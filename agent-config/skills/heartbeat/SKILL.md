---
name: heartbeat
description: One sweep over every lane that restarts the stalled, answers what standing policy already answers, runs allowed actions a guard blocked, and digests only genuinely new decisions for the coordinator. Use for /heartbeat or "Heartbeat sweep".
---

# Heartbeat

Lanes stall: a turn ends with work left, a run fails, a guard blocks an allowed command, or a question sits that policy already answers. Each sweep moves every stalled lane that an agent can move, so the principal and the coordinator only ever see real decisions.

You act only within the standing autonomy policy in global guidance. You never do a lane's work for it, rewrite its plan, or answer product intent. The one exception is running a lane's blocked command, under the rule below.

## Setup, once

`schedule_task` bound to this thread, with schedule `{"type":"interval","everyMs":3600000}` and prompt `Heartbeat sweep: use the heartbeat skill.` Report its next run.

## 1. Read every lane

Build the roster exactly as the `lage` skill's step 1 does. For each lane, read the thread's status, `t3_pending_request_list`, the last three messages, and the time of its newest side effect (lage's step 2 definitions). Skip PR and child detail unless a rule below needs it.

Done when every roster lane has a status, its asks and a last-side-effect time.

## 2. Apply the first rule that matches

| The lane is | Do |
| --- | --- |
| running, with a side effect in the last 6 hours | Nothing. |
| running, with no side effect in 6 hours and no running child | Ask once: "Heartbeat: no side effect since <time>. What's the next verifiable step?" If the next sweep finds the same, `t3_thread_send` with `mode: "restart"`: "Continue from your last verifiable step." |
| failed or interrupted | Send "Continue. The last run ended with: <error, one line>." On the same failure twice in a row, put it in the digest as stuck. |
| idle, having named a next step it can take | Send "Continue: <the step it named>." |
| holding `BLOCKED-ALLOWED: <command>` with no `RAN:` reply after it | Check the command against the policy, part by part. Refuse a chain you can't check that way. If the policy allows every part and nothing is destroyed, run it in the lane's `worktreePath` (from `t3_thread_read`), then reply in the lane: `RAN: <command> → <exit code and one-line result>`. If the policy withholds it, as with a merge that has no judge SHIP, reply with the policy line that withholds it and put it in the digest. If a guard blocks you too, tell the Process lane the exact command and guard, and put it in the digest. |
| asking a question the policy or the coordinator's file already answers | Answer it, citing the policy line or the decision and its date. |
| asking a product-intent, destructive, production-write or money question | Leave it for the principal. It goes in the digest. |
| waiting only on the principal | Nothing. |

Give every send a `clientRequestId` of `heartbeat-<sweep start, to the hour>-<threadId>`, so a re-run sweep never double-sends.

## 3. Digest

Read your own previous digest in this thread. Then send the coordinator (Home, `mcp:dc0e963c-accc-4bdd-a7d1-fc52a7523347`) one `t3_thread_send`, and only if something is new since it:

- what you unstuck, one line per lane;
- each new principal decision: the lane link, a one-line question, and the lane's recommendation;
- anything stuck that you could not move.

When nothing is new, send nothing. Your own reply in this thread is at most two lines: what you did, and the next run time.
