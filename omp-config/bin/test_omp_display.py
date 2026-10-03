"""Display authority tests; synthetic host sockets, never the real desktop."""

import importlib.util
import json
import os
from pathlib import Path
import select
import signal
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import unittest

DIRECTORY = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("omp_display", DIRECTORY / "omp-display.py")
display = importlib.util.module_from_spec(spec)
spec.loader.exec_module(display)


class HerdrAuthorityTests(unittest.TestCase):
    def test_command_input_and_other_pane_reports_never_reach_host_server(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            upstream = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            upstream.bind(str(root / "host.sock"))
            upstream.listen(1)
            upstream.settimeout(0.05)
            bridge = display.HerdrBridge(root / "engineer.sock", root / "host.sock", "own:p1")
            try:
                for method, params in (
                    (["pane.send_keys"], {}),
                    ({"method": "agent.start"}, {}),
                    (None, {}),
                    ("agent.start", {"pane_id": "own:p1", "agent": "omp"}),
                    ("pane.send_keys", {"pane_id": "own:p1", "keys": ["F12"]}),
                    ("command.invoke", {"command_id": "host-command"}),
                    ("pane.report_agent", {"pane_id": "other:p1", "source": "herdr:omp", "agent": "omp"}),
                ):
                    with self.subTest(method=method), socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                        client.settimeout(2)
                        client.connect(str(root / "engineer.sock"))
                        client.sendall(json.dumps({"id": "test", "method": method, "params": params}).encode() + b"\n")
                        result = json.loads(display.HerdrBridge.line(client))
                        self.assertEqual(result["error"]["code"], "engineer_display_denied")
                        with self.assertRaises(socket.timeout):
                            upstream.accept()
            finally:
                bridge.close()
                upstream.close()

    def test_only_read_and_own_lifecycle_authority_is_granted(self):
        request = lambda method, params: {"id": "test", "method": method, "params": params}
        self.assertTrue(display.allowed_request(request("agent.list", {}), "own:p1"))
        params = {"pane_id": "own:p1", "source": "herdr:omp", "agent": "omp", "state": "working"}
        self.assertTrue(display.allowed_request(request("pane.report_agent", params), "own:p1"))
        self.assertFalse(display.allowed_request(request("pane.report_agent", {**params, "source": "foreign"}), "own:p1"))
        self.assertFalse(display.allowed_request({**request("agent.list", {}), "execute": "host"}, "own:p1"))

    def test_trailing_input_frame_never_reaches_host_after_allowed_read(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            upstream = socket.socket(socket.AF_UNIX)
            upstream.bind(str(root / "host.sock"))
            upstream.listen(1)
            upstream.settimeout(2)
            state = {"reads": 0, "input": 0}
            errors = []

            def host():
                try:
                    connection, _ = upstream.accept()
                    with connection, connection.makefile("rb") as client:
                        for line in client:
                            request = json.loads(line)
                            if request["method"] == "agent.list":
                                state["reads"] += 1
                            else:
                                state["input"] += 1
                            connection.sendall(json.dumps({"id": request["id"], "result": {}}).encode() + b"\n")
                except Exception as error:
                    errors.append(error)

            thread = threading.Thread(target=host, daemon=True)
            thread.start()
            bridge = display.HerdrBridge(root / "engineer.sock", root / "host.sock", "own:p1")
            try:
                with socket.socket(socket.AF_UNIX) as client:
                    client.settimeout(2)
                    client.connect(str(root / "engineer.sock"))
                    frames = [json.dumps({"id": method, "method": method, "params": {}}).encode() + b"\n"
                              for method in ("agent.list", "pane.send_keys")]
                    client.sendall(b"".join(frames))
                    client.shutdown(socket.SHUT_WR)
                    try:
                        while client.recv(1024):
                            pass
                    except ConnectionResetError:
                        # Dropping unread malicious input may reset the stream.
                        pass
                thread.join(timeout=3)
                self.assertFalse(thread.is_alive())
                self.assertEqual(errors, [])
                self.assertEqual(state, {"reads": 1, "input": 0})
            finally:
                bridge.close()
                upstream.close()


class GpgAuthorityTests(unittest.TestCase):
    def test_client_cannot_enable_pinentry_or_kill_host_agent_even_after_reset(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            upstream = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            upstream.bind(str(root / "host.sock"))
            upstream.listen(1)
            upstream.settimeout(2)
            state = {"mode": b"ask", "killed": False, "environment_reads": 0}
            errors = []

            def host_agent():
                try:
                    connection, _ = upstream.accept()
                    with connection, connection.makefile("rb") as client:
                        connection.sendall(b"OK synthetic agent\n")
                        for line in client:
                            if line.startswith(b"OPTION pinentry-mode="):
                                state["mode"] = line.rstrip().split(b"=", 1)[1]
                            elif line == b"RESET\n":
                                state["mode"] = b"ask"
                            elif line == b"KILLAGENT\n":
                                state["killed"] = True
                            elif line.startswith(b"GETINFO std_"):
                                state["environment_reads"] += 1
                                connection.sendall(b"D DISPLAY=:host\n")
                            connection.sendall(b"OK\n")
                            if line == b"BYE\n":
                                break
                except Exception as error:
                    errors.append(error)

            thread = threading.Thread(target=host_agent, daemon=True)
            thread.start()
            bridge = display.GpgBridge(root / "engineer.sock", root / "host.sock", None)
            try:
                with socket.socket(socket.AF_UNIX) as connection:
                    connection.settimeout(2)
                    connection.connect(str(root / "engineer.sock"))
                    with connection.makefile("rb") as agent:
                        self.assertTrue(agent.readline().startswith(b"OK"))
                        for option in (b"OPTION pinentry-mode=ask", b"RESET", b"OPTION display=:0"):
                            connection.sendall(option + b"\n")
                            self.assertEqual(agent.readline(), b"OK\n")
                            self.assertEqual(state["mode"], b"error")
                        for query in (b"std_session_env", b"std_startup_env", b"std_env_names", b"future_subcommand"):
                            connection.sendall(b"GETINFO " + query + b"\n")
                            self.assertTrue(agent.readline().startswith(b"ERR "))
                        connection.sendall(b"KILLAGENT\n")
                        self.assertTrue(agent.readline().startswith(b"ERR "))
                        connection.sendall(b"BYE\n")
                        self.assertEqual(agent.readline(), b"OK\n")
                thread.join(timeout=3)
                self.assertFalse(thread.is_alive())
                self.assertEqual(errors, [])
                self.assertFalse(state["killed"])
                self.assertEqual(state["environment_reads"], 0)
            finally:
                bridge.close()
                upstream.close()


@unittest.skipUnless(shutil.which("bwrap") and shutil.which("slirp4netns"), "display namespace dependencies")
class NamespaceAuthorityTests(unittest.TestCase):
    def test_env_socket_rediscovery_host_proc_loopback_and_inherited_fds_are_fenced(self):
        scratch = Path.home() / ".cache/tmp"
        scratch.mkdir(parents=True, exist_ok=True)
        scratch_device = scratch.stat().st_dev
        with tempfile.TemporaryDirectory(dir=scratch) as directory, socket.socket(socket.AF_UNIX) as filesystem, \
                socket.socket(socket.AF_UNIX) as abstract, socket.socket() as tcp:
            path = str(Path(directory) / "display.sock")
            filesystem.bind(path)
            filesystem.listen(1)
            abstract_name = "\0omp-display-test-" + str(os.getpid())
            abstract.bind(abstract_name)
            abstract.listen(1)
            tcp.bind(("127.0.0.1", 0))
            tcp.listen(1)
            code = r'''
import json, os, socket, sys, tempfile
from pathlib import Path
path, abstract, host_pid, port, fd, scratch_device = sys.argv[1:]
result = {}
for name, family, address in (
    ("pathname", socket.AF_UNIX, path),
    ("abstract", socket.AF_UNIX, "\0" + abstract),
    ("host_loopback", socket.AF_INET, ("127.0.0.1", int(port))),
    ("slirp_host_gateway", socket.AF_INET, ("10.0.2.2", int(port))),
):
    with socket.socket(family) as client:
        client.settimeout(0.5)
        try:
            client.connect(address)
            result[name] = "reachable"
        except OSError:
            result[name] = "denied"
result["host_proc"] = "denied" if not Path("/proc/" + host_pid + "/environ").exists() else "reachable"
try:
    os.fstat(int(fd))
    result["inherited_fd"] = "reachable"
except OSError:
    result["inherited_fd"] = "denied"
result["display_env"] = [name for name in ("DISPLAY", "WAYLAND_DISPLAY", "HYPRLAND_INSTANCE_SIGNATURE", "DBUS_SESSION_BUS_ADDRESS") if name in os.environ]
result["no_input_devices"] = not Path("/dev/input").exists() and not Path("/dev/uinput").exists()
result["native_media_hidden"] = not Path("/run/user/" + str(os.getuid()) + "/pipewire-0").exists()
result["scratch_backing_preserved"] = (Path.home() / ".cache/tmp").stat().st_dev == int(scratch_device)
result["default_scratch_private"] = tempfile.gettempdir() == str(Path.home() / ".cache/tmp")
print(json.dumps(result))
sys.exit(73)
'''
            environment = {key: value for key, value in os.environ.items() if not key.startswith("HERDR_")}
            environment.update(DISPLAY=":777", WAYLAND_DISPLAY=path,
                               HYPRLAND_INSTANCE_SIGNATURE="synthetic", DBUS_SESSION_BUS_ADDRESS="unix:path=" + path)
            child = subprocess.run(
                [sys.executable, str(DIRECTORY / "omp-display.py"), "--", sys.executable, "-c", code,
                 path, abstract_name[1:], str(os.getpid()), str(tcp.getsockname()[1]),
                 str(filesystem.fileno()), str(scratch_device)],
                env=environment, pass_fds=(filesystem.fileno(),), capture_output=True, text=True, timeout=20)
            self.assertEqual(child.returncode, 73, child.stderr)
            self.assertEqual(json.loads(child.stdout), {
                "pathname": "denied", "abstract": "denied", "host_loopback": "denied",
                "slirp_host_gateway": "denied", "host_proc": "denied", "inherited_fd": "denied",
                "display_env": [], "no_input_devices": True,
                "native_media_hidden": True,
                "scratch_backing_preserved": True,
                "default_scratch_private": True,
            })

    def test_hidden_caller_interpreter_bootstraps_without_exposing_hermes(self):
        hidden = Path.home() / ".hermes"
        hidden.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="omp-display-interpreter-", dir=hidden) as directory:
            interpreter = Path(directory) / "python3"
            interpreter.symlink_to("/usr/bin/python3")
            environment = {key: value for key, value in os.environ.items()
                           if not key.startswith(("HERDR_", "OMP_ENGINEER_DISPLAY"))}
            environment["DISPLAY"] = ":777"
            namespaces = [os.readlink(f"/proc/self/ns/{name}") for name in ("mnt", "pid", "net")]
            code = r'''
import json, os, sys
from pathlib import Path
print(json.dumps({
    "caller_interpreter_hidden": not Path(sys.argv[1]).exists(),
    "display_env_removed": "DISPLAY" not in os.environ,
    "private_namespaces": [
        os.readlink("/proc/self/ns/" + name) != parent
        for name, parent in zip(("mnt", "pid", "net"), sys.argv[2:])
    ],
}))
sys.exit(73)
'''
            child = subprocess.run(
                [str(interpreter), str(DIRECTORY / "omp-display.py"), "--",
                 "/usr/bin/python3", "-c", code, str(interpreter), *namespaces],
                env=environment, capture_output=True, text=True, timeout=25)
            self.assertEqual(child.returncode, 73, child.stderr)
            self.assertEqual(json.loads(child.stdout), {
                "caller_interpreter_hidden": True, "display_env_removed": True,
                "private_namespaces": [True, True, True],
            })

    def test_group_interrupt_is_single_and_term_reaches_command_for_graceful_flush(self):
        code = r'''
import signal, sys, time
count = 0
def interrupt(*_):
    global count
    count += 1
    print("INTERRUPTED", flush=True)
def terminate(*_):
    print("FLUSHED interrupts=" + str(count), flush=True)
    sys.exit(42)
signal.signal(signal.SIGINT, interrupt)
signal.signal(signal.SIGQUIT, interrupt)
signal.signal(signal.SIGTERM, terminate)
print("READY", flush=True)
time.sleep(30)
'''
        for interrupted in (signal.SIGINT, signal.SIGQUIT):
            with self.subTest(signal=interrupted):
                environment = {key: value for key, value in os.environ.items() if not key.startswith("HERDR_")}
                with subprocess.Popen([sys.executable, str(DIRECTORY / "omp-display.py"), "--",
                                       sys.executable, "-u", "-c", code],
                                      env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE, text=True, start_new_session=True) as child:
                    try:
                        self.assertTrue(select.select([child.stdout], [], [], 10)[0])
                        self.assertEqual(child.stdout.readline().strip(), "READY")
                        os.killpg(child.pid, interrupted)
                        self.assertTrue(select.select([child.stdout], [], [], 5)[0])
                        self.assertEqual(child.stdout.readline().strip(), "INTERRUPTED")
                        child.send_signal(signal.SIGTERM)
                        # Network termination and bridge joins each have three-second cleanup bounds.
                        # This wait covers teardown, not a five-second graceful-command contract.
                        output, errors = child.communicate(timeout=15)
                        self.assertEqual(child.returncode, 42, errors)
                        self.assertEqual(output.strip(), "FLUSHED interrupts=1")
                    finally:
                        if child.poll() is None:
                            child.kill()
                            child.communicate(timeout=5)

    def test_internal_exec_and_gui_reject_forged_host_markers(self):
        environment = {**os.environ, "OMP_ENGINEER_DISPLAY": "isolated-v1",
                       "OMP_ENGINEER_DISPLAY_NS": os.readlink("/proc/self/ns/mnt")}
        for name, args in (("omp-display.py", ["--_exec", "/usr/bin/true"]),
                           ("omp-gui.py", ["--", "/usr/bin/true"])):
            with self.subTest(name=name):
                child = subprocess.run([sys.executable, str(DIRECTORY / name), *args],
                                       env=environment, capture_output=True, text=True, timeout=5)
                self.assertEqual(child.returncode, 1, child.stderr)


if __name__ == "__main__":
    unittest.main()
