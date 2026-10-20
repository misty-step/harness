---
name: heartbeat
description: Sweep lanes, resume stalls, relay decisions, run allowed blocked commands, and digest new principal questions. Use for /heartbeat or "Heartbeat sweep".
---

# Heartbeat

Follow global guidance's **Autonomy** section. Leave technical choices with the lane; run only its checked blocked command.

## Setup

Read `~/home/CLAUDE.md` and exclude its out-of-scope work from the roster and every emitted brief; refer to the exclusion generically. Read `list_scheduled_tasks`: reconcile this thread's heartbeat to `{"type":"interval","everyMs":3600000}` and prompt `Heartbeat sweep: use the heartbeat skill.` Update the existing task, or `schedule_task` if absent. Report next run.

## 1. Read every lane

Build the roster exactly as the `lage` skill's step 1 does. Read `~/home/NOW.md` (Home's open loops), `~/.local/state/home/inbox.md`, and your durable sweep record (below). Read each lane's status, `t3_pending_request_list`/`t3_pending_request_read`, and `t3_thread_read` tail with `view: "activity", runLimit: 3`: `afterPosition` near `itemCount - 12`, `maxCharsPerItem: 3000`. Expand truncation with `itemId`/`textOffset`; page back until outstanding asks, blocked requests and heartbeat replies are accounted for. For the latest failed `runId`, page backward by lowering `afterPosition` until its last `error` and all available `system_notice`/`assistant_message` reset notices are read; exhaust that run or record unavailable evidence. `recentRuns` gives status/IDs, not failure text. Use thread reads for lanes, never parent-scoped `task_status`.

Record run ID, provider, error title/text and reset UTC or `unknown: <why>`. Only `type: "error", title: "Usage limit reached"` identifies a usage limit; `Provider error` with capacity prose does not. Resolve same-run Claude notices: relative intervals from `updatedAt`, local times using timezone and date context. Conflicting/ambiguous timing stays unknown. Codex may have no reset notice.

