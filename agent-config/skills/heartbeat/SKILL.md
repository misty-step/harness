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
- An `error` reading "Insufficient context allowance for the provider handoff" means the lane can take no more turns; restarting fails the same way. Run `lane-succession`'s starter steps for it. `t3-pool` may have started a successor already; starter step 1 finds it.
- Check each successor `t3-pool` logged since your previous sweep (`~/.local/state/t3-pool/moves.jsonl`, `kind: "successor"`) against `lane-succession`'s **Continued** checks. Correct a successor once if any check fails. If a succession failed or has not continued by the next sweep, report it once to Process.
- Nudge a top-level lane once to hand off at its next boundary when `lane-succession`'s **When** query shows any of its provider threads at 60% or more.
- For `BLOCKED-ALLOWED`, send Process the blocker and guard. Nudge the lane once to continue unblocked work, unless usage-limited. Route recurring blocks and tooling causes to Process.
- Leave usage-limited, progressing, held, finished and live-agent waits alone. Nudge an idle lane once for its named unblocked step. If liveness is uncertain, ask once for status. For other failed or demonstrably lost runs, confirm no live agents remain from lane reports and `t3_thread_list` with `includeSubagents: true`; T3 may omit native agents, so absence proves nothing. Restart once with `t3_thread_send`, `mode: "restart"`, naming the error or step.
- If a nudge, status request or restart leaves the stall unresolved next sweep, report it once to Process, then stop.

Send Process reports via `t3_thread_send` to the Process lane. Find it as the newest unsettled top-level thread in the harness project whose title starts with `Process`. If there is none, use the thread `~/home/NOW.md` names for Process. Resolve any thread id you read from `NOW.md` through its title chain: while a title ends `(succeeded by <id>)`, follow to `<id>`.

## Digest

Use lane and Process history, `~/.local/state/home/inbox.md` and `~/home/NOW.md` to dedupe nudges and unchanged reports. Bring Home only genuine principal decisions. Changed stakes, recommendations or deadlines are news.

Write every question in full with options, recommendation and consequence of waiting. Link every referenced PR, issue and thread with a one-line summary.

Post at most one digest per UTC sweep hour. Include `<!-- heartbeat: YYYY-MM-DDTHH -->`; check the inbox before posting or retrying. With no news, post nothing.

Deliver Markdown on stdin to `home post --from Heartbeat`. Never `t3_thread_send` to Home.

Reply here with actions and next run.
