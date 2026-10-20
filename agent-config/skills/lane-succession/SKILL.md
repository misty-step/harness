---
name: lane-succession
description: Move a lane to a fresh successor thread that starts from a compact handoff. Use after a lane's first auto-compaction, when a run fails with "Insufficient context allowance for the provider handoff", or when your first message begins "Lane succession:".
---

# Lane succession

T3 replays a thread's history whenever the thread changes account or provider. If the account it moves to already holds a near-full transcript of the thread, T3 fails the run with "Insufficient context allowance for the provider handoff", and every later turn fails the same way. Succession moves the lane to a new thread that starts from a compact handoff instead of the transcript.

Three roles take part. The **predecessor** is the old thread. The **starter** launches the successor: either the predecessor itself, or Heartbeat or `t3-pool` for a predecessor that can no longer take turns. The **successor** is the new thread.

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
- `modelSelection`, `runtimeMode` and `interactionMode` as the predecessor has them. If the predecessor's account is usage-limited, the starter may change `instanceId` to an account with room.

**First message:** the starter sends this text verbatim, filling in only `<predecessor threadId>`. A script can send it without a model:

```
Lane succession: you succeed T3 thread <predecessor threadId>. Use the lane-succession skill's successor steps: read that thread with t3_thread_read, write its handoff under ~/.local/state/t3-handoffs/ unless one is attached below, then continue the lane's work.
```

A predecessor that has written its own handoff appends `Handoff: <path>`, a blank line and the file's full text after that paragraph.

## Predecessor steps

Run these in your own lane after your first auto-compaction, at the next natural boundary: a PR opened or merged, a ticket finished, or a dispatch returned. Pick a moment when no delegated task is running, because a child delivers its result only to the thread that started it. If a task cannot wait, list it under `Live work`.

1. Write the handoff to the contract path.
2. Launch the successor with the contract's settings and the first message, with your handoff attached. Keep the returned `threadId`. After an error or a lost response, check `t3_thread_list` before you retry.
3. Run `t3_thread_wait` on the successor, then read its messages. It has continued when it names the handoff's next step and starts on it. If it has not, send one correction with `t3_thread_send`. Then end your turn and take no further work.

## Starter steps for a stuck lane

Heartbeat runs these when a lane's latest failed run carries the error above.

1. Skip the lane if its title already ends `(succeeded by …)`, or if its project has a thread with the same title created after the failure. Another starter got there first.
2. Launch the successor with the contract's settings and the bare first message. The successor builds the handoff itself.
3. Confirm it continues, as in predecessor step 3.

## Successor steps

1. **Claim.** Rename the predecessor to `<title> (succeeded by <your threadId>)` with `t3_thread_update`. Your threadId is `currentThreadId` in `t3_thread_list`.
2. **Handoff.** If your first message includes one, use it. Otherwise build it. Read the predecessor's metadata with `t3_thread_read` and its charter from its first user message. Read its recent activity with `view: "activity"`, starting `afterPosition` about 60 items before `itemCount`, and page back further until `State` is certain. Write the handoff to the contract path.
3. **Adopt the live work.** Call `update_scheduled_task` with `bindToCurrentThread: true` for each scheduled task listed. Call `link_pull_request` and `watch_pull_request` for each PR. Read each running child's `childThreadId` with `t3_thread_read`.
4. **Move the pointers.** Pin yourself and unpin the predecessor with `t3_thread_organize`, then settle the predecessor. Post via `home post --from <lane>` that the lane moved: link both threads, name the handoff path, and ask Home to update `~/home/NOW.md`.
5. **Continue.** State the next step from `State`, then do it.
