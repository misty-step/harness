import copy
import datetime as dt
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
import tempfile
import unittest
import room_events as events

NOW = dt.datetime(2026, 10, 23, 12, tzinfo=dt.timezone.utc)


def reading(state, now=NOW, percent=50):
    return {'schema_version': 1, 'quota_max_age_s': 600, 'probe_max_age_s': 600,
            'accounts': [{'provider': 'codex', 'email': 'qa@example.test', 'instance_id': 'codex-qa',
                          'quota': {'state': 'current' if state != 'unknown' else 'unknown',
                                    'observed_at': now.isoformat(), 'source': 'native quota',
                                    'five_hour': {'room_percent': percent,
                                                  'resets_at': (now + dt.timedelta(hours=5)).isoformat()},
                                    'weekly': {'room_percent': 50, 'resets_at': None}},
                          'probe': {'state': 'not_needed'}}]}


class EventsTest(unittest.TestCase):
    def test_unknown_and_expired_observations_do_not_recover(self):
        state = {'schema_version': 1, 'accounts': {}, 'pending': []}
        events.transition(state, reading('current', percent=0), NOW)
        self.assertEqual(len(state['pending']), 1)
        events.transition(state, reading('unknown', NOW + dt.timedelta(seconds=1)), NOW + dt.timedelta(seconds=1))
        events.transition(state, reading('current', NOW + dt.timedelta(seconds=2)), NOW + dt.timedelta(seconds=603))
        self.assertEqual(len(state['pending']), 1)
        events.transition(state, reading('current', NOW + dt.timedelta(seconds=604)), NOW + dt.timedelta(seconds=604))
        self.assertEqual([e['state'] for e in state['pending']], ['limited', 'works'])

    def test_out_and_back_delivered_once_and_with_reset(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'state.json'
            posted = []
            events.run(path, reading('current'), NOW, 'https://example.test/room', posted.append)
            self.assertEqual(posted, [])
            room = reading('current', NOW + dt.timedelta(seconds=1), percent=0)
            events.run(path, room, NOW + dt.timedelta(seconds=1), 'https://example.test/room', posted.append)
            events.run(path, room, NOW + dt.timedelta(seconds=2), 'https://example.test/room', posted.append)
            events.run(path, reading('current', NOW + dt.timedelta(seconds=3)), NOW + dt.timedelta(seconds=3), 'https://example.test/room', posted.append)
            self.assertEqual(len(posted), 2)
            self.assertIn('hit a provider limit', posted[0])
            self.assertIn('2026-10-23T17:00:01+00:00', posted[0])
            self.assertIn('works again', posted[1])
            self.assertEqual(json.loads(path.read_text())['pending'], [])

    def test_failed_delivery_remains_retryable(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'state.json'
            def fail(body):
                raise OSError('Home unavailable')
            room = reading('current', percent=0)
            with self.assertRaises(OSError):
                events.run(path, room, NOW, 'https://example.test/room', fail)
            self.assertEqual(len(json.loads(path.read_text())['pending']), 1)
            posted = []
            events.run(path, room, NOW, 'https://example.test/room', posted.append)
            self.assertEqual(len(posted), 1)
            self.assertEqual(json.loads(path.read_text())['pending'], [])

    def test_only_structured_fresh_probe_changes_unknown_account(self):
        state = {'schema_version': 1, 'accounts': {}, 'pending': []}
        room = reading('unknown')
        room['accounts'][0]['probe'] = {'state': 'limited', 'observed_at': NOW.isoformat(),
                                       'model': 'cheap-model', 'resets_at': None, 'source': 'native cli'}
        events.transition(state, room, NOW)
        self.assertEqual(state['pending'][0]['model'], 'cheap-model')
        room['accounts'][0]['probe'].update(state='unknown', observed_at=(NOW + dt.timedelta(seconds=1)).isoformat())
        events.transition(state, room, NOW + dt.timedelta(seconds=1))
        self.assertEqual(len(state['pending']), 1)

    def test_reset_passing_never_synthesizes_recovery(self):
        state = {'schema_version': 1, 'accounts': {}, 'pending': []}
        events.transition(state, reading('current', percent=0), NOW)
        room = reading('current', NOW + dt.timedelta(hours=5))
        room['accounts'][0]['quota']['five_hour']['resets_at'] = (NOW + dt.timedelta(hours=5)).isoformat()
        events.transition(state, room, NOW + dt.timedelta(hours=5))
        self.assertEqual(len(state['pending']), 1)


    def test_installed_watcher_retries_home_and_never_calls_credential_sync(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env = dict(os.environ, HOME=str(root), PATH=str(root / '.local/bin') + ':' + str(Path(sys.executable).parent) + ':/usr/bin:/bin')
            component = Path(__file__).resolve().parent
            subprocess.run(['sh', str(component / 'install')], env=env, check=True)
            now = dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=10)
            room = reading('current', now, percent=0)
            room['accounts'][0]['quota'].update(state='partial', weekly={'room_percent': None, 'resets_at': None})
            (root / 'input.json').write_text(json.dumps(room))
            bindir = root / '.local/bin'
            (bindir / 'upkeep').write_text('#!/usr/bin/env python3\nimport os,pathlib\nprint(pathlib.Path(os.environ["HOME"], "input.json").read_text())\n')
            (bindir / 'home').write_text('#!/usr/bin/env python3\nimport os,pathlib,sys\nr=pathlib.Path(os.environ["HOME"])\nb=sys.stdin.read()\nif (r/"fail").exists():sys.exit(7)\nwith (r/"posts").open("a") as f:f.write(b+"POST-END\\n")\n')
            (bindir / 'upkeep').chmod(0o755)
            (bindir / 'home').chmod(0o755)
            (root / 'fail').touch()
            command = [str(bindir / 't3-accounts'), 'room-watch', '--evidence-url', 'https://example.test/room']
            failed = subprocess.run(command, env=env, capture_output=True, text=True)
            self.assertNotEqual(failed.returncode, 0)
            state = root / '.local/state/t3-accounts/room-events.json'
            self.assertEqual(len(json.loads(state.read_text())['pending']), 1)
            (root / 'fail').unlink()
            subprocess.run(command, env=env, capture_output=True, text=True, check=True)
            subprocess.run(command, env=env, capture_output=True, text=True, check=True)
            self.assertEqual((root / 'posts').read_text().count('POST-END'), 1)
            later = now + dt.timedelta(seconds=1)
            room['accounts'][0]['quota']['observed_at'] = later.isoformat()
            room['accounts'][0]['probe'] = {'state': 'works', 'observed_at': later.isoformat(),
                                           'source': 'synthetic probe', 'model': 'cheap-model'}
            (root / 'input.json').write_text(json.dumps(room))
            subprocess.run(command, env=env, capture_output=True, text=True, check=True)
            self.assertEqual((root / 'posts').read_text().count('POST-END'), 1)
            self.assertEqual(next(iter(json.loads(state.read_text())['accounts'].values()))['state'], 'limited')
            room['accounts'][0]['quota']['observed_at'] = (now + dt.timedelta(seconds=2)).isoformat()
            room['accounts'][0]['quota']['five_hour']['room_percent'] = 50
            room['accounts'][0]['probe'] = {'state': 'unknown'}
            (root / 'input.json').write_text(json.dumps(room))
            subprocess.run(command, env=env, capture_output=True, text=True, check=True)
            self.assertEqual((root / 'posts').read_text().count('POST-END'), 1)
            self.assertFalse((root / '.config/t3-accounts/accounts.json').exists())

    def test_installed_watch_retires_old_probe_without_announcing_recovery(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env = dict(os.environ, HOME=str(root), PATH=str(root / '.local/bin') + ':' + str(Path(sys.executable).parent) + ':/usr/bin:/bin')
            component = Path(__file__).resolve().parent
            subprocess.run(['sh', str(component / 'install')], env=env, check=True)
            bindir = root / '.local/bin'
            digest = hashlib.sha256(b'synthetic-fixture').hexdigest()[:12]
            commands = {
                'pass': '#!/bin/sh\nprintf synthetic-fixture',
                'bun': '#!/usr/bin/env python3\nimport sys,json\nif "envhash" in sys.argv:print(' + repr(digest) + ')\nelif "status" in sys.argv:print("claude-qa\\t"+json.dumps({"auth":"authenticated","status":"ready"}))\nelse:sys.exit(99)\n',
                'home': '#!/bin/sh\ntouch "$HOME/unexpected-post"\n',
            }
            for name, body in commands.items():
                (bindir / name).write_text(body)
                (bindir / name).chmod(0o755)
            config = root / '.config/t3-accounts/accounts.json'
            config.parent.mkdir(parents=True)
            config.write_text(json.dumps({'hosts': {'authority': ''}, 'claude': [{
                'account': 'qa@example.test', 'instance': 'claude-qa', 'pass': 'fixture/ONLY',
                'keep': True, 'issued': dt.date.today().isoformat()}], 'codex': [], 'retired': [], 'watch_only': []}))
            state = root / '.local/state/t3-accounts/state.json'
            state.parent.mkdir(parents=True)
            state.write_text(json.dumps({'open': {'claude-live:qa@example.test': ['old rejection', 'high']},
                                         'claude_live': {'qa@example.test': 'rejected'}}))
            result = subprocess.run([str(bindir / 't3-accounts'), 'watch'], env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse((root / 'unexpected-post').exists())
            saved = json.loads(state.read_text())
            self.assertEqual(saved['open'], {})
            self.assertEqual(saved['claude_live'], {'qa@example.test': 'rejected'})

if __name__ == '__main__':
    unittest.main()
