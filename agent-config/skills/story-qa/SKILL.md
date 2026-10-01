---
name: story-qa
description: Review completion and walk affected stories on the real product; repair missing verification or CI cadence when commissioned.
argument-hint: "[repository, story IDs, or run scope]"
---

# Story-driven QA (US-022)

Use the product's existing walk for the shortest real user/consumer journey that
can reject this change's plausible failure. Screenshots prove appearance, not
persistence or delivery; check consequential state at its actual owner.
Docs/internal edits need composition or owner-path proof, not a fake UI journey.

Disposable data must use the authorized account/integration. Worktrees, browser
tabs and contexts do not themselves isolate server-side state. Clean up only what
you create. Report revision, observed result and unverified scope in the PR.
Missing QA infrastructure is separate work unless it prevents proving this fix.
[check-cadence.md](check-cadence.md) owns deleting/rescheduling checks.
