import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).with_name('agents-hook.py')
spec = importlib.util.spec_from_file_location('agents_hook', SOURCE)
hook = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hook)


class AgentsHookTest(unittest.TestCase):
    def setUp(self):
        (Path.home()/'.cache/tmp').mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='harness-hook-', dir=Path.home()/'.cache/tmp')
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)/'.claude'
        self.directory.mkdir()
        (self.directory/'AGENTS.md').write_text('# Global instructions\n' + '🦆 requires complete instructions.\n'*600)
        self.foreign = {'env': {'FOREIGN': 'keep'}, 'permissions': {'deny': ['Read(secret)']},
                        'hooks': {'SessionStart': [{'matcher': 'startup', 'hooks': [{'type': 'command', 'command': 'printf foreign'}]}],
                                  'Stop': [{'hooks': [{'type': 'command', 'command': 'printf stop'}]}]}}
        (self.directory/'settings.json').write_text(json.dumps(self.foreign))

    def snapshot(self):
        return {str(p.relative_to(self.directory)): ('link', os.readlink(p)) if p.is_symlink()
                else ('file', p.read_bytes(), p.stat().st_mode) if p.is_file() else ('dir',)
                for p in self.directory.rglob('*')}

    def test_install_preserves_foreign_state_and_full_context_reruns_without_writes(self):
        mode = (self.directory/'settings.json').stat().st_mode
        before = self.snapshot()
        hook.plan(self.directory)
        self.assertEqual(before, self.snapshot())
        hook.install(self.directory)
        self.assertEqual((self.directory/'settings.json').stat().st_mode, mode)
        data = json.loads((self.directory/'settings.json').read_text())
        self.assertEqual(data['env'], self.foreign['env'])
        self.assertEqual(data['permissions'], self.foreign['permissions'])
        self.assertEqual(data['hooks']['Stop'], self.foreign['hooks']['Stop'])
        self.assertEqual(data['hooks']['SessionStart'][0], self.foreign['hooks']['SessionStart'][0])
        handlers = data['hooks']['SessionStart'][-1]['hooks']
        text = ''
        for part in range(len(handlers)):
            result = subprocess.run(['python3', str(self.directory/'hooks/harness-agents.py'), str(part)], capture_output=True, text=True, check=True)
            context = json.loads(result.stdout)['hookSpecificOutput']['additionalContext']
            self.assertLess(len(context.encode('utf-16-le'))//2, 10000)
            text += context.split('\n', 1)[1]
        self.assertEqual(text, (self.directory/'AGENTS.md').read_text())
        before = self.snapshot()
        stats = {p: (self.directory/p).stat().st_ino for p in ('settings.json','hooks/harness-agents.py')}
        hook.install(self.directory)
        self.assertEqual(before, self.snapshot())
        self.assertEqual(stats, {p: (self.directory/p).stat().st_ino for p in stats})

    def test_guidance_upgrade_updates_parts_without_duplicate_hooks(self):
        hook.install(self.directory)
        (self.directory/'AGENTS.md').write_text('# New guidance\nshort\n')
        hook.install(self.directory)
        data = json.loads((self.directory/'settings.json').read_text())
        self.assertEqual(len(data['hooks']['SessionStart']), 2)
        self.assertEqual(len(data['hooks']['SessionStart'][-1]['hooks']), 1)
        result = subprocess.run(['python3', str(self.directory/'hooks/harness-agents.py'), '0'], capture_output=True, text=True, check=True)
        self.assertIn('# New guidance', json.loads(result.stdout)['hookSpecificOutput']['additionalContext'])

    def test_owned_handler_upgrade_preserves_foreign_hooks_and_permissions(self):
        hook.install(self.directory)
        script = self.directory/'hooks/harness-agents.py'
        script.write_text('#!/usr/bin/env python3\n' + hook.OWNER + '\nprint("obsolete handler")\n')
        hook.install(self.directory)
        self.assertEqual(script.read_text(), SOURCE.read_text())
        data = json.loads((self.directory/'settings.json').read_text())
        self.assertEqual(data['hooks']['SessionStart'][0], self.foreign['hooks']['SessionStart'][0])
        self.assertEqual(data['permissions'], self.foreign['permissions'])

    def test_foreign_hook_and_symlinked_settings_are_refused_without_changes(self):
        script = self.directory/'hooks/harness-agents.py'
        script.parent.mkdir()
        script.write_text('# foreign script\n')
        before = self.snapshot()
        with self.assertRaises(ValueError): hook.install(self.directory)
        self.assertEqual(before, self.snapshot())
        script.unlink()
        (self.directory/'settings.json').unlink()
        (self.directory/'settings.json').symlink_to('foreign.json')
        before = self.snapshot()
        with self.assertRaises(ValueError): hook.install(self.directory)
        self.assertEqual(before, self.snapshot())

    def test_malformed_settings_and_reserved_command_collisions_are_refused(self):
        script = self.directory/'hooks/harness-agents.py'
        for value in ('{bad json', json.dumps({'hooks': {'SessionStart': [{'hooks': [{'type': 'command', 'command': hook.command(script, 0)}]}]}})):
            (self.directory/'settings.json').write_text(value)
            before = self.snapshot()
            with self.assertRaises(ValueError): hook.install(self.directory)
            self.assertEqual(before, self.snapshot())

    def test_explicit_disable_all_hooks_and_foreign_empty_groups_are_preserved(self):
        data = {**self.foreign, 'disableAllHooks': True}
        data['hooks']['SessionStart'].append({'matcher': 'resume', 'hooks': []})
        (self.directory/'settings.json').write_text(json.dumps(data))
        hook.install(self.directory)
        updated = json.loads((self.directory/'settings.json').read_text())
        self.assertTrue(updated['disableAllHooks'])
        self.assertEqual(updated['hooks']['SessionStart'][:-1], data['hooks']['SessionStart'])

    def test_guard_hook_is_added_once_beside_foreign_pretooluse_hooks(self):
        foreign = {'matcher': 'Edit', 'hooks': [{'type': 'command', 'command': 'foreign-pre'}]}
        self.foreign['hooks']['PreToolUse'] = [foreign]
        (self.directory/'settings.json').write_text(json.dumps(self.foreign))
        hook.install(self.directory)
        guard = {'matcher': 'Bash', 'hooks': [hook.guard_hook()]}
        self.assertEqual(json.loads((self.directory/'settings.json').read_text())['hooks']['PreToolUse'], [foreign, guard])
        before = self.snapshot()
        hook.install(self.directory)
        self.assertEqual(before, self.snapshot())

    def test_foreign_guard_command_collisions_and_malformed_pretooluse_are_refused(self):
        command = hook.guard_command()
        for pretool in ({'PreToolUse': {}}, {'PreToolUse': [{'matcher': 'Bash'}]},
                        {'PreToolUse': [{'matcher': 'Edit', 'hooks': [hook.guard_hook()]}]},
                        {'PreToolUse': [{'matcher': 'Bash', 'hooks': [{'type': 'command', 'command': command, 'timeout': 99}]}]}):
            (self.directory/'settings.json').write_text(json.dumps({'hooks': pretool}))
            before = self.snapshot()
            with self.assertRaises(ValueError): hook.install(self.directory)
            self.assertEqual(before, self.snapshot())

    def test_permission_hook_is_added_once_beside_foreign_hooks_and_collisions_are_refused(self):
        foreign = {'hooks': [{'type': 'command', 'command': 'foreign-permission'}]}
        self.foreign['hooks']['PermissionRequest'] = [foreign]
        (self.directory/'settings.json').write_text(json.dumps(self.foreign))
        hook.install(self.directory)
        script = self.directory/'hooks/harness-agents.py'
        installed = json.loads((self.directory/'settings.json').read_text())['hooks']['PermissionRequest']
        self.assertEqual(installed, [foreign, {'hooks': [hook.permission_hook(script)]}])
        before = self.snapshot()
        hook.install(self.directory)
        self.assertEqual(before, self.snapshot())
        for group in ({'matcher': 'Bash', 'hooks': [hook.permission_hook(script)]},
                      {'hooks': [{**hook.permission_hook(script), 'timeout': 99}]}):
            (self.directory/'settings.json').write_text(json.dumps({'hooks': {'PermissionRequest': [group]}}))
            before = self.snapshot()
            with self.assertRaises(ValueError): hook.install(self.directory)
            self.assertEqual(before, self.snapshot())

    def test_permission_hook_refuses_only_unanswerable_full_access_requests(self):
        hook.install(self.directory)
        script = str(self.directory/'hooks/harness-agents.py')

        def run(mode, entrypoint, tool='Bash'):
            env = {**os.environ, 'CLAUDE_CODE_ENTRYPOINT': entrypoint}
            return subprocess.run(['python3', script, 'permission'], input=json.dumps({'permission_mode': mode, 'tool_name': tool}),
                                  capture_output=True, text=True, check=True, env=env).stdout
        decision = json.loads(run('bypassPermissions', 'sdk-ts'))['hookSpecificOutput']['decision']
        self.assertEqual(decision['behavior'], 'deny')
        self.assertIn('literal path', decision['message'])
        self.assertEqual(run('bypassPermissions', 'sdk-ts', 'AskUserQuestion'), '')
        self.assertEqual(run('bypassPermissions', 'sdk-ts', 'ExitPlanMode'), '')
        self.assertEqual(run('default', 'sdk-ts'), '')
        self.assertEqual(run('bypassPermissions', 'cli'), '')
        self.assertEqual(subprocess.run(['python3', script, 'permission'], input='not json', capture_output=True, text=True, check=True).stdout, '')
        self.assertEqual(subprocess.run(['python3', script, 'permission'], input='[]', capture_output=True, text=True, check=True).stdout, '')


if __name__ == '__main__': unittest.main()
