---
name: story-qa
description: Review completion and walk affected stories on the real product; repair missing verification or CI cadence when commissioned.
argument-hint: "[repository, story IDs, or run scope]"
---

# Story-driven QA (US-022)

Use the repository's verification skill for the shortest real user/consumer journey that
can reject this change's plausible failure. When the product has sign-in, the walk signs in
as the actual owner identity on the real product; an email sent or a 200 response
is not a sign-in. A missing skill or unprovable owner sign-in is reported, never passed. Screenshots prove appearance, not
persistence or delivery; check consequential state at its actual owner.
Docs are walked as their reader uses them: the published or installed text. Internal edits need
proof that they compose. Neither gets a fake UI journey.

Disposable data must use the authorized account/integration. Worktrees, browser
tabs and contexts do not themselves isolate server-side state. Clean up only what
you create. Report revision, observed result and unverified scope in the PR.
A missing verification skill is added in the change, or the change stacks on the PR adding it.
Other missing QA infrastructure is separate work unless it prevents proving this fix.
[check-cadence.md](check-cadence.md) owns deleting/rescheduling checks.
