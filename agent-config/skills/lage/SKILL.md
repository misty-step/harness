---
name: lage
description: Executive brief on every open lane, in-flight initiative and running agent, complete enough to decide from without opening anything. Use for /lage, "get me up to speed", "status on all lanes", or before choosing what to dispatch next.
---

# Lage

Read-only: never message a lane, merge, re-run or start work to improve the brief. The **requesting thread** asked for the brief, and the **previous lage** is the last brief it received, or 24 hours ago if there is none. A responsive coordinator (Home) delegates to one runner and relays its brief whole. When its checkout has `CLAUDE.md` or hooks, use `t3_thread_launch` with `scratch: true`. Name the lage skill, the requesting `threadId` and previous lage's time in the launch message; direct delivery there with `t3_thread_send`.

## 1. Roster

List every project (`t3_project_list`). For each project, pass its `projectId`:

- `t3_thread_list` with `settled: false` and `includeSubagents: true`: open threads and their children, to the last page.
- `t3_thread_list` with `settled: true`: newest-updated first, so stop at the first thread updated before the previous lage. Those whose `settledAt` is later become **Closed**.
- `list_scheduled_tasks`: each task's `boundThreadId`, `nextRunAt` and last run status.

A **lane** is a top-level thread doing initiative work. Not lanes:

- your own thread and the requesting thread;
- **standing threads** that coordinate rather than build: Home, and any thread a scheduled task is bound to, such as Heartbeat;
- **children** (`parentThreadId` set): hand lane children to their reader and standing-thread children to the coordinator. Ignore children of settled parents. A child is **running** when its status is `queued`, `starting` or `running`, or it is a native subagent (`latestRunId: null`, always `idle`) updated in the last 15 minutes whose delegated parent has not completed;
- **scratch threads**, the other top-level threads in the scratch project (titled `No project`, `workspaceRoot` `~/.t3/scratch`): one-off tasks a coordinator launched, such as a lage runner. One that is `failed`, `interrupted` or `waiting` goes to **Stuck**, owned by the thread that launched it, or Heartbeat. `cancelled` means the principal stopped it; omit it from **Stuck**.

Done when every project meets the open last-page and settled previous-lage cutoff bounds and every thread is placed as a lane, a closed lane, a child, or a standing or scratch thread.

## 2. Read each lane

For each open lane, fill this record; read closed lanes for unresolved asks too. Write `unknown: <why>` for any field you could not get.

- **Goal:** the lane's brief (its first message, `limit: 1`), in one line, plus its definition of done.
- **Last word:** the lane's latest assistant message, and the latest message to it: the newest `user_message` in the `messages` view, which includes sends from other threads. The tail rarely holds one, so page back until you find it.
- **Asks:** every question to the principal that nobody has answered yet, however old, each with its options, the lane's recommendation, what waiting costs, and any date. Keep each numbered sub-question with its recommended answer. Include `t3_pending_request_list`, any unresolved `BLOCKED-ALLOWED:` line, and any blocker you found that the lane never raised, marked "(found by lage)".
- **Progress:** the newest **side effect**, with its time. A side effect is a pushed commit, an opened or merged PR, a deploy, a published ticket, or a change applied on a host, such as a service or runner restarted. Prose about intent and uncommitted drafts are not progress.
- **PRs:** the state of every PR the lane names, read from the forge (`gh pr view <url> --json state,mergedAt,statusCheckRollup,reviewDecision`).
- **Agents:** the lane's running children and its project's scheduled tasks, as step 1 handed them over.

Read tails, not whole threads: `afterPosition` near `itemCount - 12`, `maxCharsPerItem` around 3000. When an ask or report is cut off, page the rest with `itemId` and `textOffset`. Page further back only when the tail doesn't say what the lane is waiting on.

Fan the reads out: one `delegate_task` child per four lanes or so, returning only records. While they run, read the coordinator's open-loops file yourself (Home's is `~/home/NOW.md`): an ask it already answers is a **dropped relay**, not a decision. Record it that way.

```
Read-only: follow ~/.claude/skills/lage/SKILL.md step 2; return its records.
Lanes: <title, threadId, projectId, running children and scheduled tasks, one per line>
```

