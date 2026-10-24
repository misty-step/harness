---
name: heartbeat
description: Sweep lanes for stalls, dropped decisions, and failed native recovery. Use for /heartbeat or "Heartbeat sweep".
---

# Heartbeat

Follow global guidance's **Autonomy** section.

## Sweep

Read `~/home/AGENTS.md`. Exclude its out-of-scope work from the roster and every brief; name none of it here.

Resolve the established hourly task and its native `boundThreadId` under `lane-succession` **Dispatcher ownership**. Only that existing thread executes the sweep and succession effects. A different caller queues its request to that thread; unknown or duplicate ownership blocks effects. Preserve the existing task and binding; create no replacement schedule during discovery.

Build the discovery list using `lage` step 1. Act only on lanes in the installed roster (`lane-succession` **Scope**: `wipRoots`, draining lanes included) and their descendants, which reach a listed root by following `parentThreadId`. Discovery grants no authorization. If the roster check fails, report that once to Home and do no recovery: no nudges, restarts or succession requests. Pin roster lanes with `t3_thread_organize`, `action: "pin"`. Read `~/home/NOW.md`, both inbox stores under `lane-succession` **Inbox evidence**, and your previous sweep. Check lane status, pending requests and activity tails. Expand truncated questions; read older history to resolve asks, blockers or uncertain liveness.

- Relay policy or recorded answers with citations. Leave technical choices with the lane.
- For the latest failed run, read `t3_thread_read`, `view: "activity"`: an `error` titled "Usage limit reached" identifies a usage limit; reset text is in that run's notices. Leave recovery to T3. If no reset is advertised, or still failed next sweep after the advertised reset, report once to Process; suggest a provider with room, read live with `upkeep room`; a run's reset text is a dated reading, not a current one.
- An `error` reading "Insufficient context allowance for the provider handoff" means the lane can take no more turns; restarting fails the same way. For a roster lane, draining or not, run `lane-succession`'s reporter steps: write the handoff and request a successor from Home once, in a post of its own. Then consume that request through the dispatcher steps below.
- Consume exact `Lane succession requested: <id>` entries from both inbox stores for valid installed `wipRoots`. Run `lane-succession` **Dispatcher steps 0–4** yourself, one lane at a time in this bound native thread, with the newest handoff. The roster is Home's naming; ask for no fresh approval. Reconcile tracked partial dispatches first, including legacy Home attempts with known inactive prior runs, successors not yet listed, lost launch responses, and source/installed swaps awaiting readback. A claim or candidate means recover that successor, never launch another. Preserve all scope, route, duplicate, adoption and abandonment guards; parked, unnamed and child threads are forbidden. Report BLOCKED once or completion once to Home as that contract requires.
- Nudge a roster lane once to run `lane-succession` at its next boundary when the skill's **When** query shows any of its provider threads at 60% or more. First apply the skill's scope, successor and inbox duplicate checks; an existing request or unknown read means no repeated nudge or request. Child context failures stay with their parent, never a top-level replacement.
- For `BLOCKED-ALLOWED`, send Process the blocker and guard. Nudge the lane once to continue unblocked work, unless usage-limited. Route recurring blocks and tooling causes to Process.
- Leave usage-limited, progressing, held, finished and live-agent waits alone. Nudge an idle lane once for its named unblocked step. If liveness is uncertain, ask once for status. For other failed or demonstrably lost runs, confirm no live agents remain from lane reports and `t3_thread_list` with `includeSubagents: true`; T3 may omit native agents, so absence proves nothing. Restart once with `t3_thread_send`, `mode: "restart"`, naming the error or step.
- If a nudge, status request or restart leaves the stall unresolved next sweep, report it once to Process, then stop.

Send Process reports via `t3_thread_send` to the Process lane: the roster entry whose title starts with `Process`. To deliver to it, follow its title chain: while a title ends `(succeeded by <id>)`, send to `<id>` instead. Delivering a report grants no roster membership. With no Process entry, or an invalid roster, report to Home instead.

## Digest

Use lane and Process history, both inbox stores under `lane-succession` **Inbox evidence**, and `~/home/NOW.md` to dedupe nudges and unchanged reports. A failed primary or fallback read is unknown, not permission to repost. Bring Home blocked dispatches and genuine principal decisions. Changed stakes, recommendations or deadlines are news.

Write every question in full with options, recommendation and consequence of waiting. Link every referenced PR, issue and thread with a one-line summary.

Post at most one digest per UTC sweep hour. Include `<!-- heartbeat: YYYY-MM-DDTHH -->`; check the inbox before posting or retrying. With no news, post nothing.

Deliver Markdown on stdin to `home post --from Heartbeat`. Never `t3_thread_send` to Home.

Reply here with actions and next run.
