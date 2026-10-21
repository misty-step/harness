---
name: lane-succession
description: Move a top-level lane to a fresh successor thread that starts from a compact handoff. Use in a top-level lane thread whose T3 context passes 60% of its window or that has auto-compacted, when a lane's run fails with "Insufficient context allowance for the provider handoff", or when your first message begins "Lane succession:".
---

# Lane succession

T3 replays a thread's history whenever the thread changes account or provider. If the account it moves to already holds a near-full transcript of the thread, T3 fails the run with "Insufficient context allowance for the provider handoff", and every later turn fails the same way. Succession moves the lane to a new thread that starts from a compact handoff instead of the transcript.

Three roles take part. The **predecessor** is the old thread. The **starter** launches the successor: either the predecessor itself, or Heartbeat or `t3-pool` for a predecessor that can no longer take turns. The **successor** is the new thread.

## Scope

Succession applies only to top-level lane threads: `parentThreadId` is null in `t3_thread_read`, and the thread is not Home, Heartbeat or a one-off in the scratch project (`No project`). A delegated child, such as a builder, QA, reviewer or judge, never hands off, because its result reaches its parent only from its own thread. A child whose context is heavy finishes its task and reports; its parent dispatches the rest.

## When

At each natural boundary, such as a PR opened or merged, a ticket finished or a dispatch returned, read your thread's context usage. Your threadId is `currentThreadId` in `t3_thread_list`.

```sh
sqlite3 -readonly "${T3CODE_HOME:-$HOME/.t3}/userdata/statev2.sqlite" "SELECT provider_instance_id,
  json_extract(payload_json, '$.contextUsage.usedTokens') AS used, json_extract(payload_json, '$.contextUsage.maxTokens') AS max,
  ROUND(100.0 * json_extract(payload_json, '$.contextUsage.usedTokens') / json_extract(payload_json, '$.contextUsage.maxTokens')) AS pct
  FROM orchestration_v2_projection_provider_threads WHERE thread_id = '<threadId>'"
```

Hand off when any row reaches 60%, or after your first auto-compaction, whichever comes first. Every row counts, including accounts the lane has left. Compaction shrinks only the current conversation, and a later switch back resumes the old one at its high-water mark.

T3 refuses a switch once `used` exceeds `max − max(16k, max/4)` minus the handoff itself, about 73% of a 1M window. The dead Process lane held 934,205 of 1,000,000. Handing off at 60% leaves room to reach the boundary. Heartbeat nudges lanes past 60%.

## Contract

