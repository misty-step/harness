"""Legacy content fixtures use AGENTS.md; production supplies the legacy alias path."""
import os
from pathlib import Path
import tempfile
import unittest
from canonical_instructions import OWNED, migrate, validate


class CanonicalInstructionsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.canonical = self.root / 'current' / 'AGENTS.md'
        self.canonical.parent.mkdir()
        # Exercise the standalone legacy-file branch without authoring a CLAUDE.md fixture.
        self.legacy = self.root / 'AGENTS.md'
        self.backup = self.root / 'backup' / 'AGENTS.md'
        self.args = self.canonical, self.legacy, self.backup
        self.content = OWNED + b'\n# Previous guidance\nOperator additions survive.\n'

    def snapshot(self):
        return {str(p.relative_to(self.root)): (('link', os.readlink(p)) if p.is_symlink()
                else ('file', p.read_bytes()) if p.is_file() else ('dir',))
                for p in self.root.rglob('*')}

    def test_upgrade_preserves_all_bytes_and_repeats_after_new_composition(self):
        self.legacy.write_bytes(self.content)
        before = self.snapshot()
        validate(*self.args)
        self.assertEqual(before, self.snapshot())
        migrate(*self.args)
        self.assertEqual(self.backup.read_bytes(), self.content)
        self.assertEqual(self.canonical.read_bytes(), self.content)
        self.assertFalse(os.path.lexists(self.legacy))
        self.canonical.write_bytes(OWNED + b'\n# New composition\n')
        before = self.snapshot()
        migrate(*self.args)
        self.assertEqual(before, self.snapshot())
        self.assertEqual(self.backup.stat().st_mode & 0o777, 0o600)

    def test_two_owned_files_preserve_legacy_without_overwriting_canonical(self):
        self.legacy.write_bytes(self.content)
        self.canonical.write_bytes(OWNED + b'\nNew content\n')
        migrate(*self.args)
        self.assertEqual(self.canonical.read_bytes(), OWNED + b'\nNew content\n')
        self.assertEqual(self.backup.read_bytes(), self.content)

    def test_foreign_or_late_marker_refused_without_changes(self):
        for path in (self.legacy, self.canonical):
            for content in (b'# Foreign\n', b'# Notes\n' + OWNED + b'\n'):
                with self.subTest(path=path, content=content):
                    path.write_bytes(content)
                    before = self.snapshot()
                    with self.assertRaises(ValueError):
                        migrate(*self.args)
                    self.assertEqual(before, self.snapshot())
                    path.unlink()

    def test_foreign_brokenlink_directory_and_canonical_link_are_refused(self):
        for path in (self.legacy, self.canonical):
            for kind in ('link', 'dir'):
                with self.subTest(path=path, kind=kind):
                    if kind == 'link':
                        path.symlink_to('missing')
                    else:
                        path.mkdir()
                    before = self.snapshot()
                    with self.assertRaises(ValueError):
                        migrate(*self.args)
                    self.assertEqual(before, self.snapshot())
                    path.unlink() if kind == 'link' else path.rmdir()

    def test_owned_alias_removed_and_broken_alias_refused(self):
        self.legacy.symlink_to('current/AGENTS.md')
        before = self.snapshot()
        with self.assertRaises(ValueError):
            migrate(*self.args)
        self.assertEqual(before, self.snapshot())
        self.canonical.write_bytes(self.content)
        migrate(*self.args)
        self.assertFalse(os.path.lexists(self.legacy))
        self.assertEqual(self.canonical.read_bytes(), self.content)
        before = self.snapshot()
        migrate(*self.args)
        self.assertEqual(before, self.snapshot())

    def test_backup_collision_and_symlink_parent_refused(self):
        self.legacy.write_bytes(self.content)
        self.backup.parent.mkdir()
        self.backup.write_bytes(b'Foreign backup\n')
        before = self.snapshot()
        with self.assertRaises(ValueError):
            migrate(*self.args)
        self.assertEqual(before, self.snapshot())
        self.backup.unlink()
        self.backup.parent.rmdir()
        self.backup.parent.symlink_to(self.canonical.parent)
        before = self.snapshot()
        with self.assertRaises(ValueError):
            migrate(*self.args)
        self.assertEqual(before, self.snapshot())

    def test_interrupted_upgrade_with_matching_backup_converges(self):
        self.legacy.write_bytes(self.content)
        self.backup.parent.mkdir()
        self.backup.write_bytes(self.content)
        migrate(*self.args)
        self.assertFalse(os.path.lexists(self.legacy))
        self.assertEqual(self.canonical.read_bytes(), self.content)
        self.assertEqual(self.backup.read_bytes(), self.content)


if __name__ == '__main__':
    unittest.main()