Find the newest side effect (lage step 2's definition) in dated activity; verify linked evidence as needed. Record time or `unknown: <why>`. Resolve agent waits from `t3_thread_list` with `includeSubagents: true` and lane reports: T3 may omit native agents, so absence proves nothing.

Classify every ask: policy/dated NOW answers are relays; technical choices belong to the lane; unresolved Autonomy **Bring him only** asks enter the draft digest with options, recommendation and consequence of waiting, regardless of other asks or lane status.

Done when every lane has status, asks, wait evidence, progress time and failed-run evidence (or explicit unknowns), and every principal ask enters the draft.

## 2. Select exactly one rule

Each row excludes all preceding matches. Batch sends; use `clientRequestId: heartbeat-<sweep start, UTC hour YYYY-MM-DDTHH>-<purpose>-<threadId>` (`nudge`, `answer`, `ran`, `process`, `resume`), reused on retries. Inbox digests use the delivery record below. Write every question in full with options, recommendation and consequence of waiting in every emitted brief. Link every referenced PR, issue and thread with a one-line summary; use no bare item numbers.

| Condition | Action |
| --- | --- |
| `BLOCKED-ALLOWED: <command>` with no later `RAN: <command>` | Reread the lane immediately before running; defer to a `RAN:` for that command. Run commands whose every part Autonomy allows and none destroys, in the lane's `worktreePath`; reply `RAN: <command> → <exit/result>`. Refuse uncheckable or disallowed ones with a final, digested `RAN: <command> → refused (<reason/policy line>)`. Leave a guard block on your run without `RAN:` for later sweeps to retry; send Process and the digest its exact command and guard unless Process's thread and your previous digest already hold them. |
| Agent-answerable asks remain | Relay all answers with citations/dates; tell the lane to make technical calls and continue unblocked work. |
| Explicitly waiting on agents, or a live child blocks the next step | Wait. If native-agent liveness is unknown and progress is older than 6 hours/unknown, ask once for status; digest as stuck if still unknown next sweep. |
| Latest run `failed` with the usage-limit marker | If awaiting phaedrus or on stop/hold, suppress action within this row. Otherwise reread latest run immediately before sending: if unchanged and reset passed or unknown, send `Continue from your last verifiable step` (`resume`). Unknown reset: retry next sweep and each eligible sweep. Known future reset: wait. After more than 5 hours continuously stalled, escalate using the durable record below, even before a weekly reset. |
| `failed`, `interrupted`, `rolled_back`; no explicit stop/hold | Send `Continue: <last error>`. Same failure after that retry: digest as stuck; retry only after changed evidence. |
| `idle`, `completed`, `cancelled`, `waiting`; named unblocked step; no stop/hold | Send `Continue: <named step>`. |
| `preparing`, `queued`, `starting`, `running`; progress older than 6 hours/unknown | Ask once for next verifiable step and child status. Next unchanged sweep: `t3_thread_send`, `mode: "restart"`, with `Continue from your last verifiable step` only with confirmed absence of live agents; otherwise digest as stuck. |
| All remaining lanes | Leave waiting, progressing, held or finished work alone; digest unknown status/missing evidence. |

## Durable sweep record

Create `~/.local/state/heartbeat/` if absent; maintain `sweep.json` there outside Home's memory. Serialize sweeps with `flock` on `~/.local/state/heartbeat/sweep.lock`; atomically replace the JSON after each state change. Persist sweep hour, selected rules/results, run/error/reset evidence, asks and deliveries. Reuse the saved hour when resuming an interrupted sweep.

Per lane, persist `stallId`, `firstFailureAt`, its evidence/source, `lastRunId`, `processDelivered` and `inboxDelivered`. Start at the oldest evidenced consecutive limit failure's completion time; page history beyond three runs to establish continuity. If unavailable, use the first observed sweep time, explicitly labelled. Never advance that clock on failed retries. A newer run that starts useful work, succeeds or fails for another reason ends the stall: clear active stall fields; preserve delivery history. A queued/preparing retry alone is not recovery. Missing evidence preserves the clock as uncertain. A later limit episode gets a new stall ID.

After more than 5 hours, unless principal-wait/stop/hold suppresses action, send Process the linked lane, provider, error and recommendation to move to a provider with headroom; distrust `upkeep status` headroom. Use `heartbeat-<stallId>-process-<threadId>`, saved before sending. Independently enqueue the same escalation for the inbox. Mark each destination delivered only on confirmed delivery; retry only the missing destination with its saved key/body. Retain both flags for the entire stall, beyond the recent-run window. Earlier child-wait rules still win.

## 3. Digest

Dedupe against the durable delivery history, inbox and `~/home/NOW.md`. Unchanged asks already held are accounted for; recorded answers become relays; changed stakes/recommendations/deadlines are new. Record every principal ask as delivered (inbox entry), already held (cite where), or answered/relayed. Include only new unstuck lanes, principal asks and stuck work; with no news, post nothing.

Deliver Home digests only via `home post --from Heartbeat`, passing Markdown on stdin. Its contract appends `## <UTC> [Heartbeat]` plus the body to `~/.local/state/home/inbox.md`; it is being built and is not yet live. Home's thread is written only by phaedrus: never `t3_thread_send` to Home. Lane/Process sends remain thread sends.

Before posting, persist a pending digest with stable `digestId`, exact body and included ask/stall IDs. Include `<!-- heartbeat-digest: <digestId> -->` in the body. Under the sweep lock, reconcile against the inbox: if that marker and complete body already occur in one Heartbeat entry, record delivered without posting. Otherwise pipe the saved body to `home post --from Heartbeat`, verify the complete entry, then persist its timestamp/marker and mark included inbox escalations delivered. After a crash or uncertain command result, reread the inbox before retrying the same pending body. Never mark delivered on command invocation alone; if unavailable, retain pending and report delivery blocked here. This handles a post succeeding before its delivery-record write.

Reply here in two lines at most: actions and next run.
