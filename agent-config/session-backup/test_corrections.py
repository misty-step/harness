"""Correction regressions: synthetic sources and isolated local restic only."""
from contextlib import redirect_stdout
import errno
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import backup as implementation
from test_configured import source

ROOT = Path(__file__).resolve().parent


class BackupCorrectionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="backup-correction-fixture-")
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.home = self.base / "home"
        self.profile = self.base / "input"
        self.profile.mkdir()
        (self.profile / "data.txt").write_text("Synthetic recovery input.\n")
        self.config = self.config_for(source(self.profile, include=["data.txt"]))
        self.stage = self.base / "stage"
        self.state = self.home / ".local/state/agent-session-backup"

    def config_for(self, *sources):
        return {"schema": 1, "mode": "hermes-only", "sources": list(sources)}

    def cli(self, home, config, env=None):
        config_path = self.base / "sources.json"
        config_path.write_text(json.dumps(config))
        binary = shutil.which("restic") if env is not None else "/fixture-no-restic"
        return subprocess.run([sys.executable, str(ROOT / "backup.py"), "--home", str(home),
                               "--config", str(config_path), "--restic", binary or "/fixture-no-restic"],
                              env=env, text=True, capture_output=True)

    def readonly_source(self):
        selected = self.profile / "accepted"
        (selected / "nested").mkdir(parents=True)
        (selected / "nested/decision.txt").write_text("Read-only synthetic decision.\n")
        selected.chmod(0o555)
        (selected / "nested").chmod(0o555)
        self.addCleanup(selected.chmod, 0o700)
        self.addCleanup((selected / "nested").chmod, 0o700)
        return selected, self.config_for(source(self.profile, include=["accepted"]))

    def assert_readonly_source_intact(self, selected):
        self.assertEqual(selected.stat().st_mode & 0o777, 0o555)
        self.assertEqual((selected / "nested").stat().st_mode & 0o777, 0o555)
        self.assertEqual((selected / "nested/decision.txt").read_text(), "Read-only synthetic decision.\n")

    def test_cli_home_aliases_never_delete_selected_snapshot_input(self):
        (self.home / "child/deeper").mkdir(parents=True)
        marker = self.state / "snapshot/fixture.txt"
        marker.parent.mkdir(parents=True)
        original = "Selected synthetic input; never remove.\n"
        config = self.config_for(source(self.state, include=["snapshot/fixture.txt"]))
        for home in (self.home, self.home / "child/..", self.home / "child/deeper/../.."):
            with self.subTest(home=str(home)):
                marker.parent.mkdir(parents=True, exist_ok=True)
                marker.write_text(original)
                result = self.cli(home, config)
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertEqual(marker.read_text(), original)
                self.assertEqual(result.stdout, "")
                self.assertFalse((self.state / "last-success.json").exists())

    def test_home_state_scratch_and_stale_stage_symlinks_are_refused_before_removal(self):
        outside = self.base / "outside"
        outside.mkdir()
        marker = outside / "fixture.txt"
        marker.write_text("Unselected fixture must remain.\n")
        for relative in ("home", "home/.local/state/agent-session-backup", "home/.cache/tmp",
                         "home/.local/state/agent-session-backup/snapshot"):
            link = self.base / relative
            link.parent.mkdir(parents=True, exist_ok=True)
            link.symlink_to(outside, target_is_directory=True)
            try:
                with self.subTest(relative=relative), patch("backup.restic") as transport:
                    with self.assertRaisesRegex(ValueError, "Symlink"):
                        implementation.backup(self.home, "fixture-double", self.config)
                    transport.assert_not_called()
                    self.assertTrue(link.is_symlink())
                    self.assertEqual(marker.read_text(), "Unselected fixture must remain.\n")
            finally:
                link.unlink()

    def test_stage_alias_and_symlink_parent_refused_without_touching_source(self):
        child = self.profile / "child"
        child.mkdir()
        config = self.config_for(source(self.profile, include=["child"]))
        with self.assertRaises(ValueError):
            implementation.stage_configured(config, child / "../child/stage")
        self.assertFalse((child / "stage").exists())
        link = self.base / "linked-input"
        link.symlink_to(self.profile, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "Symlink"):
            implementation.stage_configured(config, link / "elsewhere")
        self.assertFalse((self.profile / "elsewhere").exists())

    @unittest.skipIf(os.getuid() == 0, "requires ordinary-user permission enforcement")
    def test_optional_denied_parent_and_file_fail_instead_of_reporting_missing(self):
        closed = self.base / "optional/closed"
        closed.mkdir(parents=True)
        selected = closed / "existing.txt"
        selected.write_text("Existing optional synthetic input.\n")
        config = self.config_for(self.config["sources"][0], source(closed.parent, "optional", ["closed/existing.txt"], False))
        for denied in (closed, selected):
            denied.chmod(0)
            try:
                with self.subTest(denied=denied), patch("backup.restic") as transport:
                    with self.assertRaises(PermissionError):
                        implementation.backup(self.home, "fixture-double", config)
                    transport.assert_not_called()
                    self.assertFalse((self.state / "last-success.json").exists())
                    self.assertFalse((self.state / "snapshot").exists())
            finally:
                denied.chmod(0o700 if denied == closed else 0o600)
        self.assertEqual(selected.read_text(), "Existing optional synthetic input.\n")

    def test_optional_unexpected_stat_error_is_not_absence(self):
        original = Path.lstat
        selected = self.profile / "data.txt"
        def denied(path, *args, **kwargs):
            if path == selected:
                raise OSError(errno.EIO, "Synthetic I/O failure", str(path))
            return original(path, *args, **kwargs)
        optional = source(self.profile, "optional", ["data.txt"], False)
        required = source(self.profile, "required", ["absent-required"])
        with patch.object(Path, "lstat", denied), self.assertRaisesRegex(OSError, "Synthetic I/O failure"):
            implementation.stage_configured(self.config_for(optional, required), self.stage)
        self.assertFalse(self.stage.exists())

    def test_readonly_stage_failure_preserves_primary_error_and_removes_only_owned_stage(self):
        selected, config = self.readonly_source()
        config["sources"].append(source(self.base / "absent", "missing", ["data"]))
        sibling = self.base / "sibling.txt"
        sibling.write_text("Unrelated fixture.\n")
        with self.assertRaisesRegex(ValueError, "Required source missing is missing"):
            implementation.stage_configured(config, self.stage)
        self.assertFalse(self.stage.exists())
        self.assertEqual(sibling.read_text(), "Unrelated fixture.\n")
        self.assert_readonly_source_intact(selected)
        result = self.cli(self.home, config)
        self.assertEqual(result.returncode, 1)
        self.assertIn("Required source missing is missing", result.stderr)
        self.assertNotIn("Permission denied", result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertFalse((self.state / "snapshot").exists())
        self.assertFalse((self.state / "last-success.json").exists())
        self.assert_readonly_source_intact(selected)

    def test_cleanup_failure_never_masks_primary_error(self):
        config = self.config_for(source(self.base / "absent", include=["data"]))
        with patch("backup.remove_owned_tree", side_effect=PermissionError("Synthetic cleanup failure")):
            with self.assertRaisesRegex(ValueError, "Required source") as raised:
                implementation.stage_configured(config, self.stage)
        self.assertTrue(any("Synthetic cleanup failure" in note for note in getattr(raised.exception, "__notes__", [])))

    def test_owned_cleanup_never_chmods_or_traverses_linked_and_hardlinked_sources(self):
        self.stage.mkdir()
        directory = self.stage / "readonly"
        directory.mkdir()
        outside = self.profile / "data.txt"
        outside.chmod(0o444)
        original = outside.stat()
        os.link(outside, directory / "hardlink.txt")
        (directory / "source-link").symlink_to(self.profile, target_is_directory=True)
        (directory / "broken-link").symlink_to(self.base / "absent")
        directory.chmod(0o555)
        implementation.remove_owned_tree(self.stage)
        self.assertFalse(self.stage.exists())
        self.assertEqual(outside.read_text(), "Synthetic recovery input.\n")
        self.assertEqual(outside.stat().st_mode, original.st_mode)
        self.assertEqual(outside.stat().st_mtime_ns, original.st_mtime_ns)
        self.assertTrue(self.profile.is_dir())

    def test_cleanup_failure_blocks_retention_receipt_and_stdout(self):
        from test_configured import ConfiguredBackupTests
        calls = []
        # This explicitly labeled transport double isolates the cleanup outcome.
        transport = ConfiguredBackupTests().fixture_transport(calls)
        original = implementation.remove_owned_tree
        stage = self.state / "snapshot"
        def denied(path):
            if path == stage:
                raise PermissionError("Synthetic stage cleanup failure")
            return original(path)
        with patch("backup.restic", transport), patch("backup.remove_owned_tree", denied), redirect_stdout(io.StringIO()) as output:
            with self.assertRaisesRegex(PermissionError, "Synthetic stage cleanup failure"):
                implementation.backup(self.home, "fixture-double", self.config)
        self.assertEqual([call[0] for call in calls], ["backup", "restore"])
        self.assertEqual(output.getvalue(), "")
        self.assertFalse((self.state / "last-success.json").exists())

    @unittest.skipUnless(shutil.which("restic"), "existing restic required for local fixture proof")
    def test_real_restic_readonly_cli_success_and_restored_corruption_failure(self):
        selected, config = self.readonly_source()
        binary = shutil.which("restic")
        assert binary is not None
        env = {"PATH": os.environ["PATH"], "HOME": str(self.home), "TMPDIR": tempfile.gettempdir(),
               "PYTHONDONTWRITEBYTECODE": "1", "RESTIC_REPOSITORY": str(self.base / "local-repository"),
               "RESTIC_PASSWORD": "fixture"}
        subprocess.run([binary, "init"], env=env, capture_output=True, text=True, check=True)
        result = self.cli(self.home, config, env)
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = self.state / "last-success.json"
        self.assertEqual(json.loads(result.stdout), json.loads(receipt.read_text()))
        self.assertEqual(json.loads(result.stdout)["scope_restore"], "matched")
        self.assertFalse((self.state / "snapshot").exists())
        previous = receipt.read_bytes()
        calls = []
        original_restic = implementation.restic
        def corrupt_restore(binary, *args):
            calls.append(args[0])
            response = original_restic(binary, *args)
            if args[0] == "restore":
                (Path(args[3]) / "sources/chief/accepted/nested/decision.txt").write_text("Corrupted restored fixture.\n")
            return response
        with patch.dict(os.environ, env, clear=True):
            with patch("backup.restic", corrupt_restore), redirect_stdout(io.StringIO()) as output:
                with self.assertRaisesRegex(ValueError, "Restored file differs"):
                    implementation.backup(self.home, binary, config)
        self.assertEqual(calls, ["backup", "restore"])
        self.assertEqual(output.getvalue(), "")
        self.assertEqual(receipt.read_bytes(), previous)
        self.assertFalse((self.state / "snapshot").exists())
        self.assertFalse(list((self.home / ".cache/tmp").iterdir()))
        self.assert_readonly_source_intact(selected)

    def test_legacy_sessions_link_into_reserved_state_is_rejected_before_source_deletion(self):
        marker = self.state / "snapshot/selected.jsonl"
        marker.parent.mkdir(parents=True)
        marker.write_text("Legacy linked source must remain.\n")
        sessions = self.home / ".omp/agent/sessions"
        sessions.parent.mkdir(parents=True)
        sessions.symlink_to(marker.parent, target_is_directory=True)
        with patch("backup.restic") as transport, self.assertRaisesRegex(ValueError, "overlaps"):
            implementation.backup(self.home, "fixture-double")
        transport.assert_not_called()
        self.assertEqual(marker.read_text(), "Legacy linked source must remain.\n")
        self.assertFalse((self.state / "backup.lock").exists())


if __name__ == "__main__":
    unittest.main()
