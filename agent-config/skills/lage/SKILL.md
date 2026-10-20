---
name: lage
description: Executive brief on every open lane, in-flight initiative and running agent, complete enough to decide from without opening anything. Use for /lage, "get me up to speed", "status on all lanes", or before choosing what to dispatch next.
---

# Lage

A **lage** is the situation report a principal reads before deciding. It covers every lane: what the lane is for, where it truly stands, and every decision only the principal can make. Each decision carries enough context to be made from the brief alone.

The whole run is read-only, and read-only work needs nobody's permission. Never message a lane, merge, re-run or start anything to make the brief better. The **requesting thread** asked for the brief, and the **previous lage** is the last brief it received, or 24 hours ago if there is none. A coordinator who must stay responsive (Home) hands this skill to one runner and relays its brief whole. A `delegate_task` child runs in your checkout and loads its `CLAUDE.md` and hooks, so when yours has either, launch the runner with `t3_thread_launch` and `scratch: true`. It has no parent link, so its launch message names the lage skill, your `threadId` as the requesting thread, and the previous lage's time, and says "send the brief there with `t3_thread_send`".

## 1. Roster

List every project (`t3_project_list`). For each project, pass its `projectId` and page each call to the end:

- `t3_thread_list` with `settled: false` and `includeSubagents: true`: open threads and their children.
- `t3_thread_list` with `settled: true`: newest-updated first, so stop at the first thread updated before the previous lage. Those whose `settledAt` is later become **Closed**.
- `list_scheduled_tasks`: each task's `boundThreadId`, `nextRunAt` and last run status.

A **lane** is a top-level thread doing initiative work. Not lanes:

- your own thread and the requesting thread;
- **standing threads** that coordinate rather than build: Home, and any thread a scheduled task is bound to, such as Heartbeat;
- **children** (`parentThreadId` set): hand each lane's children to its reader, and ignore those whose parent is settled. A child is **running** when its status is `queued`, `starting` or `running`, or it is a native subagent (`latestRunId: null`, which always reports `idle`) updated in the last 15 minutes;
- **scratch threads**, the other top-level threads in the scratch project (titled `No project`, `workspaceRoot` `~/.t3/scratch`): one-off tasks a coordinator launched, such as a lage runner. One that is `failed`, `interrupted` or `waiting` goes to **Stuck**, owned by the thread that launched it, or Heartbeat.

Done when every project was listed to its last page and every thread is placed as a lane, a closed lane, a child, or a standing or scratch thread.

## 2. Read each lane

For each lane, fill this record. Write `unknown: <why>` for any field you could not get.

- **Goal:** the lane's brief (its first message, `limit: 1`), in one line, plus its definition of done.
- **Last word:** the lane's latest assistant message, and the latest message to it: the newest `user_message` in the `messages` view, which includes sends from other threads. The tail rarely holds one, so page back until you find it.
- **Asks:** every question to the principal that nobody has answered yet, however old, each with its options, the lane's recommendation, what waiting costs, and any date. Keep each numbered sub-question with its recommended answer. Include `t3_pending_request_list`, any unresolved `BLOCKED-ALLOWED:` line, and any blocker you found that the lane never raised, marked "(found by lage)".
- **Progress:** the newest **side effect**, with its time. A side effect is a pushed commit, an opened or merged PR, a deploy, a published ticket, or a change applied on a host, such as a service or runner restarted. Prose about intent and uncommitted drafts are not progress.
- **PRs:** the state of every PR the lane names, read from the forge (`gh pr view <url> --json state,mergedAt,statusCheckRollup,reviewDecision`).
- **Agents:** the lane's running children and its project's scheduled tasks, as step 1 handed them over.

Read tails, not whole threads: `afterPosition` near `itemCount - 12`, `maxCharsPerItem` around 3000. When an ask or report is cut off, page the rest with `itemId` and `textOffset`. Page further back only when the tail doesn't say what the lane is waiting on.

Fan the reads out: one `delegate_task` child per four lanes or so, each briefed like this, returning only the records. While they run, read the coordinator's open-loops file yourself (Home's is `~/home/NOW.md`): an ask it already answers is a **dropped relay**, not a decision. Record it that way.

