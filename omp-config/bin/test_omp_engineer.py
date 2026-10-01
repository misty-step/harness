"""Non-live policy/cgroup fixtures; no systemd launches or live cgroup mutation."""

import copy
import fcntl
import importlib.util
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
LEGACY = ROOT + "/app.slice/app-terminal.scope"


def group(path, maximum=None, swap=None, current=0, oom=0, populated=False):
    return {"path": path, "memory_max": maximum, "memory_swap_max": swap,
            "memory_high": None, "current_bytes": current, "oom_group": oom,
            "populated": populated}


def scope(number, *, current=0, populated=True):
    unit = f"omp-engineer-{number:024x}.scope"
    return {**group(FLEET + "/" + unit, 4 * GIB, 0, current, 1, populated), "unit": unit,
            "systemd_memory_max": 4 * GIB, "systemd_memory_swap_max": 0,
            "systemd_oom_policy": "kill"}


def process(pid, *, ppid=1, rss=GIB, pss=None, native=True, path=LEGACY):
    return {"pid": pid, "ppid": ppid, "uid": 1000, "starttime": pid * 10,
            "rss_bytes": rss, "pss_bytes": rss if pss is None else pss,
            "native_omp": native, "cgroup": path, "comm": "omp" if native else "worker",
            "exe": "/home/fixture/.local/bin/omp" if native else "/usr/bin/worker"}


def measurement():
    return {"schema_version": 1, "uid": 1000, "user_root": ROOT,
            "current_group": ROOT + "/app.slice/fixture.scope", "available_bytes": 128 * GIB,
            "fleet": {**group(FLEET, 36 * GIB, 0), "slice": "-.slice"},
            "ancestors": [group(path) for path in ("/user.slice", "/user.slice/user-1000.slice", ROOT)],
            "monitored": [ROOT + "/app.slice"], "scopes": [], "processes": [], "legacy_groups": [],
            "heavy": {"path": ROOT + "/dev.slice/dev-exec.slice", "current_bytes": 0, "jobs": []},
            "captured_at": "2026-10-01T00:00:00+00:00"}


