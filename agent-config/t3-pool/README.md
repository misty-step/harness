# T3 account pools

`t3-pool` continues fresh usage-limited Claude and Codex threads on another
account: the same provider first, then the other provider with a mapped model.
It continues delegated children so their results still reach their parents.
When a lane's transcript is too large for its target, it starts a successor
thread instead. `claude-config/install` selects it through
`agent-config/install --t3-pool`. Installation deploys inactive systemd user
units; activation is explicit. An enabled timer runs 90 seconds after startup
and 90 seconds after each pass finishes.

## Configuration and eligibility

`pools.json` owns the instance lists, reserved accounts, `maxMovesPerPass`, the
cross-provider model map and its shared efforts.
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

- Its latest executed run has a root failure less than 30 minutes old, measured
  by the error item's `updated_at`: a `usage_limit`, or T3's "Insufficient
  context allowance for the provider handoff" refusal.
- No archive, deletion, settlement, pending request, queued run or superseding
  provider-session error.
- No user account, model or runtime change superseding a reserved move.
- For a handoff refusal, no `(succeeded by …)` title and no same-title thread in
  its project created after the failure: another starter got there first.

A delegated child qualifies only when it is an app-owned subagent whose
original task already has a result and whose parent is neither archived nor
deleted. Its continuation is a user `message.dispatch`, so T3's
`recordSubagentFollowup` gives the new run a fresh parent-owned task; that
task's completion notifies the parent, as an orchestrator follow-up to a
child thread does. The pass prints the task id. Children never get successors,
because a successor cannot report to the parent. Top-level lanes take the pass
and hourly caps before children.
Eligibility and target limits are re-read before switching and continuing.

For each account, `F` is its newest current root usage-limit failure; `S` is its
newest completed-run completion. Archived, deleted, settled and superseded
failures do not count. An account is limited only when `F > S` and its reset is
still in the future. An absent or invalid reset expires one hour after `F`.
Running runs do not clear a limit: a limited account accepts runs that then
fail at the same limit.

## Targets

Targets come from the thread's pool. When every other account in it is limited
or reserved, they come from the other pools, with the model and effort mapped by
`crossProvider`: Sol at an effort becomes Opus 5.5 at the same effort, and back.
Other options, such as `fastMode` or `serviceTier`, are provider-specific and
stay behind. An unmapped model or an effort outside `efforts` gets no
cross-provider move. A same-pool account that is only at its hourly cap does not
send the thread to another provider.

T3 replays a compact handoff into the target's provider thread for this lane.
If the target already holds a transcript of it, T3 budgets
`window − used − max(16k, window/4)` tokens and refuses when that leaves no
room for the handoff. The pool reads each provider thread's `contextUsage` and
prefers a target that fits. When none fits, or when T3 has already refused, it
starts a successor instead.

## Successors

A successor follows the `lane-succession` skill's contract (#411). The pool
calls `orchestration.launchThread` with a pre-assigned thread id, the old
thread's title, project and interaction mode, the target's model selection and
the old runtime mode. The workspace is `existing_worktree` with the old
`worktreePath` and branch, or `root` when there is none. The first message is
the contract's fixed text: the successor reads the old thread, writes the
handoff under `~/.local/state/t3-handoffs/`, claims the old thread and continues.
The pool then settles the old thread unless it has a newer run, and posts the
new thread id with `home post --from t3-pool`. If that fails, it appends the
same body to `$XDG_STATE_HOME/home/inbox.md`. Heartbeat confirms that the
successor continues.

## State and retries

`~/.local/state/t3-pool/state.json` holds derived account limits, moves for
currently failed runs, and hourly target admissions. Limits are recomputed on
every pass; legacy null limits cannot persist. Admissions survive pruning of
completed moves and expire after one hour. Rejected or interrupted reservations
count conservatively toward the hourly cap. No manual state edits are needed.
`XDG_CONFIG_HOME` and `XDG_STATE_HOME` override the respective roots.

Passes take a nonblocking `flock`. A move's target, admission and command IDs
are saved with fsync before dispatch. After a crash or lost acknowledgement,
the next pass retries the same command ID, which T3 deduplicates. A lost launch
acknowledgement resumes the same successor thread. Only an authoritative
`rejected` receipt permits a new attempt ID. A launch can fail before T3 writes
a receipt; that failure keeps its ID but still counts as a rejection. A rejected move is
recorded and skipped so the pass can continue; three rejections across either
phase mark it `abandoned`. A failed continuation retries without switching again.
Corrupt state fails closed. Runtime mode never changes.

`moves.jsonl` records each move once, with time, thread, source, destination,
failed run and kind (`account`, `provider` or `successor`), plus the mapped
model or successor thread when there is one. Each finished move also prints a
`moved` line to the journal. `rejections.jsonl` and stderr record rejected attempts without
server error bodies or credentials.

## Authenticated continuation

The CLI shares `lib/t3-rpc.ts` with `t3-runtime-mode`. It issues a ten-minute
`orchestration:operate` session, sends protocol-2 Effect RPC commands to the
loopback server, waits for acknowledgements and revokes the session in `finally`,
including after interruption. Authentication headers never reach output.
Cleanup failure identifies the unique session label for recovery.

Each account or provider move sends `provider.switch`, then `message.dispatch` with
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

Dry runs print each fresh candidate with its move, kind or waiting reason,
marking children, then the move count, limited accounts and counts of excluded
failures by reason. A candidate held by the pass cap names its next move.
They issue no sessions, dispatch no commands and write no state or logs. When
no move is eligible, normal passes also issue no session; T3's native
`autoResumeLimitedThreads` remains responsible for reset.

The tests use a SQLite projection and an authenticated fixture WebSocket server.
They cover eligibility, child follow-up tasks, cross-provider mapping,
transcript-size prediction, successors, Home fallback, recovery evidence,
unknown resets, reservations, load, caps across restarts, rejection and
abandonment, lost acknowledgements, interruption, private output and installer
ownership. Installer checks run in
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

Same-provider account moves ran live on 2026-10-20: three claudeAgent lanes
continued on claude-mistystep. The supported RPC cannot inject a synthetic
usage-limit failure, so child, cross-provider and successor moves are proven by
live dry runs and fixture tests until a live pass makes one. The shipped pass is
capped at one move for observation.
