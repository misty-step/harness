# Harness verification map

This directory is the maintained source for verifying harness as its operator uses it. Read this index, run `verify-harness doctor`, then use the matching feature file as the recipe.

## Baseline preconditions

- Run from the root of a harness checkout or worktree on the revision under test, with the change committed. Installers read committed HEAD.
- `verify-harness doctor` passes.
- Nothing else is using the same `VH_DIR`. The default is `~/.cache/tmp/verify-harness`.

## Driving conventions

- Every command is `.agents/skills/verify-harness/bin/verify-harness <command>`.
- Deploy only into the run's private HOME. Never run an installer against the live HOME to verify.
- Read the live HOME, never write it. The exception is `live`, whose sessions update ordinary runtime state: a Claude Code transcript and `~/.claude.json`, and Codex lock files under `~/.codex/tmp`.
- Run `cleanup` after the last drive and after every failed iteration.

## Proof and skip reporting

- Each feature's proof is its PASS lines in `transcript.txt` plus the artifacts its file names.
- A Claude Code or Codex loading claim needs the session's own report: init event, `InstructionsLoaded` hooks or rendered prompt. File bytes alone do not prove loading.
- Report an unreachable feature with the attempted command and the unmet precondition. Do not report it verified through another feature.

## Features

- [Sign in](./sign-in.md) covers the owner's native gh, Claude Code and Codex logins.
- [Gate](./gate.md) covers `./scripts/check`, which runs the native tests and the isolated installer checks.
- [Isolated deploy](./isolated-deploy.md) covers claude-config and codex-config installs into a private HOME, plus refusal of foreign guidance files.
- [Fresh session](./fresh-session.md) covers a fresh Claude Code and Codex session loading the deployed guidance and shared skills.
- [Live drift](./live-drift.md) covers whether the live `~/.claude` and `~/.codex` match source, with a real model call.
- [Home post](./home-post.md) covers reporting to Home with `home post`, refused posts and the SSH route.
- [T3 pool](./t3-pool.md) covers t3-pool dry runs against the live T3 database and the installed bundle.
