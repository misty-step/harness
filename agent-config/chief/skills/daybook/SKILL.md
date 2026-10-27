---
name: daybook
description: Orient from and publish durable facts to shared Daybook.
version: 1.0.0
author: Misty Step
license: MIT
platforms: [linux, macos]
metadata:
  hermes:
    tags: [Daybook, Context, Memory]
    related_skills: []
---

# Daybook

Daybook (cortex `daybook`) is the single shared context system for all agents.
Use the official `exocortex` CLI; see `exocortex --help` for current syntax.

Before work, orient with `exocortex search "<topic>" --mode bm25`, then
`exocortex get <path>` for relevant evidence. Factory uses BM25: `brief`
hardcodes hybrid inference, which is too heavy for this shared host.

Write durable decisions, corrected facts, and outcomes back promptly:
- Small captures: `exocortex note "<fact or decision>" --agent kaylee`.
- New notes: `exocortex put <path> --from - --agent kaylee` with the note on
  stdin; it is create-only. Notes need YAML frontmatter with a `type`.
- Updates: `exocortex get <path>` for the stored revision, then
  `exocortex put <path> --from - --expects <revision> --agent kaylee`.
  On conflict, re-read and reconcile; never overwrite a stale revision.

Use `exocortex log`, `lint`, `sync`, and `status` for lineage and index health.
Publish exclusively through `note` or `put`; never edit Daybook via raw git.
