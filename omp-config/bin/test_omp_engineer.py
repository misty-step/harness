"""Non-live policy/cgroup fixtures; no systemd launches or live cgroup mutation."""

import copy
import fcntl
import importlib.util
import io
import json
import os
from pathlib import Path
import pty
import shutil
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("omp_engineer", Path(__file__).with_name("omp-engineer.py"))
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)
GIB = 1024 ** 3
ROOT = "/user.slice/user-1000.slice/user@1000.service"
FLEET = ROOT + "/omp.slice"


def group(path, maximum=None, swap=None, current=0, oom=0, populated=False):
    return {"path": path, "memory_max": maximum, "memory_swap_max": swap,
            "memory_high": None, "current_bytes": current, "oom_group": oom,
            "populated": populated}


def scope(number, *, current=0, populated=True):
    unit = f"omp-engineer-{number:024x}.scope"
    return {**group(FLEET + "/" + unit, 4 * GIB, 0, current, 1, populated), "unit": unit,
            "systemd_memory_max": 4 * GIB, "systemd_memory_swap_max": 0,
            "systemd_oom_policy": "kill"}


def measurement():
    return {"schema_version": 1, "uid": 1000, "user_root": ROOT,
            "current_group": ROOT + "/app.slice/fixture.scope", "available_bytes": 128 * GIB,
            "fleet": {**group(FLEET, swap=0), "slice": "-.slice"},
            "ancestors": [group(path) for path in ("/user.slice", "/user.slice/user-1000.slice", ROOT)],
            "monitored": [ROOT + "/app.slice"], "scopes": [],
            "captured_at": "2026-10-01T00:00:00+00:00"}


