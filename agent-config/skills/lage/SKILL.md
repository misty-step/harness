---
name: lage
description: Executive brief on every open lane, in-flight initiative and running agent, complete enough to decide from without opening anything. Use for /lage, "get me up to speed", "status on all lanes", or before choosing what to dispatch next.
---

# Lage

Read-only investigation: never message a lane, merge, re-run or start work to improve the brief.
The previous lage is the time the launcher passes; otherwise use the newest
`~/.local/state/home/lage/*.md` filename's UTC time. Use 24 hours ago only when that directory
is empty. If unreadable, report the gap rather than guessing.

Home delegates to one asynchronous runner. When its checkout has `AGENTS.md` or hooks, use
`t3_thread_launch` with `scratch: true`. Name the requesting thread's `threadId`, lage skill and
previous lage's time in the launch message. The runner completes delivery and delegates further
only when useful.

## 1. Roster

Read the coordinator's instructions first (Home's are `~/home/AGENTS.md`). Exclude its out-of-scope
work from assignments and every brief section. Keep private exclusion contents out of this repo.

List every project with `t3_project_list`. For each `projectId`, read:

- `t3_thread_list`, `settled: false`, `includeSubagents: true`, through the last page.
- `t3_thread_list`, `settled: true`, newest-updated first. Stop at the first thread updated before
  the previous lage. Those whose `settledAt` is later are closed lanes.
- `list_scheduled_tasks` for `boundThreadId`, `nextRunAt` and last run status.

A lane is a top-level initiative thread. Classify the rest separately:

- Exclude your own and the requesting thread.
- Standing threads coordinate rather than build: Home and threads bound to scheduled tasks.
- Children have `parentThreadId`. Give lane children to their reader and standing-thread children
  to the coordinator. Ignore children of settled parents. Running means `queued`, `starting` or
  `running`; native subagents (`latestRunId: null`, always `idle`) count when updated within
  15 minutes and their delegated parent has not completed.
- Other top-level threads in the scratch project (`No project`, `workspaceRoot` `~/.t3/scratch`)
  are one-off tasks. Failed, interrupted or waiting scratch work is stuck, owned by its launcher
  or Heartbeat. Cancelled means the principal stopped it; omit it from stuck.

Account for every thread within these paging bounds.

## 2. Read lanes

Read every in-scope open lane and unresolved asks on closed lanes. Capture:

- Goal and definition of done from its first message (`limit: 1`).
- Latest assistant message and latest `user_message`, including cross-thread sends. Page back to
  find the latter when absent from the tail.
- Every unresolved ask, however old, naming its requester. Capture every sub-question, options,
  recommendation, waiting cost and date. Include `t3_pending_request_list`, unresolved
  `BLOCKED-ALLOWED:` lines and unraised blockers, marked "found by lage".
- Latest verifiable work, its time and next outcome. Pushes and deploys prove delivery; research
  and drafts can prove ongoing work. Absence of a push alone does not prove a stall.
- Every named PR's forge state (`gh pr view <url> --json state,mergedAt,statusCheckRollup,reviewDecision`).
- Running children and scheduled tasks from the roster.

A side effect is a pushed commit, opened or merged PR, deploy, published ticket or host change.

Read tails with `afterPosition` near `itemCount - 12` and `maxCharsPerItem` around 3000.
Recover truncated asks or reports with `itemId` and `textOffset`; read older history only to
resolve missing context. Mark unavailable facts `unknown: <why>`.

Read the coordinator's open-loops file (Home's is `~/home/NOW.md`). An ask it already answers is
a dropped relay, not a principal decision. Finish with every lane covered and PR states verified.

## 3. Classify

Assign each lane the first matching state:

| State | Meaning |
| --- | --- |
| `waiting on you` | Unresolved principal decision on intent, destruction, production writes or money, even if other work can proceed. |
| `stuck` | Failed, interrupted, claims to be running with no side effect in 6 hours, or waiting on an agent-answerable ask. |
| `in review` | A PR is open and agent review, QA or the judge is pending. |
| `parked` | Deliberately on hold. |
| `shipped` | Merged or deployed since the previous lage, with no PR open and no builder running. |
| `building` | Code or PR open, builder running, or verifiable progress in the last 6 hours. |
| `scoping` | Interviewing, specifying or ticketing, with no code yet; also the fallback state. |

Apply the same test to asks found by lage. Process or permission asks answered by standing policy
are agent-answerable: classify them as stuck. Deploying merged code through its repository's
pipeline is shipping, not a production write. Claim only what evidence proves: started, PR open,
merged, artifact verified or live behavior proven ([Foundations](https://foundations.mistystep.io/way-of-working)).

## 4. Write

Lead with what needs him. Start `**Lage, <date> <local time>.** <N> decisions for you.`
List all unresolved principal questions in priority order, urgent first, including closed-lane asks.
Write each question in full with its requester, context, options and their costs, recommendation
and reason, and what happens if unanswered and when. Give each question its own numbered entry
in one sequence, 1…N. Never bundle approvals or substitute unseen source labels or item numbers.
Numbered references use only individual entries from this brief, never ranges.

Recommendations follow standing autonomy and Foundations. Flag noncompliant options and recommend
a compliant one. Reclassify agent-answerable asks explicitly instead of silently dropping them.

Follow with lane states, latest verifiable progress and next steps with owners; shipped outcomes
and closure reasons; stuck work and who unsticks it; running children, scratch work and standing
threads' last and next runs. Include capacity from `upkeep status` if available. Give each status
item only what changes a decision. Drop empty sections except **Not checked**, which lists read
gaps. Do not cap the brief's length.

Link every mention of every PR, issue, ticket, story, spec, doc, file, ADR and thread. Put the whole
reference inside its Markdown link and expand ranges into individual links. At first mention,
give each linked item a one-line summary sufficient to understand it without opening it.
Expand unfamiliar jargon; an opaque title is insufficient. For unreadable sources, give their
known purpose and read gap; if purpose is unknown, report missing context against the linked lane.
Link threads as `[title](t3-thread://v1/<threadId>)`; resolve source and local-artifact links under global autonomy's review-link rule. Use familiar names for lanes and agents.
Mark unverified claims "lane says".

Embed relevant source content. Never substitute "see NOW.md" or another file pointer for it.
Before delivery, run [self-check.md](self-check.md) on the draft and pointer and repair failures.
The brief is ready when he can decide from it alone and every lane and unresolved ask is covered.

## 5. Deliver

Home's thread is phaedrus-only; never `t3_thread_send` there.

Save the full brief to `~/.local/state/home/lage/<YYYY-MM-DDTHHMMZ>.md` using current UTC time;
create the directory if needed. Publish the full brief under global autonomy's review-link rule.
Pipe one pointer to `home post --from Lage` via stdin, containing a clickable HTTPS link to the
full brief and `<N> waiting; <S> stuck`. N counts all principal questions; agent-answerable
reclassifications count only as stuck. If `home post` fails, append `## <UTC> [Lage]` and the same
pointer directly to `~/.local/state/home/inbox.md`; report the fallback in the runner.

Done when the linked full brief is reachable and the inbox contains its single linked pointer.
If saving, publishing or both inbox paths fail, report the failed step without claiming delivery.
