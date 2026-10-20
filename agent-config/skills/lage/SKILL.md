---
name: lage
description: Executive brief on every open lane, in-flight initiative and running agent, complete enough to decide from without opening anything. Use for /lage, "get me up to speed", "status on all lanes", or before choosing what to dispatch next.
---

# Lage

A **lage** is the situation report a principal reads before deciding. It covers every lane: what the lane is for, where it truly stands, and every decision only the principal can make. Each decision carries enough context to be made from the brief alone.

The whole run is read-only, and read-only work needs nobody's permission. Never message a lane, merge, re-run or start anything to make the brief better. If you are a coordinator who must stay responsive (Home), hand this skill to one agent and relay its brief whole when it lands. A `delegate_task` child runs in your checkout and loads its `CLAUDE.md` and hooks, so when yours has either, launch the agent with `t3_thread_launch` and `scratch: true`, and have it send the brief back to your thread. The agent that runs the skill does the reading.

## 1. Roster

List every project (`t3_project_list`), then every thread in each (`t3_thread_list` with that `projectId`, `settled: false`, paged to the end). A **lane** is a top-level thread doing initiative work. Not lanes:

- your own thread;
- **standing threads** that coordinate rather than build, such as Home and Heartbeat: report each one's last run and next scheduled run on the **Running** line;
- subagent threads (`parentThreadId` set): count them under their parent, and ignore those whose parent is settled;
- threads with no project (T3's scratch project): one-off tasks a coordinator launched, such as this brief's own runner, or standing threads. Report them on the **Running** line.

Also list threads settled since the previous lage. That is the last lage in the requesting thread, or 24 hours if there is none. These become **Closed**.

Done when every project was listed to its last page and every thread is placed as a lane, a closed lane, or a child.

## 2. Read each lane

For each lane, fill this record. Write `unknown: <why>` for any field you could not get. Never leave a field blank.

- **Goal:** the lane's brief (its first message, `limit: 1`), in one line, plus its definition of done.
- **Last word:** the lane's latest assistant message, and the latest message to it.
- **Asks:** every question to the principal that nobody has answered yet, however old, each with its options, the lane's recommendation, what waiting costs, and any date. Include `t3_pending_request_list` and any unresolved `BLOCKED-ALLOWED:` line.
- **Progress:** the newest **side effect**, with its time. A side effect is a pushed commit, an opened or merged PR, a deploy, a published ticket, or a change applied on a host, such as a service or runner restarted. Prose about intent and uncommitted drafts are not progress.
- **PRs:** the state of every PR the lane names, read from the forge (`gh pr view <url> --json state,mergedAt,statusCheckRollup,reviewDecision`). The lane's claim is a claim; the forge is the fact.
- **Agents:** running children (`t3_thread_list` with `includeSubagents: true`, where `parentThreadId` is this lane) and the scheduled tasks in the lane's project (`list_scheduled_tasks` with its `projectId`).

Read tails, not whole threads: `afterPosition` near `itemCount - 12`, `maxCharsPerItem` around 3000. When an ask or report is cut off, page the rest with `itemId` and `textOffset`. Page further back only when the tail doesn't say what the lane is waiting on.

Fan the reads out: one `delegate_task` child per four lanes or so, each briefed like this, returning only the records. While they run, read the coordinator's open-loops file yourself (Home's is `~/home/NOW.md`).

```
Read-only. Message no thread and start nothing. For each T3 lane below, read
~/.claude/skills/lage/SKILL.md step 2 and return one record with every field it
lists, or `unknown: <why>` for a field you could not get. Return only the records.
Lanes: <title, threadId and projectId, one per line>
```

An ask the coordinator's file already answers is a **dropped relay**, not a decision. Record it that way.

Done when every lane has a full record and every PR state came from the forge.

## 3. Classify

Give each lane exactly one state:

| State | Meaning |
| --- | --- |
| `waiting on you` | It holds an ask only the principal can answer: product intent, a destructive or irreversible act, a production write, or money. |
| `stuck` | It failed or was interrupted, or claims to be running with no side effect in 6 hours, or waits on something an agent could do. |
| `in review` | A PR is open and review, QA or the judge is running. |
| `building` | It had a side effect in the last 6 hours. |
| `scoping` | It is interviewing, specifying or ticketing, and has no code yet. |
| `shipped` | It merged or deployed since the previous lage. |
| `parked` | Deliberately on hold. |

An ask about process or permission that standing policy already answers is not the principal's. Move it to `stuck` and note "agent-answerable". Deploying merged code through the repository's own pipeline is shipping, not a production write. Use the exact progress claim the evidence supports: started, PR open, merged, artifact verified, or live behavior proven ([Foundations](https://foundations.mistystep.io/way-of-working)). Never make anything look further along than it is.

## 4. Write the brief

```
**Lage, <date> <local time>.** <N> decisions for you. <The single most important fact, one sentence.>

**Decisions**
1. **<Lane>: <the decision, worded so "yes" accepts your recommendation>** ([thread](t3-thread://v1/<id>))
   <Why it matters now.> Options: <A, and what it costs>; <B, and what it costs>.
   Recommend <X>, because <reason>. If unanswered: <what happens, and when>. Detail: <link>.

**Lanes**
| Lane | For | State | Last real progress | Next |
| --- | --- | --- | --- | --- |
| [<title>](t3-thread://v1/<id>) | <goal, under 8 words> | <state> | <side effect, how long ago> | <next step, and whose> |

**Also waiting on you** (blocks no lane, has no date)
- <ask, one line, with its link>

**Shipped and closed since last lage**
- <what changed for a user, with the PR or deploy link>
- Closed: <lane, and why it closed>

**Stuck** (agents fix these; no action for you)
- <lane>: <cause>. <Who unsticks it: the lane, Heartbeat, or the coordinator.>

**Running:** <N agents across M lanes; anything running past its expected time>. **Capacity:** <one line from `upkeep status`, if it runs>.
**Not checked:** <every source you could not read, and why>.
```

- **Decisions** holds at most five asks: those whose delay costs the most, because they block the most work or lapse first, in that order. Number them, so one reply like "1 yes, 2 B" answers the batch. Every other ask goes on one line under **Also waiting on you**, with its recommendation and link.
- Every recommendation follows the standing autonomy policy and [Foundations](https://foundations.mistystep.io/way-of-working). When an option breaks either, say so inside that option, and recommend a compliant one.
- Make each decision self-contained. Where it rests on a story, spec or diff, give the one line that matters and link the rest.
- Link threads as `[title](t3-thread://v1/<id>)` and PRs by full URL. Call lanes, PRs and agents by names the principal knows.
- Label anything you did not verify: "(lane says)". Write plain, short sentences that read on a phone.
- The whole brief fits two phone screens, about 60 lines. Keep each decision to four lines, each table row and **Stuck** item to one line, and each cell under eight words. When it still runs over, shorten in this order: **Shipped**, then **Stuck**, then table cells. Every lane keeps its row and every ask keeps its line. Drop empty sections, but keep **Not checked**.

Done when every lane appears in exactly one table row, every unanswered ask is a numbered decision, an **Also waiting on you** line, or a reclassification note, every decision has a compliant recommendation and an "if unanswered", and the brief fits about 60 lines.
