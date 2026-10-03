---
name: user-stories
description: Draft, extend, or reconcile root user stories without silently changing operator intent.
disable-model-invocation: true
argument-hint: "[repository, capability, or story id]"
---

# User stories

Root `USER_STORIES.md` is the checker's discovery contract; split directories do
not work. Use [template.md](template.md): `## US-NNN`, `Statement:`, numbered
`Criteria:`, `Evidence:` paths/commands, optional `No-gos:`. Criteria use SHALL
shapes; `scripts/check-stories.sh` validates them (`--tests` scans citations).

IDs are permanent: highest existing +1, never reuse/renumber. Only the operator
changes intent; first adoption uses designated agent review. Status/priority
belong in the native tracker, not this file. Clarifying wording is not permission
to widen a ticket. Existing evidence routes need to follow actual owner changes.

Keep capability groups and any existing `features/` specs aligned with the root
story statements, numbered criteria, and real evidence paths. When deletion is
proposed, `story-deletion-check --repo PATH --base BASE --head HEAD` reads the
base contract; rewriting or retiring a story in the same proposal is not approval
to remove its capability. Route a supported exact-head loss to Kaylee for
Phaedrus's explicit approval; equivalent implementations need no intent change.
