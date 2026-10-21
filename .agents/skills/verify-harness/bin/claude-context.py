#!/usr/bin/env python3
"""Validate the native consumer's hook output against canonical AGENTS.md."""
import hashlib
import json
from pathlib import Path
import re
import sys

source = Path(sys.argv[2]).read_text()
parts = {}
for line in Path(sys.argv[1]).read_text().splitlines():
    row = json.loads(line)
    if row.get('subtype') != 'hook_response' or row.get('hook_event') != 'SessionStart':
        continue
    try:
        context = json.loads(row.get('stdout', ''))['hookSpecificOutput']['additionalContext']
    except (ValueError, KeyError, TypeError):
        continue
    match = re.match(r'Harness global AGENTS.md, part (\d+)/(\d+):\n', context)
    if not match:
        continue
    assert row['outcome'] == 'success' and row['exit_code'] == 0, 'native hook failed'
    assert len(context.encode('utf-16-le')) // 2 < 10000, 'native hook output limit exceeded'
    part, total = map(int, match.groups())
    assert part not in parts, 'duplicate global guidance hook'
    parts[part] = (total, context[match.end():])
assert parts, 'native consumer reported no canonical SessionStart context'
assert set(parts) == set(range(1, len(parts) + 1)), 'missing guidance part'
assert all(total == len(parts) for total, _ in parts.values()), 'guidance part counts differ'
observed = ''.join(parts[i][1] for i in range(1, len(parts) + 1))
assert observed == source, 'native hook context differs from canonical AGENTS.md'
print(json.dumps({'delivery': 'native SessionStart', 'parts': len(parts), 'characters': len(source),
                  'sha256': hashlib.sha256(observed.encode()).hexdigest(), 'complete': True}))
