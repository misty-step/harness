"""Reserved-inode regressions; only synthetic inputs and fresh local restic."""
from contextlib import redirect_stdout
import fcntl
import io
import json
import os
from pathlib import Path
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import backup as implementation
import test_configured as fixtures
from test_configured import source

ROOT = Path(__file__).resolve().parent


class ControlFileTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="backup-control-fixture-")
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.home = self.base / "home"
        self.state = self.home / ".local/state/agent-session-backup"
        self.state.mkdir(parents=True)
        self.input = self.base / "input"
        self.input.mkdir()
        self.selected = self.input / "data.txt"
        self.original = b"Selected synthetic bytes must survive control-file mutations.\n"
        self.selected.write_bytes(self.original)
        self.config = {"schema": 1, "mode": "hermes-only", "sources": [source(self.input, include=["data.txt"])]}
        self.config_path = self.base / "sources.json"
        self.config_path.write_text(json.dumps(self.config))
        self.lock = self.state / "backup.lock"
        self.receipt = self.state / "last-success.json"
        self.stage = self.state / "snapshot"
        self.env = {"PATH": os.environ["PATH"], "HOME": str(self.home), "TMPDIR": tempfile.gettempdir(),
                    "PYTHONDONTWRITEBYTECODE": "1"}

    def cli(self, binary="/nonexistent-fixture-restic", env=None):
        return subprocess.run([sys.executable, str(ROOT / "backup.py"), "--home", str(self.home),
                               "--config", str(self.config_path), "--restic", binary],
                              env=env or self.env, text=True, capture_output=True, timeout=60)

    def assert_source(self):
        self.assertEqual(self.selected.read_bytes(), self.original)

    def previous_stage(self):
        self.stage.mkdir()
        marker = self.stage / "prior.txt"
        marker.write_bytes(b"Prior owned stage must not be removed on preflight refusal.\n")
        return marker

    def run_double(self, calls):
        # Transport double checks mutation/failure ordering, not uploaded bytes.
        transport = fixtures.ConfiguredBackupTests().fixture_transport(calls)
        with patch("backup.restic", transport), redirect_stdout(io.StringIO()) as output:
            implementation.backup(self.home, "fixture-double", self.config)
        return json.loads(output.getvalue())

    def test_cli_hardlinked_lock_and_receipt_refused_before_stage_removal(self):
        marker = self.previous_stage()
        prior_stage = marker.read_bytes()
        for reserved in (self.lock, self.receipt):
            with self.subTest(reserved=reserved.name):
                os.link(self.selected, reserved)
                info = reserved.stat()
                self.assertEqual(info.st_uid, os.getuid())
                self.assertEqual(info.st_nlink, 2)
                result = self.cli()
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertEqual(result.stdout, "")
                self.assertIn("hardlink", result.stderr)
                self.assert_source()
                self.assertEqual(reserved.stat().st_ino, info.st_ino)
                self.assertEqual(reserved.stat().st_mode, info.st_mode)
                self.assertEqual(reserved.stat().st_mtime_ns, info.st_mtime_ns)
                self.assertEqual(marker.read_bytes(), prior_stage)
                reserved.unlink()

    def test_contended_lock_is_not_truncated_and_prior_state_is_untouched(self):
        self.lock.write_bytes(b"Existing unique lock bytes.\n")
        self.receipt.write_bytes(b'{"prior_fixture":true}\n')
        marker = self.previous_stage()
        with self.lock.open("r+") as held:
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = self.cli()
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertEqual(self.lock.read_bytes(), b"Existing unique lock bytes.\n")
        self.assertEqual(self.receipt.read_bytes(), b'{"prior_fixture":true}\n')
        self.assertTrue(marker.is_file())
        self.assert_source()

    def test_special_control_leaves_are_rejected_without_blocking_or_upload(self):
        marker = self.previous_stage()
        for reserved in (self.lock, self.receipt):
            for kind in ("fifo", "directory", "socket"):
                with self.subTest(reserved=reserved.name, kind=kind):
                    handle = None
                    if kind == "fifo":
                        os.mkfifo(reserved)
                    elif kind == "directory":
                        reserved.mkdir()
                    else:
                        handle = socket.socket(socket.AF_UNIX)
                        self.addCleanup(handle.close)
                        parent_fd = os.open(self.state, os.O_RDONLY | os.O_DIRECTORY)
                        try:
                            # Fixture scratch paths exceed AF_UNIX's name limit.
                            handle.bind(f"/proc/self/fd/{parent_fd}/{reserved.name}")
                        finally:
                            os.close(parent_fd)
                    try:
                        info = reserved.lstat()
                        result = self.cli()
                        self.assertEqual(result.returncode, 1, result.stderr)
                        self.assertEqual(result.stdout, "")
                        self.assertIn("regular", result.stderr)
                        self.assertEqual(reserved.lstat().st_mode, info.st_mode)
                        self.assertTrue(marker.is_file())
                        self.assert_source()
                    finally:
                        if handle is not None:
                            handle.close()
                        reserved.rmdir() if kind == "directory" else reserved.unlink()

    def test_foreign_owned_control_preflight_rejects_before_any_mutation(self):
        # Labeled uid-only fault injection; no host chown or privilege requirement.
        marker = self.previous_stage()
        for reserved in (self.lock, self.receipt):
            with self.subTest(reserved=reserved.name):
                reserved.write_bytes(b"Foreign ownership fixture.\n")
                real_lstat = Path.lstat
                def foreign(path, *args, **kwargs):
                    info = real_lstat(path, *args, **kwargs)
                    if path == reserved:
                        fields = list(info)
                        fields[4] = os.getuid() + 1
                        return os.stat_result(fields)
                    return info
                with patch.object(Path, "lstat", foreign), patch("backup.restic") as transport:
                    with self.assertRaisesRegex(PermissionError, "foreign-owned"):
                        implementation.backup(self.home, "fixture-double", self.config)
                    transport.assert_not_called()
                self.assertEqual(reserved.read_bytes(), b"Foreign ownership fixture.\n")
                self.assertTrue(marker.is_file())
                self.assert_source()
                reserved.unlink()

    @unittest.skipUnless(shutil.which("unshare") and shutil.which("newuidmap") and shutil.which("newgidmap"),
                         "mapped user namespace required for real foreign-uid fixture")
    def test_real_foreign_uid_control_leaves_are_refused_in_private_user_namespace(self):
        probe = subprocess.run(["unshare", "--user", "--map-auto", "--map-root-user", "true"],
                               env=self.env, text=True, capture_output=True, timeout=30)
        if probe.returncode != 0:
            self.skipTest("mapped user namespace unavailable: " + probe.stderr.strip())
        # Only subordinate fixture UIDs are used; chown is undone before exit.
        code = """
import json, os, sys
from pathlib import Path
from unittest.mock import patch
import backup
base = Path(sys.argv[1])
home = base / 'namespace-home'
state = home / '.local/state/agent-session-backup'
state.mkdir(parents=True)
root = base / 'namespace-input'
root.mkdir()
selected = root / 'data.txt'
selected.write_bytes(b'Namespace synthetic source.\\n')
config = {'schema': 1, 'mode': 'hermes-only', 'sources': [{
    'id': 'fixture', 'role': 'fixture', 'tier': 'hot', 'required': True,
    'root': str(root), 'include': ['data.txt']}]}
checks = []
for name in ('backup.lock', 'last-success.json'):
    reserved = state / name
    reserved.write_bytes(b'Actual foreign uid fixture.\\n')
    try:
        os.chown(reserved, 1, -1)
        assert reserved.stat().st_uid == 1 and os.getuid() == 0
        with patch.object(backup, 'restic') as transport:
            try:
                backup.backup(home, 'fixture-double', config)
            except PermissionError as error:
                assert 'foreign-owned' in str(error)
            else:
                raise AssertionError('Foreign leaf was not refused')
            transport.assert_not_called()
        assert reserved.read_bytes() == b'Actual foreign uid fixture.\\n'
        assert selected.read_bytes() == b'Namespace synthetic source.\\n'
        assert not (state / 'snapshot').exists()
        checks.append({'leaf': name, 'process_uid': os.getuid(), 'leaf_uid': reserved.stat().st_uid})
    finally:
        os.chown(reserved, 0, -1)
        reserved.unlink()
print(json.dumps(checks))
"""
        env = {**self.env, "PYTHONPATH": str(ROOT)}
        result = subprocess.run(["unshare", "--user", "--map-auto", "--map-root-user", sys.executable,
                                 "-c", code, str(self.base)], env=env, text=True, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        observed = json.loads(result.stdout)
        self.assertEqual([item["leaf"] for item in observed], ["backup.lock", "last-success.json"])
        self.assertTrue(all(item["leaf_uid"] != item["process_uid"] for item in observed))

    def test_opened_lock_is_revalidated_before_flock_or_chmod(self):
        self.lock.write_bytes(b"Descriptor-boundary fixture.\n")
        real_fstat = os.fstat
        inode = self.lock.stat().st_ino
        # Descriptor-only fault injections prove the open itself is nontruncating.
        for field, value, error, diagnostic in ((4, os.getuid() + 1, PermissionError, "foreign-owned"),
                                               (3, 2, ValueError, "hardlink"),
                                               (0, stat.S_IFIFO | 0o600, ValueError, "regular")):
            with self.subTest(field=field):
                def unsafe(fd):
                    info = real_fstat(fd)
                    if info.st_ino == inode:
                        fields = list(info)
                        fields[field] = value
                        return os.stat_result(fields)
                    return info
                with patch("backup.os.fstat", unsafe), patch("backup.fcntl.flock") as flock, patch("backup.os.fchmod") as chmod:
                    with self.assertRaisesRegex(error, diagnostic):
                        implementation.backup(self.home, "fixture-double", self.config)
                    flock.assert_not_called()
                    chmod.assert_not_called()
                self.assertEqual(self.lock.read_bytes(), b"Descriptor-boundary fixture.\n")
                self.assert_source()

    def test_success_receipt_replaces_inode_privately_and_lock_bytes_survive(self):
        self.lock.write_bytes(b"Nonempty unique lock fixture.\n")
        previous = b'{"prior_fixture":true}\n'
        self.receipt.write_bytes(previous)
        self.receipt.chmod(0o644)
        inode = self.receipt.stat().st_ino
        calls = []
        with self.receipt.open("rb") as old:
            result = self.run_double(calls)
            self.assertEqual(old.read(), previous)
        self.assertNotEqual(self.receipt.stat().st_ino, inode)
        self.assertEqual(self.receipt.stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads(self.receipt.read_text()), result)
        self.assertEqual([args[0] for args in calls], ["backup", "restore", "forget"])
        self.assertEqual(self.lock.read_bytes(), b"Nonempty unique lock fixture.\n")
        self.assert_source()
        self.assertFalse(self.stage.exists())
        self.assertFalse(list(self.state.glob(".last-success-*.tmp")))

    def test_opened_receipt_is_revalidated_before_publication(self):
        previous = b'{"prior_fixture":true}\n'
        self.receipt.write_bytes(previous)
        inode = self.receipt.stat().st_ino
        real_fstat = os.fstat
        for field, value, error in ((4, os.getuid() + 1, PermissionError), (3, 2, ValueError)):
            with self.subTest(field=field):
                def unsafe(fd):
                    info = real_fstat(fd)
                    if info.st_ino == inode:
                        fields = list(info)
                        fields[field] = value
                        return os.stat_result(fields)
                    return info
                with patch("backup.os.fstat", unsafe), patch("backup.os.replace") as replace:
                    with self.assertRaises(error):
                        implementation.publish_success(self.receipt, {"fixture": True})
                    replace.assert_not_called()
                self.assertEqual(self.receipt.read_bytes(), previous)
                self.assertFalse(list(self.state.glob(".last-success-*.tmp")))

    def test_receipt_write_and_replace_failures_keep_previous_receipt_and_emit_no_success(self):
        previous = b'{"prior_fixture":true}\n'
        self.receipt.write_bytes(previous)
        for operation in ("fsync", "replace"):
            calls = []
            transport = fixtures.ConfiguredBackupTests().fixture_transport(calls)
            inode = self.receipt.stat().st_ino
            with self.subTest(operation=operation), patch("backup.restic", transport), redirect_stdout(io.StringIO()) as output:
                with patch("backup.os." + operation, side_effect=OSError("Injected receipt publication failure")):
                    with self.assertRaisesRegex(OSError, "publication failure"):
                        implementation.backup(self.home, "fixture-double", self.config)
            self.assertEqual(self.receipt.read_bytes(), previous)
            self.assertEqual(self.receipt.stat().st_ino, inode)
            self.assertEqual(output.getvalue(), "")
            self.assertEqual([args[0] for args in calls], ["backup", "restore", "forget"])
            self.assertFalse(self.stage.exists())
            self.assertFalse(list(self.state.glob(".last-success-*.tmp")))
            self.assert_source()

    @unittest.skipIf(os.getuid() == 0, "requires ordinary-user permission enforcement")
    def test_readonly_receipt_preserves_previous_failure_order_and_stdout(self):
        self.receipt.write_bytes(b'{"prior_fixture":true}\n')
        self.receipt.chmod(0o400)
        self.addCleanup(self.receipt.chmod, 0o600)
        calls = []
        transport = fixtures.ConfiguredBackupTests().fixture_transport(calls)
        with patch("backup.restic", transport), redirect_stdout(io.StringIO()) as output:
            with self.assertRaises(PermissionError):
                implementation.backup(self.home, "fixture-double", self.config)
        self.assertEqual([args[0] for args in calls], ["backup", "restore", "forget"])
        self.assertEqual(output.getvalue(), "")
        self.assertEqual(self.receipt.read_bytes(), b'{"prior_fixture":true}\n')
        self.assert_source()

    def test_stage_manifest_is_exclusive_and_never_truncates_an_existing_alias(self):
        real_save = implementation.save_entry
        def add_manifest_alias(path, kind, saved):
            real_save(path, kind, saved)
            if path == self.selected:
                os.link(self.selected, self.stage / "manifest.json")
        # Labeled boundary injection into a freshly created stage, not race proof.
        with patch("backup.save_entry", add_manifest_alias):
            with self.assertRaises(FileExistsError):
                implementation.stage_configured(self.config, self.stage)
        self.assert_source()
        self.assertFalse(self.stage.exists())
        (self.home / ".omp/agent/sessions").mkdir(parents=True)
        def add_legacy_alias(home):
            os.link(self.selected, self.stage / "manifest.json")
            return "fixture-glass"
        with patch("backup.glass_build", add_legacy_alias), patch("backup.restic") as transport:
            with self.assertRaises(FileExistsError):
                implementation.backup(self.home, "fixture-double")
            transport.assert_not_called()
        self.assert_source()
        self.assertFalse(self.stage.exists())

    @unittest.skipUnless(shutil.which("restic"), "existing restic required for real local CLI proof")
    def test_real_local_restic_cli_alias_refusals_and_safe_lock_receipt_success(self):
        binary = shutil.which("restic")
        assert binary is not None
        env = {**self.env, "RESTIC_REPOSITORY": str(self.base / "local-repository"), "RESTIC_PASSWORD": "fixture"}
        subprocess.run([binary, "init"], env=env, text=True, capture_output=True, check=True)
        for reserved in (self.lock, self.receipt):
            os.link(self.selected, reserved)
            result = self.cli(binary, env)
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertEqual(result.stdout, "")
            self.assertIn("hardlink", result.stderr)
            self.assert_source()
            reserved.unlink()
        snapshots = subprocess.check_output([binary, "snapshots", "--json"], env=env, text=True)
        self.assertEqual(json.loads(snapshots), [])
        self.lock.write_bytes(b"Existing unique lock: never truncate.\n")
        previous = b'{"prior_fixture":true}\n'
        self.receipt.write_bytes(previous)
        with self.receipt.open("rb") as old:
            result = self.cli(binary, env)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(old.read(), previous)
        emitted = json.loads(result.stdout)
        self.assertEqual(emitted["scope_restore"], "matched")
        self.assertEqual(json.loads(self.receipt.read_text()), emitted)
        self.assertEqual(self.receipt.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.lock.read_bytes(), b"Existing unique lock: never truncate.\n")
        self.assert_source()
        self.assertFalse(self.stage.exists())
        self.assertFalse(list((self.home / ".cache/tmp").iterdir()))
        target = self.base / "exact-snapshot-proof"
        subprocess.run([binary, "restore", emitted["snapshot"] + ":" + emitted["stage"],
                        "--target", str(target), "--verify"], env=env, capture_output=True, text=True, check=True)
        self.assertEqual((target / "sources/chief/data.txt").read_bytes(), self.original)
        self.assertEqual(implementation.verify_configured(target)["schema"], 2)


if __name__ == "__main__":
    unittest.main()
