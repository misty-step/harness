---
name: daybook-sync
description: Read or publish authorized notes in private Daybook from any T3 provider. Use before agent note edits or to recover a failed note push.
---

# Daybook sync

Read only the sources needed for the selected request. Keep vault contents in
its private repository and approved execution context. Access grants no new
permission to read personal records or disclose them to another provider.

1. Read the selected checkout's `AGENTS.md`. Confirm this is an authorized note
   change. Engineering changes use their repository's PR process.
2. Run `daybook-sync prepare --repo <checkout> --agent <lane-id> --email <agent-email>`.
   It confirms a private GitHub origin and returns JSON with a fresh workspace,
   branch and remote master revision. Read current target files there before editing.
3. Work only in that workspace. Preserve human-authored notes and follow the
   vault's layer rules. Agent edits never create, change, move or delete `journal/`
   files. The command also rejects journal publication, including rename sources.
4. Inspect `git diff` and `git status` in the workspace. Select each changed file
   explicitly. Keep commits small and limited to the selected request.
5. Run `daybook-sync publish --workspace <workspace> --message <message> -- <file>...`.
   It rejects staged work, unexpected paths and symlinks, scans for secrets,
   commits with the supplied agent identity, and pushes `HEAD:master` immediately.
   Publication rebases on freshly fetched master and retries remote contention
   at most three times. Success returns JSON with `published: true` and the SHA.
6. Run `daybook-sync finish --workspace <workspace>`. It confirms the remote
   contains HEAD, then removes the clean worktree without force and deletes
   only its exact local branch. Retain every failed or pending workspace.

The command is on the shared `~/.local/bin` PATH. This canonical skill is
`~/.agents/skills/daybook-sync/SKILL.md`, available to Claude, Codex, Gemini and
other T3 providers without a native skill loader. Claude and Codex also receive
native skill packages. A provider can read this file directly through the
Daybook `AGENTS.md` pointer. Installed files alone do not prove provider loading.

## Recovery

A failed publish retains the workspace and every commit. After a push race or
network failure, rerun the same publish command before making more edits. It
recognizes a previously successful push. An overlap aborts the rebase and
retains the original local commit and remote commit. Inspect those versions in
scope, prepare a fresh workspace, and reapply only the intended edit. Surface
contradictions that need human judgment. Do not force-push or resolve by choosing
one whole side. Unexpected staged files or HEAD changes require inspection.

Authentication uses native logins. If it fails, use `authenticated-commands`;
missing access does not authorize new credentials. Diagnostics suppress Git
and scanner contents. Inspect private failures locally and publish proof only
to an accessible private GitHub destination.

## Machine timers use a separate protocol

Hourly ingest and nightly human snapshots retain their Daybook-owned timer
implementation. They can commit human journal bytes under machine authority.
They reconcile root commits in a disposable worktree with ordinary merge/push,
then fast-forward the root only when Git can preserve every pending human edit.
The agent command provides no journal bypass, timer, root merge, stash or reset.
See the Daybook timer implementation for its locking and conflict recovery.