class AdmissionTests(unittest.TestCase):
    def test_minimal_containment_snapshot_warns_below_the_twenty_gib_floor(self):
        snapshot = measurement()
        snapshot["scopes"] = [scope(number, current=GIB // 16) for number in range(18)]
        snapshot["fleet"].update(current_bytes=2 * GIB, populated=True)
        # The 18 live cages have 72 GiB of limits; none are physical reservations.
        for available, warns in ((46 * GIB, False), (20 * GIB, False), (20 * GIB - 1, True)):
            with self.subTest(available=available):
                snapshot["available_bytes"] = available
                result = core.admission(snapshot)
                self.assertTrue(result["admitted"])
                self.assertEqual(bool(result["warnings"]), warns)
                self.assertEqual(result["capacity"]["required_available_bytes"], 20 * GIB)
                self.assertEqual(result["capacity"]["fleet_current_bytes"], 2 * GIB)
                self.assertEqual(result["capacity"]["caged_count"], 18)
                self.assertIsNone(result["capacity"]["effective_memory_max_bytes"])

    def test_measured_fleet_guideline_and_missing_capacity_measurements_warn_without_reserving(self):
        snapshot = measurement()
        snapshot["fleet"].update(current_bytes=36 * GIB, populated=True)
        self.assertEqual(core.admission(snapshot)["warnings"], [])
        snapshot["fleet"]["current_bytes"] += 1
        warning = core.admission(snapshot)["warnings"]
        self.assertIn(str(36 * GIB + 1), warning[0])
        snapshot["fleet"]["current_bytes"] = 0
        snapshot["available_bytes"] = None
        self.assertIsNone(core.admission(snapshot)["capacity"]["available_bytes"])

    def test_nested_launch_reuses_a_verified_cage_below_the_scale_up_floor(self):
        snapshot = measurement()
        snapshot["scopes"] = [scope(number) for number in range(9)]
        snapshot["current_group"] = snapshot["scopes"][0]["path"]
        snapshot["available_bytes"] = 0
        result = core.admission(snapshot)
        self.assertTrue(result["admitted"])
        self.assertTrue(result["reuses_cage"])
        snapshot["scopes"][0]["oom_group"] = 0
        with self.assertRaises(core.CageError):
            core.admission(snapshot)

    def test_actual_ancestor_bounds_and_oomd_monitors_cannot_be_hidden_by_leaf_limits(self):
        snapshot = measurement()
        snapshot["scopes"] = [scope(number, current=GIB // 16) for number in range(18)]
        snapshot["fleet"].update(current_bytes=2 * GIB, populated=True)
        snapshot["ancestors"][-1].update(memory_max=24 * GIB, current_bytes=8 * GIB)
        result = core.admission(snapshot)
        self.assertTrue(result["admitted"])
        self.assertTrue(bool(result["warnings"]))
        self.assertEqual(result["capacity"]["effective_memory_max_bytes"], 24 * GIB)
        snapshot["ancestors"][-1].update(memory_max=32 * GIB, current_bytes=12 * GIB)
        at_floor = core.admission(snapshot)
        self.assertTrue(at_floor["admitted"])
        self.assertEqual(at_floor["warnings"], [])
        self.assertEqual(at_floor["capacity"]["effective_memory_max_bytes"], 32 * GIB)
        self.assertEqual(at_floor["capacity"]["required_ancestor_headroom_bytes"], 20 * GIB)
        snapshot["ancestors"][-1]["current_bytes"] += 1
        below_floor = core.admission(snapshot)
        self.assertTrue(below_floor["admitted"])
        self.assertTrue(bool(below_floor["warnings"]))
        for corrupt in (lambda s: s["ancestors"][0].update(oom_group=1),
                        lambda s: s["monitored"].append(ROOT),
                        lambda s: s["monitored"].append("/"),
                        lambda s: s["monitored"].append(scope(0)["path"])):
            candidate = measurement()
            candidate["scopes"] = [scope(0)]
            corrupt(candidate)
            with self.assertRaises(core.CageError):
                core.admission(candidate)

    def test_finite_fleet_uses_measured_headroom_not_full_leaf_limits(self):
        snapshot = measurement()
        snapshot["scopes"] = [scope(number, current=GIB // 2) for number in range(18)]
        snapshot["available_bytes"] = 46 * GIB
        snapshot["fleet"].update(memory_max=32 * GIB, current_bytes=12 * GIB, populated=True)
        at_floor = core.admission(snapshot)
        self.assertTrue(at_floor["admitted"])
        self.assertEqual(at_floor["warnings"], [])
        self.assertEqual(at_floor["capacity"]["effective_memory_max_bytes"], 32 * GIB)
        self.assertEqual(at_floor["capacity"]["required_ancestor_headroom_bytes"], 20 * GIB)
        snapshot["fleet"]["current_bytes"] += 1
        below_floor = core.admission(snapshot)
        self.assertTrue(below_floor["admitted"])
        self.assertTrue(bool(below_floor["warnings"]))
        snapshot["fleet"]["current_bytes"] = 12 * GIB
        snapshot["ancestors"][-1].update(memory_max=24 * GIB, current_bytes=4 * GIB)
        restricted = core.admission(snapshot)
        self.assertTrue(restricted["admitted"])
        self.assertEqual(restricted["capacity"]["effective_memory_max_bytes"], 24 * GIB)

    def test_incomplete_or_ambiguous_containment_measurements_fail_closed(self):
        for corrupt in (lambda s: s["ancestors"][-1].pop("memory_max"),
                        lambda s: s.update(uid="1000"),
                        lambda s: s.pop("monitored"),
                        lambda s: s.pop("scopes"),
                        lambda s: s["ancestors"].pop(),
                        lambda s: s["fleet"].update(slice="app.slice"),
                        lambda s: s["fleet"].update(memory_swap_max=GIB),
                        lambda s: s["fleet"].update(memory_high=GIB),
                        lambda s: s["fleet"].update(oom_group=1),
                        lambda s: s["scopes"][0].update(memory_max=8 * GIB),
                        lambda s: s["scopes"][0].update(memory_swap_max=GIB),
                        lambda s: s["scopes"][0].update(systemd_memory_max=8 * GIB),
                        lambda s: s["scopes"][0].update(systemd_oom_policy="continue"),
                        lambda s: s["scopes"].append(copy.deepcopy(s["scopes"][0])),
                        lambda s: s.update(current_group=FLEET)):
            snapshot = measurement()
            snapshot["scopes"] = [scope(0)]
            corrupt(snapshot)
            with self.assertRaises(core.CageError):
                core.admission(snapshot)

    @patch.object(core.subprocess, "run", side_effect=FileNotFoundError("Glass is unavailable"))
    def test_serialized_launch_remeasures_warnings_and_registers_below_floor(self, _run):
        snapshot = measurement()
        snapshot["scopes"] = [scope(number, current=GIB // 16) for number in range(18)]
        snapshot["fleet"].update(current_bytes=2 * GIB, populated=True)
        snapshot["available_bytes"] = 20 * GIB
        with tempfile.TemporaryDirectory() as directory:
            lock_path = Path(directory) / "admission.lock"
            attempted = []
            def assert_locked():
                other = os.open(lock_path, os.O_RDWR)
                try:
                    with self.assertRaises(BlockingIOError):
                        fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)
                finally:
                    os.close(other)
            def inspect():
                assert_locked()
                return copy.deepcopy(snapshot)
            def register(result):
                assert_locked()
                registered = scope(18 + len(attempted), current=GIB // 16)
                snapshot["scopes"].append(registered)
                snapshot["fleet"]["current_bytes"] += GIB // 16
                snapshot["available_bytes"] -= 1
                attempted.append((result["capacity"]["available_bytes"],
                                  result["admitted"], bool(result["warnings"])))
                return registered
            with patch.object(sys, "stderr", io.StringIO()):
                core.launch_transaction(core.admission_lock(lock_path), inspect, register)
                core.launch_transaction(core.admission_lock(lock_path), inspect, register)
            self.assertEqual(attempted, [(20 * GIB, True, False), (20 * GIB - 1, True, True)])
            # The verified handoff releases the lock, not hypothetical cage slots.
            other = os.open(lock_path, os.O_RDWR)
            try:
                fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)
            finally:
                os.close(other)


class NativeDispatchTests(unittest.TestCase):
    RECEIPT = r'''
import json, os, sys
from pathlib import Path
Path(os.environ["OMP_EXEC_RECEIPT"]).write_text(json.dumps({
    "pid": os.getpid(), "exe": os.readlink("/proc/self/exe"),
    "argv": sys.argv[1:], "tty": os.isatty(0),
}))
sys.exit(23)
'''
    DRIVER = r'''
import importlib.util, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location("core", sys.argv[1])
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)
native, runtime, trace_file = map(Path, sys.argv[2:5])
root, argv = sys.argv[5], sys.argv[6:]
def trace(value):
    with trace_file.open("a") as handle:
        handle.write(value + "\n")
class FixtureHost:
    def __init__(self, *args):
        trace("host")
        self.root = root
    def current_group(self):
        trace("membership")
        raise core.CageError("Launcher membership is outside the verified user hierarchy")
def forbidden_registration(*args):
    raise AssertionError("Unsafe membership attempted a live systemd registration")
core.Host = FixtureHost
core.native_path = lambda: native
core.runtime_path = lambda: runtime
core.start_scope = forbidden_registration
sys.argv = ["omp", *argv]
try:
    sys.exit(core.main(argv))
except core.CageError as exc:
    print(str(exc), file=sys.stderr)
    sys.exit(exc.code)
'''

    def dispatch(self, options, *, terminal, command=None):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            native = base / "native" / "omp"
            native.parent.mkdir()
            shutil.copyfile(sys.executable, native)
            native.chmod(0o700)
            trace_file, receipt_file = base / "trace", base / "receipt.json"
            if command is None:
                argv = ["-c", self.RECEIPT, *options]
            else:
                (base / command).write_text(self.RECEIPT)
                argv = [command, *options]
            environment = {**os.environ, "OMP_EXEC_RECEIPT": str(receipt_file)}
            master, slave = pty.openpty() if terminal else (None, None)
            try:
                with subprocess.Popen(
                        [sys.executable, "-c", self.DRIVER,
                         str(Path(__file__).with_name("omp-engineer.py").resolve()), str(native),
                         str(base / "runtime"), str(trace_file), ROOT, *argv],
                        cwd=base, env=environment, stdin=slave if terminal else subprocess.DEVNULL,
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) as child:
                    try:
                        _, stderr = child.communicate(timeout=5)
                    except subprocess.TimeoutExpired:
                        child.kill()
                        child.communicate()
                        raise
                    return {"code": child.returncode, "stderr": stderr, "pid": child.pid,
                            "native": str(native),
                            "receipt": json.loads(receipt_file.read_text()) if receipt_file.exists() else None,
                            "inspections": trace_file.read_text().splitlines() if trace_file.exists() else []}
            finally:
                if terminal:
                    os.close(master)
                    os.close(slave)

    def test_native_roots_and_aliases_route_only_outside_flag_values_and_prompt_data(self):
        with patch.object(core.os, "isatty", return_value=True):
            for args in (["join"], ["img"], ["plugins"], ["q"], ["skills"], ["wt"],
                         ["--model", "opus", "models"], ["--approval-mode=yolo", "update"],
                         ["--profile", "work", "models"], ["--metadata", "", "models"]):
                with self.subTest(args=args):
                    self.assertFalse(core.engineer_invocation(args))
            for args in (["--model", "models"], ["--resume", "update"],
                         ["--metadata", "models"], ["--", "models"],
                         ["launch", "models"], ["a prompt", "models"]):
                with self.subTest(args=args):
                    self.assertTrue(core.engineer_invocation(args))

    def test_nonengineer_native_exec_bypasses_unavailable_containment_inspection(self):
        cases = ((["-p"], True, None), (["--print"], True, None),
                 (["--mode", "json"], True, None), (["--mode=rpc"], True, None),
                 (["--mode", "acp"], True, None), (["--mode", "text"], True, None),
                 (["--mode=rpc-ui"], True, None), (["--version"], True, None),
                 (["--help"], True, None), ([], False, None), (["--check"], True, "update"))
        for options, terminal, command in cases:
            with self.subTest(options=options, terminal=terminal, command=command):
                result = self.dispatch(options, terminal=terminal, command=command)
                self.assertEqual(result["code"], 23, result["stderr"])
                self.assertEqual(result["receipt"], {"pid": result["pid"], "exe": result["native"],
                                                     "argv": options, "tty": terminal})
                self.assertEqual(result["inspections"], [])

    def test_engineers_require_safe_membership_and_print_shaped_data_cannot_bypass(self):
        cases = (([], True), (["--", "-p"], True),
                 (["--system-prompt", "-p", "--model", "-p"], True),
                 (["--system-prompt=-p"], True), (["--model", "models"], True),
                 (["--resume", "models"], True), (["--", "--mode=json"], True))
        for options, terminal in cases:
            with self.subTest(options=options, terminal=terminal):
                result = self.dispatch(options, terminal=terminal)
                self.assertEqual(result["code"], 1, result["stderr"])
                self.assertIsNone(result["receipt"])
                self.assertIn("membership", result["inspections"])


class InspectionAndTerminalTests(unittest.TestCase):
    def test_staged_roster_is_unenforced_but_partial_activation_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            entry = home / ".local/bin/omp"
            entry.parent.mkdir(parents=True)
            entry.write_bytes(b"\x7fELFregular native remains untouched")
            account = core.pwd.struct_passwd(("fixture", "x", os.getuid(), os.getgid(),
                                            "", str(home), "/bin/sh"))
            with patch.object(core.pwd, "getpwuid", return_value=account), \
                    patch.object(core, "Host", side_effect=core.CageError("No user manager")):
                output = io.StringIO()
                with patch.object(sys, "stdout", output):
                    self.assertEqual(core.memory(["--json"]), 0)
                inactive = json.loads(output.getvalue())
                self.assertFalse(inactive["activated"])
                self.assertTrue(inactive["admitted"])
                self.assertFalse(inactive["reservation"])
                self.assertIsNone(inactive["capacity"])
                entry.unlink()
                entry.symlink_to("omp-engineer")
                with self.assertRaises(core.CageError):
                    core.memory(["--json"])
                entry.unlink()
                for relative in (".local/lib/omp-engineer/omp", ".config/systemd/user/omp.slice"):
                    marker = home / relative
                    marker.parent.mkdir(parents=True, exist_ok=True)
                    marker.touch()
                    with self.assertRaises(core.CageError):
                        core.memory(["--json"])
                    marker.unlink()

    def test_live_snapshot_admits_without_process_memory_or_legacy_state(self):
        snapshot = measurement()
        snapshot["available_bytes"] = 20 * GIB
        snapshot["scopes"] = [scope(0, current=GIB // 16)]
        snapshot["fleet"].update(current_bytes=GIB // 16, populated=True)
        with tempfile.TemporaryDirectory() as directory:
            host = core.Host(seconds=float("inf"))
            host.uid, host.root = snapshot["uid"], snapshot["user_root"]
            host.proc = Path(directory) / "proc"
            host.cgroup = Path(directory) / "cgroup"
            own = host.proc / str(os.getpid())
            own.mkdir(parents=True)
            (own / "cgroup").write_text("0::" + snapshot["current_group"] + "\n")
            (host.proc / "meminfo").write_text(f"MemAvailable: {20 * GIB // 1024} kB\n")
            # There are no stat, exe or smaps files, and no retained runtime state.
            for record in [*snapshot["ancestors"], snapshot["fleet"], *snapshot["scopes"]]:
                group_directory = host.cgroup / record["path"].lstrip("/")
                group_directory.mkdir(parents=True, exist_ok=True)
                for filename, key in (("memory.max", "memory_max"),
                                      ("memory.swap.max", "memory_swap_max"),
                                      ("memory.high", "memory_high"),
                                      ("memory.current", "current_bytes"),
                                      ("memory.oom.group", "oom_group")):
                    value = record[key]
                    (group_directory / filename).write_text("max" if value is None else str(value))
                (group_directory / "cgroup.events").write_text(
                    f"populated {int(record['populated'])}\nfrozen 0\n")
                (group_directory / "cgroup.procs").write_text("")

            def capture(argv):
                if argv[0] == core.OOMCTL:
                    return ("Swap Monitored CGroups:\nMemory Pressure Monitored CGroups:\n"
                            f"  Path: {ROOT}/app.slice\n")
                if "list-units" in argv:
                    return json.dumps([{"unit": snapshot["scopes"][0]["unit"]}])
                unit = argv[argv.index("show") + 1]
                if unit == "omp.slice":
                    properties = {"Id": unit, "LoadState": "loaded", "ActiveState": "active",
                                  "ControlGroup": FLEET, "Slice": "-.slice", "MemoryMax": "infinity",
                                  "MemorySwapMax": "0", "MemoryHigh": "infinity"}
                elif unit == snapshot["scopes"][0]["unit"]:
                    properties = {"Id": unit, "LoadState": "loaded", "ActiveState": "active",
                                  "ControlGroup": snapshot["scopes"][0]["path"], "Slice": "omp.slice",
                                  "MemoryMax": str(4 * GIB), "MemorySwapMax": "0", "OOMPolicy": "kill"}
                else:
                    raise AssertionError(f"Unrelated unit inspection: {unit}")
                return "\n".join(f"{field[2:]}={properties[field[2:]]}"
                                 for field in argv if field.startswith("-p"))

            original_iterdir = Path.iterdir
            def limited_iterdir(path):
                if path == host.proc:
                    raise AssertionError("Snapshot attempted a process-wide /proc walk")
                return original_iterdir(path)
            with patch.object(host, "capture", side_effect=capture), \
                    patch.object(Path, "iterdir", new=limited_iterdir), \
                    patch.object(core, "runtime_path", side_effect=AssertionError("Legacy runtime inspection")):
                result = core.admission(host.snapshot())
                (host.proc / "meminfo").unlink()
                missing = core.admission(host.snapshot())
                self.assertIsNone(missing["capacity"]["available_bytes"])
                self.assertEqual(missing["scopes"][0]["path"], snapshot["scopes"][0]["path"])
            self.assertTrue(result["admitted"])
            self.assertFalse(result["reuses_cage"])


    def test_native_update_replaces_only_retained_binary_and_preserves_normal_target_resolution(self):
        # Exercise native which("omp") and actual ELF replacement, not PATH strings.
        scratch = Path(os.environ.get("TMPDIR", Path.home() / ".cache/tmp"))
        scratch.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=scratch) as directory:
            home = Path(directory)
            entry = home / ".local/bin/omp"
            entry.parent.mkdir(parents=True)
            launcher = entry.with_name("omp-engineer")
            owned = b"#!/usr/bin/env python3\n# owned by misty-step/harness omp-config engineer-cage\n"
            launcher.write_bytes(owned)
            launcher.chmod(0o700)
            entry.symlink_to("omp-engineer")
            native = home / ".local/lib/omp-engineer/omp"
            native.parent.mkdir(parents=True)
            shutil.copyfile(sys.executable, native)
            native.chmod(0o700)
            inherited = {"PATH": str(entry.parent)}
            for args in ([], ["launch", "update"], ["--resume=session"], ["--", "update"],
                         ["--model", "update"], ["update", "--check"], ["update", "-c"],
                         ["--model", "--check", "update", "--check"]):
                with self.subTest(args=args):
                    selected = subprocess.check_output(
                        [str(native), "-c", 'import shutil; print(shutil.which("omp"))'],
                        env=core.native_environment(args, inherited, native), text=True, timeout=5)
                    self.assertEqual(selected.strip(), str(entry))
            update = """import os,shutil,sys; from pathlib import Path
target = Path(shutil.which("omp"))
assert target.read_bytes()[:4] == b"\\x7fELF"
stage = target.with_name("omp.update")
shutil.copyfile(sys.argv[1], stage)
stage.chmod(0o700)
os.replace(stage, target)
"""
            for args in (["update"], ["--model", "--check", "update"], ["-p", "update"],
                         ["--cwd", str(home), "update"]):
                with self.subTest(args=args):
                    shutil.copyfile(sys.executable, native)
                    native.chmod(0o700)
                    subprocess.run([str(native), "-c", update, "/usr/bin/true"],
                                   env=core.native_environment(args, inherited, native), check=True, timeout=5)
                    self.assertEqual(native.read_bytes(), Path("/usr/bin/true").read_bytes())
                    self.assertTrue(entry.is_symlink())
                    self.assertEqual(os.readlink(entry), "omp-engineer")
                    self.assertEqual(launcher.read_bytes(), owned)
                    self.assertEqual(subprocess.run([str(native)], check=False, timeout=5).returncode, 0)

    def test_missing_actual_cgroup_control_and_malformed_oomd_inventory_refuse(self):
        host = core.Host(seconds=float("inf"))
        with tempfile.TemporaryDirectory() as directory:
            host.cgroup = Path(directory)
            leaf = host.cgroup / "fixture"
            leaf.mkdir()
            for name, value in (("memory.max", "4294967296"), ("memory.swap.max", "0"),
                                ("memory.high", "max"), ("memory.current", "0"),
                                ("memory.oom.group", "1"), ("cgroup.events", "populated 1\nfrozen 0\n")):
                (leaf / name).write_text(value)
            self.assertEqual(host.group_controls("/fixture")["oom_group"], 1)
            (leaf / "memory.oom.group").unlink()
            with self.assertRaises(core.CageError):
                host.group_controls("/fixture")
        host.capture = lambda argv: "Memory Pressure Monitored CGroups:\n\tPath: /user.slice\n"
        with self.assertRaises(core.CageError):
            host.monitors()

    def test_native_handoff_rejects_a_truncated_response(self):
        first, second = socket.socketpair()
        try:
            second.sendall(b"READY\n")
            self.assertEqual(core.receive_line(first), b"READY\n")
            second.sendall(b"EX")
            second.shutdown(socket.SHUT_WR)
            with self.assertRaises(core.CageError):
                core.receive_line(first)
        finally:
            first.close()
            second.close()

    def test_polluted_pty_recovery_discards_pending_input_and_restores_shell_modes(self):
        master, slave = pty.openpty()
        script = r'''
import fcntl, importlib.util, json, os, select, sys, termios, tty
spec = importlib.util.spec_from_file_location("core", sys.argv[1])
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)
master, slave = int(sys.argv[2]), int(sys.argv[3])
os.setsid()
fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
os.dup2(slave, 0)
os.dup2(slave, 2)
tty.setraw(0)
os.write(master, b"STALE-PENDING-TOOL-INPUT")
select.select([0], [], [])
terminal = core.Terminal()
terminal.recover_if_polluted()
os.write(master, b"safe\n")
value = os.read(0, 4096)
mode = termios.tcgetattr(0)
print(json.dumps({"input": value.decode(), "canonical": bool(mode[3] & termios.ICANON),
                  "echo": bool(mode[3] & termios.ECHO), "signals": bool(mode[3] & termios.ISIG)}))
'''
        try:
            result = subprocess.run([sys.executable, "-c", script, str(Path(__file__).with_name("omp-engineer.py")),
                                     str(master), str(slave)], pass_fds=(master, slave), capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout), {"input": "safe\n", "canonical": True, "echo": True, "signals": True})
        finally:
            os.close(master)
            os.close(slave)


if __name__ == "__main__":
    unittest.main()
