# T3 pool

`t3-pool` continues a usage-limited top-level T3 lane on another account of the same provider. claude-config installs it with inactive systemd units, and activation is the operator's explicit choice. Its dry run is the operator's view of what a pass would do.

## Sub-features

- `pool-dry-run-live`: `bun agent-config/bin/t3-pool.ts --dry-run` reads the live T3 database read-only and prints `{"dryRun":true,"planned":<n>,"limited":[...],...}`.
- `pool-dry-run-inert`: the dry run leaves `~/.local/state/t3-pool/` unchanged.
- `pool-bundle`: the installed `~/.local/bin/t3-pool --dry-run` runs with no source checkout and no T3 database, and plans 0 moves.
- `pool-config`: the live `~/.config/t3-pool.json` matches `agent-config/t3-pool/pools.json`.
- `pool-opt-in`: `t3-pool.timer` is enabled only if the operator chose it.

## How to get to it (user POV)

- `bun agent-config/bin/t3-pool.ts --dry-run`, or `t3-pool --dry-run` once installed.
- `systemctl --user status t3-pool.timer` and `journalctl --user -u t3-pool.service`.

## Driving it with verify-harness

Preconditions:

- `verify-harness install` passed in this `VH_DIR`.
- The local T3 server is running. Doctor shows it on loopback.

- **Plan.** Run `verify-harness pool`. Expect `PASS live dry run: {"planned":<n>,"limited":[...]}`.
- **Inert.** Expect `PASS dry run wrote no pool state`.
- **Bundle.** Expect `PASS installed bundle runs with no source or T3 database`.
- **Config.** Expect `PASS live ~/.config/t3-pool.json matches source`, then the timer state line.
- **Proof.** Keep `pool-live-dry-run.json` and the pool section of `transcript.txt`.

## Succession policy candidate

For a change to `heartbeat` or `lane-succession`, first run `install`, `session both`
and `session-auth` with unique `VH_DIR` and `VH_EVIDENCE`. In a fresh authenticated
native session on that private HOME, read the installed global guidance and both
installed skills. Use the helper's fresh cwd outside the live HOME and a symlink
there to the private installed skills; read through that link so native file-read
discovery does not pick up live ancestor instructions. With only file-read tools available, request decisions for:
a valid named root, a listed child, a parked/unnamed lane, concurrent Home dispatch,
a lost launch response, missing installed readback, pre-adoption abandonment and
post-adoption failure. Require automatic serialized dispatch only for the named
root, recovery of the same tracked successor, full restoration receipts before
reopening, no adoption before readback and one blocker/completion report to Home.
Also distinguish an exact-ID roster-only PR from authored policy or config changes.
Retain the prompt, native response and observed decisions outside Git. Run `home`
and `pool` to prove private delivery and runtime dry-run preservation. No actual
thread launch, roster mutation or timer activation is part of this policy proof.
Live deployed guidance remains pending until the normal post-merge release.

## Gotchas

- Never run `t3-pool` without `--dry-run` to verify. A real pass switches a live lane's account and continues it.
- Cross-account continuation on a live limited thread stays unverified. The supported RPC cannot inject a synthetic usage-limit failure, so the fixture tests in `agent-config/bin/t3-pool.test.ts` (run by [Gate](./gate.md)) carry that proof.
- `limited` lists accounts whose newest root usage-limit failure is newer than their newest success. On 2026-10-20 that was every Codex account.
- When `t3-pool.timer` is enabled, a real pass can run inside the dry run's window and write state. The drive then prints `NOTE a live t3-pool.service pass ran during the dry run; inert check inconclusive` instead of failing. Rerun `pool`.
- `t3-runtime-mode` mutates a live thread's mode, so this map drives it only through its fixture tests in the gate.
