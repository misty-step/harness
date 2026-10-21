#!/usr/bin/env python3
# owned by misty-step/harness claude-config agents-hook
"""Install Claude's native SessionStart adapter; keep instructions in AGENTS.md."""
import json
import os
from pathlib import Path
import shlex
import stat
import sys
import tempfile

OWNER = '# owned by misty-step/harness claude-config agents-hook'
PART_SIZE = 4000  # At most 8000 UTF-16 units, below the native 10,000-character cap.


def read_regular(path):
    if not os.path.lexists(path):
        return None
    if not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError(f'Refusing nonregular destination: {path}')
    return path.read_text()


def parts(text):
    result = []
    while len(text) > PART_SIZE:
        end = text.rfind('\n', 0, PART_SIZE) + 1 or PART_SIZE
        result.append(text[:end])
        text = text[end:]
    return [*result, text]


def command(script, part):
    return f'python3 {shlex.quote(str(script))} {part}'


def plan(directory):
    script = directory / 'hooks' / 'harness-agents.py'
    if script.parent.is_symlink() or (script.parent.exists() and not script.parent.is_dir()):
        raise ValueError(f'Refusing nonregular hooks directory: {script.parent}')
    previous = read_regular(script)
    if previous is not None and previous.splitlines()[1:2] != [OWNER]:
        raise ValueError(f'Refusing unowned hook: {script}')
    settings = read_regular(directory / 'settings.json')
    data = json.loads(settings) if settings is not None else {}
    if not isinstance(data, dict) or not isinstance(data.get('hooks', {}), dict):
        raise ValueError('Claude settings and hooks must be objects')
    groups = data.get('hooks', {}).get('SessionStart', [])
    if not isinstance(groups, list):
        raise ValueError('SessionStart must be an array')
    retained = []
    prefix = command(script, '')
    for group in groups:
        if not isinstance(group, dict) or not isinstance(group.get('hooks'), list):
            raise ValueError('SessionStart entries must contain a hooks array')
        hooks = []
        for hook in group['hooks']:
            if not isinstance(hook, dict):
                raise ValueError('Hook handlers must be objects')
            text = hook.get('command', '')
            if isinstance(text, str) and text.startswith(prefix):
                suffix = text[len(prefix):]
                if previous is None or not suffix.isdigit() or hook != {'type': 'command', 'command': text} or set(group) != {'hooks'}:
                    raise ValueError('Refusing a foreign hook collision at the harness command')
            else:
                hooks.append(hook)
        if hooks or not group['hooks']:
            retained.append({**group, 'hooks': hooks})
    return script, settings, data, retained


def write_atomic(path, content, mode):
    if path.exists() and path.read_text() == content and stat.S_IMODE(path.stat().st_mode) == mode:
        return
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(prefix='.harness-agents-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(content)
            os.fchmod(stream.fileno(), mode)
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def install(directory):
    script, _, data, groups = plan(directory)
    text = (directory / 'AGENTS.md').read_text()
    count = len(parts(text))
    groups.append({'hooks': [{'type': 'command', 'command': command(script, part)} for part in range(count)]})
    data.setdefault('hooks', {})['SessionStart'] = groups
    write_atomic(script, Path(__file__).read_text(), 0o700)
    settings_path = directory / 'settings.json'
    mode = stat.S_IMODE(settings_path.stat().st_mode) if settings_path.exists() else 0o600
    write_atomic(settings_path, json.dumps(data, indent=2) + '\n', mode)


def emit(part):
    directory = Path(__file__).resolve().parent.parent
    text = (directory / 'AGENTS.md').read_text()
    count = len(parts(text))
    if not 0 <= part < count:
        raise ValueError('Hook part is outside the canonical guidance')
    context = f'Harness global AGENTS.md, part {part + 1}/{count}:\n' + parts(text)[part]
    print(json.dumps({'hookSpecificOutput': {'hookEventName': 'SessionStart', 'additionalContext': context}}))


if __name__ == '__main__':
    try:
        if len(sys.argv) == 2:
            emit(int(sys.argv[1]))
        elif len(sys.argv) == 3 and sys.argv[1] == 'check':
            plan(Path(sys.argv[2]).absolute())
        elif len(sys.argv) == 3 and sys.argv[1] == 'install':
            install(Path(sys.argv[2]).absolute())
        else:
            raise ValueError('expected check DIR, install DIR, or PART')
    except (OSError, ValueError) as error:
        sys.exit(str(error))
