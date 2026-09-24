---
name: story-qa
description: Walk a curated set of user stories through the real product surface as an agent; record observable results and gaps.
disable-model-invocation: true
argument-hint: "[repository, story IDs, or run scope]"
---

# Story-driven agent QA (US-022)

Use for product QA, not as a substitute for a unit suite or for writing new test infrastructure. `skill://user-stories` owns story intent; `skill://verification-infrastructure` repairs a missing runnable path. This skill uses the paths already owned by the product. A browser script can help set up or repeat a journey, but a passing script alone is not an agent walk.

## Curate once, walk often

Start with the repository's `USER_STORIES.md` and its existing product QA procedure. Maintain a short, product-owned walk list: story ID, why it matters, entry point, representative identity/data, actions on the end-user surface, independently observable postconditions, and safe cleanup. Include a core journey, a meaningful failure/recovery path, and changed or high-risk stories; keep a small PR-relevant selection and rotate the rest through regular scheduled QA. Record the selection and cadence in the product, not in harness-wide inventory. An unrun story is **not verified**; an outdated walkthrough needs repair before it can prove anything. Do not mint a story just to inflate the list or rewrite operator intent.

For a change, pick affected criteria and the shortest journey that could expose a plausible user-visible failure. Reuse a recent result only if candidate revision, target, data, and risk are still applicable; don't replay the same scenario in every layer or rerun unaffected checks for ceremony. For recurring QA, walk the curated list on the agreed cadence and rotate neglected/error paths. Regular QA is an owned run with a report, not an assertion that a CI schedule exists.

## Interact and observe

Use the same interface a user has: browser for web, native UI for desktop, real commands for CLI, or an executable consumer for a library. Set up through supported fixtures/APIs when needed, then perform the user actions on that surface and inspect the resulting state there. For consequential claims, corroborate persistence or delivery independently where the user surface cannot show it. Prefer native interaction tools and the product's existing setup; Playwright may automate repetition but cannot replace looking, acting, and checking the user's outcome. For visual changes, use `skill://visual-state-review` for the affected named states; do not infer backend success from screenshots.

Use authorized test identities, disposable data, and owned cleanup. A test environment or agent role does not authorize publishing, financial/legal/medical actions, permission changes, or destructive operations. Pause for the required approval rather than substituting a fake success. Heavy browser runs and services follow `skill://using-exe-dev` and host-resource policy.

## Report what happened

For each selected story, record candidate revision, target/environment, identity class (not credentials), action path, expected and observed postconditions, pass/fail/blocked/skipped, and the reason for any gap. Keep a concise redacted capture or output where it distinguishes success from plausible failure. Report cleanup and untested criteria. A passing local walk does not certify a hosted deployment; a scheduled run of another revision does not certify this change. File genuine defects against their owner; do not turn a failed walk into another tautological test.
