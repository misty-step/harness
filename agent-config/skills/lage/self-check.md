# Draft self-check

Can he decide from the brief alone? Inspect every question's options, recommendation and
unanswered consequence, every source mention's link and its first-mention summary, and coverage
of unresolved asks. With `brief` and `pointer` naming the draft files, both greps must print nothing:

```sh
sed -E 's/\[[^]]*\]\([^)]*\)//g' "$brief" | grep -En '#[0-9]|\bPR [0-9]'
grep -Ein '\bQ[0-9]|items? [0-9]|asks? [0-9]|open item' "$brief"
```

Verify one numbering sequence and equal header and pointer counts:

```sh
python3 - "$brief" "$pointer" <<'PY'
import re, sys
from pathlib import Path
brief, pointer = (Path(p).read_text() for p in sys.argv[1:])
n = int(re.search(r'\*\*Lage, .*?\*\* (\d+) decisions for you\.', brief)[1])
assert [int(x) for x in re.findall(r'^(\d+)\. ', brief, re.M)] == list(range(1, n + 1))
assert int(re.search(r'\b(\d+) waiting\b', pointer)[1]) == n
print(f'PASS: {n} questions; header and pointer agree')
PY
```

Repair failures and rerun. Greps cannot prove meaningful summaries or complete questions;
inspect the whole brief, including status items and **Not checked**.
