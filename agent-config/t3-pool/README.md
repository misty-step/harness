# T3 account pools

`t3-pool` continues fresh usage-limited Claude and Codex threads on another
account: the same provider first, then the other provider with a mapped model.
It continues delegated children so their results still reach their parents.
When T3 refuses a top-level WIP root's transcript handoff, it requests succession
from Home once. A blocked child requests recovery through its owning parent.
Only Home opens top-level threads from groomed and specced backlog.
`claude-config/install` selects it through
`agent-config/install --t3-pool`. Installation deploys inactive systemd user
units; activation is explicit. An enabled timer runs 90 seconds after startup
and 90 seconds after each pass finishes.

## Configuration and eligibility

`pools.json` owns the instance lists, reserved accounts, `maxMovesPerPass`, the
cross-provider model map, shared efforts and the explicit `wipRoots` IDs.
Installation copies it to `~/.config/t3-pool.json`. Each pool needs at least two
unique instance IDs of the same driver with compatible models and options.
An instance can belong to only one pool. The installed config file and its
`wipRoots` key are required; absent or invalid rosters fail closed.

Home names the active set according to available budget; there is no fixed
global lane cap. The current named roots are Tach, Process 2, Overmind and
Marmalade, plus draining Voice and Habitat, confirmed through T3 on 2026-10-21.
Home and Heartbeat are exempt from the WIP count but are not pool targets. Verify roots and other backlog lanes are excluded.

Pool and Heartbeat read the same runtime authority:
`${XDG_CONFIG_HOME:-$HOME/.config}/t3-pool.json`, key `wipRoots`, an array of
unique nonempty exact root IDs. They never infer membership from NOW or all
open threads. No separate registry or budget calculator is involved.

Home changes the WIP set by intentionally editing `wipRoots` in this source
`pools.json`, reviewing the exact current IDs with `t3_thread_read`, and deploying
the config through the normal harness installer. Installation replaces the owned
`~/.config/t3-pool.json`; an installed config can also be edited for immediate
operation, then reconciled to source before the next install. `wipRoots: []`
disables all moves. A missing file or key, malformed JSON, non-array value,
duplicate or blank ID stops recovery before any action. Names and `(succeeded by …)` claims never transfer eligibility: after Home
creates and verifies a successor, Home replaces the predecessor ID intentionally.

A thread is eligible only if it is a maintained top-level root or a descendant
whose every parent edge agrees with its original task's owner and forked node.
Missing, conflicting or cyclic ancestry and any archived, deleted or settled
ancestor fail closed. The cached `lineage.rootThreadId` is not authority.
The planner and executor use this same boundary; configuration and ancestry are
read again before each switch, continuation and Home request. Account usage
observed on excluded lanes can still make an account unavailable as a target;
that observation never authorizes moving those lanes.

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
original task already has a result and whose entire ancestry is eligible.
A newer run, queued run or app-owned delegation on its parent after the failure
means the parent has taken over recovery, so the pool skips the stale child.
Its continuation is a user `message.dispatch`, so T3's
`recordSubagentFollowup` gives the new run a fresh parent-owned task; that
task's completion notifies the parent, as an orchestrator follow-up to a
child thread does. The pass prints the task id. The pool never launches successors.
Top-level lanes take the pass and hourly caps before children.
Eligibility, target pool membership, model and effort mapping, reservations and
target limits are re-read before switching and continuing.

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
stay behind. An unmapped model, implicit or duplicate effort, or an effort
outside `efforts` gets no cross-provider move; provider defaults cannot prove
equivalent effort. A same-pool account that is only at its hourly cap does not
send the thread to another provider.

T3 owns transcript admission. Accounts sharing native history can resume without
a handoff; stale per-account context rows do not justify succession. The pool
attempts an eligible move and responds to an actual T3 handoff refusal.

## Succession requests

The pool never launches, renames or settles a thread. A handoff refusal on an
explicitly named top-level WIP root produces one `home post --from t3-pool` per failed run, with
the predecessor link, failed run, project, workspace, branch, current model and
options, runtime and interaction mode, and the failure reason. Home decides
whether succession follows from groomed and specced backlog and uses the
`lane-succession` contract. A child's handoff refusal instead reports its verified
owning parent and asks Home to route recovery through that parent. Child alerts
contain neither the succession marker nor the handoff line below. They never
request a top-level replacement, so task results remain attached to their parent.

The first line is `Lane succession requested: <predecessor threadId>`, shared
with Heartbeat's inbox duplicate check. The request includes
`Handoff: none; the successor builds it from t3_thread_read history.`

If Home posting fails, the same request is appended to
`$XDG_STATE_HOME/home/inbox.md`. A successful post or fallback marks the request
done; subsequent passes do not repost it. A crash between posting and the state
save can repeat a request, identified by the same failed run. It cannot create a
thread. Neither a dry run nor a succession-only pass issues an RPC session.

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
phase mark it `abandoned` and notify Home with both original and target
selections, including when a cached receipt reveals the third rejection after a
restart. A failed continuation retries without switching again. If a provider
move cannot continue after switching, it is abandoned with the reason and both
selections sent to Home. An accepted continuation receipt prevents a false
abandonment alert after a lost acknowledgement. Terminal notifications persist
until Home posting or its inbox fallback succeeds, even if the failed run is
superseded. A crash after delivery but before saving can repeat the notification.
Succession requests serialize with legacy `phase: done` plus a pending notification
flag, so the old reader cannot execute them. Reverting to the unrestricted old
planner is not an authorized rollback: leave the timer off until the replacement
retains the WIP filter. Corrupt state fails closed before authentication, state
rewrites or notifications. Recovery phases are `switch`, `continue`, `done` and
`abandoned`; succession and parent recovery notification phases are `announce`,
`done` and `abandoned`. Pending child succession notifications from the earlier
format migrate to parent recovery without a succession marker. Retired
`launch` and `settle` phases are rejected. Only the original account-only format
may omit both kind and target. Source and target identities must agree with
their selections. Runtime mode never changes.

`moves.jsonl` records each move once, with time, thread, source, destination,
failed run and kind (`account` or `provider`), plus the mapped
model when there is one. Succession requests print a `requested` line instead.
Each finished move also prints a `moved` line to the journal. `rejections.jsonl`
and stderr record rejected attempts without
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
no move is eligible, normal passes also issue no session. The pool never changes
`autoResumeLimitedThreads`; broad native auto-resume must remain off while
enforcing Home's named set.

The tests use a SQLite projection and an authenticated fixture WebSocket server.
They cover eligibility, child follow-up tasks, cross-provider mapping,
transitive WIP ancestry, stale child rejection, Home succession requests,
fallback, recovery evidence,
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
usage-limit failure, so child and cross-provider moves are proven by
fixture tests until an authorized live pass makes one. Succession requests are
proven with an isolated Home inbox; the pool cannot create a successor. The
shipped pass is capped at one move for observation.
