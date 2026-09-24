---
name: story-qa
description: Before done, adversarially review work and walk affected user stories on the real product surface.
argument-hint: "[repository, story IDs, or run scope]"
---

# Story-driven agent QA (US-022)

Use for completion review and product QA, not as a substitute for a unit suite or for writing new test infrastructure. `skill://user-stories` owns story intent; `skill://verification-infrastructure` repairs a missing runnable path. This skill uses the paths already owned by the product. A browser script can help set up or repeat a journey, but a passing script alone is not an agent walk.

## Required before done

For every task, derive the outcomes to challenge from the request or ticket and applicable root user stories; a ticket is not required. Review the entire change yourself, including every touched caller and relevant user path. Actively look for counterexamples: boundary inputs, failure and recovery, permissions, state transitions, unintended side effects, and claims unsupported by observation. A model review, passing suite, or teammate review does not replace this adversarial pass. Repair what fails and recheck the affected path; name any genuine blocker rather than quietly calling the work done.

For user-facing changes, invoke this skill by default and manually walk each affected story criterion through the real end-user interface on the candidate revision. One journey may cover several criteria; do not run unrelated stories for ceremony. Test the plausible failure as well as the happy path where risk warrants it. If the real surface cannot be reached, mark the affected criteria unverified and do not claim the change done. For docs-only or internal work, still self-review and exercise the relevant documentation, configuration, installer, or internal consumer path; do not fabricate a product walk.

## Curate once, walk often

Where the repository has `USER_STORIES.md`, start there and with its existing product QA procedure; otherwise derive criteria from the request or ticket. Maintain a short, product-owned walk list: story ID or request criterion, why it matters, entry point, representative identity/data, actions on the end-user surface, independently observable postconditions, and safe cleanup. Include a core journey, a meaningful failure/recovery path, and changed or high-risk stories; keep a small PR-relevant selection and rotate the rest through regular scheduled QA. Record the selection and cadence in the product, not in harness-wide inventory. An unrun story is **not verified**; an outdated walkthrough needs repair before it can prove anything. Do not mint a story just to inflate the list or rewrite operator intent.

For a change, cover the affected criteria with the shortest journeys that could expose plausible user-visible failures; a single walk can defend several criteria. Reuse a recent result only if candidate revision, target, data, and risk are still applicable; don't replay the same scenario in every layer or rerun unaffected checks for ceremony. For recurring QA, walk the curated list on the agreed cadence and rotate neglected/error paths. Regular QA is an owned run with a report, not an assertion that a CI schedule exists.

## Interact and observe

Use the same interface a user has: browser for web, native UI for desktop, real commands for CLI, or an executable consumer for a library. Set up through supported fixtures/APIs when needed, then perform the user actions on that surface and inspect the resulting state there. For consequential claims, corroborate persistence or delivery independently where the user surface cannot show it. Prefer native interaction tools and the product's existing setup; Playwright may automate repetition but cannot replace looking, acting, and checking the user's outcome. For visual changes, use `skill://visual-state-review` for the affected named states; do not infer backend success from screenshots.

Use authorized test identities, disposable data, and owned cleanup. A test environment or agent role does not authorize publishing, financial/legal/medical actions, permission changes, or destructive operations. Pause for the required approval rather than substituting a fake success. Heavy browser runs and services follow `skill://using-exe-dev` and host-resource policy.

## Report what happened

For each selected story or request criterion, record candidate revision, target/environment, identity class (not credentials), action path, expected and observed postconditions, pass/fail/blocked/skipped, and the reason for any gap. Keep a concise redacted capture or output where it distinguishes success from plausible failure. Report cleanup and untested criteria. A passing local walk does not certify a hosted deployment; a scheduled run of another revision does not certify this change. File genuine defects against their owner; do not turn a failed walk into another tautological test.
