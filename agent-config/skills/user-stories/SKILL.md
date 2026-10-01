---
name: user-stories
description: Draft, extend, or reconcile root user stories without silently changing operator intent.
disable-model-invocation: true
argument-hint: "[repository, capability, or story id]"
---

# User stories

`USER_STORIES.md` at the repository root carries what users must be able to do.
A story names progress in a situation, not a widget or implementation. Criteria
must be rejectable by a check. Status, ownership, estimates, and priorities stay
in the work record.

Use [template.md](template.md). One root file is the discovery/checker contract;
`foundation-check` and receipts do not read split story directories. Each story
has `## US-007`, `Statement:`, numbered `Criteria:`, and `Evidence:` paths/commands;
`No-gos:` is optional. Group related stories under `## Capability: <name>`.
Criteria use the five shapes: THE SYSTEM SHALL; WHEN ... SHALL; WHILE ... SHALL;
WHERE ... SHALL; IF ... THEN SHALL.

IDs are permanent: mint highest existing + 1, never rename, renumber, or reuse.
Propose intent changes as a split, `Superseded by US-007`, or
`Retired: YYYY-MM-DD — reason`; wording clarification may preserve intent.
Only the operator changes intent. First-story adoption gets the designated
agent reviewer's approval; later intent changes need the operator's approval.
Behavioral changes cite the literal ID in their PR, tests, design, and evidence.

- **Init:** inspect README, code, and stated/observed behavior; draft in a PR,
  labeling uncertainty rather than inventing product needs.
- **Extend:** add the new behavioral contract in the same PR as its capability;
  preserve existing intent and cite its ID.
- **Reconcile:** read-only audit of missing stories/evidence and unknown test IDs.

Run [scripts/check-stories.sh](scripts/check-stories.sh) against the repository.
`--tests` scans `*_test.go`, `*.test.ts`, `*.test.tsx`, `test_*.py`, and `*_test.py`
for citations. Structural failures block; evidence-path and test-coverage
warnings are not runtime proof. Read the file cold: can an agent identify the
required user outcomes and meaningful proof? `skill://story-qa` walks them.
