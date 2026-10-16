"""Client wire/endpoint contracts exercised against disposable Unix servers."""

import importlib.util
import json
import os
from pathlib import Path
import shlex
import socket
import stat
import subprocess
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

DIRECTORY = Path(__file__).resolve().parent
CLIENT = DIRECTORY / "omp-host-install.py"
spec = importlib.util.spec_from_file_location("omp_host_install", CLIENT)
client = importlib.util.module_from_spec(spec)
spec.loader.exec_module(client)


def reply(ok=True, receipt=None, error=None, capabilities=None):
    return {"schema_version": 1, "ok": ok, "receipt": receipt,
            "error": error, "capabilities": capabilities}


class ClientTransportTests(unittest.TestCase):
    def invoke(self, arguments, response, expected):
        with tempfile.TemporaryDirectory() as directory, socket.socket(socket.AF_UNIX) as server:
            endpoint = Path(directory) / "install.sock"
            server.bind(str(endpoint))
            endpoint.chmod(0o600)
            server.listen(1)
            server.settimeout(5)
            failures = []

            def host():
                try:
                    connection, _ = server.accept()
                    with connection, connection.makefile("rb") as reader:
                        connection.settimeout(5)
                        wire = reader.readline(65537)
                        self.assertTrue(wire.endswith(b"\n"))
                        self.assertLessEqual(len(wire), 65536)
                        self.assertEqual(json.loads(wire), expected)
                        connection.sendall(response)
                except Exception as exc:
                    failures.append(exc)

            thread = threading.Thread(target=host, daemon=True)
            thread.start()
            process = subprocess.run([sys.executable, str(CLIENT), "--socket", str(endpoint), *arguments],
                                     capture_output=True, text=True, timeout=10)
            thread.join(6)
            self.assertFalse(thread.is_alive())
            self.assertEqual(failures, [])
            return process

    def test_host_denials_keep_failure_receipt_and_exit_nonzero(self):
        result = reply(False, receipt={"receipt_id": "host-failed", "status": "rolled_back"},
                       error="Glass publication failed")
        process = self.invoke(["rollback", "host-failed"], json.dumps(result).encode() + b"\n",
                              {"schema_version": 1, "operation": "rollback", "receipt_id": "host-failed"})
        self.assertEqual(process.returncode, 1)
        self.assertEqual(json.loads(process.stdout), result)
        self.assertEqual(process.stderr, "")

    def test_retired_workbench_receipts_remain_readable_and_rollback_capable(self):
        for operation, status in (("readback", "installed"), ("rollback", "rolled_back")):
            with self.subTest(operation=operation):
                receipt = {"receipt_id": "host-workbench-old", "recipe": "workbench-item", "status": status}
                result = reply(receipt=receipt)
                process = self.invoke([operation, receipt["receipt_id"]], json.dumps(result).encode() + b"\n",
                                      {"schema_version": 1, "operation": operation,
                                       "receipt_id": receipt["receipt_id"]})
                self.assertEqual(process.returncode, 0, process.stderr)
                self.assertEqual(json.loads(process.stdout), result)
                self.assertEqual(process.stderr, "")

    def test_malformed_and_incomplete_host_responses_are_transport_failures(self):
        valid = reply(capabilities={"route_version": "1"})
        responses = [
            b"not-json\n", b"{}", b"[]\n", b"\xff\n",
            json.dumps({**valid, "schema_version": True}).encode() + b"\n",
            json.dumps({**valid, "ok": 1}).encode() + b"\n",
            json.dumps({**valid, "execute": "host-command"}).encode() + b"\n",
            json.dumps(reply(receipt={})).encode() + b"\n",
            json.dumps(reply(False, error=None)).encode() + b"\n",
            b'{"schema_version":1,"ok":true,"ok":false,"receipt":null,"error":null,"capabilities":{}}\n',
            b'{"schema_version":1,"ok":true,"receipt":null,"error":null,"capabilities":{"n":NaN}}\n',
            json.dumps(valid).encode() + b"\n{}\n",
        ]
        for response in responses:
            with self.subTest(response=response):
                process = self.invoke(["capabilities"], response,
                                      {"schema_version": 1, "operation": "capabilities"})
                self.assertEqual(process.returncode, 1)
                self.assertEqual(process.stdout, "")
                self.assertIn("omp-host-install:", process.stderr)

    def test_complete_success_without_reply_eof_is_not_accepted(self):
        with tempfile.TemporaryDirectory() as directory, socket.socket(socket.AF_UNIX) as server:
            endpoint = Path(directory) / "install.sock"
            server.bind(str(endpoint))
            endpoint.chmod(0o600)
            server.listen(1)
            server.settimeout(2)
            release = threading.Event()
            failures = []

            def host():
                try:
                    connection, _ = server.accept()
                    with connection:
                        connection.recv(65536)
                        connection.sendall(json.dumps(reply(capabilities={})).encode() + b"\n")
                        release.wait(2)
                except Exception as exc:
                    failures.append(exc)

            thread = threading.Thread(target=host, daemon=True)
            thread.start()
            try:
                with patch.object(client, "TIMEOUT", 0.1):
                    with self.assertRaises((client.InstallError, OSError)):
                        client.exchange(endpoint, {"schema_version": 1, "operation": "capabilities"})
            finally:
                release.set()
                thread.join(3)
            self.assertFalse(thread.is_alive())
            self.assertEqual(failures, [])

    def test_invalid_action_flags_never_connect(self):
        install = ["install", "--item", "K-test", "--recipe", "shared-skill",
                   "--revision", "a" * 40, "--selection", "story-qa"]
        repository = ["install-repository", "--repository", "iron-forest", "--revision", "a" * 40]
        cases = [[], ["shell", "true"], ["capabilities", "--item", "K-test"],
                 ["readback", "host-1", "--profile", "omp"], ["rollback", "../receipt"],
                 [*install, "--argv", "true"], [*install, "--repo", "https://foreign.invalid"],
                 [*install, "--environment", "HOME=/tmp"],
                 [*install, "--destination", "/tmp/file"],
                 [*install[:-1], "../story-qa"],
                 [*install, "--revision", "A" * 40],
                 [*install, "--revision", "abc"],
                 [*install, "--recipe", "shared-bin", "--profile", "kaylee"],
                 [*install, "--recipe", "harness-cli"],
                 [*install, "--recipe", "workbench-item"],
                 ["install", "--item", "K-test", "--recipe", "shared-skill", "--rev", "a" * 40,
                  "--selection", "story-qa"],
                 [*repository, "--command", "true"],
                 [*repository, "--environment", "HOME=/tmp"],
                 [*repository, "--destination", "/tmp/file"],
                 [*repository, "--repository", "../harness"],
                 [*repository, "--repository", "https://github.com/foreign/repo"],
                 [*repository, "--revision", "master"],
                 [*repository, "--revision", "A" * 40],
                 [*repository, "--revision", "abc"],
                 [*repository, "--repository", "forest"],
                 [*repository, "--repository", "misty-step/iron-forest"],
                 [*repository, "--state", "/tmp/forest"],
                 [*repository, "--restart", "forest-api"],
                 [*repository, "--repository", "cantrip", "--command", "true"],
                 [*repository, "--repository", "cantrip", "--config", "/tmp/cantrip.toml"],
                 [*repository, "--repository", "cantrip", "--restart", "cantrip.service"],
                 ["readback-repository", "--repository", "iron-forest", "--state", "/tmp/forest"],
                 ["readback-repository", "--repository", "iron-forest", "--revision", "a" * 40]]
        with tempfile.TemporaryDirectory() as directory, socket.socket(socket.AF_UNIX) as server:
            endpoint = Path(directory) / "install.sock"
            server.bind(str(endpoint))
            endpoint.chmod(0o600)
            server.listen(1)
            server.settimeout(0.02)
            for arguments in cases:
                with self.subTest(arguments=arguments):
                    process = subprocess.run([sys.executable, str(CLIENT), "--socket", str(endpoint), *arguments],
                                             capture_output=True, text=True, timeout=5)
                    self.assertEqual(process.returncode, 2, process.stderr)
                    self.assertEqual(process.stdout, "")
                    with self.assertRaises(socket.timeout):
                        server.accept()

    def test_wrong_socket_type_mode_symlink_missing_and_owner_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory, socket.socket(socket.AF_UNIX) as server:
            root = Path(directory)
            endpoint = root / "install.sock"
            server.bind(str(endpoint))
            server.listen(1)
            server.settimeout(0.02)
            regular = root / "regular"
            regular.write_text("not a socket")
            alias = root / "alias"
            alias.symlink_to(endpoint)
            for path in (regular, alias, root / "missing", Path("relative.sock")):
                with self.subTest(path=path):
                    process = subprocess.run([sys.executable, str(CLIENT), "--socket", str(path), "capabilities"],
                                             capture_output=True, text=True, timeout=5)
                    self.assertEqual(process.returncode, 1)
                    self.assertEqual(process.stdout, "")
                    self.assertIn("omp-host-install:", process.stderr)
            endpoint.chmod(0o660)
            with self.assertRaises(client.InstallError):
                client.exchange(endpoint, {"schema_version": 1, "operation": "capabilities"})
            endpoint.chmod(0o600)
            wrong_owner = SimpleNamespace(st_mode=stat.S_IFSOCK | 0o600, st_uid=os.getuid() + 1)
            with patch.object(Path, "lstat", return_value=wrong_owner):
                with self.assertRaisesRegex(client.InstallError, "UID-owned"):
                    client.exchange(endpoint, {"schema_version": 1, "operation": "capabilities"})
            with self.assertRaises(socket.timeout):
                server.accept()

    def test_response_size_and_total_deadline_are_bounded(self):
        for response, delay, message in ((b"x" * 257, 0, "exceeds"), (b"", 0.1, "timed out")):
            with self.subTest(message=message), tempfile.TemporaryDirectory() as directory, \
                    socket.socket(socket.AF_UNIX) as server:
                endpoint = Path(directory) / "install.sock"
                server.bind(str(endpoint))
                endpoint.chmod(0o600)
                server.listen(1)
                server.settimeout(2)
                failures = []

                def host():
                    try:
                        connection, _ = server.accept()
                        with connection:
                            connection.recv(65536)
                            if delay:
                                threading.Event().wait(delay)
                            if response:
                                connection.sendall(response)
                    except Exception as exc:
                        failures.append(exc)

                thread = threading.Thread(target=host, daemon=True)
                thread.start()
                with patch.object(client, "MAX_REPLY", 256), patch.object(client, "TIMEOUT", 0.05):
                    with self.assertRaisesRegex((client.InstallError, OSError), message):
                        client.exchange(endpoint, {"schema_version": 1, "operation": "capabilities"})
                thread.join(3)
                self.assertFalse(thread.is_alive())
                self.assertEqual(failures, [])

    def test_only_cantrip_install_extends_the_total_deadline(self):
        cases = [
            ("install-repository", "cantrip", 901, True),
            ("install-repository", "cantrip", 2101, False),
            ("readback-repository", "cantrip", 901, False),
            ("install-repository", "harness", 901, False),
            ("capabilities", None, 901, False),
        ]
        for operation, repository, elapsed, succeeds in cases:
            with self.subTest(operation=operation, repository=repository, elapsed=elapsed), \
                    tempfile.TemporaryDirectory() as directory, socket.socket(socket.AF_UNIX) as server:
                endpoint = Path(directory) / "install.sock"
                server.bind(str(endpoint))
                endpoint.chmod(0o600)
                server.listen(1)
                server.settimeout(2)
                request = {"schema_version": 1, "operation": operation}
                if repository is not None:
                    request["repository"] = repository
                if operation == "install-repository":
                    request["revision"] = "a" * 40
                result = reply(receipt={"repository": repository})
                failures = []

                def host():
                    try:
                        connection, _ = server.accept()
                        with connection:
                            connection.settimeout(2)
                            connection.recv(65536)
                            if succeeds:
                                connection.sendall(json.dumps(result).encode() + b"\n")
                    except Exception as exc:
                        failures.append(exc)

                thread = threading.Thread(target=host, daemon=True)
                thread.start()
                clock = iter([0])
                with patch.object(client.time, "monotonic", side_effect=lambda: next(clock, elapsed)):
                    if succeeds:
                        self.assertEqual(client.exchange(endpoint, request), result)
                    else:
                        with self.assertRaisesRegex(client.InstallError, "timed out"):
                            client.exchange(endpoint, request)
                thread.join(3)
                self.assertFalse(thread.is_alive())
                self.assertEqual(failures, [])


