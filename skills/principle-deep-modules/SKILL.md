---
name: principle-deep-modules
description: "Designing an interface or module: hide complexity behind a small domain-shaped surface."
disable-model-invocation: true
metadata:
  owner: phaedrus
  prevents: "Overengineering and special-case growth; inferred from 16 operator corrections, initiative #533."
  source: "misty-step/mistystack#533; John Ousterhout, A Philosophy of Software Design; Linus Torvalds, good taste; cursor/plugins@c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/skills/principle-boundary-discipline; cursor/plugins@c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/skills/principle-minimize-reader-load; cursor/plugins@c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/skills/principle-type-system-discipline"
  sunset: "2026-11-27"
---

# Deep modules

Organize a module around one body of domain knowledge. Expose the few operations the consumer needs and hide their mechanics.

Choose a data shape that removes special cases. Define errors out of existence where the contract permits it instead of making each caller coordinate recovery.

Parse and validate at external boundaries. Inside the boundary, use typed domain values and propagate errors; keep general mechanisms behind the interface.

Measure depth by hidden complexity relative to interface cost. A one-caller wrapper or forwarding layer that hides nothing increases reader load; inline it. Let types carry the contract; do not cast to silence the checker.

Keep clear local code when an abstraction would add indirection without removing repeated rules, branches or invalid states.

Done when callers express their intent with fewer concepts and the consumer contract still passes.
