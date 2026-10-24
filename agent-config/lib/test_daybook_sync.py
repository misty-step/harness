"""Real Git repositories and gitleaks; only private-host discovery is substituted."""
from concurrent.futures import ThreadPoolExecutor
from importlib.machinery import SourceFileLoader
from importlib.util import module_from_spec, spec_from_loader
import json
import os
from pathlib import Path
import secrets
import shutil
import string
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(os.environ.get('DAYBOOK_SYNC_SOURCE', Path(__file__).resolve().parents[1] / 'bin/daybook-sync'))
spec = spec_from_loader('daybook_sync', SourceFileLoader('daybook_sync', str(SOURCE)))
sync = module_from_spec(spec)
spec.loader.exec_module(sync)


class DaybookSyncTest(unittest.TestCase):
    def setUp(self):
        scratch = Path.home() / '.cache/tmp'
        scratch.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=scratch, prefix='daybook-sync-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.env = {**os.environ, 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
                    'GIT_AUTHOR_NAME': 'Fixture human', 'GIT_AUTHOR_EMAIL': 'human@example.invalid',
                    'GIT_COMMITTER_NAME': 'Fixture human', 'GIT_COMMITTER_EMAIL': 'human@example.invalid'}
        for key in list(self.env):
            if key.startswith('GIT_') and key not in {'GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL',
                    'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'}:
                del self.env[key]
        self.env_patch = patch.dict(os.environ, self.env, clear=True)
        self.env_patch.start()
        self.addCleanup(self.env_patch.stop)
        self.remote = self.root / 'remote.git'
        self.human = self.root / 'human'
        self.g(self.root, 'init', '--bare', '--initial-branch=master', str(self.remote))
        self.g(self.root, 'clone', str(self.remote), str(self.human))
        for path, content in {'notes/shared.md': 'base\n', 'notes/untouched.md': 'keep\n',
                              'journal/human.md': 'human source\n'}.items():
            self.put(self.human, path, content)
        self.g(self.human, 'add', '.')
        self.g(self.human, 'commit', '-m', 'synthetic base')
        self.g(self.human, 'push', 'origin', 'master')
        self.base = self.g(self.human, 'rev-parse', 'HEAD')
        self.fixture_remote = patch.object(sync, 'private_remote',
            side_effect=lambda repo: self.g(repo, 'remote', 'get-url', 'origin'))
        self.fixture_remote.start()
        self.addCleanup(self.fixture_remote.stop)

    def g(self, repo, *args):
        p = subprocess.run(['git', '-C', str(repo), *args], env=self.env,
                           capture_output=True, text=True)
        if p.returncode:
            self.fail(f'fixture git {args[0]} failed: {p.stderr}')
        return p.stdout.rstrip('\n')

    def put(self, repo, path, content):
        target = Path(repo) / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)

    def prepare(self, name='agent', repo=None):
        result = sync.prepare(repo or self.human, name, f'{name}@example.invalid', self.root / 'writers')
        return Path(result['workspace'])

    def publish(self, workspace, *paths):
        return sync.publish(workspace, 'selected synthetic note', list(paths))

    def snapshot(self, repo):
        return (self.g(repo, 'rev-parse', 'HEAD'), self.g(repo, 'status', '--porcelain=v1', '-z'),
                ((Path(repo) / 'notes/shared.md').read_bytes() if (Path(repo) / 'notes/shared.md').exists() else None),
                self.g(repo, 'diff', '--cached', '--binary'))

    def test_dirty_human_root_and_unpublished_commit_are_untouched(self):
        self.put(self.human, 'notes/local-only.md', 'unpublished root commit\n')
        self.g(self.human, 'add', 'notes/local-only.md')
        self.g(self.human, 'commit', '-m', 'human unpublished')
        self.put(self.human, 'notes/shared.md', 'dirty human bytes\n')
        self.put(self.human, 'journal/human.md', 'human pending journal\n')
        self.g(self.human, 'add', 'journal/human.md')
        before = self.snapshot(self.human)
        w = self.prepare()
        self.assertEqual(self.g(w, 'rev-parse', 'HEAD'), self.base)
        self.assertFalse((w / 'notes/local-only.md').exists())
        self.put(w, 'notes/agent.md', 'agent note\n')
        result = self.publish(w, 'notes/agent.md')
        self.assertTrue(result['published'])
        self.assertEqual(self.g(self.remote, 'rev-parse', 'master'), result['head'])
        self.assertEqual(self.snapshot(self.human), before)
        self.assertEqual(self.g(w, 'show', '-s', '--format=%an <%ae>'), 'agent <agent@example.invalid>')
        self.assertEqual(self.g(w, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'), 'notes/agent.md')

    def test_concurrent_writers_keep_both_nonoverlapping_changes(self):
        a, b = self.prepare('a'), self.prepare('b')
        self.put(a, 'notes/a.md', 'a\n')
        self.put(b, 'notes/b.md', 'b\n')
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(self.publish, a, 'notes/a.md'), pool.submit(self.publish, b, 'notes/b.md')]
            self.assertTrue(all(f.result()['published'] for f in futures))
        self.assertEqual(self.g(self.remote, 'show', 'master:notes/a.md'), 'a')
        self.assertEqual(self.g(self.remote, 'show', 'master:notes/b.md'), 'b')
        self.assertEqual(self.g(self.remote, 'rev-list', '--count', 'master'), '3')
        self.assertEqual(self.g(self.remote, 'rev-list', '--merges', 'master'), '')

    def test_overlap_aborts_and_retains_both_commits(self):
        a, b = self.prepare('a'), self.prepare('b')
        self.put(a, 'notes/shared.md', 'version a\n')
        self.put(b, 'notes/shared.md', 'version b\n')
        published = self.publish(a, 'notes/shared.md')
        with self.assertRaisesRegex(sync.SyncError, 'rebase conflict'):
            self.publish(b, 'notes/shared.md')
        self.assertEqual((b / 'notes/shared.md').read_text(), 'version b\n')
        state = json.loads(sync.state_path(b).read_text())
        self.assertTrue(state['pending'])
        self.assertEqual(self.g(b, 'rev-parse', 'HEAD'), state['head'])
        self.assertEqual(self.g(self.remote, 'rev-parse', 'master'), published['head'])
        self.assertEqual(self.g(b, 'status', '--porcelain'), '')
        self.assertEqual(self.g(b, 'show', 'HEAD:notes/shared.md'), 'version b')

    def test_explicit_files_and_existing_index_preserve_every_byte(self):
        w = self.prepare()
        self.put(w, 'notes/a.md', 'a\n')
        self.put(w, 'notes/b.md', 'b\n')
        before = self.snapshot(w)
        with self.assertRaisesRegex(sync.SyncError, 'exactly match'):
            self.publish(w, 'notes/a.md')
        self.assertEqual(self.snapshot(w), before)
        self.g(w, 'add', 'notes/b.md')
        before = self.snapshot(w)
        with self.assertRaisesRegex(sync.SyncError, 'pre-existing staged'):
            self.publish(w, 'notes/a.md', 'notes/b.md')
        self.assertEqual(self.snapshot(w), before)

    def test_journal_create_edit_delete_and_both_rename_directions(self):
        for action in ('create', 'edit', 'delete', 'rename-out', 'rename-in'):
            with self.subTest(action=action):
                w = self.prepare(action)
                if action == 'create':
                    self.put(w, 'journal/new.md', 'agent\n')
                    paths = ['journal/new.md']
                elif action == 'edit':
                    self.put(w, 'journal/human.md', 'agent\n')
                    paths = ['journal/human.md']
                elif action == 'delete':
                    (w / 'journal/human.md').unlink()
                    paths = ['journal/human.md']
                elif action == 'rename-out':
                    (w / 'journal/human.md').rename(w / 'notes/moved.md')
                    paths = ['notes/moved.md', 'journal/human.md']
                else:
                    (w / 'notes/shared.md').rename(w / 'journal/moved.md')
                    paths = ['notes/shared.md', 'journal/moved.md']
                before = self.snapshot(w)
                with self.assertRaisesRegex(sync.SyncError, 'journal'):
                    self.publish(w, *paths)
                self.assertEqual(self.snapshot(w), before)
        # Agent restrictions do not change the human/machine commit path.
        self.put(self.human, 'journal/human.md', 'exact machine snapshot bytes\n')
        self.g(self.human, 'add', 'journal/human.md')
        self.g(self.human, 'commit', '-m', 'machine snapshot')
        self.assertEqual(self.g(self.human, 'show', 'HEAD:journal/human.md'), 'exact machine snapshot bytes')

    def test_upstream_rename_cannot_redirect_a_selected_edit_into_journal(self):
        w = self.prepare()
        self.put(w, 'notes/shared.md', 'agent revision\n')
        self.g(self.human, 'mv', 'notes/shared.md', 'journal/relocated.md')
        self.g(self.human, 'commit', '-m', 'human relocates note into journal')
        self.g(self.human, 'push', 'origin', 'master')
        upstream = self.g(self.remote, 'rev-parse', 'master')
        with self.assertRaisesRegex(sync.SyncError, 'journal'):
            self.publish(w, 'notes/shared.md')
        self.assertEqual(self.g(self.remote, 'rev-parse', 'master'), upstream)
        self.assertEqual(self.g(self.remote, 'show', 'master:journal/relocated.md'), 'base')
        self.assertTrue(json.loads(sync.state_path(w).read_text())['pending'])
        self.assertIn('agent revision', self.g(w, 'show', '--format=', 'HEAD'))

    def test_upstream_rename_cannot_change_unselected_paths(self):
        w = self.prepare()
        self.put(w, 'notes/shared.md', 'agent revision\n')
        self.g(self.human, 'mv', 'notes/shared.md', 'notes/relocated.md')
        self.g(self.human, 'commit', '-m', 'human relocates note')
        self.g(self.human, 'push', 'origin', 'master')
        upstream = self.g(self.remote, 'rev-parse', 'master')
        with self.assertRaisesRegex(sync.SyncError, 'unselected'):
            self.publish(w, 'notes/shared.md')
        self.assertEqual(self.g(self.remote, 'rev-parse', 'master'), upstream)
        self.assertTrue(json.loads(sync.state_path(w).read_text())['pending'])
        self.assertIn('agent revision', self.g(w, 'show', '--format=', 'HEAD'))

    def test_ignored_unselected_bytes_are_preserved_before_rebase(self):
        self.put(self.human, '.gitignore', 'notes/ignored.md\n')
        self.g(self.human, 'add', '.gitignore')
        self.g(self.human, 'commit', '-m', 'ignore scratch fixture')
        self.g(self.human, 'push', 'origin', 'master')
        w = self.prepare()
        before = self.g(w, 'rev-parse', 'HEAD')
        self.put(w, 'notes/ignored.md', 'local scratch bytes\n')
        self.put(w, 'notes/agent.md', 'selected note\n')
        self.put(self.human, 'notes/ignored.md', 'remote tracked bytes\n')
        self.g(self.human, 'add', '-f', 'notes/ignored.md')
        self.g(self.human, 'commit', '-m', 'track ignored path')
        self.g(self.human, 'push', 'origin', 'master')
        upstream = self.g(self.remote, 'rev-parse', 'master')
        with self.assertRaisesRegex(sync.SyncError, 'exactly match'):
            self.publish(w, 'notes/agent.md')
        self.assertEqual((w / 'notes/ignored.md').read_bytes(), b'local scratch bytes\n')
        self.assertEqual((w / 'notes/agent.md').read_bytes(), b'selected note\n')
        self.assertEqual(self.g(w, 'rev-parse', 'HEAD'), before)
        self.assertEqual(self.g(self.remote, 'rev-parse', 'master'), upstream)

    def test_ignored_unselected_bytes_are_preserved_on_pending_retry(self):
        self.put(self.human, '.gitignore', 'notes/ignored.md\n')
        self.g(self.human, 'add', '.gitignore')
        self.g(self.human, 'commit', '-m', 'ignore scratch fixture')
        self.g(self.human, 'push', 'origin', 'master')
        w = self.prepare()
        hooks = self.root / 'deny-hooks'
        hooks.mkdir()
        hook = hooks / 'pre-push'
        hook.write_text('#!/bin/sh\nexit 1\n')
        hook.chmod(0o700)
        self.g(w, 'config', 'core.hooksPath', str(hooks))
        self.put(w, 'notes/agent.md', 'selected note\n')
        with self.assertRaises(sync.SyncError):
            self.publish(w, 'notes/agent.md')
        before = self.g(w, 'rev-parse', 'HEAD')
        hook.unlink()
        self.put(w, 'notes/ignored.md', 'local scratch bytes\n')
        self.put(self.human, 'notes/ignored.md', 'remote tracked bytes\n')
        self.g(self.human, 'add', '-f', 'notes/ignored.md')
        self.g(self.human, 'commit', '-m', 'track ignored path')
        self.g(self.human, 'push', 'origin', 'master')
        upstream = self.g(self.remote, 'rev-parse', 'master')
        with self.assertRaisesRegex(sync.SyncError, 'pending'):
            self.publish(w, 'notes/agent.md')
        self.assertEqual((w / 'notes/ignored.md').read_bytes(), b'local scratch bytes\n')
        self.assertEqual(self.g(w, 'show', 'HEAD:notes/agent.md'), 'selected note')
        self.assertEqual(self.g(w, 'rev-parse', 'HEAD'), before)
        self.assertEqual(self.g(self.remote, 'rev-parse', 'master'), upstream)

    def test_ignored_bytes_created_between_push_attempts_are_preserved(self):
        self.put(self.human, '.gitignore', 'notes/ignored.md\n')
        self.g(self.human, 'add', '.gitignore')
        self.g(self.human, 'commit', '-m', 'ignore scratch fixture')
        self.g(self.human, 'push', 'origin', 'master')
        w = self.prepare()
        other = self.root / 'racing-writer'
        self.g(self.root, 'clone', str(self.remote), str(other))
        self.g(other, 'config', 'user.name', 'Race writer')
        self.g(other, 'config', 'user.email', 'race@example.invalid')
        hooks = self.root / 'retry-hooks'
        hooks.mkdir()
        hook = hooks / 'pre-push'
        hook.write_text(f'''#!/bin/sh
set -e
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
if [ ! -f '{hooks}/ran' ]; then
  touch '{hooks}/ran'
  printf 'local scratch bytes\\n' > '{w}/notes/ignored.md'
  printf 'remote tracked bytes\\n' > '{other}/notes/ignored.md'
  git -C '{other}' add -f notes/ignored.md
  git -C '{other}' commit -qm 'track ignored path'
  git -C '{other}' push -q origin master
fi
''')
        hook.chmod(0o700)
        self.g(w, 'config', 'core.hooksPath', str(hooks))
        self.put(w, 'notes/agent.md', 'selected note\n')
        with self.assertRaisesRegex(sync.SyncError, 'pending'):
            self.publish(w, 'notes/agent.md')
        self.assertEqual((w / 'notes/ignored.md').read_bytes(), b'local scratch bytes\n')
        self.assertEqual(self.g(w, 'show', 'HEAD:notes/agent.md'), 'selected note')
        self.assertEqual(self.g(self.remote, 'rev-parse', 'master'), self.g(other, 'rev-parse', 'HEAD'))
        self.assertTrue(json.loads(sync.state_path(w).read_text())['pending'])

    def test_symlinks_directories_traversal_and_literal_pathspecs(self):
        w = self.prepare()
        outside = self.root / 'outside'
        outside.write_text('outside unchanged\n')
        (w / 'link.md').symlink_to(outside)
        (w / 'alias').symlink_to(w / 'journal', target_is_directory=True)
        for path in ('link.md', 'alias/human.md', '../outside', '/outside', 'notes/../journal/human.md',
                     './notes/shared.md', '.', 'notes', '.git/config'):
            with self.subTest(path=path), self.assertRaises(sync.SyncError):
                self.publish(w, path)
        self.assertEqual(outside.read_text(), 'outside unchanged\n')
        (w / 'link.md').unlink()
        (w / 'alias').unlink()
        self.put(w, 'notes/[literal]*.md', 'literal\n')
        self.publish(w, 'notes/[literal]*.md')
        self.assertEqual(self.g(self.remote, 'show', 'master:notes/[literal]*.md'), 'literal')

    def test_deleted_tracked_symlink_is_rejected(self):
        (self.human / 'old-link').symlink_to('journal/human.md')
        self.g(self.human, 'add', 'old-link')
        self.g(self.human, 'commit', '-m', 'fixture symlink')
        self.g(self.human, 'push', 'origin', 'master')
        w = self.prepare()
        (w / 'old-link').unlink()
        with self.assertRaisesRegex(sync.SyncError, 'regular files'):
            self.publish(w, 'old-link')

    def test_secret_scanner_blocks_push_and_retains_worktree_bytes(self):
        self.assertIsNotNone(shutil.which('gitleaks'), 'real gitleaks required')
        w = self.prepare()
        token = 'ghp_' + ''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(36))
        self.put(w, 'notes/private.md', 'token=' + token + '\n')
        before = (w / 'notes/private.md').read_bytes()
        with self.assertRaises(sync.SyncError):
            self.publish(w, 'notes/private.md')
        self.assertEqual((w / 'notes/private.md').read_bytes(), before)
        self.assertEqual(self.g(self.remote, 'rev-parse', 'master'), self.base)
        self.assertEqual(self.g(w, 'diff', '--cached', '--name-only'), '')
        self.assertEqual(self.g(w, 'rev-parse', 'HEAD'), self.base)

    def race_hook(self, workspace, races):
        other = self.root / 'other'
        self.g(self.root, 'clone', str(self.remote), str(other))
        self.g(other, 'config', 'user.name', 'Race writer')
        self.g(other, 'config', 'user.email', 'race@example.invalid')
        hooks = self.root / 'hooks'
        hooks.mkdir()
        script = hooks / 'pre-push'
        # Fixture paths come from tempfile with no shell metacharacters.
        script.write_text(f'''#!/bin/sh
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
count=0
[ ! -f '{hooks}/count' ] || read count < '{hooks}/count'
count=$((count + 1))
printf '%s\\n' "$count" > '{hooks}/count'
if [ "$count" -le {races} ]; then
  git -C '{other}' pull --ff-only >/dev/null 2>&1 || exit 1
  mkdir -p '{other}/races'
  printf '%s\\n' "$count" > '{other}/races/'"$count"
  git -C '{other}' add races || exit 1
  git -C '{other}' commit -qm race || exit 1
  git -C '{other}' push origin master >/dev/null 2>&1 || exit 1
fi
''')
        script.chmod(0o700)
        self.g(workspace, 'config', 'core.hooksPath', str(hooks))
        return hooks

    def test_actual_push_race_retries_and_bounded_contention_resumes(self):
        w = self.prepare()
        hooks = self.race_hook(w, races=3)
        self.put(w, 'notes/agent.md', 'retained\n')
        with self.assertRaisesRegex(sync.SyncError, 'exceeded 3 attempts'):
            self.publish(w, 'notes/agent.md')
        self.assertEqual((hooks / 'count').read_text(), '3\n')
        self.assertEqual(self.g(self.remote, 'rev-list', '--count', 'master'), '4')
        self.assertEqual(self.g(w, 'show', 'HEAD:notes/agent.md'), 'retained')
        result = self.publish(w, 'notes/agent.md')
        self.assertTrue(result['published'])
        self.assertEqual(self.g(self.remote, 'show', 'master:notes/agent.md'), 'retained')
        self.assertEqual(self.g(self.remote, 'rev-list', '--count', 'master'), '5')

    def test_policy_push_failure_is_not_retried_and_successful_push_retry_is_idempotent(self):
        w = self.prepare()
        hooks = self.root / 'deny-hooks'
        hooks.mkdir()
        hook = hooks / 'pre-push'
        hook.write_text('#!/bin/sh\nexit 1\n')
        hook.chmod(0o700)
        self.g(w, 'config', 'core.hooksPath', str(hooks))
        self.put(w, 'notes/a.md', 'a\n')
        with self.assertRaises(sync.SyncError):
            self.publish(w, 'notes/a.md')
        state = json.loads(sync.state_path(w).read_text())
        self.assertTrue(state['pending'])
        with self.assertRaisesRegex(sync.SyncError, 'pending'):
            sync.finish(w)
        self.assertEqual(self.g(self.remote, 'rev-parse', 'master'), self.base)
        hook.unlink()
        result = self.publish(w, 'notes/a.md')
        state['head'] = result['head']
        sync.save(w, state)  # Simulate lost state write after a successful push.
        self.assertTrue(self.publish(w, 'notes/a.md')['published'])
        self.assertEqual(self.g(self.remote, 'rev-list', '--count', 'master'), '2')

    def test_primary_checkout_foreign_head_and_inherited_git_index_are_not_consumed(self):
        with self.assertRaisesRegex(sync.SyncError, 'primary checkout'):
            self.publish(self.human, 'notes/shared.md')
        w = self.prepare()
        self.put(w, 'notes/foreign.md', 'foreign\n')
        self.g(w, 'add', 'notes/foreign.md')
        self.g(w, 'commit', '-m', 'outside helper')
        before = self.snapshot(w)
        with self.assertRaisesRegex(sync.SyncError, 'HEAD changed'):
            self.publish(w, 'notes/foreign.md')
        self.assertEqual(self.snapshot(w), before)
        v = self.prepare('safe')
        self.put(v, 'notes/safe.md', 'safe\n')
        with patch.dict(os.environ, {'GIT_INDEX_FILE': str(self.human / '.git/index'),
                                      'GIT_WORK_TREE': str(self.human), 'GIT_DIR': str(self.human / '.git')}):
            self.publish(v, 'notes/safe.md')
        self.assertEqual(self.g(self.human, 'rev-parse', 'HEAD'), self.base)

    def test_finish_removes_only_clean_published_workspace_and_local_branch(self):
        w = self.prepare()
        branch = self.g(w, 'branch', '--show-current')
        self.put(w, 'notes/a.md', 'a\n')
        with self.assertRaisesRegex(sync.SyncError, 'dirty'):
            sync.finish(w)
        self.assertTrue(w.exists())
        result = self.publish(w, 'notes/a.md')
        # A caller that lost the successful response can repeat the command.
        self.assertEqual(self.publish(w, 'notes/a.md')['head'], result['head'])
        self.g(w, 'config', 'core.excludesFile', str(self.root / 'ignore'))
        (self.root / 'ignore').write_text('ignored.txt\n')
        self.put(w, 'ignored.txt', 'retain ignored bytes\n')
        with self.assertRaisesRegex(sync.SyncError, 'dirty'):
            sync.finish(w)
        self.assertTrue((w / 'ignored.txt').exists())
        (w / 'ignored.txt').unlink()
        self.assertTrue(sync.finish(w)['removed'])
        self.assertFalse(w.exists())
        self.assertNotIn(branch, self.g(self.human, 'branch', '--list'))
        self.assertEqual(self.g(self.remote, 'rev-parse', 'master'), result['head'])

    def test_installed_cli_journey_uses_real_local_transport(self):
        # Native SSH transport maps only synthetic Git data to the local bare remote.
        # gh supplies fixture privacy metadata; no provider or network sees content.
        ssh = self.root / 'ssh-fixture'
        ssh.write_text(f'''#!/bin/sh
case "$*" in
  *git-upload-pack*) exec git-upload-pack '{self.remote}' ;;
  *git-receive-pack*) exec git-receive-pack '{self.remote}' ;;
  *) exit 1 ;;
esac
''')
        ssh.chmod(0o700)
        fakebin = self.root / 'fixture-bin'
        fakebin.mkdir()
        (fakebin / 'python3').symlink_to(sys.executable)
        gh = fakebin / 'gh'
        gh.write_text('#!/bin/sh\nprintf true\n')
        gh.chmod(0o700)
        self.g(self.human, 'remote', 'set-url', 'origin', 'git@github.com:fixture/vault.git')
        env = {**self.env, 'HOME': str(self.root / 'home'), 'GIT_SSH_COMMAND': str(ssh),
               'PATH': f'{fakebin}:{self.env["PATH"]}'}
        def cli(*args):
            proc = subprocess.run([str(SOURCE), *args], env=env, capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            return json.loads(proc.stdout)
        root_before = self.snapshot(self.human)
        begun = cli('prepare', '--repo', str(self.human), '--agent', 'cli-agent', '--email', 'cli@example.invalid')
        w = Path(begun['workspace'])
        self.put(w, 'notes/space in name.md', 'CLI exact bytes\n')
        sent = cli('publish', '--workspace', str(w), '--message', 'CLI note', '--', 'notes/space in name.md')
        self.assertTrue(sent['published'])
        self.assertEqual(self.g(self.remote, 'show', 'master:notes/space in name.md'), 'CLI exact bytes')
        self.assertEqual(self.g(self.remote, 'show', '-s', '--format=%an <%ae>', 'master'), 'cli-agent <cli@example.invalid>')
        self.assertTrue(cli('finish', '--workspace', str(w))['removed'])
        self.assertFalse(w.exists())
        self.assertEqual(self.snapshot(self.human), root_before)

    def test_shared_installer_refuses_foreign_launcher_before_any_write(self):
        target = self.root / 'install-home'
        self.put(target, '.local/bin/daybook-sync', 'foreign executable\n')
        installer = Path(__file__).resolve().parents[1] / 'install'
        p = subprocess.run([str(installer), '--home', str(target), '--agent-dir', str(target / '.agents'),
                            '--skill', 'daybook-sync', '--bin', 'daybook-sync'],
                           capture_output=True, text=True, env=self.env)
        self.assertNotEqual(p.returncode, 0)
        self.assertIn('Refusing unowned launcher', p.stderr)
        self.assertEqual((target / '.local/bin/daybook-sync').read_text(), 'foreign executable\n')
        self.assertFalse((target / '.agents').exists())

    def test_cli_help_and_private_origin_validation(self):
        p = subprocess.run([str(SOURCE), '--help'], capture_output=True, text=True, env=self.env)
        self.assertEqual(p.returncode, 0)
        self.assertIn('prepare', p.stdout)
        self.assertIn('publish', p.stdout)
        # The actual boundary rejects a local remote, without calling a provider.
        self.fixture_remote.stop()
        with self.assertRaisesRegex(sync.SyncError, 'private github.com'):
            sync.private_remote(self.human)
        self.g(self.human, 'remote', 'set-url', 'origin', 'https://github.com/example/private.git')
        fakebin = self.root / 'bin'
        fakebin.mkdir()
        gh = fakebin / 'gh'
        gh.write_text('#!/bin/sh\nprintf false\n')
        gh.chmod(0o700)
        with patch.dict(os.environ, {'PATH': f'{fakebin}:{os.environ["PATH"]}'}):
            with self.assertRaisesRegex(sync.SyncError, 'not confirmed private'):
                sync.private_remote(self.human)
        self.g(self.human, 'remote', 'set-url', '--push', 'origin', 'https://github.com/example/other.git')
        with self.assertRaisesRegex(sync.SyncError, 'identical fetch and push'):
            sync.private_remote(self.human)


if __name__ == '__main__':
    unittest.main(verbosity=2)
