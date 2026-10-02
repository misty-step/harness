import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest

from backup import stage_hermes

ROOT = Path(__file__).resolve().parent


class SessionBackupTests(unittest.TestCase):
    def test_staging_includes_committed_wal_not_uncommitted_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            profile = Path(directory) / "kaylee"
            profile.mkdir()
            for name in ("sessions", "cron", "plugin-data/kaylee"):
                (profile / name).mkdir(parents=True)
            (profile / "sessions/transcript.jsonl").write_text('supplied transcript\n')
            (profile / "plugin-data/kaylee/ledger.json").write_text('{"commissions": []}\n')
            source = profile / "state.db"
            live = sqlite3.connect(source)
            try:
                live.execute("PRAGMA journal_mode=WAL")
                live.execute("PRAGMA wal_autocheckpoint=0")
                live.execute("CREATE TABLE messages (body TEXT)")
                live.execute("INSERT INTO messages VALUES ('committed in WAL')")
                live.commit()
                live.execute("INSERT INTO messages VALUES ('not committed')")
                saved = Path(directory) / "saved"
                stage_hermes(profile, saved)
                with sqlite3.connect(saved / "state.db") as restored:
                    self.assertEqual(restored.execute("SELECT body FROM messages").fetchall(),
                                     [("committed in WAL",)])
                    self.assertEqual(restored.execute("PRAGMA quick_check").fetchall(), [("ok",)])
                self.assertEqual(live.execute("SELECT body FROM messages").fetchall(),
                                 [("committed in WAL",), ("not committed",)])
                live.rollback()
                self.assertEqual((saved / "sessions/transcript.jsonl").read_text(), 'supplied transcript\n')
                self.assertEqual((saved / "plugin-data/kaylee/ledger.json").read_text(), '{"commissions": []}\n')
                self.assertFalse((saved / "state.db-wal").exists())
                self.assertFalse((saved / "state.db-shm").exists())
            finally:
                live.close()

    def test_foreign_timer_refuses_entire_install_before_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            timer = home / ".config/systemd/user/agent-session-backup.timer"
            timer.parent.mkdir(parents=True)
            timer.write_text("operator's unrelated timer\n")
            result = subprocess.run(
                [str(ROOT.parent / "install"), "--home", str(home), "--session-backup"],
                env={**os.environ, "HOME": str(home)}, capture_output=True, text=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(timer.read_text(), "operator's unrelated timer\n")
            self.assertFalse((home / ".local/bin/agent-session-backup").exists())
            self.assertFalse((timer.parent / "agent-session-backup.service").exists())


if __name__ == "__main__":
    unittest.main()
