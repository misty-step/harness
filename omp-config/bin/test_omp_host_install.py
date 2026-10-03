"""Client wire/endpoint contracts exercised against disposable Unix servers."""

import importlib.util
import json
import os
from pathlib import Path
import shutil
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
                  "--selection", "story-qa"]]
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


@unittest.skipUnless(shutil.which("bun") and shutil.which("flock"), "CLI installer dependencies")
class ClientDeploymentTests(unittest.TestCase):
    def test_foreign_client_is_rejected_before_any_cli_write_or_cage_activation(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            bin_dir = home / ".local/bin"
            bin_dir.mkdir(parents=True)
            foreign = bin_dir / "omp-host-install"
            foreign.write_text("#!/bin/sh\n# foreign entrypoint\nexit 0\n")
            engineer = bin_dir / "omp-engineer"
            previous = "#!/usr/bin/env python3\n# owned by misty-step/harness omp-config engineer-cage\n# old code sentinel\n"
            engineer.write_text(previous)
            native = bin_dir / "omp"
            native.write_text("unrelated native executable sentinel")
            process = subprocess.run(
                [str(DIRECTORY.parent / "install")],
                env={"PATH": os.environ["PATH"], "HOME": str(home),
                     "PI_CODING_AGENT_DIR": str(home / "agent"), "OMP_INSTALL_COMPONENTS": "cli"},
                capture_output=True, text=True, timeout=20)
            self.assertNotEqual(process.returncode, 0)
            self.assertIn("Refusing foreign omp-host-install entrypoint", process.stderr)
            self.assertEqual(foreign.read_text(), "#!/bin/sh\n# foreign entrypoint\nexit 0\n")
            self.assertEqual(engineer.read_text(), previous)
            self.assertEqual(native.read_text(), "unrelated native executable sentinel")
            self.assertFalse((home / ".config/systemd/user/omp.slice").exists())
            self.assertFalse((home / ".local/lib/omp-engineer/omp").exists())


if __name__ == "__main__":
    unittest.main()