class AdmissionTests(unittest.TestCase):
    def test_rolling_uncaged_charge_is_measured_and_includes_idle_native_subagents(self):
        snapshot = measurement()
        snapshot["processes"] = [process(100 + number, rss=GIB // 4, pss=GIB // 8) for number in range(20)]
        # Twenty idle native roots are 5 GiB, not a fictional 80-GiB reservation.
        admitted = core.admission(snapshot)
        self.assertTrue(admitted["admitted"])
        self.assertEqual(admitted["capacity"]["fleet_demand_bytes"], 9 * GIB)
        self.assertEqual(admitted["capacity"]["uncaged_count"], 20)
        self.assertEqual(admitted["capacity"]["uncaged_pss_bytes"], 20 * GIB // 8)
        # An engineer's native subagent and worker count as descendants, not new roots.
        snapshot["processes"].extend([process(300, ppid=100, rss=GIB),
                                      process(301, ppid=300, rss=31 * GIB, native=False)])
        refused = core.admission(snapshot)
        self.assertFalse(refused["admitted"])
        self.assertEqual(refused["capacity"]["fleet_demand_bytes"], 41 * GIB)
        self.assertEqual(refused["capacity"]["uncaged_count"], 20)
        self.assertEqual(refused["uncaged"][0]["pids"], [100, 300, 301])

    def test_scope_lifetime_reserves_full_ceiling_for_idle_and_lingering_children(self):
        snapshot = measurement()
        snapshot["scopes"] = [scope(number) for number in range(8)]
        snapshot["available_bytes"] = 20 * GIB
        boundary = core.admission(snapshot)
        self.assertTrue(boundary["admitted"])
        self.assertEqual(boundary["capacity"]["caged_reserved_bytes"], 32 * GIB)
        lingering = scope(8, current=GIB // 4)
        snapshot["scopes"].append(lingering)
        snapshot["processes"].append(process(500, path=lingering["path"], native=False, rss=GIB // 4))
        refused = core.admission(snapshot)
        self.assertFalse(refused["admitted"])
        self.assertEqual(refused["capacity"]["caged_reserved_bytes"], 36 * GIB)
        self.assertEqual(refused["capacity"]["uncaged_count"], 0)
        # Only an empty cgroup releases the reservation, not loss of native PID.
        lingering["populated"] = False
        snapshot["processes"] = []
        self.assertTrue(core.admission(snapshot)["admitted"])

    def test_old_physical_usage_is_not_subtracted_twice_from_memavailable(self):
        snapshot = measurement()
        snapshot["processes"] = [process(100, rss=20 * GIB, pss=10 * GIB)]
        snapshot["available_bytes"] = 20 * GIB
        result = core.admission(snapshot)
        self.assertTrue(result["admitted"])
        self.assertEqual(result["capacity"]["required_available_bytes"], 20 * GIB)
        self.assertEqual(result["capacity"]["fleet_demand_bytes"], 24 * GIB)

    def test_scale_up_uses_twenty_gib_floor_not_unused_cage_or_heavy_headroom(self):
        snapshot = measurement()
        snapshot["scopes"] = [scope(number) for number in range(4)]
        snapshot["processes"] = [process(100 + number, rss=GIB // 4) for number in range(20)]
        # Today's reported 52.3 GB, the exact floor, and one byte below it.
        for available, admitted in ((52_300_000_000, True), (20 * GIB, True), (20 * GIB - 1, False)):
            with self.subTest(available=available):
                snapshot["available_bytes"] = available
                result = core.admission(snapshot)
                self.assertEqual(result["admitted"], admitted)
                self.assertEqual(result["capacity"]["required_available_bytes"], 20 * GIB)
                self.assertEqual(result["capacity"]["fleet_demand_bytes"], 25 * GIB)

    def test_retained_legacy_group_keeps_reparented_children_charged_once(self):
        snapshot = measurement()
        snapshot["legacy_groups"] = [LEGACY]
        snapshot["processes"] = [process(200, ppid=100, native=False, rss=33 * GIB),
                                  process(201, ppid=200, native=False, rss=GIB),
                                  process(202, native=False, path=ROOT + "/app.slice/unrelated.scope", rss=50 * GIB)]
        result = core.admission(snapshot)
        self.assertFalse(result["admitted"])
        self.assertEqual(result["capacity"]["uncaged_count"], 0)
        self.assertEqual(result["capacity"]["uncaged_rss_bytes"], 34 * GIB)
        self.assertEqual(result["legacy_unattributed_pids"], [200, 201])
        snapshot["processes"].append(process(100, rss=GIB))
        result = core.admission(snapshot)
        self.assertEqual(result["capacity"]["uncaged_rss_bytes"], 35 * GIB)
        self.assertEqual(result["capacity"]["legacy_process_count"], 3)
        snapshot["processes"][-1].update(exited=True, native_omp=False, rss_bytes=0, pss_bytes=0)
        after_exit = core.admission(snapshot)
        self.assertEqual(after_exit["capacity"]["legacy_process_count"], 2)
        self.assertEqual(after_exit["capacity"]["uncaged_rss_bytes"], 34 * GIB)
        self.assertEqual(after_exit["legacy_unattributed_pids"], [200, 201])

    def test_nested_launch_reuses_a_real_verified_cage_even_when_new_admission_is_full(self):
        snapshot = measurement()
        snapshot["scopes"] = [scope(number) for number in range(9)]
        snapshot["current_group"] = snapshot["scopes"][0]["path"]
        snapshot["available_bytes"] = 0
        result = core.admission(snapshot)
        self.assertTrue(result["admitted"])
        self.assertTrue(result["reuses_cage"])
        self.assertEqual(result["capacity"]["new_reservation_bytes"], 0)
        snapshot["scopes"][0]["oom_group"] = 0
        with self.assertRaises(core.CageError):
            core.admission(snapshot)

    def test_actual_ancestor_bounds_and_oomd_monitors_cannot_be_hidden_by_leaf_limits(self):
        snapshot = measurement()
        snapshot["ancestors"][-1].update(memory_max=24 * GIB, current_bytes=8 * GIB)
        result = core.admission(snapshot)
        self.assertFalse(result["admitted"])
        self.assertEqual(result["capacity"]["effective_memory_max_bytes"], 24 * GIB)
        snapshot["ancestors"][-1].update(memory_max=32 * GIB, current_bytes=0)
        self.assertEqual(core.admission(snapshot)["capacity"]["effective_memory_max_bytes"], 32 * GIB)
        for corrupt in (lambda s: s["ancestors"][0].update(oom_group=1),
                        lambda s: s["monitored"].append(ROOT),
                        lambda s: s["monitored"].append("/"),
                        lambda s: s["monitored"].append(scope(0)["path"])):
            candidate = measurement()
            candidate["scopes"] = [scope(0)]
            corrupt(candidate)
            with self.assertRaises(core.CageError):
                core.admission(candidate)

    def test_active_heavy_bounds_are_checked_without_reserving_unused_capacity(self):
        snapshot = measurement()
        snapshot["available_bytes"] = 20 * GIB
        snapshot["heavy"].update(memory_max=60 * GIB, memory_swap_max=8 * GIB, populated=False)
        self.assertTrue(core.admission(snapshot)["admitted"])
        path = ROOT + "/dev.slice/dev-exec.slice"
        snapshot["heavy"] = {**group(path, 16 * GIB, 2 * GIB, current=4 * GIB, populated=True),
                             "jobs": [{**group(path + "/dev-job-1.scope", 8 * GIB, GIB,
                                               current=4 * GIB, oom=1, populated=True), "unit": "dev-job-1.scope"}]}
        result = core.admission(snapshot)
        self.assertTrue(result["admitted"])
        self.assertEqual(result["capacity"]["required_available_bytes"], 20 * GIB)
        snapshot["heavy"]["memory_max"] = 60 * GIB
        with self.assertRaises(core.CageError):
            core.admission(snapshot)

    def test_incomplete_or_ambiguous_measurements_fail_closed(self):
        for corrupt in (lambda s: s["ancestors"][-1].pop("memory_max"),
                        lambda s: s.pop("monitored"),
                        lambda s: s["ancestors"].pop(),
                        lambda s: s["fleet"].update(slice="app.slice"),
                        lambda s: s["scopes"][0].update(memory_swap_max=GIB),
                        lambda s: s["scopes"][0].update(systemd_oom_policy="continue"),
                        lambda s: s["processes"].append(copy.deepcopy(s["processes"][0])),
                        lambda s: s["processes"][0].update(pss_bytes=2 * GIB)):
            snapshot = measurement()
            snapshot["scopes"] = [scope(0)]
            snapshot["processes"] = [process(100)]
            corrupt(snapshot)
            with self.assertRaises(core.CageError):
                core.admission(snapshot)

    def test_two_stale_preflights_cannot_spend_the_last_scope_twice(self):
        snapshot = measurement()
        snapshot["scopes"] = [scope(number) for number in range(8)]
        self.assertTrue(core.admission(copy.deepcopy(snapshot))["admitted"])
        self.assertTrue(core.admission(copy.deepcopy(snapshot))["admitted"])
        with tempfile.TemporaryDirectory() as directory:
            lock_path = Path(directory) / "admission.lock"
            attempted = []
            def register(result):
                # Actual flock remains held through the verified registration callback.
                other = os.open(lock_path, os.O_RDWR)
                try:
                    with self.assertRaises(BlockingIOError):
                        fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)
                finally:
                    os.close(other)
                snapshot["scopes"].append(scope(8))
                attempted.append("registered")
                return scope(8)
            first = core.launch_transaction(core.admission_lock(lock_path), lambda: copy.deepcopy(snapshot), register)
            self.assertEqual(first["path"], FLEET + "/omp-engineer-000000000000000000000008.scope")
            with self.assertRaises(core.CageError) as refused:
                core.launch_transaction(core.admission_lock(lock_path), lambda: copy.deepcopy(snapshot), register)
            self.assertEqual(refused.exception.code, 75)
            self.assertEqual(attempted, ["registered"])
            # The launch lock is released; the still-populated scope is the reservation.
            other = os.open(lock_path, os.O_RDWR)
            try:
                fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)
            finally:
                os.close(other)
            self.assertEqual(core.admission(snapshot)["capacity"]["caged_reserved_bytes"], 36 * GIB)


class InspectionAndTerminalTests(unittest.TestCase):
    def test_unrelated_opaque_daemon_does_not_block_native_memory_inspection(self):
        host = core.Host()
        scratch = Path(os.environ.get("TMPDIR", Path.home() / ".cache/tmp"))
        scratch.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=scratch) as directory:
            host.proc = Path(directory)
            for pid, name, group in ((1, "daemon", host.root),
                                     (2, "omp", host.root + "/app.slice/terminal.scope")):
                process = host.proc / str(pid)
                process.mkdir()
                fields = ["S", *(["0"] * 21)]
                fields[1], fields[19], fields[21] = "0", "123", "1"
                (process / "stat").write_text(f"{pid} ({name}) " + " ".join(fields))
                (process / "cgroup").write_text("0::" + group + "\n")
                (process / "smaps_rollup").write_text("Pss: 1 kB\n")
                (process / "exe").symlink_to("/usr/bin/" + name)
            original = os.readlink
            def protected(path):
                if Path(path).parent.name == "1":
                    raise PermissionError("Unrelated daemon is not ptrace-readable")
                return original(path)
            with patch.object(core.os, "readlink", side_effect=protected):
                processes, groups = host.processes([], [])
            self.assertEqual([(row["pid"], row["native_omp"]) for row in sorted(processes, key=lambda row: row["pid"])],
                             [(1, False), (2, True)])
            self.assertEqual(groups, [host.root + "/app.slice/terminal.scope"])
            with patch.object(core.os, "readlink", side_effect=PermissionError("Native root is opaque")):
                with self.assertRaises(core.CageError):
                    host.processes([], [])

    def test_deleted_legacy_group_retains_live_orphan_memory_until_tasks_exit(self):
        host = core.Host()
        scratch = Path(os.environ.get("TMPDIR", Path.home() / ".cache/tmp"))
        scratch.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=scratch) as directory:
            runtime = Path(directory)
            host.proc = runtime / "proc"
            host.proc.mkdir()
            process = host.proc / "2"
            process.mkdir()
            fields = ["S", *(["0"] * 21)]
            fields[1], fields[19], fields[21] = "0", "123", "1"
            (process / "stat").write_text("2 (orphan) " + " ".join(fields))
            legacy = host.root + "/app.slice/terminal.scope"
            (process / "cgroup").write_text("0::" + legacy + " (deleted)\n")
            (process / "smaps_rollup").write_text("Pss: 1 kB\n")
            state = runtime / "legacy.json"
            state.write_text(json.dumps([legacy]))
            state.chmod(0o600)
            with patch.object(core, "runtime_path", return_value=runtime):
                self.assertEqual(host.legacy_groups(), [legacy])
            processes, groups = host.processes([legacy], [])
            self.assertEqual(groups, [legacy])
            self.assertEqual([(row["native_omp"], row["pss_bytes"]) for row in processes],
                             [(False, 1024)])
            for child in process.iterdir():
                child.unlink()
            process.rmdir()
            self.assertEqual(host.processes([legacy], []), ([], []))


    def test_native_updater_target_routing_never_leaks_into_engineer_or_read_only_paths(self):
        native = Path("/home/fixture/.local/lib/omp-engineer/omp")
        inherited = {"PATH": "/home/fixture/.local/bin:/usr/bin", "HERDR_SESSION": "kept",
                     "PI_CONFIG_FILES": "/owned/roster.yml", "OMPCODE": "1"}
        normal = ([], ["--resume=session.jsonl"], ["-p", "update"],
                  ["update", "--check"], ["update", "-c"], ["update", "--canary", "-c"])
        for argv in normal:
            self.assertEqual(core.native_environment(argv, inherited, native)["PATH"],
                             "/home/fixture/.local/bin:/usr/bin")
        for argv in (["update"], ["update", "--force"], ["update", "--canary"], ["update", "--stable"]):
            environment = core.native_environment(argv, inherited, native)
            self.assertEqual(environment["PATH"],
                             "/home/fixture/.local/lib/omp-engineer:/home/fixture/.local/bin:/usr/bin")
        self.assertEqual(inherited["PATH"], "/home/fixture/.local/bin:/usr/bin")

    def test_native_update_replaces_retained_binary_without_replacing_owned_entrypoint(self):
        # OMP 18.4.9 selects its replacement target through which("omp").
        # Exercise that external filesystem contract, not just the PATH string.
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
            environment = core.native_environment(["update"], {"PATH": str(entry.parent)}, native)
            update = """import os,shutil,sys; from pathlib import Path
target = Path(shutil.which("omp"))
assert target.read_bytes()[:4] == b"\\x7fELF"
stage = target.with_name("omp.update")
shutil.copyfile(sys.argv[1], stage)
stage.chmod(0o700)
os.replace(stage, target)
"""
            subprocess.run([str(native), "-c", update, "/usr/bin/true"],
                           env=environment, check=True, timeout=5)
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