Scripts depend on this contract. Change it only together with its consumers: Heartbeat, and `t3-pool` ([#415](https://github.com/misty-step/harness/issues/415)).

**Handoff file:** `~/.local/state/t3-handoffs/<predecessor threadId>-<UTC>.md`, where `<UTC>` is `date -u +%Y%m%dT%H%M%SZ`. If a predecessor has several handoff files, the newest is current. The file opens with `# Handoff: <title>` and a `Predecessor: <threadId>` line, followed by these `##` sections in this order:

- `Charter`: the lane's standing brief. Copy it verbatim when it is short. Otherwise give its rules plus a pointer to the predecessor's first message.
- `State`: what is done, what is in flight, and the next step.
- `Open`: blockers, and questions waiting on phaedrus, with where each was asked.
- `Live work`: running delegated tasks (`taskId`, `childThreadId`), PRs the lane links or watches, and scheduled tasks bound to the predecessor (`list_scheduled_tasks`, `boundThreadId`).
- `Suggested skills`: the skills the successor should load.

Link PRs, issues, stories and paths rather than copying them. Name secrets by pass entry or variable, never by value. A handoff is complete when a cold agent could take the next step from it alone.

**Launch:** the starter calls `t3_thread_launch` with these settings, all taken from the predecessor's `t3_thread_read` and `t3_thread_configuration`:

- `title` and `projectId` as the predecessor has them.
- `workspaceStrategy`: `{type: "existing_worktree", worktreePath, branch}`, or `{type: "root"}` when `worktreePath` is null.
- `runtimeMode` and `interactionMode` as the predecessor has them, always.
- `modelSelection` as the predecessor has it, or an account or provider with room. A move across providers maps the model and keeps its effort: GPT-6.1 Sol at `reasoningEffort` X becomes Opus 5.5 at `effort` X, and the reverse. Provider-only options, such as `fastMode` and `serviceTier`, are dropped.

**First message:** the starter sends this text verbatim, filling in only `<predecessor threadId>`. A script can send it without a model:

```
Lane succession: you succeed T3 thread <predecessor threadId>. Use the lane-succession skill's successor steps: read that thread with t3_thread_read, write its handoff under ~/.local/state/t3-handoffs/ unless one is attached below, then continue the lane's work.
```

A predecessor that has written its own handoff appends `Handoff: <path>`, a blank line and the file's full text after that paragraph. A script starter may settle the predecessor and post the move to Home itself. The successor then skips whatever is already done.

**Continued:** a succession has continued when all four checks hold.

1. The predecessor's title ends `(succeeded by <successor threadId>)`.
2. The successor's latest run is not `failed`.
3. `home inbox --all` has an entry naming the successor's threadId.
4. The successor's messages name the handoff's next step, and either start on it or report a hold that its charter sets.

A script starter checks 1 and 2, records the launch and stops. Heartbeat's next sweep checks the rest.

## Predecessor steps

Run these in your own lane when **When** fires. Pick a moment when no delegated task is running, because a child delivers its result only to the thread that started it. If a task cannot wait, list it under `Live work`.

1. Write the handoff to the contract path.
2. Launch the successor with the contract's settings and the first message, with your handoff attached. Keep the returned `threadId`. After an error or a lost response, check `t3_thread_list` before you retry.
3. Run `t3_thread_wait` on the successor, then apply the **Continued** checks. If any fails, send one correction with `t3_thread_send` naming the missing steps. Then settle yourself with `t3_thread_organize`, which takes effect when your turn ends, and take no further work.

## Starter steps for a stuck lane

Heartbeat runs these for a top-level lane whose latest failed run carries the error above. `t3-pool` runs the same steps as a script.

1. **Follow the chain.** While the thread's title ends `(succeeded by <id>)`, move to `<id>`. If the chain ends at a different thread, that thread is now the lane, so judge it instead. Skip the lane if its project has a thread with the same title created after the failure, because another starter got there first. If the failed thread is itself a successor (its first user message begins `Lane succession:`) and it has not claimed its predecessor, the succession has failed. Report that once to Process and start no further successor for the lane.
2. **Launch** the successor with the contract's settings and the bare first message. The successor builds the handoff itself.
3. **Confirm** with the **Continued** checks. If any fails, send one correction. If the succession still has not continued by the next sweep, report it once to Process.

## Successor steps

Steps 1 and 3 to 5 apply even when a handoff is attached.

1. **Claim.** Rename the predecessor to `<title> (succeeded by <your threadId>)` with `t3_thread_update`.
2. **Handoff.** If your first message includes one, use it. Otherwise build it. Read the predecessor's metadata with `t3_thread_read`, and its charter from its first user message. Read its recent activity with `view: "activity"`, starting `afterPosition` about 60 items before `itemCount`, and page back further until `State` is certain. Write the handoff to the contract path.
3. **Adopt the live work.** Call `update_scheduled_task` with `bindToCurrentThread: true` for each scheduled task listed. Call `link_pull_request` and `watch_pull_request` for each PR. Read each running child's `childThreadId` with `t3_thread_read`.
4. **Move the pointers.** Pin yourself and unpin the predecessor with `t3_thread_organize`. Settle the predecessor unless it is already settled or still running; a live predecessor settles itself. If `home inbox --all` does not yet name your threadId, post via `home post --from <lane>` that the lane moved. Link both threads, name the handoff path, and ask Home to update `~/home/NOW.md`.
5. **Check before working.** Confirm that the predecessor's title carries your claim, that `home inbox --all` names your threadId, and that each pin, unpin and settle call in step 4 succeeded. Redo any step that is missing.
6. **Continue.** State the next step from `State`, then do it.
