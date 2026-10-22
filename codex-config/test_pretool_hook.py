from importlib.util import module_from_spec, spec_from_file_location
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).with_name('pretool-hook.py')
spec = spec_from_file_location('pretool_hook', SOURCE)
hook = module_from_spec(spec)
spec.loader.exec_module(hook)

FOREIGN = {'hooks': {'SessionStart': [{'hooks': [{'type': 'command', 'command': 'foreign-start'}]}],
                     'PreToolUse': [{'matcher': 'Edit', 'hooks': [{'type': 'command', 'command': 'foreign-pre'}]}]}}


class PretoolHookTest(unittest.TestCase):
    def setUp(self):
        (Path.home()/'.cache/tmp').mkdir(parents=True, exist_ok=True)
        temp = tempfile.TemporaryDirectory(prefix='harness-codex-hook-', dir=Path.home()/'.cache/tmp')
        self.addCleanup(temp.cleanup)
        self.directory = Path(temp.name)
        self.path = self.directory/'hooks.json'
        trust = patch.object(hook, 'trust')
        self.trust = trust.start()
        self.addCleanup(trust.stop)

    def test_guard_is_added_once_beside_foreign_hooks_without_rewriting_unchanged_files(self):
        self.path.write_text(json.dumps(FOREIGN))
        hook.install(self.directory)
        data = json.loads(self.path.read_text())
        self.assertEqual(data['hooks']['SessionStart'], FOREIGN['hooks']['SessionStart'])
        self.assertEqual(data['hooks']['PreToolUse'], [*FOREIGN['hooks']['PreToolUse'], {'matcher': 'Bash', 'hooks': [hook.guard_hook()]}])
        before = self.path.stat().st_ino, self.path.read_text()
        hook.install(self.directory)
        self.assertEqual(before, (self.path.stat().st_ino, self.path.read_text()))
        self.assertEqual(self.trust.call_count, 2)

    def test_creates_hooks_json_privately_when_absent(self):
        hook.install(self.directory)
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)

    def test_foreign_collisions_and_malformed_hooks_are_refused_without_changes(self):
        for value in ('{bad', '[]', json.dumps({'hooks': {'PreToolUse': {}}}),
                      json.dumps({'hooks': {'PreToolUse': [{'matcher': 'Edit', 'hooks': [hook.guard_hook()]}]}}),
                      json.dumps({'hooks': {'PreToolUse': [{'matcher': 'Bash', 'hooks': [{**hook.guard_hook(), 'async': True}]}]}})):
            self.path.write_text(value)
            with self.assertRaises(ValueError): hook.install(self.directory)
            self.assertEqual(self.path.read_text(), value)

    def test_nonregular_destination_is_refused(self):
        self.path.symlink_to('missing.json')
        with self.assertRaises(ValueError): hook.install(self.directory)


if __name__ == '__main__': unittest.main()
