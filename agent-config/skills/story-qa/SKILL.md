---
name: story-qa
description: Review completion and walk affected stories on the real product; repair missing verification or CI cadence when commissioned.
argument-hint: "[repository, story IDs, or run scope]"
---

# Story-driven QA (US-022)

Challenge the requested outcome before calling it done. Read the complete change,
affected callers, request criteria, and root `USER_STORIES.md` when present. Try
plausible boundary, failure/recovery, permission, state-transition, and side-effect
counterexamples. Another review or a green suite does not replace this pass.

Walk affected user-facing criteria through the actual end-user surface on the
candidate revision: browser, native application, real CLI, or executable library
consumer. Setup APIs and automation can support the walk; inspect the user's
result yourself. Screenshots prove appearance, not persistence or delivery.
Corroborate consequential outcomes independently when the surface cannot show
them. Docs/internal changes get their real owner-path check, not a pretend
product journey. An unavailable surface leaves the criterion unverified.

Use the product's existing walk list and commands. Cover changed/high-risk
criteria with the shortest journeys that can reject plausible failure; one
journey can prove several criteria. Reuse evidence only while revision, target,
data, and risk remain applicable. Recurring QA needs an owned run and report,
including neglected/error paths, not merely a schedule.

Record revision, target, identity class, actions, expected versus observed
postconditions, pass/fail/unverified criteria, redacted evidence, and owned
cleanup. Repair defects and recheck the affected path. Use disposable data and
the project's actual integration authority.

Focused detail:
- `skill://visual-state-review`: named rendered states and gallery.
- [authoring.md](authoring.md): create/repair runnable product verification (commissioned scope).
- [runtime.md](runtime.md): environment, identity, preview, and cleanup boundaries.
- [check-cadence.md](check-cadence.md): change check schedules without losing gates (US-023).
- `skill://test-audit`: permanent tests; `skill://user-stories`: operator intent.
- `skill://engineering-operations/workstation.md`: heavy execution and resources.
