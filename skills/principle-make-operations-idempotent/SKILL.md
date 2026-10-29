---
name: principle-make-operations-idempotent
description: "Designing a command, job, migration or loop that mutates state: make reruns and crashed runs converge."
disable-model-invocation: true
metadata:
  owner: phaedrus
  prevents: "Retries and crashes that need manual cleanup; Scholar pstack adoption."
  source: "cursor/plugins@c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/skills/principle-make-operations-idempotent; Daybook artifacts/2026-10/pstack-vs-mistystack.md (Scholar); Phaedrus t2228u via Maren"
  sunset: "2026-11-27"
---

# Make operations idempotent

Derive each step from the state that exists: read current state, compare it to the goal and apply only the difference. A repeat then finds nothing left to do.

Anything a run leaves behind, such as a lock, temporary file, half-written record or claimed job, must be recognizable as stale by the next run from evidence true wherever the run stopped. Write to a temporary path and rename into place; compare by content, not creation order.

Ask: what happens if this runs twice, if the previous run crashed at each point, and does re-execution reach the same end state? "It depends on what was left behind" means it needs a reconciliation step.

Done when a rerun after any interruption converges without manual cleanup.
