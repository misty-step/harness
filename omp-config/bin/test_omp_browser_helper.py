"""Real component handoffs in disposable scopes, not native-agent acceptance."""

import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

DIRECTORY = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("browser_display", DIRECTORY / "omp-display.py")
assert spec is not None and spec.loader is not None
display = importlib.util.module_from_spec(spec)
spec.loader.exec_module(display)


class BrowserBoundaryTests(unittest.TestCase):
    def test_private_runtime_is_disk_backed_and_never_tmpfs(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            args = display.mounts(home, home / "dns", home / "tmp", private_run=home / "run")
            for target in (home / ".omp/run", home / ".cache/tmp", Path("/tmp"), Path("/var/tmp")):
                index = args.index(str(target))
                self.assertEqual(args[index - 2], "--bind")
            with patch.object(display, "capture", return_value="tmpfs\n"):
                with self.assertRaises(display.DisplayError):
                    display.disk_scratch(home)
            home.chmod(0o755)
            with self.assertRaises(display.DisplayError):
                display.disk_scratch(home)  # Per-launch storage remains strictly private.

    def test_helper_checks_reject_every_weakened_control(self):
        props = {"MemoryMax": str(4 * 1024 ** 3), "MemoryHigh": "infinity",
                 "MemorySwapMax": "0", "OOMPolicy": "kill"}
        controls = {"memory.max": str(4 * 1024 ** 3), "memory.high": "max",
                    "memory.swap.max": "0", "memory.oom.group": "1"}
        display.verify_helper_controls(props, controls)
        for key, bad in (("memory.max", "max"), ("memory.max", "32"),
                         ("memory.swap.max", "max"), ("memory.high", "32"),
                         ("memory.oom.group", "0")):
            with self.subTest(key=key), self.assertRaises(display.DisplayError):
                display.verify_helper_controls(props, {**controls, key: bad})
        for key, bad in (("MemoryMax", "infinity"), ("MemoryHigh", "32"),
                         ("MemorySwapMax", "infinity"), ("OOMPolicy", "continue")):
            with self.subTest(key=key), self.assertRaises(display.DisplayError):
                display.verify_helper_controls({**props, key: bad}, controls)

    def test_owner_incarnation_and_root_pidfd_are_rechecked(self):
        group = display.process_group(os.getpid())
        if display.SCOPE.fullmatch(group.rsplit("/", 1)[-1]) is None:
            self.skipTest("actual disposable owner required")
        # Only this test process is pinned. No fabricated response is host proof.
        with display.BrowserOwner() as owner:
            original = owner.invocation
            with patch.object(display, "unit_state", return_value={
                    **owner.properties, "InvocationID": "0" * 32}):
                with self.assertRaises(display.DisplayError):
                    owner.verify()
            self.assertEqual(owner.invocation, original)
            owner.verify()

@unittest.skipUnless(shutil.which("bwrap") and shutil.which("slirp4netns"), "namespace dependencies")
class CompiledHandoffTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        group = Path("/proc/self/cgroup").read_text().strip().removeprefix("0::")
        if not group.rsplit("/", 1)[-1].startswith("omp-engineer-"):
            raise unittest.SkipTest("run in an actual disposable uncapped omp-engineer scope")
        runtime = Path.home() / ".local/state"
        runtime.mkdir(mode=0o700, parents=True, exist_ok=True)
        cls.scratch = tempfile.TemporaryDirectory(dir=runtime)
        cls.root = Path(cls.scratch.name)
        cls.owner_group = group
        cls.boundary = cls.root / "omp-display.py"
        shutil.copyfile(DIRECTORY / "omp-display.py", cls.boundary)
        cls.helper = cls.root / "omp-browser-helper"
        subprocess.run([os.environ.get("RUSTC", "rustc"), "--edition=2024", "-O",
                        str(DIRECTORY / "omp-browser-helper.rs"), "-o", str(cls.helper)],
                       check=True, timeout=60)

    @classmethod
    def tearDownClass(cls):
        cls.scratch.cleanup()

    def test_compiled_shim_execs_only_in_verified_sibling_and_preserves_stdio_group(self):
        owner = Path("/proc/self/cgroup").read_text().strip().removeprefix("0::")
        before = display.unit_state(owner.rsplit("/", 1)[-1])
        # The target is a tiny local component, explicitly not Chromium/agent acceptance.
        code = "import json,os,sys; print(json.dumps({'pid':os.getpid(),'pgrp':os.getpgrp(),'group':open('/proc/self/cgroup').read().strip(),'input':sys.stdin.read(),'args':sys.argv[1:]}))"
        bootstrap = "import os,sys; os.execv(sys.argv[1],[sys.argv[1],'-c',sys.argv[2],str(os.getpid()),str(os.getpgrp()),'argument with spaces'])"
        env = {k: v for k, v in os.environ.items() if not k.startswith(("HERDR_", "OMP_ENGINEER_DISPLAY"))}
        env.update(OMP_ENGINEER_BROWSER_ISOLATION="chromium-v1", PUPPETEER_EXECUTABLE_PATH="/usr/bin/python3")
        result = subprocess.run(["/usr/bin/python3", str(self.boundary), "--", "/usr/bin/python3",
                                 "-c", bootstrap, str(self.helper), code], env=env,
                                input="native stdin", capture_output=True, text=True, timeout=25)
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads(result.stdout)
        group = receipt["group"].removeprefix("0::")
        self.assertNotEqual(group, owner)
        self.assertEqual(group.rsplit("/", 1)[0], owner.rsplit("/", 1)[0])
        self.assertEqual(receipt["input"], "native stdin")
        self.assertEqual(receipt["args"], [str(receipt["pid"]), str(receipt["pgrp"]), "argument with spaces"])
        self.assertGreater(receipt["pid"], 0)
        deadline = time.monotonic() + 3
        while "LoadState=not-found" not in display.capture([
                "/usr/bin/systemctl", "--user", "show", group.rsplit("/", 1)[-1], "-pLoadState"]):
            self.assertLess(time.monotonic(), deadline, "component helper scope did not drain")
            time.sleep(0.05)
        self.assertEqual(display.unit_state(owner.rsplit("/", 1)[-1]), before)

    def test_nested_opt_in_without_controller_refuses_before_native_execution(self):
        native = Path.home() / ".local/lib/omp-engineer/omp"
        native.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.assertFalse(native.exists(), "disposable native target must be unused")
        shutil.copyfile("/usr/bin/touch", native)
        native.chmod(0o700)
        launcher = self.root / "omp-engineer.py"
        shutil.copyfile(DIRECTORY / "omp-engineer.py", launcher)
        code = r'''
import json, os, subprocess, sys, tempfile
from pathlib import Path
marker = Path(tempfile.gettempdir()) / "nested-target-ran"
env = {**os.environ, "OMP_ENGINEER_BROWSER_ISOLATION": "chromium-v1",
       "PUPPETEER_EXECUTABLE_PATH": "/usr/bin/chromium"}
p = subprocess.run(["/usr/bin/python3", sys.argv[1], "--", str(marker)],
                   env=env, capture_output=True, text=True, timeout=10)
print(json.dumps({"exit": p.returncode, "executed": marker.exists(), "error": p.stderr}))
'''
        env = {k: v for k, v in os.environ.items()
               if not k.startswith(("HERDR_", "OMP_ENGINEER_DISPLAY", "OMP_ENGINEER_BROWSER_ISOLATION"))}
        try:
            child = subprocess.run(["/usr/bin/python3", str(self.boundary), "--", "/usr/bin/python3",
                                    "-c", code, str(launcher)], env=env,
                                   capture_output=True, text=True, timeout=25)
            self.assertEqual(child.returncode, 0, child.stderr)
            receipt = json.loads(child.stdout)
            self.assertEqual(receipt["exit"], 1, receipt)
            self.assertFalse(receipt["executed"], receipt)
            self.assertIn("existing Chromium controller", receipt["error"])
        finally:
            native.unlink()

    def test_same_namespace_nonshim_peer_is_refused_without_moving_it(self):
        code = "import json,os,socket; s=socket.socket(socket.AF_UNIX); s.connect('/run/user/'+str(os.getuid())+'/omp-browser-helper.sock'); s.sendall(b'CHROMIUM\\n'); print(json.dumps({'reply':s.recv(256).decode(),'group':open('/proc/self/cgroup').read().strip()}))"
        env = {k: v for k, v in os.environ.items() if not k.startswith(("HERDR_", "OMP_ENGINEER_DISPLAY"))}
        env["OMP_ENGINEER_BROWSER_ISOLATION"] = "chromium-v1"
        child = subprocess.run(["/usr/bin/python3", str(self.boundary), "--", "/usr/bin/python3", "-c", code],
                               env=env, capture_output=True, text=True, timeout=25)
        self.assertEqual(child.returncode, 0, child.stderr)
        self.assertEqual(json.loads(child.stdout), {"reply": "ERR browser isolation admission failed\n",
                                                   "group": "0::" + self.owner_group})

    def test_host_namespace_peer_is_refused_and_never_moves(self):
        with display.BrowserBridge(self.root / "reject.sock", self.helper) as bridge:
            # Pin only this host namespace to demonstrate refusal at private provenance.
            with self.assertRaises(display.DisplayError):
                bridge.pin_namespace(os.getpid())
            with socket.socket(socket.AF_UNIX) as client:
                client.settimeout(3)
                client.connect(str(self.root / "reject.sock"))
                client.sendall(b"CHROMIUM\n")
                self.assertEqual(display.HerdrBridge.line(client), b"ERR browser isolation admission failed")
        self.assertFalse((self.root / "reject.sock").exists())


    def spawn(self, directory, endpoint):
        marker = directory / "browser-ran"
        runtime = f"/run/user/{os.getuid()}/omp-browser-helper.sock"
        environment = {**os.environ, "OMP_CHROMIUM_EXECUTABLE": "/usr/bin/touch"}
        child = subprocess.Popen(
            ["bwrap", "--unshare-user", "--unshare-pid", "--die-with-parent",
             "--ro-bind", "/", "/", "--proc", "/proc", "--dev", "/dev",
             "--tmpfs", "/run", "--dir", f"/run/user/{os.getuid()}",
             "--bind", str(directory), str(directory), "--ro-bind", str(endpoint), runtime,
             "--", str(self.helper), str(marker)],
            env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return child, marker

    def test_forged_admission_never_executes_the_browser(self):
        unchanged = f"EXEC {self.owner_group.rsplit('/', 1)[-1]} 4294967296\n".encode()
        for reply in (unchanged, b"ERR denied\n"):
            with self.subTest(reply=reply), tempfile.TemporaryDirectory(dir=self.scratch.name) as directory:
                root = Path(directory)
                with socket.socket(socket.AF_UNIX) as server:
                    server.bind(str(root / "gate.sock"))
                    os.chmod(root / "gate.sock", 0o600)
                    server.listen(1)
                    server.settimeout(2)
                    child, marker = self.spawn(root, root / "gate.sock")
                    try:
                        try:
                            connection, _ = server.accept()
                        except socket.timeout:
                            _, errors = child.communicate(timeout=5)
                            self.fail(f"launch gate was not reached: {errors.decode()}")
                        with connection:
                            connection.settimeout(2)
                            self.assertEqual(display.HerdrBridge.line(connection, 16), b"CHROMIUM")
                            connection.sendall(reply)
                        _, errors = child.communicate(timeout=5)
                        self.assertNotEqual(child.returncode, 0, errors.decode())
                        self.assertFalse(marker.exists(), "refused launch executed its target")
                    finally:
                        if child.poll() is None:
                            child.kill()
                            child.communicate(timeout=5)
                        else:
                            child.communicate(timeout=5)

    def test_cancelled_launch_cannot_execute_after_gate_release(self):
        with tempfile.TemporaryDirectory(dir=self.scratch.name) as directory, socket.socket(socket.AF_UNIX) as server:
            root = Path(directory)
            server.bind(str(root / "gate.sock"))
            os.chmod(root / "gate.sock", 0o600)
            server.listen(1)
            server.settimeout(5)
            child, marker = self.spawn(root, root / "gate.sock")
            try:
                try:
                    connection, _ = server.accept()
                except socket.timeout:
                    _, errors = child.communicate(timeout=5)
                    self.fail(f"launch gate was not reached: {errors.decode()}")
                with connection:
                    connection.settimeout(2)
                    self.assertEqual(display.HerdrBridge.line(connection, 16), b"CHROMIUM")
                    descriptor = int.from_bytes(connection.getsockopt(socket.SOL_SOCKET, 77, 4), sys.byteorder)
                    try:
                        signal.pidfd_send_signal(descriptor, signal.SIGTERM)
                        child.communicate(timeout=5)
                        # A stale permission cannot revive a cancelled launch.
                        try:
                            connection.sendall(f"EXEC {self.owner_group.rsplit('/', 1)[-1]} 4294967296\n".encode())
                        except (BrokenPipeError, ConnectionResetError):
                            pass
                    finally:
                        os.close(descriptor)
                self.assertFalse(marker.exists(), "cancelled launch executed its target")
                self.assertNotEqual(child.returncode, 0)
            finally:
                if child.poll() is None:
                    child.kill()
                    child.communicate(timeout=5)
                else:
                    child.communicate(timeout=5)


if __name__ == "__main__":
    unittest.main()
