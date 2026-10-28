import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from legacy_skill import owns_legacy_skill


class LegacySkillOwnership(unittest.TestCase):
    def test_exact_historical_package_is_owned_but_modified_or_extra_content_is_not(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "heartbeat"
            root.mkdir()
            content = b"historical maintained package\n"
            expected = {"heartbeat": {"SKILL.md": hashlib.sha256(content).hexdigest()}}
            (root / "SKILL.md").write_bytes(content)
            with patch("legacy_skill.PACKAGES", expected):
                self.assertTrue(owns_legacy_skill(root))
                (root / "foreign.txt").write_text("preserve me")
                self.assertFalse(owns_legacy_skill(root))
                (root / "foreign.txt").unlink()
                (root / "SKILL.md").write_bytes(content + b"modified")
                self.assertFalse(owns_legacy_skill(root))
                (root / "SKILL.md").unlink()
                target = Path(directory) / "foreign.md"
                target.write_bytes(content)
                (root / "SKILL.md").symlink_to(target)
                self.assertFalse(owns_legacy_skill(root))
                alias = Path(directory) / "lage"
                alias.symlink_to(root, target_is_directory=True)
                self.assertFalse(owns_legacy_skill(alias))

    def test_unknown_name_is_never_adopted(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertFalse(owns_legacy_skill(Path(directory)))


if __name__ == "__main__":
    unittest.main()
