---
name: lane-succession
description: Replace a roster lane with a fresh successor thread that starts from a compact handoff, dispatched by Home. Use in a roster lane (`wipRoots` in t3-pool.json) whose T3 context passes 60% of its window or that has auto-compacted, when a lane's run fails with "Insufficient context allowance for the provider handoff", when Home dispatches a successor, or when your first message begins "Lane succession:".
---

# Lane succession

T3 replays a thread's history whenever the thread changes account or provider. If the account it moves to already holds a near-full transcript of the thread, T3 fails the run with "Insufficient context allowance for the provider handoff", and every later turn fails the same way. Succession replaces the lane's thread with a new one that starts from a compact handoff instead of the transcript.

Only Home opens threads (global guidance, Autonomy, **Work in progress**). Four roles take part:

- The **predecessor** is the old thread.
- A **reporter** prepares the handoff and asks Home for a successor. This is the predecessor itself, or Heartbeat or `t3-pool` when the predecessor can no longer take turns. Reporters never launch a thread.
- The **dispatcher** launches the successor. This is always Home.
- The **successor** is the new thread.

A successor takes its predecessor's place on the roster, so succession never adds a lane.

## Scope

Succession applies only to lanes on the **roster**: the top-level thread IDs in `wipRoots` of the installed `${XDG_CONFIG_HOME:-$HOME/.config}/t3-pool.json`. Home names its lanes there, including lanes it is draining, and maintains the list in harness `agent-config/t3-pool/pools.json`. `t3-pool` reads the same file. Check the roster before you act:

```sh
roster="${XDG_CONFIG_HOME:-$HOME/.config}/t3-pool.json"
jq -e '.wipRoots | type == "array" and all(.[]; type == "string" and test("\\S")) and length == (unique | length)' "$roster" >/dev/null &&
  jq -r '.wipRoots[]' "$roster"
```

The roster is invalid if the check fails: the file or key is missing, the JSON is malformed, or an ID is blank or duplicated. Then report that once to Home and request no succession. `[]` is valid and names no lanes. Only the roster grants membership. Open threads, `NOW.md`, titles and lineage never do.

Home, Heartbeat and scratch one-offs are never roster lanes. A delegated child, such as a builder, QA, reviewer or judge, never becomes a top-level replacement, even if a reporter emits the succession marker for it or its ID is accidentally listed in `wipRoots`. Its result reaches its parent only from its own thread. A child whose context is heavy finishes its task and reports; its parent dispatches the rest under that lane.

## When

At each natural boundary, such as a PR opened or merged, a ticket finished or a dispatch returned, read your thread's context usage. Your threadId is `currentThreadId` in `t3_thread_list`.

```sh
sqlite3 -readonly "${T3CODE_HOME:-$HOME/.t3}/userdata/statev2.sqlite" "SELECT provider_instance_id,
  json_extract(payload_json, '$.contextUsage.usedTokens') AS used, json_extract(payload_json, '$.contextUsage.maxTokens') AS max,
  ROUND(100.0 * json_extract(payload_json, '$.contextUsage.usedTokens') / json_extract(payload_json, '$.contextUsage.maxTokens')) AS pct
  FROM orchestration_v2_projection_provider_threads WHERE thread_id = '<threadId>'"
```

Ask for a successor when any row reaches 60%, or after your first auto-compaction, whichever comes first. Every row counts, including accounts the lane has left. Compaction shrinks only the current conversation, and a later switch back resumes the old one at its high-water mark.

T3 refuses a switch once `used` exceeds `max − max(16k, max/4)` minus the handoff itself, about 73% of a 1M window. The dead Process lane held 934,205 of 1,000,000. Asking at 60% leaves room to work until Home dispatches. Heartbeat nudges lanes past 60%.

## Contract

