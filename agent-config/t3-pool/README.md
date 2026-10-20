# T3 account pools

`t3-pool` continues fresh usage-limited top-level Claude and Codex lanes on
another account of the same provider. `claude-config/install` selects it through
`agent-config/install --t3-pool`. Installation deploys inactive systemd user
units; activation is explicit. An enabled timer runs 90 seconds after startup
and 90 seconds after each pass finishes.

## Configuration and eligibility

`pools.json` owns the instance lists, reserved accounts and `maxMovesPerPass`.
Installation copies it to `~/.config/t3-pool.json`. Each pool needs at least two
unique instance IDs of the same driver with compatible models and options.
An instance can belong to only one pool. The CLI uses bundled defaults when
no installed config exists.

The shipped reservations are `claude-hello`, `claude-r90` and `codex-r90`.
`codex-r90` has no credits; remove its reservation only after a future observed
refill. Reserved accounts can be sources but never targets.
Targets are chosen by fewest running runs,
including reservations made earlier in the pass; ties follow pool order after
the source. The shipped ramp admits one move per pass. `maxMovesPerPass` accepts
only 1 or 2. Each target admits at most three moves per rolling hour.

The CLI reads `$T3CODE_HOME/userdata/statev2.sqlite` read-only, defaulting to
`~/.t3`. A move requires all of the following:

- A top-level lane (`lineage.parentThreadId` is null).
- Its latest executed run has a root `usage_limit` failure less than 30 minutes
  old, measured by the error item's `updated_at`.
- No archive, deletion, settlement, pending request, queued run or superseding
  provider-session error.
- No user account, model or runtime change superseding a reserved move.

All delegated children are excluded, including failed, completed, cancelled,
delivered and superseded tasks. T3's current manual continuation drops
`delegatedTaskId`, so continuing a child cannot deliver its result to its parent.
Eligibility and target limits are re-read before switching and continuing.

For each account, `F` is its newest current root usage-limit failure; `S` is its
newest completed-run completion or running-run start. Archived, deleted,
settled and superseded failures do not count. An account is limited only when
`F > S` and its reset is still in the future. An absent or invalid reset expires
one hour after `F`. Newer successful or running activity clears the limit.

## State and retries

`~/.local/state/t3-pool/state.json` holds derived account limits, moves for
currently failed runs, and hourly target admissions. Limits are recomputed on
every pass; legacy null limits cannot persist. Admissions survive pruning of
completed moves and expire after one hour. Rejected or interrupted reservations
count conservatively toward the hourly cap. No manual state edits are needed.
`XDG_CONFIG_HOME` and `XDG_STATE_HOME` override the respective roots.

Passes take a nonblocking `flock`. A move's target, admission and command IDs
are saved with fsync before dispatch. After a crash or lost acknowledgement,
the next pass retries the same command ID, which T3 deduplicates. Only an
authoritative `rejected` receipt permits a new attempt ID. A rejected move is
recorded and skipped so the pass can continue; three rejections across either
phase mark it `abandoned`. A failed continuation retries without switching again.
Corrupt state fails closed. Runtime mode never changes.

`moves.jsonl` records each switch once, with time, thread, source, destination
and failed run. `rejections.jsonl` and stderr record rejected attempts without
server error bodies or credentials.

## Authenticated continuation

The CLI shares `lib/t3-rpc.ts` with `t3-runtime-mode`. It issues a ten-minute
`orchestration:operate` session, sends protocol-2 Effect RPC commands to the
loopback server, waits for acknowledgements and revokes the session in `finally`,
including after interruption. Authentication headers never reach output.
Cleanup failure identifies the unique session label for recovery.

Each move sends `provider.switch`, then `message.dispatch` with
`Continue where you left off.`, empty attachments and `start_immediately`.
`manualContinuationOfRunId` guards the latest failed run, archive and pending
requests atomically. The automatic `usageLimitContinuationOfRunId` is a no-op
before reset or after switching accounts, so it cannot serve this path.
This contract was checked against T3 0.1.1-nightly. Provider switching has no
expected-run precondition; a concurrent user action can still race the switch.

## Verification and operation

```sh
bun agent-config/bin/t3-pool.ts --dry-run
bun test agent-config/bin/t3-pool.test.ts agent-config/bin/t3-runtime-mode.test.ts
./scripts/check shared
```

Dry runs print each fresh top-level candidate with its move or waiting reason,
then the move count, limited accounts and counts of excluded failures by reason.
They issue no sessions, dispatch no commands and write no state or logs. When
no move is eligible, normal passes also issue no session; T3's native
`autoResumeLimitedThreads` remains responsible for reset.

The tests use a SQLite projection and an authenticated fixture WebSocket server.
They cover eligibility, recovery evidence, unknown resets, reservations, load,
caps across restarts, rejection and abandonment, lost acknowledgements,
interruption, private output and installer ownership. Installer checks run in
a fresh clone with private HOME and recorded systemctl calls.

On a host with systemd and `flock`, activation is an explicit operation:

```sh
systemctl --user enable --now t3-pool.timer
systemctl --user status t3-pool.timer
journalctl --user -u t3-pool.service --no-pager
```

To turn pooling off durably:

```sh
systemctl --user disable --now t3-pool.timer
systemctl --user stop t3-pool.service
```

Reinstall never enables or starts the timer, so it preserves this off switch.
An existing `/dev/null` unit mask is preserved, and foreign launcher, config or
unit destinations are refused before deployment. Without systemd, a user manager
or `flock`, the installer skips pooling with a notice and installs the other
selected primitives normally. Pool state and logs survive reinstalls.

Cross-account continuation remains unverified on a live limited scratch thread:
the supported RPC cannot inject a synthetic usage-limit failure. Live dry runs
and fixture tests verify the candidate without mutating real lanes. The first
opted-in pass is capped at one move for observation.
