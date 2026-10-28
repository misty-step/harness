---
name: lage
description: Investigate assigned work and return a compact structured result for Home to render inline, with decisions first. Use for /lage, "get me up to speed", "status on all lanes", or before choosing what to dispatch next.
---

# Lage

Read-only investigation: read chats, PRs and issues without messaging, merging, rerunning or starting work to improve the brief.

Read the coordinator's instructions first (Home's are `~/home/AGENTS.md`). Exclude its out-of-scope work without disclosing private exclusions. Use the previous brief's supplied timestamp, otherwise the newest timestamped result in `~/.local/state/home/lage/`, or the last 24 hours when that directory is empty. Report an unreadable state as a gap.

## 1. Discover

Use the host's native chat and project inventory tools. Start with the scope the user named; for a general status request, cover the available active work and recently completed work. Use the previous brief's timestamp when available, otherwise the last 24 hours. State the read bounds and gaps.

Use native collaboration status for children of the current task. Do not infer parentage, liveness or scheduled work from a chat's title. Read available metadata and current status. Include relevant existing automations without creating or changing them.

## 2. Read

Read each in-scope chat's recent status and turn summaries. Page back only to resolve missing goals, unresolved questions or truncated reports. Capture:

- Goal and definition of done.
- Latest verified outcome, its time and next outcome with an owner.
- Every unresolved principal question, including its requester, options, recommendation, waiting cost and date. Check older context when the latest tail omits it.
- Blockers the agent can resolve under standing policy, distinguished from principal decisions.
- Each named PR's current GitHub state and checks, rather than relying on a chat's claim.
- Running children, existing schedules and any failed or unavailable reads.

Prefer compact native wait/status snapshots when following progress. A push, PR or deployment proves delivery; research and drafts can prove ongoing work. Lack of a push alone does not prove a stall. Mark unverified claims as reported and unavailable facts `unknown: <why>`.

Report account room only from a fresh native usage-limit reading or `upkeep room --json` when available, naming the source and age. Missing or stale readings are unknown.

## 3. Classify

Assign each work item its first matching state:

| State | Meaning |
| --- | --- |
| `waiting on you` | An unresolved principal decision on intent, destruction, production writes or money. |
| `stuck` | Failed, interrupted, demonstrably stalled, or waiting on a question standing policy answers. |
| `in review` | A PR is open and independent review, QA or judgment is pending. |
| `parked` | Deliberately on hold. |
| `shipped` | Merged or deployed since the previous brief, with no remaining unit underway. |
| `building` | A builder is running or there is verifiable ongoing progress. |
| `scoping` | Interviewing, specifying or ticketing, with no code yet; also the fallback state. |

Claim only what evidence proves: started, PR open, merged, artifact verified or live behavior proven. Deploying merged code through its repository's pipeline is shipping, not a production-data write.

## 4. Return a compact result

Read [result-format.md](result-format.md) and write one `lage.v1` JSON result for Home to render inline. Keep the primary fields concise:

1. Principal decisions, each with the complete question, recommendation and consequence of no answer.
2. One row per assigned work item: name, state, latest outcome and next step with its owner.
3. Shipped outcomes since the previous brief, with evidence.
4. Blockers and the owner who can resolve each.

Retain supporting detail, running children, schedules, capacity and read gaps. Account for every in-scope item and unresolved question. Use the host's native clickable chat links and accessible GitHub or live URLs alongside the facts they support. Read [self-check.md](self-check.md) before delivery.

## 5. Deliver to Home

Home's chat is phaedrus-only. Deliver through its inbox.

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
