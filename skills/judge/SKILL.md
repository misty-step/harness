---
name: judge
description: "Rule on PR review and QA findings: blocker, filed follow-up or skip, then SHIP, FIX, REVERT or SPLIT."
metadata:
  owner: phaedrus
  prevents: "Reviewer-driven fix loops and renewed rounds after retries: bounded behind judge rulings in mistystack PRs #450 and #454."
  source: "misty-step/mistystack@0ccc1a308cdeefa29e991d3b7c1dbab016cfea03/agent-config/skills/judge"
  sunset: 2026-11-27
---

# Judge

An independent judge has neither built, reviewed nor tested this change. An
involved thread returns the independence conflict instead of ruling. Read intent,
acceptance criteria, stories, PR head, QA/review reports and earlier resolutions.
The brief comes from `skill://ship-loop`'s `prompt --role judge|final-judge`.

## 1. Confirm

Read the evidence and actual callers behind each finding; merge duplicates. A
single security/correctness report deserves a source trace. Treat captured QA
failures as observations, not speculation. After a fix, inspect only the named
blockers and defects the fix introduced; retain unchanged proof.

## 2. Rule

Each finding gets one ruling and one reason:

- **blocker:** demonstrated harm introduced by this unit, a broken acceptance
  criterion, or missing required proof. Includes security, data loss, broken build,
  deploy or rollback. Pre-existing defects cannot block this PR.
- **file:** worthwhile actionable work, while this unit is a net improvement now.
  Reuse an issue for the same cause; every such ruling gets a ticket link.
- **skip:** disproved, already covered, speculative, preference-only or not worth
  doing. A reviewer's suggestion alone does not earn a ticket.

Judge the atomic unit, not the initiative's remaining work. Heuristics may ship
labelled approximate. For unsettled intent, choose the reversible option closest
to the stated outcome and record an `intent call`; block an irreversible choice.
Confirm the `Rigor:` reason and diff size; raise the tier only for a concrete
changed-path risk. Record `no deploy` when no deployed artifact changes.

## 3. Decide and record

Post `Verdict at <head SHA>` with linked QA/review, one outcome and its reason,
exact blockers with owner and observable fix, useful follow-ups, consequential
skips and intent calls under the core's claim rule. Omit empty sections.

- **SHIP:** independent completed QA/review cover this SHA; all blockers resolved.
  `skill://verification` defines the required real-path proof, including sign-in
  and role evidence when relevant. Internal changes need composition proof.
- **FIX:** the initial judge names exact eligible `<role>:<finding-id>` blockers
  from one reporter thread. The builder owns code; the conductor owns proof.
- **REVERT / SPLIT:** drop/revert the unit or make independently shippable units.

Only FIX authorizes the single fix round. The blocking reporter's role rechecks
named fixes and fix-introduced regressions in a fresh thread. Unrelated findings
become follow-ups. Final judgment allows SHIP, REVERT or SPLIT; changed SHAs,
rebases and retries never reset the cap.

Return native thread ID, SHA, outcome, blockers, ticket links and PR report URL to
the conductor for the helper's `record --kind verdict`. Its schema and state
machine enforce eligibility and independence. SHIP plus passing affected checks
is the merge gate; no additional human review follows.
