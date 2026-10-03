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
