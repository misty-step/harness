# T3 account pools

`t3-pool` continues usage-limited Claude and Codex threads on the next available
account of the same provider. `claude-config/install` selects this component
through `agent-config/install --t3-pool` and enables its systemd user timer.
The timer runs 90 seconds after startup and 90 seconds after each pass finishes.
No T3 authentication files or provider credentials are copied or changed.

## Configuration and state

`pools.json` owns the ordered instance lists. Installation copies it to
`~/.config/t3-pool.json`. Each pool must contain at least two unique instance
IDs, and an instance can belong to only one pool. Pools must contain instances
of the same driver with compatible model options. Change maintained source
before redeploying. The CLI uses the bundled config when no installed config
exists, so source and bundled dry runs work before installation.

The CLI reads `$T3CODE_HOME/userdata/statev2.sqlite` read-only, with
`T3CODE_HOME` defaulting to `~/.t3`. It derives failures from the latest executed
run and its latest root error item, matching T3 0.1.1-nightly. Child errors,
older runs, other failure classes and superseding session errors do not qualify.
Archived, deleted and settled threads, pending approvals and queued runs are
excluded from moves. Existing snoozes for rate-limit recovery can be resumed.
An account switch or model/runtime change by the user supersedes a pending move.

`~/.local/state/t3-pool/state.json` holds unexpired account limits and the moves
for currently failed runs. Limits survive a successful continuation. An absent
or invalid reset blocks the account until an operator removes that limit from
the state file after restoring the account. Expired limits and obsolete handled
runs are removed on subsequent passes. `moves.jsonl` records one line per move
with time, thread, source instance, destination instance and failed run.
`XDG_CONFIG_HOME` and `XDG_STATE_HOME` override the respective roots.

Passes take a nonblocking `flock` on the state directory's lock file. A move's
target and command IDs are saved before dispatch. After a crash or a lost RPC
acknowledgement, the next pass retries the same commands, which T3 deduplicates,
instead of moving that run again. T3 also caches command rejections permanently.
Only a read-only lookup of a `rejected` receipt permits a new command attempt ID
for the same target and phase. A failed continuation retries without another
switch. Corrupt state fails closed. Runtime mode is never changed.

## Authenticated continuation

The CLI shares `lib/t3-rpc.ts` with `t3-runtime-mode`. It issues a short-lived
`orchestration:operate` session, sends protocol-2 Effect RPC commands to the
loopback server, waits for acknowledgements and revokes the session in `finally`,
including after interruption. Authentication headers and server error bodies
never reach output. Cleanup failure reports the unique session label for recovery.

Each move sends `provider.switch` followed by `message.dispatch` with
`Continue where you left off.`, empty attachments and `start_immediately`.
The continuation uses `manualContinuationOfRunId`, the server's guarded resume
path for interrupted or usage-limited runs. It rejects stale runs, archives and
pending approvals atomically. The native automatic worker's
`usageLimitContinuationOfRunId` cannot be reused here: it silently does nothing
before reset or after changing provider instances. This compatibility choice
comes from `UsageLimitRecoveryWorker.limitRecoveryCommand` and
`ThreadManagementService.dispatchMessage` in T3 0.1.1-nightly. Projection state
is also re-read between commands. The provider-switch RPC has no expected-run
precondition, so a concurrent user action can still race the switch itself.

## Verification and operation

```sh
bun agent-config/bin/t3-pool.ts --dry-run
bun test agent-config/bin/t3-pool.test.ts agent-config/bin/t3-runtime-mode.test.ts
./scripts/check shared
systemctl --user status t3-pool.timer
journalctl --user -u t3-pool.service --no-pager
```

Dry runs print one JSON line per planned move and a final count with the limited
instances. They do not issue sessions, dispatch commands or write state or logs.
When no instance has room, a normal pass issues no session and T3's own
`autoResumeLimitedThreads` recovery remains responsible for reset.

The tests create a fixture SQLite projection and authenticated fake WebSocket
server. They exercise rejection, lost acknowledgements, repeat passes, account
cooldowns, overlapping processes, interruption, private output and installer
ownership. The installer checks use a fresh clone, private HOME and recorded
systemctl calls. They never activate the live timer.

The supported RPC has no command for injecting a synthetic usage-limit failure.
A live scratch test would require an actual provider limit or editing live
projection/event data. The live dry run and fixture-server tests cover this
change without mutating real lanes. The real cross-account continuation remains
unverified until a scratch thread encounters a genuine limit.
