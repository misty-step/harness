---
name: lage
description: Executive brief on every open lane, in-flight initiative and running agent, complete enough to decide from without opening anything. Use for /lage, "get me up to speed", "status on all lanes", or before choosing what to dispatch next.
---

# Lage

Read-only investigation: never message a lane, merge, re-run or start work to improve the brief.
Delivery is step 5. The **previous lage** is the time the launcher passes; otherwise use the
newest `~/.local/state/home/lage/*.md` filename's UTC time. Fall back to 24 hours ago only
when that directory is empty. If it cannot be read, report that gap rather than guessing.
A responsive coordinator (Home) delegates to one runner. When its checkout has `CLAUDE.md`
or hooks, use `t3_thread_launch` with `scratch: true`. Name the lage skill and previous lage's
time in the launch message; have the runner complete delivery itself.

## 1. Roster

Read the coordinator's instruction file first (Home's is `~/home/CLAUDE.md`). Exclude from the brief
any work it puts out of scope; keep the exclusion's contents out of this shared skill. Apply that
scope to lane-reader assignments and all brief sections.

List every project (`t3_project_list`). For each project, pass its `projectId`:

- `t3_thread_list` with `settled: false` and `includeSubagents: true`: open threads and their
  children, to the last page.
- `t3_thread_list` with `settled: true`: newest-updated first, so stop at the first thread updated
  before the previous lage. Those whose `settledAt` is later become **Closed**.
- `list_scheduled_tasks`: each task's `boundThreadId`, `nextRunAt` and last run status.

A **lane** is a top-level thread doing initiative work. Not lanes:

- your own thread and the requesting thread;
- **standing threads** that coordinate rather than build: Home, and any thread a scheduled task is
  bound to, such as Heartbeat;
- **children** (`parentThreadId` set): hand lane children to their reader and standing-thread
  children to the coordinator. Ignore children of settled parents. A child is **running** when its
  status is `queued`, `starting` or `running`, or it is a native subagent (`latestRunId: null`,
  always `idle`) updated in the last 15 minutes whose delegated parent has not completed;
- **scratch threads**, the other top-level threads in the scratch project (titled `No project`,
  `workspaceRoot` `~/.t3/scratch`): one-off tasks a coordinator launched, such as a lage runner. One
  that is `failed`, `interrupted` or `waiting` goes to **Stuck**, owned by the thread that launched
  it, or Heartbeat. `cancelled` means the principal stopped it; omit it from **Stuck**.

Done when every project meets the open last-page and settled previous-lage cutoff bounds and every
thread is placed as a lane, a closed lane, a child, or a standing or scratch thread.

## 2. Read each lane

For each in-scope open lane, fill this record; read in-scope closed lanes for unresolved asks too.
Write `unknown: <why>` for any field you could not get.

- **Goal:** the lane's brief (its first message, `limit: 1`), in one line, plus its definition of
  done.
- **Last word:** the lane's latest assistant message, and the latest message to it: the newest
  `user_message` in the `messages` view, which includes sends from other threads. The tail rarely
  holds one, so page back until you find it.
- **Asks:** every question to the principal that nobody has answered yet, however old, each with its
  options, the lane's recommendation, what waiting costs, and any date. Capture every sub-question
  in full, with its options, recommendation and what happens if unanswered; source item numbers
  alone are insufficient. Include `t3_pending_request_list`, any unresolved `BLOCKED-ALLOWED:` line,
  and any blocker you found that the lane never raised, marked "(found by lage)".
- **Progress:** the newest **side effect**, with its time. A side effect is a pushed commit, an
  opened or merged PR, a deploy, a published ticket, or a change applied on a host, such as a
  service or runner restarted. Prose about intent and uncommitted drafts are not progress.
- **PRs:** the state of every PR the lane names, read from the forge (`gh pr view <url> --json
  state,mergedAt,statusCheckRollup,reviewDecision`).
- **Agents:** the lane's running children and its project's scheduled tasks, as step 1 handed them
  over.

Read tails, not whole threads: `afterPosition` near `itemCount - 12`, `maxCharsPerItem` around 3000.
When an ask or report is cut off, page the rest with `itemId` and `textOffset`. Page further back
only when the tail doesn't say what the lane is waiting on.

Fan the reads out: one `delegate_task` child per four lanes or so, returning only records. While
they run, read the coordinator's open-loops file yourself (Home's is `~/home/NOW.md`): an ask it
already answers is a **dropped relay**, not a decision. Record it that way.

```
Read-only: follow ~/.claude/skills/lage/SKILL.md step 2; return its records.
Lanes: <title, threadId, projectId, running children and scheduled tasks, one per line>
```

Done when every in-scope open lane has a full record, closed-lane asks are captured, and every PR
state came from the forge.

## 3. Classify

Give each lane the first row below that fits:

| State | Meaning |
| --- | --- |
| `waiting on you` | Only the principal can decide intent, destruction, production writes or money. |
| `stuck` | Failed, interrupted, no side effect in 6 hours, or waiting on an agent-answerable ask. |
| `in review` | A PR is open and agent review, QA or the judge is pending. |
| `parked` | Deliberately on hold. |
| `shipped` | It merged or deployed since the previous lage, with no PR open and no builder running. |
| `building` | Code or PR open, builder running, or side effect in the last 6 hours. |
| `scoping` | It is interviewing, specifying or ticketing, and has no code yet. |

