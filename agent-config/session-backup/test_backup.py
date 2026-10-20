import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent


class SessionBackupTests(unittest.TestCase):
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
