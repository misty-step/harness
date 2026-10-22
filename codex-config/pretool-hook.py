#!/usr/bin/env python3
# owned by misty-step/harness codex-config pretool-hook
"""Register the workstation guard as Codex's PreToolUse hook and trust it through Codex's own RPC."""
import json
import os
from pathlib import Path
import queue
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
import threading

TIMEOUT = 60


def guard_command():
    return shlex.quote(str(Path.home() / '.local' / 'bin' / 'workstation-guard'))


def guard_hook():
    return {'type': 'command', 'command': guard_command(), 'timeout': 10}


def plan(directory):
    path = directory / 'hooks.json'
    if os.path.lexists(path) and not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError(f'Refusing nonregular destination: {path}')
    text = path.read_text() if path.exists() else None
    data = json.loads(text) if text is not None else {}
    if not isinstance(data, dict) or not isinstance(data.get('hooks', {}), dict):
        raise ValueError('Codex hooks.json and its hooks must be objects')
    groups = data.get('hooks', {}).get('PreToolUse', [])
    if not isinstance(groups, list):
        raise ValueError('PreToolUse must be an array')
    retained = []
    for group in groups:
        if not isinstance(group, dict) or not isinstance(group.get('hooks'), list) or not all(isinstance(hook, dict) for hook in group['hooks']):
            raise ValueError('PreToolUse entries must contain a hooks array of objects')
        hooks = []
        for hook in group['hooks']:
            if hook.get('command') != guard_command():
                hooks.append(hook)
            elif hook != guard_hook() or group.get('matcher') != 'Bash':
                raise ValueError('Refusing a foreign hook collision at the workstation guard command')
        if hooks or not group['hooks']:
            retained.append({**group, 'hooks': hooks})
    return path, text, data, [*retained, {'matcher': 'Bash', 'hooks': [guard_hook()]}]


def write_atomic(path, content):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(prefix='.harness-hooks-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(content)
            os.fchmod(stream.fileno(), stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o600)
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


class AppServer:
    """Minimal JSON-lines client for `codex app-server` over stdio."""

    def __init__(self, codex, directory):
        env = {**os.environ, 'CODEX_HOME': str(directory)}
        self.process = subprocess.Popen([codex, 'app-server', '--listen', 'stdio://'], stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, env=env, cwd=directory)
        self.lines, self.next_id = queue.Queue(), 0
        threading.Thread(target=self.read, daemon=True).start()
        self.request('initialize', {'clientInfo': {'name': 'harness_config', 'version': '1.0.0'}})
        self.send({'method': 'initialized', 'params': {}})

    def read(self):
        for line in self.process.stdout:
            self.lines.put(line)
        self.lines.put(None)

    def send(self, message):
        self.process.stdin.write(json.dumps(message) + '\n')
        self.process.stdin.flush()

    def request(self, method, params):
        self.next_id += 1
        self.send({'id': self.next_id, 'method': method, 'params': params})
        while True:
            try:
                line = self.lines.get(timeout=TIMEOUT)
            except queue.Empty:
                raise ValueError(f'codex app-server did not answer {method}') from None
            if line is None:
                raise ValueError(f'codex app-server exited during {method}')
            message = json.loads(line)
            if message.get('id') == self.next_id:
                if 'error' in message:
                    raise ValueError(f'codex app-server {method} failed: {message["error"].get("message")}')
                return message['result']

    def close(self):
        self.process.terminate()
        self.process.wait()


def trust(directory):
    codex = shutil.which('codex')
    if codex is None:
        print('warning: codex not found; review and trust the workstation guard hook with /hooks in Codex', file=sys.stderr)
        return
    server = AppServer(codex, directory)
    try:
        def ours():
            entries = server.request('hooks/list', {'cwds': [str(directory)]})['data']
            return [hook for entry in entries for hook in entry['hooks']
                    if hook['eventName'] == 'preToolUse' and hook['source'] == 'user' and hook.get('command') == guard_command()]
        stale = [hook for hook in ours() if hook['trustStatus'] != 'trusted']
        if stale:
            server.request('config/batchWrite', {'edits': [{'keyPath': 'hooks.state', 'mergeStrategy': 'upsert', 'value': {
                hook['key']: {'trusted_hash': hook['currentHash']} for hook in stale}}], 'reloadUserConfig': True})
        hooks = ours()
        if not hooks or any(hook['trustStatus'] != 'trusted' for hook in hooks):
            raise ValueError('Codex did not report the workstation guard hook as trusted')
    finally:
        server.close()


def install(directory):
    path, text, data, groups = plan(directory)
    data.setdefault('hooks', {})['PreToolUse'] = groups
    content = json.dumps(data, indent=2) + '\n'
    if text is None or json.loads(text) != data:
        write_atomic(path, content)
    trust(directory)


if __name__ == '__main__':
    try:
        if len(sys.argv) == 3 and sys.argv[1] == 'check':
            plan(Path(sys.argv[2]).absolute())
        elif len(sys.argv) == 3 and sys.argv[1] == 'install':
            install(Path(sys.argv[2]).absolute())
        else:
            raise ValueError('expected check DIR or install DIR')
    except (OSError, ValueError) as error:
        sys.exit(str(error))
