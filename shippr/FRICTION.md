---
name: file-friction
description: >-
  File durable agent friction to Powder at the end of a shippr loop (focus
  `friction`) or whenever a missing primitive cost real time. Use it when the
  pain is durable, recurring, owned and a reproducible contract gap.
---
# File friction

Powder is the only sink; never GitHub issues.

```sh
shippr friction --repo misty-step/glass --title "No seeded review user in preview" \
  --reason "ctl-glass has no login --seed" --cost-minutes 20 --fix "add ctl-glass login --seed"
```

- File it when the gap would bite the next agent too. Pass `--one-off` for noise; it soft-skips.
- Less than 5 minutes lost: it soft-skips.
- The same title in the same repo adds a "seen again" note to the open item instead of a duplicate. If that item is done or dropped, `file` creates a new `-rN` item marked "Recurs after closed item".
- `--product-decision` when fixing it needs a product call; Maren's friction sweep parks it.
