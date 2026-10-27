---
name: daybook
description: Orient from and publish durable facts to shared Daybook.
version: 2.0.0
author: Misty Step
license: MIT
platforms: [linux, macos]
metadata:
  hermes:
    tags: [Daybook, Context, Memory]
    related_skills: []
---

# Daybook

Daybook is the single shared context system for all agents: a private Git
vault (`moomooskycow/daybook`) read and written directly with git. Its own
`AGENTS.md` is the contract; read it before writing.

Factory's clone: `~/development/moomooskycow/daybook`. Keep its `master`
checkout clean; nothing refreshes it on a timer.

Read: `git -C ~/development/moomooskycow/daybook pull --ff-only`, then
`meta/NOW.md`, known paths, or `git grep -n -i "<topic>"`. Hits route to
sources; cite paths and dates.

Write decisions, corrected facts and outcomes promptly, per that contract:
- Use a task-owned worktree, never the shared master checkout:
  `git -C <clone> fetch origin && git -C <clone> worktree add -b kaylee/<slug> <dir> origin/master`.
- Read the current target before editing. New notes need YAML frontmatter with
  a `type` and `layer: derived`.
- Commit only files I changed, in small commits under my name (the clone's
  configured identity is Kaylee).
- `git fetch origin && git rebase origin/master`, then
  `git push origin HEAD:master` promptly. On a race, fetch/rebase and retry;
  never force-push, never take a whole side of a conflict.
- Never create, edit, move or delete anything under `journal/`.
- Remove the worktree and branch once the push lands.
