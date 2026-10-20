---
name: heartbeat
description: Sweep lanes, resume stalls, relay decisions, run allowed blocked commands, and digest new principal questions. Use for /heartbeat or "Heartbeat sweep".
---

# Heartbeat

Follow global guidance's **Autonomy** section. Leave technical choices with the lane; run only its checked blocked command.

## Setup

Record the coordinator's thread ID in this thread; resolve it from the coordinator thread if missing. Read `list_scheduled_tasks`: reconcile this thread's heartbeat to `{"type":"interval","everyMs":3600000}` and prompt `Heartbeat sweep: use the heartbeat skill.` Update the existing task, or `schedule_task` if absent. Report next run.

## 1. Read every lane

Build the roster exactly as the `lage` skill's step 1 does. Read `~/home/NOW.md` (Home's open loops) and your previous sweep. Read each lane's status, `t3_pending_request_list`/`t3_pending_request_read`, and `t3_thread_read` tail with `runLimit: 3`: `afterPosition` near `itemCount - 12`, `maxCharsPerItem: 3000`. Expand truncation with `itemId`/`textOffset`; page back until outstanding asks, blocked requests and heartbeat replies are accounted for.

Find the newest side effect (lage step 2's definition) in dated activity; verify linked evidence as needed. Record time or `unknown: <why>`. Resolve agent waits from `t3_thread_list` with `includeSubagents: true` and lane reports: T3 may omit native agents, so absence proves nothing.

Classify every ask: policy/dated NOW answers are relays; technical choices belong to the lane; unresolved Autonomy **Bring him only** asks enter the draft digest with recommendation and waiting cost, regardless of other asks or lane status.

Done when every lane has status, asks, wait evidence and progress time (or explicit unknowns), and every principal ask enters the draft.

## 2. Select exactly one rule

Each row excludes all preceding matches. Batch sends; use `clientRequestId: heartbeat-<sweep start, UTC hour YYYY-MM-DDTHH>-<purpose>-<threadId>` (`digest`, `nudge`, `answer`, `ran`, `process`, `resume`), reused on retries.

| Condition | Action |
| --- | --- |
| `BLOCKED-ALLOWED: <command>` with no later `RAN: <command>` | Reread the lane immediately before running; defer to a `RAN:` for that command. Run commands whose every part Autonomy allows and none destroys, in the lane's `worktreePath`; reply `RAN: <command> → <exit/result>`. Refuse uncheckable or disallowed ones with a final, digested `RAN: <command> → refused (<reason/policy line>)`. Leave a guard block on your run without `RAN:` for later sweeps to retry; send Process and the digest its exact command and guard unless Process's thread and your previous digest already hold them. |
| Agent-answerable asks remain | Relay all answers with citations/dates; tell the lane to make technical calls and continue unblocked work. |
| Explicitly waiting on agents, or a live child blocks the next step | Wait. If native-agent liveness is unknown and progress is older than 6 hours/unknown, ask once for status; digest as stuck if still unknown next sweep. |
| Latest run `failed` on a provider usage limit (rate, quota, credits); no newer run | Unless it awaits phaedrus or holds: once any reset time the error names passes, send `Continue from your last verifiable step` each sweep (`resume`); a failed retry costs seconds. Past 5 hours stalled, tell Process and the digest its lane, provider and error once, as in row 1, recommending a provider with headroom; distrust `upkeep status` headroom. |
| `failed`, `interrupted`, `rolled_back`; no explicit stop/hold | Send `Continue: <last error>`. Same failure after that retry: digest as stuck; retry only after changed evidence. |
| `idle`, `completed`, `cancelled`, `waiting`; named unblocked step; no stop/hold | Send `Continue: <named step>`. |
| `preparing`, `queued`, `starting`, `running`; progress older than 6 hours/unknown | Ask once for next verifiable step and child status. Next unchanged sweep: `t3_thread_send`, `mode: "restart"`, with `Continue from your last verifiable step` only with confirmed absence of live agents; otherwise digest as stuck. |
| All remaining lanes | Leave waiting, progressing, held or finished work alone; digest unknown status/missing evidence. |

Record each lane's selected rule and results here for next sweep.

## 3. Digest

Dedupe against both your previous digest and `~/home/NOW.md`. Unchanged asks already held are accounted for; recorded answers become relays; changed stakes/recommendations/deadlines are new. Record every principal ask as sent, already held (cite where), or answered/relayed.

Send the configured coordinator one `t3_thread_send` only for new items: unstuck lanes; principal asks (lane link, question, recommendation, waiting cost); stuck work. With no news, send nothing. Reply here in two lines at most: actions and next run.
