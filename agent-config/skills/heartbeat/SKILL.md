---
name: heartbeat
description: Sweep lanes for stalls, dropped decisions, and failed native recovery. Use for /heartbeat or "Heartbeat sweep".
---

# Heartbeat

Follow global guidance's **Autonomy** section.

## Sweep

Read `~/home/CLAUDE.md`. Exclude its out-of-scope work from the roster and every brief; name none of it here.

Use `list_scheduled_tasks` to reconcile this thread's hourly task: `{"type":"interval","everyMs":3600000}`, prompt `Heartbeat sweep: use the heartbeat skill.` Update the existing task or create it with `schedule_task`.

Build the roster using `lage` step 1. Pin lane threads with `t3_thread_organize`, `action: "pin"`, so PR merges keep them in phaedrus's sidebar. Read `~/home/NOW.md`, Home's inbox and your previous sweep. Check lane status, pending requests and `t3_thread_read` activity tails. Expand truncated questions and read older history only to resolve outstanding asks, blockers or uncertain liveness.

- Relay answers already settled by policy or recorded decisions, with citations. Leave technical choices with the lane and tell it to continue unblocked work.
- For `BLOCKED-ALLOWED`, nudge the lane once to resolve its authorized blocker and continue. Put recurring blocks in the digest for Process.
- If a usage-limited lane is still failed after its reset has passed, or has no reset, report it once in the digest and suggest moving it to a provider with headroom.
- Leave progressing, held, finished and live-agent waits alone. Nudge an idle lane once when it has a named unblocked next step. For other failed or demonstrably lost runs, confirm no live agents remain and restart once with `t3_thread_send`, `mode: "restart"`, naming the last error or next step. A quiet timeline alone does not prove a stall. Digest repeated failures for Process.

## Digest

Use lane history, `~/.local/state/home/inbox.md` and `~/home/NOW.md` to avoid repeating nudges and unchanged reports. Include new recoveries, stuck work and unresolved principal decisions, regardless of lane status. Changed stakes, recommendations or deadlines are news.

Write every question in full with options, recommendation and consequence of waiting. Link every referenced PR, issue and thread with a one-line summary.

Post at most one digest per UTC sweep hour. Include `<!-- heartbeat: YYYY-MM-DDTHH -->` using that hour; check the inbox for it before posting or retrying. With no news, post nothing.

Deliver Markdown on stdin to `home post --from Heartbeat`. Never `t3_thread_send` to Home.

Reply here with actions and next run.