```
Read-only. Message no thread and start nothing. For each T3 lane below, read
~/.claude/skills/lage/SKILL.md step 2 and return one record with every field it
lists, or `unknown: <why>` for a field you could not get. Return only the records.
Lanes: <title, threadId, projectId, running children and scheduled tasks, one per line>
```

Done when every lane has a full record and every PR state came from the forge.

## 3. Classify

Give each lane exactly one state, the first row below that fits:

| State | Meaning |
| --- | --- |
| `waiting on you` | It holds an ask only the principal can answer: product intent, a destructive or irreversible act, a production write, or money. |
| `stuck` | It failed or was interrupted, or claims to be running with no side effect in 6 hours, or waits on something an agent could do. |
| `in review` | A PR is open and review, QA or the judge is running. |
| `building` | It had a side effect in the last 6 hours. |
| `scoping` | It is interviewing, specifying or ticketing, and has no code yet. |
| `shipped` | It merged or deployed since the previous lage. |
| `parked` | Deliberately on hold. |

Test asks a reader found like the lane's own. An ask about process or permission that standing policy already answers is not the principal's: move it to `stuck` and note "agent-answerable". Deploying merged code through the repository's own pipeline is shipping, not a production write. Use the exact progress claim the evidence supports: started, PR open, merged, artifact verified, or live behavior proven ([Foundations](https://foundations.mistystep.io/way-of-working)).

## 4. Write the brief

```
**Lage, <date> <local time>.** <N> decisions for you. <The single most important fact, one sentence.>

**Decisions**
1. **<Lane>: <the decision, worded so "yes" accepts your recommendation>** ([thread](t3-thread://v1/<id>))
   <Why it matters now.> Options: <A, and what it costs>; <B, and what it costs>.
   Recommend <X>, because <reason>. If unanswered: <what happens, and when>. Detail: <link>.
   <Bundles only: Q4 A, Q5 yes, …>

**Lanes**
| Lane | State | Last real progress | Next |
| --- | --- | --- | --- |
| [<title>](t3-thread://v1/<id>) | <state> | <side effect, how long ago> | <next step, and whose> |

**Also waiting on you** (blocks no lane, has no date)
- <ask, one line, with its link>

**Shipped and closed since last lage**
- <what changed for a user, with the PR or deploy link>
- Closed: <lane, and why it closed>

**Stuck** (agents fix these; no action for you)
- <lane or scratch thread>: <cause>. <Who unsticks it: the lane, Heartbeat, or the coordinator.>

**Running:** <N running children across M lanes; scratch threads; standing threads' last and next runs>. **Capacity:** <one line from `upkeep status`, if it runs>.
**Not checked:** <every source you could not read, and why>.
```

- **Decisions** holds at most five asks: those whose delay costs the most, because they block the most work or lapse first, in that order. Number them, so one reply like "1 yes, 2 B" answers the batch. Every other ask goes on one line under **Also waiting on you**, with its recommendation and link.
- A decision that bundles sub-questions spends its fifth line on each one's recommended answer, so "yes" approves only answers the brief shows. Move what overflows that line to **Also waiting on you** on the same terms: a line shows every answer its "yes" approves, or links the thread and recommends nothing.
- Every recommendation follows the standing autonomy policy and [Foundations](https://foundations.mistystep.io/way-of-working). When an option breaks either, say so inside that option, and recommend a compliant one.
- Where a decision rests on a story, spec or diff, give the one line that matters and link the rest. Link threads as `[title](t3-thread://v1/<id>)` and PRs by full URL. Call lanes, PRs and agents by names the principal knows. Label anything you did not verify: "(lane says)".
- The brief fits two phone screens: at most 60 lines and 3,500 visible characters, no line over 100 (link text counts, link targets don't). Keep each table row and **Stuck** item to one line and each cell under six words. When it runs over, shorten **Shipped**, then **Stuck**, then table cells, then each decision's why. Every lane keeps its row and every ask keeps its line. Drop empty sections, but keep **Not checked**.

Done when every lane appears in exactly one table row, every unanswered ask is a numbered decision, an **Also waiting on you** line, or a reclassification note, every decision has a compliant recommendation and an "if unanswered", and the brief fits two phone screens by the counts above.
