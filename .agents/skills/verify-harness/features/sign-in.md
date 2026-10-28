# Sign in

Harness depends on native CLI execution logins: gh pushes branches and merges PRs, Claude Code and Codex run native agent sessions. Sign-in works when each CLI answers as phaedrus's identity, checked read-only.

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

- **Check logins.** Run `verify-harness doctor`. Expect `PASS gh signed in as moomooskycow`, `PASS gh can push misty-step/harness`, `PASS claude native subscription identity matches` and `PASS codex signed in with ChatGPT`.
- **Prove a model call.** Run `verify-harness live` after `install`. Expect `model answered: # Claude Code global guidance` and `PASS the model sees the live global guidance`.
- **Proof.** Keep the doctor and live sections of `transcript.txt` and `claude-live-result.json`.

## Gotchas

- Doctor retries `gh api user` once and prints the first stderr line when it still fails. A lone transient failure is the API, not the login.
- `gh auth status` prints a masked token line. Doctor uses `gh api user` instead and prints no token.
- Doctor reads the Codex identity from the `id_token` claim in `~/.codex/auth.json`, or `$CODEX_HOME/auth.json`, and reports only whether an account email is present. That email is personal, and the repository is public.

These native subscription identities are execution authentication, not product QA
accounts. Harness has no product sign-in; application QA uses the agent's own
AgentMail account and production owner/admin role proof under global guidance.
