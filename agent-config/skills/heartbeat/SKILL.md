---
name: heartbeat
description: Sweep lanes for stalls, dropped decisions, and failed native recovery. Use for /heartbeat or "Heartbeat sweep".
---

# Heartbeat

Follow global guidance's **Autonomy** section.

## Sweep

Read `~/home/CLAUDE.md`. Exclude its out-of-scope work from the roster and every brief; name none of it here.

Use `list_scheduled_tasks` to reconcile this thread's hourly task: `{"type":"interval","everyMs":3600000}`, prompt `Heartbeat sweep: use the heartbeat skill.` Update the existing task or create it with `schedule_task`.

Build the roster using `lage` step 1. Pin lane threads with `t3_thread_organize`, `action: "pin"`. Read `~/home/NOW.md`, Home's inbox and your previous sweep. Check lane status, pending requests and activity tails. Expand truncated questions; read older history to resolve asks, blockers or uncertain liveness.

- Relay policy or recorded answers with citations. Leave technical choices with the lane.
- For the latest failed run, read `t3_thread_read`, `view: "activity"`: an `error` titled "Usage limit reached" identifies a usage limit; reset text is in that run's notices. Leave recovery to T3. If no reset is advertised, or still failed next sweep after the advertised reset, report once to Process; suggest a provider with headroom.
- For `BLOCKED-ALLOWED`, send Process the blocker and guard. Nudge the lane once to continue unblocked work, unless usage-limited. Route recurring blocks and tooling causes to Process.
- Leave usage-limited, progressing, held, finished and live-agent waits alone. Nudge an idle lane once for its named unblocked step. If liveness is uncertain, ask once for status. For other failed or demonstrably lost runs, confirm no live agents remain; restart once with `t3_thread_send`, `mode: "restart"`, naming the error or step.
- If a nudge, status request or restart leaves the stall unresolved next sweep, report it once to Process, then stop.

Send Process reports via `t3_thread_send` to `mcp:5fe1e302-5151-46ca-9c8a-e902e0ca1791`.

## Digest

Use lane and Process history, `~/.local/state/home/inbox.md` and `~/home/NOW.md` to dedupe nudges and unchanged reports. Bring Home only genuine principal decisions. Changed stakes, recommendations or deadlines are news.

Write every question in full with options, recommendation and consequence of waiting. Link every referenced PR, issue and thread with a one-line summary.

Post at most one digest per UTC sweep hour. Include `<!-- heartbeat: YYYY-MM-DDTHH -->`; check the inbox before posting or retrying. With no news, post nothing.

Deliver Markdown on stdin to `home post --from Heartbeat`. Never `t3_thread_send` to Home.

Reply here with actions and next run.
