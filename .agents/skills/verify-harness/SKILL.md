---
name: verify-harness
description: "Verify misty-step/harness the way its operator uses it: native logins valid, the gate green, claude-config and codex-config deployed into a private HOME, fresh Claude Code and Codex sessions loading that guidance and the shared skills, live ~/.claude and ~/.codex matching source, home post, and t3-pool dry runs. Use before calling a harness change verified, after a deploy, or when an agent's loaded guidance or skills look wrong."
---

# Verify harness

Harness has no app to sign in to. Its user is an agent operator, and the journey is: the owner's native logins work, `./scripts/check` passes, an installer deploys guidance and skills, and a fresh Claude Code or Codex session actually loads them. Every step runs from a shell through one helper:

```sh
.agents/skills/verify-harness/bin/verify-harness all
```

Run from the repository root of any checkout or worktree. The feature map in [features/README.md](features/README.md) holds the per-feature recipes; a proof covers every feature it lists.

## Launch

There is no server. Each drive is a short-lived process.

- `verify-harness install [rev]` clones committed `rev` (default `HEAD`; use `origin/master` to check what is deployed) into `~/.cache/tmp/verify-harness/run/source` and runs `claude-config/install` and `codex-config/install` with `env -i` and `HOME=run/claude-home`. A fixture `systemctl` records unit calls, because a private HOME has no user manager. Ready means both installers exited 0 and the composition checks passed.
- `session`, `live`, `home` and `pool` need that install, and say so if it is missing.
- Teardown is `verify-harness cleanup`.

Run state lives in one directory, so two concurrent runs need different `VH_DIR` values, such as `VH_DIR=~/.cache/tmp/verify-harness-$RUN_ID`.

Never run an installer against the live HOME to verify. Deployment is a live mutation, not verification.

## Doctor

```sh
.agents/skills/verify-harness/bin/verify-harness doctor
```

Read-only. Doctor checks:

- the tools (Git, Bun 1.4.2 or later, jq, Python 3, gitleaks, trufflehog, claude, codex, gh, tmux);
- `gh` signed in as `moomooskycow` with push permission on misty-step/harness;
- Claude Code signed in as `phaedrus@mistystep.io`;
- Codex signed in with ChatGPT;
- `home` on PATH, and where it routes;
- the T3 server runtime is loopback;
- the `t3-pool.timer` state.

Doctor never prints a token or the Codex account email. Run it first, and again after anything surprising.

## Drive

| Command | Feature | Writes |
| --- | --- | --- |
| `doctor` | [sign-in](features/sign-in.md) | nothing |
| `check [all\|shared\|pi\|omp\|workspace]` | [gate](features/gate.md) | scratch only |
| `install [rev]` | [isolated-deploy](features/isolated-deploy.md) | run dir |
| `session [claude\|codex\|both]` | [fresh-session](features/fresh-session.md) | run dir and `/tmp/verify-harness-*` |
| `live` | [live-drift](features/live-drift.md) | one Claude Code session transcript under `~/.claude/projects/` |
| `home` | [home-post](features/home-post.md) | a private inbox in the run dir |
| `pool` | [t3-pool](features/t3-pool.md) | nothing |
| `cleanup` | | removes run dir and scratch cwds |

`all` runs `doctor`, `check`, `install`, `session`, `live`, `home`, `pool` and `cleanup` in order. Each line is `PASS`, `FAIL` or `NOTE`. The exit status is nonzero if any line failed.

`live` makes the run's only model call: one Haiku turn on the owner's Claude subscription. Codex sessions use `codex debug prompt-input`, which renders the exact model-visible input without calling a model, so they work while Codex accounts are out of credits.

## Evidence

Artifacts go to `$VH_EVIDENCE`, default `~/.cache/tmp/verify-harness/evidence/<UTC stamp>/`. For a PR proof, set `VH_EVIDENCE=docs/evidence/verify-harness/<YYYY-MM-DD>` and commit that directory:

- `transcript.txt` holds every step's PASS, FAIL and NOTE lines with timestamps;
- `check.log` is the full gate output;
- `install-tree.txt` lists the files the installers wrote outside `skills/`;
- `claude-*-init.json`, `claude-*-instructions.jsonl` and `claude-*-result.json` are the session's own init event, its `InstructionsLoaded` hook events, and the model's answer;
- `codex-*-summary.txt` holds the composed AGENTS.md heading and the skill entries from the rendered prompt;
- `registration-*` shows this skill listed by sessions started at the repository root;
- `home-readback.md` is the private inbox read back through `home inbox`;
- `pool-live-dry-run.json` is the live t3-pool plan.

Proof standards:

- Observe the session's own report of what it loaded. Matching file bytes alone does not prove loading.
- A dry run proves nothing until the state it claims to skip is unchanged. `pool` compares the state directory before and after.
- Before committing evidence, run `gitleaks dir <evidence dir>`. Evidence holds no tokens and no personal email; the repository is public.

## Cleanup

```sh
.agents/skills/verify-harness/bin/verify-harness cleanup
```

Removes `~/.cache/tmp/verify-harness/run` and the `/tmp/verify-harness-*` cwds and hook directories this run recorded. It never touches `$VH_EVIDENCE`, the live HOME, or processes it did not start. Run it after every failed iteration too.

## Gotchas

- Claude Code loads `CLAUDE.md` and `.claude/skills` from every ancestor of its cwd. A cwd under `/home/phaedrus` silently loads the live `~/.claude/CLAUDE.md` and skills into an "isolated" session. The helper starts sessions in a fresh `/tmp/verify-harness-cwd.*` directory for this reason; keep that if you edit it.
- A Claude Code session on the isolated install has no credentials and ends with `Not logged in`. That is expected: its init event and `InstructionsLoaded` hooks fire before the model call. The model-visible proof comes from `live`, which uses the real login.
- Under heavy machine load, `agent-config/bin/install.test.ts` tests that bundle launchers can exceed Bun's 5-second default timeout and fail the gate while passing in isolation. Check `/proc/loadavg` and rerun that file alone before calling it a regression.
- `home` routes every command over SSH to the cloud primary named in `~/.local/state/home/primary.json`. The `home` drive sets `HOME_FLEET_LOCAL=1` with a private `HOME_INBOX` so the probe never reaches phaedrus. Only a real report uses the routed `home post`.
- `live` compares against the installed `rev`. A branch whose guidance or skills differ from what is deployed reports DRIFT by design. Install `origin/master` to ask whether master is deployed.
