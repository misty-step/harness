# Shaping records

## Domain terms

Use the existing `DOMAIN.md` structure. When the first term needs a home, record its canonical name, meaning, boundaries and a concrete example. Identify distinct contexts when the same word has different meanings. Replace synonyms in affected records with the settled term; preserve old meanings only as explicit historical context.

A relationship is precise when a scenario can test its limits. Can one order have two customers? Can one item be cancelled without cancelling the order? Check the current implementation, then ask the owner to resolve a conflict between intended and observed behavior.

Record an ADR in the project's existing decision directory only for a real tradeoff that is costly to reverse and surprising without its context. Include the context, alternatives, decision and consequences. Ordinary reversible implementation choices stay in the spec or ticket.

## Spec and stories

Keep the initiative's full value in view. A delivery slice is not a reduced definition of success. Reuse the project's spec structure; cover these decision-bearing parts:

- The owner's intent and done-when conditions, problem evidence and intended benefit.
- The user-visible solution, domain terms, invariants, state transitions and rejection or recovery behavior.
- Accepted decisions, rejected real alternatives, interfaces and data ownership.
- Compatibility, migration, readback and rollback where persisted formats, meanings or defaults change.
- Acceptance stories and the outside checks through existing consumer boundaries.
- Non-goals, useful slices and direct dependencies.
- How actual use will show the benefit, and when to revise or stop.

Preserve decision-rich schemas or state tables when they are more exact than prose. Link source and version; leave incidental implementation detail with the code.

Use the existing story home: `USER_STORIES.md` when present, otherwise the stories section of `SPEC.md`. Link between the two instead of copying stories. Preserve existing IDs and allocate unused `US-###` IDs. Status and priority belong in the tracker.

```markdown
## US-### <capability sentence>

Statement: When I <situation>, I want <progress>, so I can <outcome>.

Criteria:
1. WHEN <trigger>, THE SYSTEM SHALL <observable behavior>.
2. IF <error condition>, THEN THE SYSTEM SHALL <observable rejection or recovery>.

No-gos: <boundaries of this story>

Evidence: <exact command or real journey that can fail each criterion>
```

Use EARS conditions that match the behavior: WHEN for events, WHILE for states, IF for unwanted conditions, and WHERE for optional features. Include success, rejection and recovery when the story has those paths. A criterion describes externally observable behavior, not a proposed internal implementation. Keep evidence links current when the implementation owner moves.

## Tickets and reconciliation

Use the project's native tracker and existing vocabulary. Read the source issue, comments and linked decisions before changing it. For each slice, record the delivered behavior, stable story IDs, acceptance criteria, direct blockers and the full briefing contract from `skill://misty`. Link raw material at its source. Prefer the highest existing consumer boundary for its Oracle.

An infrastructure-only step earns a separate ticket only when it is independently useful and verifiable. A mechanical wide refactor that cannot land in useful vertical slices stays one atomic migration when feasible. If compatibility requires stages, make the stages explicit and end with every caller migrated and the old form deleted; temporary coexistence is a migration constraint, not a permanent second API.

For backlog work, compare the complete in-scope board with accepted direction and current product evidence. Take the highest-value mismatch first. Give each item a disposition: keep, update, merge into an existing owner, retire with a reason, delivered with proof, or unresolved with an exact question. Record priority as an explicit owner decision rather than inferring it from creation order or changing blocker meanings.

Publish accepted decisions without another approval round. Preserve parent history and existing ownership; shaping does not claim a worker lease or close delivery on another worker's behalf. Merge duplicates into one surviving item and link the history. Use native blockers in dependency order, then read each changed item back and reconcile the resulting in-scope board. Report accepted changes, unresolved decisions and evidence limits with clickable links under `skill://misty`'s claim rule.
