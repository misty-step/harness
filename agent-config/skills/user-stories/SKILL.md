---
name: user-stories
description: Draft, extend, and reconcile a repository's user stories.
disable-model-invocation: true
argument-hint: "[optional repository, capability, or story id]"
---

# User stories

`USER_STORIES.md` at the repository root is the root artifact: the operator's
statement of what users must be able to do. Design, architecture, infra,
verification, review, and QA derive from it. Keep the file small enough that
any agent carries it whole at session start.

A story states the progress a user wants in a situation — not a feature, not
a widget. Criteria are the contract. Every criterion must be worded so a
check can fail on it; anything else is decoration.

## File design

One file, `USER_STORIES.md`, at the root, named like `AGENTS.md`. Do not split
it: `foundation-check`, affected-story detection and walk receipts read only
the root file, and the check script rejects a `USER_STORIES/` directory
(harness ADR-004). The skeleton lives in [template.md](template.md). Per story:

- `## US-007` plus the capability sentence, e.g. "See a project's change
  trend". Group stories under `## Capability: <name>` headings.
- `Statement:` — "When I [situation], I want [progress], so I can [outcome]."
- `Criteria:` — two to six numbered criteria in the five fixed shapes:
  THE SYSTEM SHALL (always); WHEN ... SHALL (event); WHILE ... SHALL (state);
  WHERE ... SHALL (option); IF ... THEN SHALL (error).
- `No-gos:` — optional; what this story will not grow into.
- `Evidence:` — the paths or commands that prove the criteria.

Stays out: status, estimates, points, assignees, due dates, priority ranks.
The work record carries life; the file carries intent and proof.

## The sacrosanct rules

1. Ids (`US-XXX`, minted per repository) are created once. Never renamed,
   renumbered, or reused, retirement included.
2. Stories evolve by split, supersede (`Superseded by US-007`), or retire
   (`Retired: 2026-09-17 — reason`). Never a silent rewrite; wording
   clarification inside unchanged intent is fine.
3. Only the operator changes intent. Agents draft in a PR. The PR that gives
   a repository its first stories merges on the designated agent reviewer's
   approval (harness ADR-003); later changes of intent need the operator's approval.
4. Downstream cites the id as literal text: PR descriptions, test names
   (`TestTrendMissingCoverageUS007`), design notes, ADRs, receipts.
5. Unprovable criteria are a defect. If no check can fail a criterion,
   rewrite it before the PR merges. This rule is the fail-closed pokayoke
   that keeps the file honest.

## Modes

- **init** — no story file yet: read the README and the code, then draft
  capabilities and stories for a PR. Describe only observed or stated
  behavior; label uncertainty. The designated agent reviewer approves it,
  escalating to the operator only a real change in product direction.
- **extend** — a feature or fix changes behavior: mint the next id (highest
  existing + 1), write the story in the same PR as the work, and cite the id
  in the PR description and tests. Intent changes become a split or
  supersede proposal.
- **reconcile** — read-only audit: run the check, then report behavior with
  no story, stories whose evidence is missing, and tests citing unknown ids.
  Do not auto-fix.

## Check

The package ships [check-stories.sh](scripts/check-stories.sh). Run it with
the target repository as the argument (defaults to the current directory).
It fails closed on structural defects: duplicate or malformed ids, a story
without a non-empty statement or without `SHALL` in a criterion, placeholder
text, and supersede or retire targets that do not resolve. Evidence-path
existence and per-story test coverage warn while repositories migrate;
tighten those warnings to failures once a repository has lived with stories
for a few pull requests. `--tests` scans `*_test.go`, `*.test.ts`,
`*.test.tsx`, `test_*.py`, and `*_test.py` files for id citations.

## Pitfalls

- A story naming a screen, widget, or library is a solution in disguise.
  State the progress instead.
- "Fast", "friendly", "robust" cannot fail a check. Rewrite or delete.
- Do not add tracker fields to win a review; status lives in Linear or
  Habitat.
- Do not centralize stories across repositories. Each root file stands alone.
- A test that never runs in the path that matters does not prove a criterion.

## Verification

- The check exits 0, or every reported failure is fixed.
- The pull request description and at least one test carry each new id.
- Read the file alone, cold: can you state what the product must do? If not,
  the story is not done.
