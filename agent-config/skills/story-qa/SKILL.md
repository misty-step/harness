---
name: story-qa
description: Review completion and walk affected stories on the real product; repair missing verification or CI cadence when commissioned.
argument-hint: "[repository, story IDs, or run scope]"
---

# Story-driven QA (US-022)

Use the repository's verification skill for the shortest changed user/consumer journey that
can reject this change's plausible failure. Documents-only changes read the published or
rendered text and check affected links or commands. Installed guidance or configuration
changes install, load and read that result. Neither adds an unrelated product walk or login.
When the changed product journey uses sign-in, the walk signs in
to production with the agent's own AgentMail QA account and proves the required
owner/admin role; an email sent or a 200 response is not a sign-in. A missing skill or unprovable owner sign-in is reported, never passed. Screenshots prove appearance, not
persistence or delivery; check consequential state at its actual owner.
Internal edits need proof that they compose.

Disposable data must use the authorized account/integration. Worktrees, browser
tabs and contexts do not themselves isolate server-side state. Clean up only what
you create. Report revision, observed result and unverified scope in the PR.
A missing verification skill needed for the changed journey is added in the change, or the
change stacks on the PR adding it. Missing product verification infrastructure is separate
work for documents-only edits.
Other missing QA infrastructure is separate work unless it prevents proving this fix.
For a recheck, verify only the judge's named blockers and regressions from their fix.
Link existing results for unchanged behavior without collecting them again.
[check-cadence.md](check-cadence.md) owns deleting/rescheduling checks.
