# Result self-check

Check coverage against the investigation: every in-scope lane and unresolved principal
question is present, including questions from closed lanes. Standing-policy answers belong
in stuck with an agent owner. Preserve all options, evidence and read gaps in detail.

Read only the primary fields once: can the principal scan the decisions, lane strip, shipped
outcomes and stuck owners on one screen? Each decision line gives the complete question,
recommendation and cost of no answer. Each lane has a state and short now/next. Move supporting
paragraphs into detail; keep research coverage intact. Home folds detail and overflow rather
than handing the principal a long document.

With `result` and `pointer` naming the draft files, check the delivery contract:

```sh
python3 - "$result" "$pointer" <<'PY'
import json, sys
from pathlib import Path
r = json.loads(Path(sys.argv[1]).read_text())
p = Path(sys.argv[2]).read_text()
assert r['schema'] == 'lage.v1'
assert r['as_of'] and r['since']
for key in ('decisions', 'lanes', 'shipped', 'stuck'):
    assert isinstance(r[key], list), key
assert isinstance(r['details']['not_checked'], list)
for key, fields in {
    'decisions': ('id', 'question', 'recommendation', 'if_unanswered', 'requester'),
    'lanes': ('name', 'url', 'state', 'now', 'next'),
    'shipped': ('summary',),
    'stuck': ('summary', 'owner'),
}.items():
    for item in r[key]:
        assert all(isinstance(item[f], str) and item[f].strip() for f in fields)
        assert isinstance(item['details'], dict)
        assert item['links']
        for link in item['links']:
            assert link['label'] and link['url'].startswith(('https://', 'codex://'))
assert len({d['id'] for d in r['decisions']}) == len(r['decisions'])
assert len({lane['url'] for lane in r['lanes']}) == len(r['lanes'])
assert f"{len(r['decisions'])} decisions; {len(r['stuck'])} stuck" in p
assert len(p.splitlines()) <= 3
print('PASS: structured result and compact pointer agree')
PY
```

This checks structure, not whether the facts are right or the primary view is readable.
Inspect the decision alternatives, recommendation reasons, ownership, observation times,
claim precision and source links. Keep raw local paths and unseen question labels out of
primary fields. Open the pointer's HTTPS URL and parse the served JSON before posting.

Delivery is complete when Home can read the result and the inbox contains one pointer.
A saved file or successful fallback append alone does not prove Home received it. Rendering
the inline page belongs to Home; the runner reports only the delivery it observed.