Test asks a reader found like the lane's own. An ask about process or permission that standing
policy already answers is not the principal's: move it to `stuck` and note "agent-answerable".
Deploying merged code through the repository's own pipeline is shipping, not a production write. Use
the exact progress claim the evidence supports: started, PR open, merged, artifact verified, or live
behavior proven ([Foundations](https://foundations.mistystep.io/way-of-working)).

Done when every lane has exactly one state; use `scoping` for any unmatched lane.

## 4. Write the brief

```
**Lage, <date> <local time>.** <N> decisions for you. <The single most important fact, one sentence.>

**Decisions**
1. **<Lane>: <decision so "yes" accepts your recommendation>** ([thread](t3-thread://v1/<id>))
   <Why it matters now.> Options: <A, and what it costs>; <B, and what it costs>.
   Recommend <X>, because <reason>. If unanswered: <what happens, and when>. Detail: <link>.

**Lanes**
| Lane | State | Last real progress | Next |
| --- | --- | --- | --- |
| [<title>](t3-thread://v1/<id>) | <state> | <side effect, how long ago> | <next step, and whose> |

**Also waiting on you**
<Continue the Decisions numbering and format for every remaining ask.>

**Shipped and closed since last lage**
- <what changed for a user, with the PR or deploy link>
- Closed: <lane, and why it closed>

**Stuck** (agents fix these; no action for you)
- <lane or scratch thread>: <cause>. <Who unsticks it: the lane, Heartbeat, or the coordinator.>

**Running:** <children across lanes; scratch threads; standing threads' last and next runs>.
**Capacity:** <one line from `upkeep status`, if it runs>.
**Not checked:** <every source you could not read, and why>.
```

- Lead with what needs the principal. **Decisions** holds at most five open-lane asks: those whose
  delay costs the most, because they block the most work or lapse first, in that order. Every other
  ask, including closed-lane asks, goes under **Also waiting on you** with the same detail.
- Write every question out in full, including each sub-question's options, recommendation, and what
  happens if unanswered and when. Give each question its own entry; never bundle approvals or use
  question labels, ranges or source item numbers as shorthand. Number entries 1…N in one sequence
  across both ask sections; N counts all questions needing the principal. Use that same N in the
  header and delivery pointer. Translate source labels into plain descriptions everywhere, including
  **Stuck** and **Not checked**. Only this brief’s entries may serve as numbered references; factual
  quantities and dates remain useful.
- Every recommendation follows the standing autonomy policy and
  [Foundations](https://foundations.mistystep.io/way-of-working). When an option breaks either, say
  so inside that option, and recommend a compliant one.
- Link every mention of every PR, issue, ticket, story, spec, doc, ADR and thread, in every section,
  including **Lanes** and **Stuck**. Put the entire PR or issue reference inside the Markdown link
  text; expand ranges into individual links. Every `Detail:` must have its own Markdown link on the
  same line. At its first mention, summarize each linked item in one line sufficient to understand
  it without opening it. A table row or **Stuck** item includes that summary in the row itself;
  later mentions can reuse the linked short name. Link threads as `[title](t3-thread://v1/<id>)` and
  PRs by full URL. Call lanes, PRs and agents by names the principal knows. Label anything you did
  not verify: "(lane says)".
- Include the relevant content from open-loops files and other sources in the brief itself. Never
  point at `NOW.md` or any file in place of its content.
- Self-containment takes priority over length: no total line or character cap. No line over 100
  characters (link text counts, link targets don't). Keep one line per status item, including table
  rows and **Stuck** items; questions can span lines to include their full detail. Cut anything that
  does not change a decision. Drop empty sections, but keep **Not checked**.

Before delivery, run [self-check.md](self-check.md) on your own draft and pointer. Repair every
match or failed check, then rerun. A clean grep alone cannot prove links or summaries: inspect
all reference mentions and each first-mention summary too.

Done when every in-scope lane has exactly one table row, every unanswered in-scope ask has a
full entry or reclassification note, and the draft and pointer pass every self-check.

## 5. Deliver

Home's T3 thread is written only by phaedrus. Never use `t3_thread_send` to it or send the brief to
the requesting thread by message.

The runner writes the full brief to `~/.local/state/home/lage/<YYYY-MM-DDTHHMMZ>.md`, the
coordinator's brief directory; use the current UTC time and create the directory if needed. Then
pipe one pointer entry to `home post --from lage` via stdin: the saved file's path and a one-line
count in the form `<N> waiting; <S> stuck`. Count every question needing him across both
ask sections and every stuck item. Agent-answerable reclassifications count only under stuck, never
in N. `home post` appends `## <UTC> [lage]` plus the body to `~/.local/state/home/inbox.md`.

Done when the full brief exists at the named path and the inbox contains its single pointer entry.
If delivery fails, report the failed step without claiming delivery or substituting a thread
message.
