# Draft self-check

Run these checks before delivery, with `brief` and `pointer` set to the draft files' paths.
Keep their output with your evidence. Repair failures and rerun before writing the final files.

## Links and source labels

Strip complete inline Markdown links, then grep what remains. Both greps must print nothing
(exit status 1 means no matches). Check the entire brief, including tables and **Stuck**.

```sh
sed -E 's/\[[^]]*\]\([^)]*\)//g' "$brief" > "$brief.unlinked"
grep -En '#[0-9]|\bPR [0-9]' "$brief.unlinked"
grep -Ein '\bQ[0-9]|items? [0-9]|asks? [0-9]|open item' "$brief"
grep -Pn 'Detail:(?![[:blank:]]*\[[^]]+\]\([^)]+\))' "$brief"
```

The last grep must also print nothing: each `Detail:` has a Markdown link on its own line.
Inspect reference mentions with this grep; every specific source it names must be linked at
that mention, including repeated mentions. Generic words such as "no open PRs" name no source.

```sh
grep -Ein '\b(spec|doc|ADR|ticket|story|thread|PR|issue)s?\b|Detail:' "$brief"
```

Read every linked item's first mention: it must explain what that item does in one line.
In a table row or **Stuck** item, that explanation goes in the row itself. Subsequent mentions
keep their links but need not repeat the summary. Inspect sources with titles that the grep
cannot recognize too. Fetch the source or its forge title when a reader omitted its purpose.
An opaque label or "purpose unknown" fails this check, including under **Not checked**. For an
unreadable source, summarize its known purpose and the read gap. When its purpose is wholly
unknown, report the missing context as a gap against its linked lane instead of inventing a
source label. Links supplement the content; a title alone is not a summary.

## One numbering sequence and count

List all entry numbers across both ask sections and compare them with 1…N. The header's N,
the final entry number and the pointer's waiting count must agree. Count agent-answerable
reclassifications only as stuck. Run this check; it must print PASS with the common count.
The pointer uses `<N> waiting` so its count is checkable.

```sh
python3 - "$brief" "$pointer" <<'PY'
import re
import sys
from pathlib import Path
brief, pointer = (Path(p).read_text() for p in sys.argv[1:])
n = int(re.search(r'\*\*Lage, .*?\*\* (\d+) decisions for you\.', brief)[1])
entries = [int(x) for x in re.findall(r'^(\d+)\. ', brief, re.M)]
assert entries == list(range(1, n + 1)), (entries, n)
waiting = int(re.search(r'\b(\d+) waiting\b', pointer)[1])
assert waiting == n, (waiting, n)
print(f'PASS: entries 1…{n}; header={n}; last={entries[-1] if entries else 0}; waiting={waiting}')
PY
```

Finally inspect every question's options, compliant recommendation and "if unanswered", every
lane's single row, and the width of every line (at most 100 characters, excluding link targets).
