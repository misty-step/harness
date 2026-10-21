import os
from pathlib import Path
import subprocess
import tempfile
import unittest

PROBE = Path(__file__).with_name('probe-agent-policy')


class AgentPolicyProbeTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        (self.repo / 'AGENTS.md').write_text('# Instructions\n')

    def probe(self, *flags):
        return subprocess.run([str(PROBE), *flags, str(self.repo)], capture_output=True, text=True)

    def snapshot(self):
        return {str(p.relative_to(self.repo)): os.readlink(p) if p.is_symlink()
                else p.read_bytes() if p.is_file() else 'dir' for p in self.repo.rglob('*')}

    def test_canonical_instructions_pass_without_mutation(self):
        before = self.snapshot()
        self.assertEqual(self.probe().returncode, 0)
        self.assertEqual(before, self.snapshot())

    def test_reserved_name_is_rejected_without_creating_it(self):
        import contextlib
        import io
        import runpy
        from unittest.mock import patch
        for kind in ('file', 'directory'):
            files = ['CLAUDE.md'] if kind == 'file' else []
            dirs = ['CLAUDE.md'] if kind == 'directory' else []
            output = io.StringIO()
            with patch('sys.argv', [str(PROBE), str(self.repo)]), \
                 patch('os.walk', return_value=iter([(str(self.repo), dirs, files)])), \
                 contextlib.redirect_stderr(output), \
                 self.assertRaises(SystemExit) as caught:
                runpy.run_path(str(PROBE), run_name='__main__')
            self.assertEqual(caught.exception.code, 1)
            self.assertIn('forbidden instruction filename', output.getvalue())

    def test_generator_omissions_fail_and_complete_contract_passes(self):
        skill = self.repo / '.agents/skills/verify-example'
        skill.mkdir(parents=True)
        (skill / 'SKILL.md').write_text('---\nname: verify-example\n---\nRun checks.\n')
        result = self.probe('--verification')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('missing verification contract term AgentMail', result.stderr)
        self.assertIn('must link to', result.stderr)
        (skill / 'SKILL.md').write_text('AgentMail workstation/<PROJECT>_QA_ production owner/admin AGENTS.md\n')
        aliases = self.repo / '.claude/skills'
        aliases.mkdir(parents=True)
        (aliases / skill.name).symlink_to('../../.agents/skills/' + skill.name)
        before = self.snapshot()
        self.assertEqual(self.probe('--verification').returncode, 0)
        self.assertEqual(before, self.snapshot())


if __name__ == '__main__':
    unittest.main()
