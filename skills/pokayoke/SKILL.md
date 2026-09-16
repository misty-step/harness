---
name: pokayoke
description: Make a class of error impossible instead of warning about it.
disable-model-invocation: true
argument-hint: "[optional error class or incident]"
---

# Pokayoke

Pokayoke is error-proofing: a simple, low-complexity change that makes a
particular kind of mistake impossible. A keyed connector that will not insert
the wrong way is the classic. A comment, warning, checklist, or "be careful"
is not pokayoke.

After a defect, incident, operator error, agent error, or near-miss, ask:

> how can I pokayoke this so this kind of error never happens again

The object is the *class* of error, not the latest instance. Prefer the cheapest
mechanism that removes the affordance:

- Shape or type, so the wrong value cannot be represented
- Ownership, so the wrong writer cannot reach the state
- Absence, so the dangerous operation does not exist
- An executable check that fails closed before the mistake can complete

Do not add a parallel instruction layer over a system that still permits the
failure. If a reminder is the only available control, say so; do not call it
pokayoke.

This authors or selects the mechanism. It does not authorize unrelated cleanup,
a portfolio rollout, or a second framework. Honor existing scope and write
authority; without write authority, propose the pokayoke instead.

Deliver the error class, the mechanism, proof that the original mistake path is
closed, and any residual class that remains possible.