Home may run the launch from a script, and `t3-pool` posts requests as one. Every launcher applies the dispatcher checks below. Change this contract only together with its consumers: Home, Heartbeat, and `t3-pool` ([#415](https://github.com/misty-step/harness/issues/415)).

**Handoff file:** `~/.local/state/t3-handoffs/<predecessor threadId>-<UTC>.md`, where `<UTC>` is `date -u +%Y%m%dT%H%M%SZ`. If a predecessor has several handoff files, the newest is current. The file opens with `# Handoff: <title>`, a `Predecessor: <threadId>` line, and this line verbatim: `Successor: before the work, run lane-succession successor steps 1 and 3 to 5: claim, adopt the live work, move the pointers, check.` These `##` sections follow, in this order:

- `Charter`: the lane's standing brief. Copy it verbatim when it is short. Otherwise give its rules plus a pointer to the predecessor's first message.
- `State`: what is done, what is in flight, and the next step.
- `Open`: blockers, and questions waiting on phaedrus, with where each was asked.
- `Live work`: running delegated tasks (`taskId`, `childThreadId`), PRs the lane links or watches, and scheduled tasks bound to the predecessor (`list_scheduled_tasks`, `boundThreadId`).
- `Suggested skills`: the skills the successor should load.

Link PRs, issues, stories and paths rather than copying them. Name secrets by pass entry or variable, never by value. A handoff is complete when a cold agent could take the next step from it alone.

**Request:** a reporter posts once via `home post --from <lane or reporter>`. The post opens with `Lane succession requested: <predecessor threadId>`. It then gives the lane's title, the reason (context at N% on an instance, auto-compaction, or the handoff error), and the handoff path. A script reporter that cannot write a handoff says `Handoff: none`; the successor then builds it.

**Launch:** the dispatcher calls `t3_thread_launch` with these settings, all taken from the predecessor's `t3_thread_read` and `t3_thread_configuration`:

- `title` and `projectId` as the predecessor has them.
- `workspaceStrategy`: `{type: "existing_worktree", worktreePath, branch}`, or `{type: "root"}` when `worktreePath` is null.
- `runtimeMode` and `interactionMode` as the predecessor has them, always.
- `modelSelection` as the predecessor has it, or an account or provider with room. Across providers, map GPT-6.1 Sol `reasoningEffort` to Opus 5.5 `effort`, and the reverse, only for `low`, `medium`, `high` and `xhigh`, preserving the exact value and confirming it in the live target catalog. With missing effort or any other value (including `max`, `ultra`, `ultracode` and `ultrathink`), refuse the cross-provider move and retain the provider; never silently downgrade. Supply only the mapped effort to the other provider, stripping provider-only options including `fastMode` and `serviceTier`. Same-provider moves preserve model and options.

**First message:** the dispatcher sends this text verbatim, filling in only `<predecessor threadId>`. A script can send it without a model:

```
Lane succession: you succeed T3 thread <predecessor threadId>. Use the lane-succession skill's successor steps: validate Home's authorization and the roster, abort if another successor has claimed, read that thread with t3_thread_read, write its handoff under ~/.local/state/t3-handoffs/ unless one is attached below. Wait for Home's installed roster readback before adopting live work or continuing.
```

When a current handoff file exists, the dispatcher appends `Handoff: <path>`, a blank line and the file's full text after that paragraph.

**Inbox evidence:** read both `home inbox --all` (the routed primary) and `~/.local/state/home/inbox.md` on the lane's host (the fallback), recording each command's exit status and the matching entry. A confirmed absent fallback file is empty; an unreadable file, SSH failure or failed primary read is **unknown**, never absence. Check exact predecessor request markers in both stores before any request, including a predecessor's own request. If either read is unknown, post no duplicate request and report the blocked read in the lane. A fallback entry is dedupe evidence but is not proof Home received it. Home must read that entry through a validated host route or acknowledge its contents in the primary before it counts as delivery. Until then, report the delivery blocker in the lane; do not repeatedly append the same post. This uses the existing fallback; transport repair belongs to [#418](https://github.com/misty-step/harness/issues/418).

**Continued:** a succession has continued when all five checks hold.

1. The predecessor's title ends `(succeeded by <successor threadId>)`.
2. The successor's latest run is not `failed`.
3. Both inbox stores were read successfully under **Inbox evidence**, and an entry naming the successor's threadId was delivered to Home through the primary or a validated fallback read.
4. Home observed the roster replacement in both maintained source and a fresh installed readback: the valid `wipRoots` contains the successor exactly once, omits the predecessor, and preserves every other ID. A message saying the swap was done is insufficient.
5. The successor's messages name the handoff's next step, and either start on it after authorization or report a hold that its charter sets.

Heartbeat's next sweep reads these checks too. Report failed, stalled or unlisted successors once to Home, the sole dispatcher; copy Process only for recurring diagnostics. A working successor with the predecessor still listed fails check 4.

## Predecessor steps

Run these in your own lane when **When** fires and your threadId is on the roster. Pick a moment when no delegated task is running, because a child delivers its result only to the thread that started it. If a task cannot wait, list it under `Live work`.

1. Write the handoff to the contract path.
2. Apply **Inbox evidence**, then post the contract's request to Home only if no request or successor exists. Unknown means wait for a readable route, taking no new work.
3. Take no new work. If something changes before Home dispatches, write a fresh handoff file; the newest is current. Once your title ends `(succeeded by …)`, settle yourself with `t3_thread_organize`.

## Reporter steps for a stuck lane

Heartbeat runs these for a roster lane, draining or not, whose latest failed run carries the error above. `t3-pool` posts its own request as a script, without a handoff.

1. **Check scope and duplicates.** Freshly validate the installed roster and read the predecessor: require its exact ID in `wipRoots` and `parentThreadId: null`. A descendant belongs to its parent's recovery, never top-level succession. Skip if its title ends `(succeeded by <id>)`, or a fully paginated project list (including settled threads and subagents) contains a first message opening `Lane succession: you succeed T3 thread <its threadId>.`. A later same-title thread also requires reconciliation. Apply **Inbox evidence**; an existing request means no new request, and an unknown read means stop. If the successor failed or has not claimed by your next sweep, report once to Home and request nothing more; Process may receive recurring diagnostics.
2. **Write the handoff** from the predecessor's history, as in successor step 2.
3. **Request** a successor from Home once, with the handoff path.

## Dispatcher steps

Home runs these serially: one Home dispatch at a time, including scripts, with no concurrent launch between the fresh checks and roster readback. Reporters only request. An interrupted or uncertain dispatch is reconciled before another begins.

0. **Reach the lane's environment.** Local MCP tools address only their own server. From cloud Home, use a validated remote route to the predecessor's environment for every T3 call, and a validated filesystem route to its handoff, installed roster and maintained source. Read environment identity, the exact predecessor and configuration, project/worktree inventory and both inbox stores. Record these receipts with the request. If any required route is missing or unreadable, mark dispatch BLOCKED and launch nothing; a reachable cloud inbox alone is insufficient. See [the route receipts and remaining prerequisite](https://github.com/misty-step/harness/blob/process/lane-succession/docs/evidence/verify-harness/2026-10-21-lane-succession-review/route.md).
1. **Authorize freshly before launch.** Re-read and validate the installed `wipRoots`; require the predecessor's exact ID, `parentThreadId: null`, and a currently Home-named active or draining lane under **Work in progress**. Reject children even if listed, and parked, backlogged, superseded, settled or unnamed predecessors. A request marker grants no authority. Re-read the title and fully paginate `t3_thread_list` for that project, including settled threads and subagents; read their first messages. If any claim `(succeeded by …)`, matching first-message marker, or unresolved same-title candidate exists, reconcile that successor and launch nothing. Failed or partial reads are unknown: stop, not retry. A repeated request attaches to the existing dispatch. Reply through Home's report path with its successor or blocker.
2. **Launch once.** Use the contract's settings and first message; attach the current handoff if one exists. Keep the returned `threadId` with the predecessor/request. After an error or a lost response, perform step 1's complete reconciliation before considering a retry; if absence cannot be established, keep the dispatch blocked. The first message authorizes only validation, claim and handoff preparation, not task adoption or lane work.
3. **Authorize the replacement.** Observe the successor's claim and readiness, then replace the predecessor's exact ID with the successor's in maintained `agent-config/t3-pool/pools.json`, deploy through its native installer, and re-read the installed config. Require **Continued** check 4 before telling the successor it may adopt work. Keep the returned ID tracked until that readback succeeds, even though it is not listed yet. If preparation, claim or deployment fails, report to Home and retain this pending dispatch for recovery; reconcile or correct the same successor, never launch an untracked replacement. If abandoning it, stop/settle it first, restore the predecessor in source and installed roster if needed, verify readback, then explicitly reopen the request. Never revive a parked lane.
4. **Confirm.** Apply all **Continued** checks, correcting missing steps once with `t3_thread_send`. Failure goes to Home for recovery, not solely Process. Keep the dispatch open until completion or the explicit recovery above; do not call it Continued while the swap or delivery remains unobserved.

## Successor steps

Steps 1 and 3 to 5 apply even when a handoff is attached.

1. **Validate and claim before effects.** Read Home's dispatch authorization, the valid installed roster and the predecessor freshly. Require a top-level predecessor (`parentThreadId: null`) whose exact ID is listed, or whose ID Home has already replaced with yours with readback. Require your own `parentThreadId: null` and the matching first-message marker. If the title ends `(succeeded by <other id>)`, abort and report to Home before task adoption, watch transfer, pointer moves or continuation; never overwrite another claim. A claim for your own ID is an idempotent retry. Otherwise require that the predecessor is still Home-named and unclaimed, then rename it to `<title> (succeeded by <your threadId>)` with `t3_thread_update` and read back your claim. A missing authorization, unknown read or duplicate successor blocks work. Home's serialized dispatch prevents competing claim writes.
2. **Handoff.** If your first message includes one, use it, then read the predecessor's activity after the handoff's timestamp for anything newer. Otherwise build it. Read the predecessor's metadata with `t3_thread_read`, and its charter from its first user message. Read its recent activity with `view: "activity"`, starting `afterPosition` about 60 items before `itemCount`, and page back further until `State` is certain. Write the handoff to the contract path.
3. **Wait for authorization, then adopt live work.** Require Home's installed roster readback in **Continued** check 4 and re-read your claim before any adoption. Until then, report readiness and wait; failure remains Home's tracked pending dispatch. Call `update_scheduled_task` with `bindToCurrentThread: true` for each scheduled task listed. Call `link_pull_request` and `watch_pull_request` for each PR. Read each running child's `childThreadId` with `t3_thread_read`.
4. **Move the pointers.** Pin yourself and unpin the predecessor with `t3_thread_organize`. Settle the predecessor unless it is already settled or still running; a running predecessor settles itself once it sees your claim. Apply **Inbox evidence** before posting via `home post --from <lane>` that the lane moved. Link both threads, name the handoff path and roster readback, and ask Home to update `~/home/NOW.md`. If the post fell back, report the delivery blocker here and wait for Home's validated read; never reappend on every self-check.
5. **Check before working.** Confirm your claim, Home's observed source/installed roster replacement, delivered inbox evidence and each pin, unpin and settle result. Correct a missing step only after checking its actual state. Unknown evidence blocks work and goes to Home; an existing fallback entry is not a reason to repost.
6. **Continue.** State the next step from `State`, then do it.
