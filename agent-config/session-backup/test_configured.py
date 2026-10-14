"""Fixture-only contracts. Restic doubles are not remote restore evidence."""
from contextlib import closing, redirect_stdout
from datetime import datetime, timezone
import copy
import io
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from backup import backup, digest, load_config, restic, stage_configured, stage_hermes, validate_config, verify_configured

ROOT = Path(__file__).resolve().parent


def database(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(path)) as connection:
        with connection:
            connection.execute("CREATE TABLE fixture (value TEXT)")
            connection.execute("INSERT INTO fixture VALUES ('fixture only')")


def source(root, name="chief", include=None, required=True, tier="hot", role=None):
    return {"id": name, "role": role or name, "tier": tier, "required": required,
            "root": str(root), "include": include or ["memories", "state.db", "private-config.json"]}


class ConfiguredBackupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="configured-backup-fixture-")
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.profile = self.base / "inputs/chief"
        (self.profile / "memories").mkdir(parents=True)
        (self.profile / "memories/MEMORY.md").write_text("Fixture memory, not user data.\n")
        (self.profile / "private-config.json").write_text('{"fixture": true}\n')
        (self.profile / "omitted").mkdir()
        (self.profile / "omitted/not-selected.txt").write_text("Do not copy this fixture.\n")
        database(self.profile / "state.db")
        self.config = {"schema": 1, "mode": "hermes-only", "sources": [source(self.profile)]}
        self.target = self.base / "snapshot"
        self.home = self.base / "fixture-home"

    def test_complete_bounded_memories_executives_native_stores_and_cold_scope(self):
        executive = self.base / "inputs/executives"
        (executive / "memories").mkdir(parents=True)  # Empty is still durable.
        (executive / "config.json").write_text('{"fixture": "executive"}\n')
        database(executive / "state.db")
        database(executive / "projects.db")
        default = self.base / "inputs/default"
        database(default / "kanban.db")
        database(default / "projects.db")
        database(default / "kanban/boards/fixture.db")
        triage = self.base / "inputs/triage"
        database(triage / "triage.sqlite3")
        cold = self.base / "inputs/cold"
        cold.mkdir(parents=True)
        (cold / "decision.md").write_text("Synthetic cold decision.\n")
        self.config["sources"].extend([
            source(executive, "executives", ["state.db", "projects.db", "memories", "config.json"]),
            source(default, "default", ["kanban.db", "projects.db", "kanban/boards"]),
            source(triage, "triage", ["triage.sqlite3"]),
            source(cold, "decisions", ["decision.md"], tier="cold"),
        ])
        manifest = stage_configured(self.config, self.target)
        self.assertEqual(verify_configured(self.target), manifest)
        expected = {"sources/chief/state.db", "sources/executives/state.db", "sources/executives/projects.db",
                    "sources/default/kanban.db", "sources/default/projects.db",
                    "sources/default/kanban/boards/fixture.db", "sources/triage/triage.sqlite3"}
        self.assertEqual(set(manifest["databases"]), expected)
        self.assertIn("sources/executives/memories", manifest["files"])
        self.assertEqual(manifest["sources"]["decisions"]["tier"], "cold")
        self.assertFalse(any("omitted" in value for value in manifest["files"]))
        self.assertEqual(manifest["source_host"], os.uname().nodename)
        self.assertEqual(manifest["oldest_required_cut"], min(
            value["cut_started"] for value in manifest["sources"].values() if value["required"]))
        for relative, value in manifest["files"].items():
            if value["kind"] != "directory":
                self.assertEqual(value["sha256"], digest(self.target / relative))
                started = datetime.fromisoformat(value["cut_started"])
                finished = datetime.fromisoformat(value["cut_finished"])
                self.assertEqual(started.tzinfo, timezone.utc)
                self.assertLessEqual(started, finished)

    def test_db_sqlite3_and_header_detected_wal_rows_not_uncommitted(self):
        for filename in ("wal.db", "wal.sqlite3", "wal ?#.store"):
            with self.subTest(filename=filename):
                live = sqlite3.connect(self.profile / filename)
                try:
                    live.execute("PRAGMA journal_mode=WAL")
                    live.execute("PRAGMA wal_autocheckpoint=0")
                    live.execute("CREATE TABLE messages (value TEXT)")
                    live.execute("INSERT INTO messages VALUES ('committed fixture WAL')")
                    live.commit()
                    live.execute("INSERT INTO messages VALUES ('uncommitted fixture')")
                    config = {"schema": 1, "mode": "hermes-only", "sources": [
                        source(self.profile, include=[filename])
                    ]}
                    target = self.base / ("saved-" + filename)
                    manifest = stage_configured(config, target)
                    saved = target / "sources/chief" / filename
                    with closing(sqlite3.connect(saved)) as restored:
                        self.assertEqual(restored.execute("SELECT value FROM messages").fetchall(),
                                         [("committed fixture WAL",)])
                        self.assertEqual(restored.execute("PRAGMA quick_check").fetchall(), [("ok",)])
                    self.assertEqual(len(live.execute("SELECT value FROM messages").fetchall()), 2)
                    self.assertEqual(set(manifest["databases"]), {"sources/chief/" + filename})
                    self.assertFalse(list(target.rglob("*-wal")))
                    self.assertFalse(list(target.rglob("*-shm")))
                    verify_configured(target)
                finally:
                    live.rollback()
                    live.close()

    def test_directory_selection_omits_wal_and_shm_via_backup_api(self):
        live = sqlite3.connect(self.profile / "memories/history.sqlite3")
        try:
            live.execute("PRAGMA journal_mode=WAL")
            live.execute("CREATE TABLE fixture (id INTEGER)")
            live.execute("INSERT INTO fixture VALUES (7)")
            live.commit()
            stage_configured(self.config, self.target)
            self.assertFalse(list(self.target.rglob("*-wal")))
            self.assertFalse(list(self.target.rglob("*-shm")))
            verify_configured(self.target)
        finally:
            live.close()

    def test_required_missing_file_or_root_fails_without_upload_or_success(self):
        for absent in (self.profile / "state.db", self.base / "absent-root"):
            config = copy.deepcopy(self.config)
            if absent.name == "state.db":
                absent.unlink()
            else:
                config["sources"][0]["root"] = str(absent)
            with self.subTest(absent=absent), patch("backup.restic") as transport:
                with self.assertRaisesRegex(ValueError, "Required source"):
                    backup(self.home, "unused-fixture", config)
                transport.assert_not_called()
                self.assertFalse((self.home / ".local/state/agent-session-backup/last-success.json").exists())
                self.assertFalse((self.home / ".local/state/agent-session-backup/snapshot").exists())

    def test_optional_missing_partial_and_explicit_omp_modes(self):
        self.config["sources"].append(source(self.base / "missing", "optional", ["data"], required=False))
        self.config["sources"].append(source(self.profile, "partial", ["omitted", "absent"], required=False))
        manifest = stage_configured(self.config, self.target)
        self.assertEqual(manifest["sources"]["optional"]["status"], "missing")
        self.assertEqual(manifest["sources"]["partial"]["missing"], ["absent"])
        verify_configured(self.target)
        config = copy.deepcopy(self.config)
        config["mode"] = "with-omp"
        with self.assertRaisesRegex(ValueError, "required omp"):
            validate_config(config)
        omp = self.base / "inputs/omp"
        (omp / "sessions").mkdir(parents=True)
        (omp / "sessions/fixture.jsonl").write_text('{"fixture": true}\n')
        config["sources"].append(source(omp, "omp", ["sessions"], role="omp"))
        with self.assertRaisesRegex(ValueError, "cannot select"):
            validate_config({**config, "mode": "hermes-only"})
        manifest = stage_configured(config, self.base / "with-omp")
        self.assertIn("sources/omp/sessions/fixture.jsonl", manifest["files"])

    def test_config_rejects_unbounded_paths_duplicates_overlap_and_unknown_fields(self):
        for changes in ({"root": "/"}, {"root": "//home/fixture"}, {"root": "relative"}, {"include": ["."]},
                        {"include": ["../omitted"]}, {"include": ["/absolute"]},
                        {"include": ["memories", "memories/MEMORY.md"]},
                        {"include": ["memories", "memories"]}, {"include": ["state.db-wal"]},
                        {"include": []}, {"id": "../escape"}, {"required": "yes"},
                        {"tier": "unknown"}, {"exclude": ["anything"]}):
            config = copy.deepcopy(self.config)
            config["sources"][0].update(changes)
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validate_config(config)
        config = copy.deepcopy(self.config)
        config["sources"].append(copy.deepcopy(config["sources"][0]))
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            validate_config(config)
        with self.assertRaisesRegex(ValueError, "required"):
            validate_config({**self.config, "sources": [{**self.config["sources"][0], "required": False}]})

    def test_symlinks_to_internal_omitted_external_and_root_are_rejected(self):
        for link_target in (self.profile / "memories/MEMORY.md", self.profile / "omitted", self.base):
            link = self.profile / "memories/link"
            link.symlink_to(link_target)
            with self.subTest(target=link_target), self.assertRaisesRegex(ValueError, "Symlinks"):
                stage_configured(self.config, self.target)
            self.assertFalse(self.target.exists())
            link.unlink()
        root_link = self.base / "root-link"
        root_link.symlink_to(self.profile, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "Symlinks"):
            stage_configured({**self.config, "sources": [source(root_link)]}, self.target)
        parent_link = self.base / "parent-link"
        parent_link.symlink_to(self.profile.parent, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "Symlinks"):
            stage_configured({**self.config, "sources": [source(parent_link / "chief")]}, self.target)

    def test_orphan_sidecars_special_files_and_existing_or_overlapping_target_refused(self):
        orphan = self.profile / "memories/orphan.db-wal"
        orphan.write_text("fixture only")
        with self.assertRaisesRegex(ValueError, "Orphan"):
            stage_configured(self.config, self.target)
        orphan.unlink()
        fifo = self.profile / "memories/fifo"
        os.mkfifo(fifo)
        with self.assertRaisesRegex(ValueError, "file type"):
            stage_configured(self.config, self.target)
        fifo.unlink()
        self.target.mkdir()
        with self.assertRaises(FileExistsError):
            stage_configured(self.config, self.target)
        self.assertTrue(self.target.exists())
        with self.assertRaisesRegex(ValueError, "overlaps"):
            stage_configured(self.config, self.profile / "memories/snapshot")
        selected = self.home / ".local/state/agent-session-backup"
        config = {**self.config, "sources": [source(self.home, include=[".local/state/agent-session-backup"])]}
        with self.assertRaisesRegex(ValueError, "overlaps"), patch("backup.restic") as transport:
            backup(self.home, "unused-fixture", config)
        transport.assert_not_called()
        self.assertFalse(selected.exists())

    def test_offline_verification_does_not_read_original_roots(self):
        manifest = stage_configured(self.config, self.target)
        shutil.rmtree(self.profile)
        self.profile.symlink_to(self.base / "absent")
        self.assertEqual(verify_configured(self.target), manifest)

    def test_manifest_config_identity_is_independent_of_object_order_and_duplicate_keys_refused(self):
        self.config["sources"].append(source(self.base / "absent", "optional", ["absent"], required=False))
        stage_configured(self.config, self.target)
        path = self.target / "manifest.json"
        manifest = json.loads(path.read_text())
        manifest["sources"] = dict(reversed(list(manifest["sources"].items())))
        path.write_text(json.dumps(manifest))
        verify_configured(self.target)
        config_path = self.base / "duplicate.json"
        config_path.write_text('{"schema":1,"schema":1,"mode":"hermes-only","sources":[]}')
        with self.assertRaisesRegex(ValueError, "Duplicate JSON key"):
            load_config(config_path)

    def test_restored_database_integrity_is_checked_even_with_matching_manifest_hash(self):
        manifest = stage_configured(self.config, self.target)
        saved = self.target / "sources/chief/state.db"
        saved.write_bytes(b"not a SQLite database")
        entry = manifest["files"]["sources/chief/state.db"]
        entry.update(sha256=digest(saved), size=saved.stat().st_size)
        manifest["databases"]["sources/chief/state.db"] = entry["sha256"]
        (self.target / "manifest.json").write_text(json.dumps(manifest))
        with self.assertRaises(sqlite3.Error):
            verify_configured(self.target)

    def test_legacy_selected_sqlite3_uses_backup_api_and_dereferences_links(self):
        for name in ("sessions", "cron", "plugin-data/kaylee"):
            (self.profile / name).mkdir(parents=True)
        live = sqlite3.connect(self.profile / "cron/fixture.sqlite3")
        try:
            live.execute("PRAGMA journal_mode=WAL")
            live.execute("CREATE TABLE fixture (id INTEGER)")
            live.execute("INSERT INTO fixture VALUES (8)")
            live.commit()
            saved = self.base / "legacy"
            databases = stage_hermes(self.profile, saved)
            self.assertIn(saved / "cron/fixture.sqlite3", databases)
            with closing(sqlite3.connect(saved / "cron/fixture.sqlite3")) as restored:
                self.assertEqual(restored.execute("SELECT id FROM fixture").fetchall(), [(8,)])
            self.assertFalse(list(saved.rglob("*-wal")))
            (self.profile / "sessions/link").symlink_to(self.profile / "omitted")
            linked = self.base / "legacy-with-link"
            stage_hermes(self.profile, linked)
            self.assertEqual((linked / "sessions/link/not-selected.txt").read_text(), "Do not copy this fixture.\n")
            self.assertFalse((linked / "sessions/link").is_symlink())
        finally:
            live.close()

    def test_restored_inventory_hash_modes_sidecars_and_manifest_cuts_fail_closed(self):
        stage_configured(self.config, self.target)
        original = self.base / "original"
        shutil.copytree(self.target, original)
        mutations = ("memory", "missing", "extra", "mode", "symlink", "sidecar", "oldest", "interval", "selection")
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                shutil.rmtree(self.target)
                shutil.copytree(original, self.target)
                memory = self.target / "sources/chief/memories/MEMORY.md"
                if mutation == "memory":
                    memory.write_text("Altered fixture\n")
                elif mutation == "missing":
                    memory.unlink()
                elif mutation == "extra":
                    (memory.parent / "extra").write_text("Extra fixture\n")
                elif mutation == "mode":
                    memory.chmod(0o700)
                elif mutation == "symlink":
                    memory.unlink()
                    memory.symlink_to(self.profile / "memories/MEMORY.md")
                elif mutation == "sidecar":
                    (self.target / "sources/chief/state.db-wal").write_text("Extra fixture WAL")
                else:
                    path = self.target / "manifest.json"
                    manifest = json.loads(path.read_text())
                    if mutation == "oldest":
                        manifest["oldest_required_cut"] = manifest["cut_finished"]
                    elif mutation == "interval":
                        manifest["sources"]["chief"]["cut_finished"] = "2000-01-01T00:00:00+00:00"
                    else:
                        del manifest["files"]["sources/chief/private-config.json"]
                    path.write_text(json.dumps(manifest))
                with self.assertRaises(ValueError):
                    verify_configured(self.target)

    def fixture_transport(self, calls, corrupt=None):
        def transport(binary, *args):
            calls.append(args)
            if args[0] == "backup":
                stage = Path(args[-1])
                paths = list(stage.rglob("*"))
                return json.dumps({"message_type": "summary", "snapshot_id": "fixture-snapshot",
                                   "total_files_processed": sum(path.is_file() for path in paths),
                                   "total_bytes_processed": sum(path.stat().st_size for path in paths if path.is_file())})
            if args[0] == "restore":
                _, stage = args[1].split(":", 1)
                target = Path(args[3])
                shutil.copytree(stage, target, dirs_exist_ok=True)
                if corrupt == "memory":
                    (target / "sources/chief/memories/MEMORY.md").write_text("corrupted fixture")
                elif corrupt == "manifest":
                    (target / "manifest.json").write_text("{}\n")
                elif corrupt == "transport":
                    raise subprocess.CalledProcessError(1, [binary, "restore"])
                return "fixture restore\n"
            self.assertEqual(args[0], "forget")
            return "fixture retention\n"
        return transport

    def test_configured_uploaded_restore_failure_never_retains_or_overwrites_success(self):
        marker = self.home / ".local/state/agent-session-backup/last-success.json"
        marker.parent.mkdir(parents=True)
        marker.write_text('{"previous_fixture": true}\n')
        for corrupt in ("memory", "manifest", "transport"):
            calls = []
            with self.subTest(corrupt=corrupt), patch("backup.restic", self.fixture_transport(calls, corrupt)):
                with self.assertRaises((ValueError, subprocess.CalledProcessError)):
                    backup(self.home, "fixture-restic-double", self.config)
            self.assertEqual([call[0] for call in calls], ["backup", "restore"])
            self.assertEqual(marker.read_text(), '{"previous_fixture": true}\n')
            self.assertFalse((marker.parent / "snapshot").exists())

    def test_configured_upload_contains_only_stage_and_retention_is_unchanged(self):
        calls = []
        with patch("backup.restic", self.fixture_transport(calls)), redirect_stdout(io.StringIO()):
            backup(self.home, "fixture-restic-double", self.config)
        self.assertEqual([call[0] for call in calls], ["backup", "restore", "forget"])
        self.assertEqual(calls[0][:-1], ("backup", "--json", "--tag", "agent-session-stores", "--read-concurrency", "2"))
        self.assertEqual(calls[1][1], "fixture-snapshot:" + calls[0][-1].as_posix())
        self.assertEqual(calls[2], ("forget", "--tag", "agent-session-stores", "--host", os.uname().nodename,
                                   "--keep-daily", "30", "--keep-monthly", "24"))
        receipt = json.loads((self.home / ".local/state/agent-session-backup/last-success.json").read_text())
        self.assertEqual(receipt["scope_restore"], "matched")
        self.assertIn("oldest_required_cut", receipt)
        self.assertFalse((self.home / ".omp").exists())

    def test_legacy_scope_requires_omp_and_keeps_schema1_and_direct_sessions(self):
        with self.assertRaisesRegex(ValueError, "must both exist"):
            backup(self.home, "unused-fixture")
        profile = self.home / ".hermes/profiles/kaylee"
        shutil.copytree(self.profile, profile)
        for name in ("sessions", "cron", "plugin-data/kaylee"):
            (profile / name).mkdir(parents=True)
        sessions = self.home / ".omp/agent/sessions"
        sessions.mkdir(parents=True)
        calls, captured = [], []
        transport = self.fixture_transport(calls)
        def legacy_transport(binary, *args):
            if args[0] == "backup":
                captured.append(json.loads((Path(args[-1]) / "manifest.json").read_text()))
                self.assertFalse((Path(args[-1]) / "hermes/memories").exists())
            return transport(binary, *args)
        with patch("backup.restic", legacy_transport), patch("backup.subprocess.check_output", return_value="fixture-glass\n"), redirect_stdout(io.StringIO()):
            backup(self.home, "fixture-restic-double")
        self.assertEqual(captured[0]["schema"], 1)
        self.assertEqual(captured[0]["profile"], str(profile))
        self.assertEqual(captured[0]["glass_build"], "fixture-glass")
        self.assertEqual(calls[0][-2], sessions)
        self.assertEqual(set(captured[0]["databases"]), {"hermes/state.db"})

    @unittest.skipUnless(shutil.which("restic"), "restic unavailable; local repository integration not run")
    def test_real_restic_local_fixture_repository_restore_without_originals(self):
        binary = shutil.which("restic")
        assert binary is not None  # skipUnless checks this fixture prerequisite.
        env = {"PATH": os.environ["PATH"], "HOME": str(self.home), "TMPDIR": tempfile.gettempdir(),
               "RESTIC_REPOSITORY": str(self.base / "local-fixture-repository"),
               "RESTIC_PASSWORD": "fixture"}
        with patch.dict(os.environ, env, clear=True):
            subprocess.run([binary, "init"], check=True, capture_output=True, text=True)
            with redirect_stdout(io.StringIO()) as output:
                backup(self.home, binary, self.config)
            receipt = json.loads(output.getvalue())
            self.assertEqual(receipt["scope_restore"], "matched")
            shutil.rmtree(self.profile)
            stage = self.home / ".local/state/agent-session-backup/snapshot"
            restic(binary, "restore", receipt["snapshot"] + ":" + str(stage), "--target", self.target, "--verify")
            manifest = verify_configured(self.target)
            self.assertEqual(len(manifest["databases"]), 1)
            self.assertEqual(manifest["oldest_required_cut"], receipt["oldest_required_cut"])

    @unittest.skipUnless(shutil.which("restic"), "restic unavailable; local corruption integration not run")
    def test_real_restic_restored_fixture_corruption_blocks_success_and_retention(self):
        binary = shutil.which("restic")
        assert binary is not None  # skipUnless checks this fixture prerequisite.
        env = {"PATH": os.environ["PATH"], "HOME": str(self.home), "TMPDIR": tempfile.gettempdir(),
               "RESTIC_REPOSITORY": str(self.base / "local-fixture-repository"),
               "RESTIC_PASSWORD": "fixture"}
        calls = []
        def corrupt_restore(binary, *args):
            calls.append(args[0])
            output = restic(binary, *args)
            if args[0] == "restore":
                (Path(args[3]) / "sources/chief/memories/MEMORY.md").write_text("Altered restored fixture")
            return output
        with patch.dict(os.environ, env, clear=True):
            subprocess.run([binary, "init"], check=True, capture_output=True, text=True)
            with patch("backup.restic", corrupt_restore), self.assertRaisesRegex(ValueError, "Restored file differs"):
                backup(self.home, binary, self.config)
        self.assertEqual(calls, ["backup", "restore"])
        self.assertFalse((self.home / ".local/state/agent-session-backup/last-success.json").exists())

    def test_stage_only_and_verify_cli_need_no_glass_omp_or_credentials(self):
        config_path = self.base / "sources.json"
        config_path.write_text(json.dumps(self.config))
        command = ["python3", str(ROOT / "backup.py"), "--config", str(config_path), "--stage-only", str(self.target)]
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["manifest_sha256"], digest(self.target / "manifest.json"))
        shutil.rmtree(self.profile)
        result = subprocess.run(["python3", str(ROOT / "backup.py"), "--verify-stage", str(self.target)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["scope_restore"], "matched")
        invalid = subprocess.run(["python3", str(ROOT / "backup.py"), "--stage-only", str(self.target)], capture_output=True, text=True)
        self.assertNotEqual(invalid.returncode, 0)


if __name__ == "__main__":
    unittest.main()