Done when every open lane has a full record, closed-lane asks are captured, and every PR state came from the forge.

## 3. Classify

Give each lane the first row below that fits:

| State | Meaning |
| --- | --- |
| `waiting on you` | It holds an ask only the principal can answer: product intent, a destructive or irreversible act, a production write, or money. |
| `stuck` | It failed or was interrupted, or claims to be running with no side effect in 6 hours, or waits on something an agent could do. |
| `in review` | A PR is open and review, QA, the judge or requested human team review is pending. |
| `parked` | Deliberately on hold. |
| `shipped` | It merged or deployed since the previous lage, with no PR open and no builder running. |
| `building` | It has code or a PR open, a builder running, or a side effect in the last 6 hours. |
| `scoping` | It is interviewing, specifying or ticketing, and has no code yet. |

Test asks a reader found like the lane's own. An ask about process or permission that standing policy already answers is not the principal's: move it to `stuck` and note "agent-answerable". Deploying merged code through the repository's own pipeline is shipping, not a production write. Use the exact progress claim the evidence supports: started, PR open, merged, artifact verified, or live behavior proven ([Foundations](https://foundations.mistystep.io/way-of-working)).

Done when every lane has exactly one state; use `scoping` for any unmatched lane.

## 4. Write the brief

```
**Lage, <date> <local time>.** <N> decisions for you. <The single most important fact, one sentence.>

**Decisions**
1. **<Lane>: <the decision, worded so "yes" accepts your recommendation>** ([thread](t3-thread://v1/<id>))
   <Why it matters now.> Options: <A, and what it costs>; <B, and what it costs>.
   Recommend <X>, because <reason>. If unanswered: <what happens, and when>. Detail: <link>.
   <Bundles only: Q4 hosting: A; Q5 delete backup: no; …>

**Lanes**
| Lane | State | Last real progress | Next |
| --- | --- | --- | --- |
| [<title>](t3-thread://v1/<id>) | <state> | <side effect, how long ago> | <next step, and whose> |

**Also waiting on you**
- <ask, one line, with its link>

**Shipped and closed since last lage**
- <what changed for a user, with the PR or deploy link>
- Closed: <lane, and why it closed>

**Stuck** (agents fix these; no action for you)
- <lane or scratch thread>: <cause>. <Who unsticks it: the lane, Heartbeat, or the coordinator.>

**Running:** <N running children across M lanes; scratch threads; standing threads' last and next runs>. **Capacity:** <one line from `upkeep status`, if it runs>.
**Not checked:** <every source you could not read, and why>.
```

- **Decisions** holds at most five open-lane asks: those whose delay costs the most, because they block the most work or lapse first, in that order. Number them, so one reply like "1 yes, 2 B" answers the batch. Every other ask, including closed-lane asks, goes under **Also waiting on you**, one line with recommendation and link.
- Bundles use the fifth line: each sub-answer names its question in a few words and recommends an answer. Move overflow to **Also waiting on you** under the same line limits. A line shows every question and answer its "yes" approves, or links the thread without a recommendation.
- Every recommendation follows the standing autonomy policy and [Foundations](https://foundations.mistystep.io/way-of-working). When an option breaks either, say so inside that option, and recommend a compliant one.
- Where a decision rests on a story, spec or diff, give the one line that matters and link the rest. Link threads as `[title](t3-thread://v1/<id>)` and PRs by full URL. Call lanes, PRs and agents by names the principal knows. Label anything you did not verify: "(lane says)".
- The brief has at most 60 lines and 3,500 visible characters, no line over 100 (link text counts, link targets don't). Keep each table row and **Stuck** item to one line and each cell under six words. When it runs over, shorten **Shipped**, then **Stuck**, then table cells, then each decision's why. Every lane keeps its row and every ask keeps its line. Drop empty sections, but keep **Not checked**.

Done when every lane appears in exactly one table row, every unanswered ask is a numbered decision, an **Also waiting on you** line, or a reclassification note, every decision has a compliant recommendation and an "if unanswered", and the brief meets the counts above.
