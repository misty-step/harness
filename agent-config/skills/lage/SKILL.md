---
name: lage
description: Investigate every lane and return a compact structured result for Home to render inline, with decisions first and supporting detail folded. Use for /lage, "get me up to speed", "status on all lanes", or before choosing what to dispatch next.
---

# Lage

Read-only investigation: never message a lane, merge, re-run or start work to improve the brief.
The previous lage is the time the launcher passes; otherwise use the newest
timestamped result (`.json`) or legacy brief (`.md`) in `~/.local/state/home/lage/`, excluding
`*-pointer.md`. Use 24 hours ago only when that directory is empty. If unreadable, report the gap.

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
resolve missing context. Mark unavailable facts `unknown: <why>`. Report an account's room only from a live reading, with its source and age; an `out` claim needs a reading under 15 minutes old, and with no reading the account is `unknown: no live reading`, never zero.

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

## 4. Return a compact result

Keep the investigation above complete. Read [result-format.md](result-format.md) and write one
`lage.v1` JSON result for Home, which renders one inline page in its own thread. The first view
should fit one screen:

1. Decisions first: one line per question, recommendation and cost of no answer.
2. Lane strip: one row per lane, state pill and one-line now/next.
3. Shipped since the previous lage: short outcome bullets.
4. Stuck items: one line each, with the owner who can unblock them.

Use plain words and aim for 250 words across those primary fields at the current roster size.
Put options, reasoning, evidence, running children, schedules, capacity, scratch work and read
gaps in each item's detail or the result's `details`. Home folds them by default and may fold
overflow with its count visible. Keep every lane and unresolved ask in the result; compact
writing changes presentation, never research coverage. Unknown facts stay explicitly unknown.

State each question in full, with recommendation and consequence in the same scan line; retain
its requester, options, costs, reason and deadline in detail. An ask answered by standing policy
belongs in stuck with its agent owner. Recommendations follow standing autonomy and Foundations.

Use links alongside the facts they support. A linked object has a clear label and accessible
URL; thread URLs retain their exact `t3-thread://v1/<threadId>`. Resolve local-artifact links
under global autonomy's review-link rule. Mark unverified claims "lane says". Home uses the
structured fields for state pills, comparisons and progressive disclosure; the runner supplies
facts rather than a long document for the principal to read.

Run [self-check.md](self-check.md) on the result and pointer before delivery.

## 5. Deliver to Home

Home's thread is phaedrus-only; never `t3_thread_send` there.

Save the JSON to `~/.local/state/home/lage/<YYYY-MM-DDTHHMMZ>.json` and a short Markdown pointer
beside it as `<YYYY-MM-DDTHHMMZ>-pointer.md`. Publish the reviewed JSON under global autonomy's
review-link rule, then pipe the pointer to `home post --from Lage` on stdin:

`Lage ready: <N> decisions; <S> stuck. [Structured result](<HTTPS URL>) — Home: render inline.`

Derive N from `decisions` and S from `stuck`; agent-answerable asks count only as stuck. Home
renders the decisions, lane strip, shipped bullets and stuck owners inline, with detail folded.
The link is the machine-readable handoff, not the principal's reading assignment.

If posting fails, append `## <UTC> [Lage]` and that same pointer to
`~/.local/state/home/inbox.md`, and report the fallback in the runner. Done means the JSON is
reachable and the single pointer is delivered through the primary inbox or Home has read the
fallback. Report a failed step precisely; delivery alone does not prove Home rendered the page.
