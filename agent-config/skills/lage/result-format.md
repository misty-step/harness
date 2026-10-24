# Result for Home

Return a JSON object with `schema: "lage.v1"`, `as_of` and `since` as UTC ISO timestamps,
and these arrays: `decisions`, `lanes`, `shipped`, `stuck`. Counts come from the arrays.
The `details` object holds `coverage`, `running`, `standing`, `scratch`, `capacity` and
`not_checked`. Keep `not_checked` as an array even when empty; other empty detail can be omitted.

Home renders the four arrays in that order as one inline page. Primary fields below stay
short enough to scan together; each item's `details` is collapsed. Overflow stays available
behind its count or a link. A large investigation belongs in detail, not a large first view.

## Decisions

Keep every unresolved principal question in priority order, urgent first. Each entry has:

- `id`: a stable label within this result, such as `D1`.
- `question`: the complete question in one sentence.
- `recommendation`: the proposed answer and action, worded so yes accepts it.
- `if_unanswered`: what waits or happens, and when.
- `requester`: the lane or person asking.
- `links`: sources and the requesting thread.
- `details`: the context, individual `options` with their costs, recommendation `reason`,
  `asked_at` and any `deadline`. Preserve every sub-question as its own decision.

Home's visible decision line is question — recommendation — cost of no answer. The principal
can make the recommended call from that line; alternatives and supporting reasoning expand.

## Lanes

One entry per in-scope lane: `name`, `url` (its exact T3 thread URL), `state`, `now`, `next`,
`links`, `details`. Use the state names from step 3. `now` names the latest verified outcome;
`next` names the next outcome and its owner, each in one short phrase. Home renders `state`
as a pill. Details retain goal, done criterion, observation time, evidence, children,
schedules and unresolved asks. Distinguish a reported claim from observed delivery.

## Shipped and stuck

Each shipped entry has `summary`, `links` and `details`: one outcome since `since`, with its
proof and closure reason in detail. Keep merged, artifact verified and live behavior proven
distinct. A lane can still be building while an earlier unit appears here.

Each stuck entry has `summary`, `owner`, `links` and `details`. Name who can unblock it,
including policy-answerable asks reclassified from decisions. Detail retains the cause,
waiting cost and evidence. Principal decisions remain in `decisions` rather than being counted
again as stuck.

## Links and complete detail

Use `links: [{"label": "clear source description", "url": "accessible URL"}]` alongside
the fact supported. Primary strings are plain text; Home makes the source labels clickable.
Use HTTPS or exact `t3-thread://v1/<threadId>` URLs under the global review-link rule.

`details.coverage` accounts for every thread within the investigation's paging bounds,
including closed lanes, excluded work, children, standing and scratch threads. Preserve the
counts and read bounds without disclosing private exclusions. The other detail groups retain
running work, standing-thread last/next runs, scratch owners, capacity and all read gaps.
Unverified facts say `lane says`; missing facts say `unknown: <why>` where they matter.

No principal decision, lane or read gap disappears to meet the first-view target. Home may
fold extra rows, showing how many remain. The runner supplies the complete structured result;
Home owns the inline graphic presentation.
