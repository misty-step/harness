---
name: principle-vertical-slices
description: "Splitting an initiative or migration: choose atomically shippable units useful to their consumer alone."
disable-model-invocation: true
metadata:
  owner: phaedrus
  prevents: "Reckless or unshippable slices; Daybook decision 7 and initiative #533 delivery ruling."
  source: "misty-step/mistystack#533 Q7, Martin Gratzer; misty-step/foundations@d96c99ce1152ab1d6ae4a0eed0b22cbac93897b7/way-of-working.md#delivery; cursor/plugins@c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/skills/principle-sequence-verifiable-units"
  sunset: 2026-11-27
---

# Vertical slices

Shape the whole initiative's value before splitting it. A small unit improves its consumer's path and keeps main working; breaking an existing path is reckless, not small.

Give each unit an outside Oracle, a bounded diff and a concrete risk check. Carry its independent review through `skill://ship-loop`.

Sequence actual dependencies. Dispatch independent artifacts through OMP's `task` tool with isolated worktrees and one writer per branch.

Order commits so the argument can be replayed: behavior pin before reshape, failing check before repair, proven shared primitive before its consumers.

Start with one complete useful path, prove it and then scale the demonstrated method. Infrastructure alone earns a slice only when it provides a usable consumer contract.

Done when every proposed unit is worth merging alone and has its own proof. Label claimed value measured, inferred or guess.
