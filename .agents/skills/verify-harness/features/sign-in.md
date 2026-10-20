# Sign in

Harness depends on the owner's native logins: gh pushes branches and merges PRs, Claude Code runs every T3 lane, and Codex runs the Codex lanes. Sign-in works when each CLI answers as phaedrus's identity, checked read-only.

## Sub-features

- `gh-owner`: gh is authenticated as `moomooskycow` and can push misty-step/harness.
- `claude-owner`: Claude Code is logged in through claude.ai as `phaedrus@mistystep.io`.
- `codex-owner`: Codex is logged in with ChatGPT.
- `claude-model`: a real model call succeeds on the owner's Claude login. [Live drift](./live-drift.md) proves this.

## How to get to it (user POV)

- `gh auth status` and any `gh` command.
- `claude auth status`, or any Claude Code session.
- `codex login status`, or any Codex session.

## Driving it with verify-harness

Preconditions:

- None beyond the tools. Doctor reads only.

- **Check logins.** Run `verify-harness doctor`. Expect `PASS gh signed in as moomooskycow`, `PASS gh can push misty-step/harness`, `PASS claude signed in as phaedrus@mistystep.io` and `PASS codex signed in with ChatGPT`.
- **Prove a model call.** Run `verify-harness live` after `install`. Expect `model answered: # Claude Code global guidance` and `PASS the model sees the live global guidance`.
- **Proof.** Keep the doctor and live sections of `transcript.txt` and `claude-live-result.json`.

## Gotchas

- `gh auth status` prints a masked token line. Doctor uses `gh api user` instead and prints no token.
- Doctor reads the Codex identity from the `id_token` claim in `~/.codex/auth.json`, or `$CODEX_HOME/auth.json`, and reports only whether an account email is present. That email is personal, and the repository is public.
- The Codex login can be valid while every Codex account is usage-limited. As of 2026-10-20, `codex` and `codex-mistystep` are out until 2026-10-27 and `codex-r90` has no credits. `verify-harness pool` lists limited accounts. A Codex model call is not part of this proof. Codex loading is proved without one; see [Fresh session](./fresh-session.md).
- T3's per-instance accounts (`claude-mistystep`, `codex-mistystep` and others) keep their own homes. Doctor checks the default CLI logins only.