class ClientDeploymentTests(unittest.TestCase):
    def install(self, home, components="cli"):
        fixture_bin = home / ".fixture-bin"
        fixture_bin.mkdir(exist_ok=True)
        systemctl = fixture_bin / "systemctl"
        systemctl.write_text("#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$HOME/systemctl-calls\"\nexit 1\n")
        systemctl.chmod(0o700)
        return subprocess.run(
            [str(DIRECTORY.parent / "install")],
            env={"PATH": f"{fixture_bin}:{os.environ['PATH']}", "HOME": str(home),
                 "PI_CODING_AGENT_DIR": str(home / "agent"), "OMP_INSTALL_COMPONENTS": components},
            capture_output=True, text=True, timeout=20)

    def broker(self, home, help_text="Usage:\n       workbench-host-install refresh-service",
               help_status=0, refresh_status=0, mode=0o555, target=None):
        entrypoint = home / ".local/lib/workbench-host-install/workbench-host-install"
        if target is None:
            target = entrypoint.parent / "releases/fixture/bin/workbench-host-install"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(
            "#!/bin/sh\n"
            "printf '%s\\n' \"$*\" >> \"$HOME/broker-calls\"\n"
            "if [ \"$#\" -eq 1 ] && [ \"$1\" = --help ]; then\n"
            f"  printf '%s\\n' {shlex.quote(help_text)}\n"
            f"  exit {help_status}\n"
            "fi\n"
            "test \"$#\" -eq 1 && test \"$1\" = refresh-service || exit 20\n"
            "test -x \"$HOME/.local/bin/omp-host-install\" || exit 21\n"
            f"exit {refresh_status}\n")
        target.chmod(mode)
        if target != entrypoint:
            entrypoint.parent.mkdir(parents=True, exist_ok=True)
            entrypoint.symlink_to(target)
        return entrypoint

    def test_cli_refreshes_only_the_managed_broker_after_deploying_helpers(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            self.broker(home)
            protected = {
                ".local/bin/omp": "native OMP sentinel",
                ".local/bin/cantrip": "native Cantrip sentinel",
                "agent/config.yml": "foreign: config sentinel",
                ".config/systemd/user/cantrip.service": "foreign startup owner sentinel",
            }
            for name, contents in protected.items():
                path = home / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(contents)
            process = self.install(home)
            self.assertEqual(process.returncode, 0, process.stderr)
            self.assertEqual((home / "broker-calls").read_text().splitlines(),
                             ["--help", "refresh-service"])
            for name, contents in protected.items():
                self.assertEqual((home / name).read_text(), contents)
            self.assertFalse((home / "systemctl-calls").exists())
            self.assertFalse((home / ".local/lib/omp-engineer/omp").exists())

    def test_missing_or_unmanaged_broker_does_not_change_cli_install(self):
        for kind in ("missing", "regular", "outside-release", "not-executable", "owner-writable", "writable"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory:
                home = Path(directory)
                if kind != "missing":
                    target = None
                    if kind == "regular":
                        target = home / ".local/lib/workbench-host-install/workbench-host-install"
                    elif kind == "outside-release":
                        target = home / "foreign/workbench-host-install"
                    mode = {"not-executable": 0o444, "owner-writable": 0o755, "writable": 0o777}.get(kind, 0o555)
                    self.broker(home, target=target, mode=mode)
                process = self.install(home)
                self.assertEqual(process.returncode, 0, process.stderr)
                self.assertTrue((home / ".local/bin/omp-host-install").is_file())
                self.assertFalse((home / "broker-calls").exists())
                self.assertFalse((home / "systemctl-calls").exists())

    def test_old_or_unsuccessful_help_does_not_authorize_refresh(self):
        cases = [
            ("Usage:\n       workbench-host-install serve", 0),
            ("Usage:\n       workbench-host-install refresh-service-worker", 0),
            ("Usage:\n       workbench-host-install serve\n\nUse refresh-service to update.", 0),
            ("Description:\n  refresh-service is mentioned, not advertised", 0),
            ("Usage:\n       workbench-host-install refresh-service extra-argument", 0),
            ("Usage:\n       workbench-host-install refresh-service", 2),
        ]
        for help_text, status in cases:
            with self.subTest(help_text=help_text, status=status), tempfile.TemporaryDirectory() as directory:
                home = Path(directory)
                self.broker(home, help_text=help_text, help_status=status)
                process = self.install(home)
                self.assertEqual(process.returncode, 0, process.stderr)
                self.assertEqual((home / "broker-calls").read_text().splitlines(), ["--help"])
                self.assertFalse((home / "systemctl-calls").exists())

    def test_broker_refresh_failure_is_not_reported_as_successful_install(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            self.broker(home, refresh_status=7)
            process = self.install(home)
            self.assertNotEqual(process.returncode, 0)
            self.assertIn("broker refresh failed", process.stderr)
            self.assertEqual((home / "broker-calls").read_text().splitlines(),
                             ["--help", "refresh-service"])
            self.assertFalse((home / "systemctl-calls").exists())

    def test_non_cli_selection_does_not_probe_or_refresh_the_broker(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            self.broker(home)
            process = self.install(home, components="guidance")
            self.assertEqual(process.returncode, 0, process.stderr)
            self.assertTrue((home / "agent/AGENTS.md").is_file())
            self.assertFalse((home / "broker-calls").exists())

    def test_foreign_client_is_rejected_before_any_cli_write_or_cage_activation(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            self.broker(home)
            bin_dir = home / ".local/bin"
            bin_dir.mkdir(parents=True)
            foreign = bin_dir / "omp-host-install"
            foreign.write_text("#!/bin/sh\n# foreign entrypoint\nexit 0\n")
            engineer = bin_dir / "omp-engineer"
            previous = "#!/usr/bin/env python3\n# owned by misty-step/harness omp-config engineer-cage\n# old code sentinel\n"
            engineer.write_text(previous)
            native = bin_dir / "omp"
            native.write_text("unrelated native executable sentinel")
            process = self.install(home)
            self.assertNotEqual(process.returncode, 0)
            self.assertIn("Refusing foreign omp-host-install entrypoint", process.stderr)
            self.assertEqual(foreign.read_text(), "#!/bin/sh\n# foreign entrypoint\nexit 0\n")
            self.assertEqual(engineer.read_text(), previous)
            self.assertEqual(native.read_text(), "unrelated native executable sentinel")
            self.assertFalse((home / ".config/systemd/user/omp.slice").exists())
            self.assertFalse((home / ".local/lib/omp-engineer/omp").exists())
            self.assertFalse((home / "broker-calls").exists())


if __name__ == "__main__":
    unittest.main()
