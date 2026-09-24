---
name: test-audit
description: Use whenever writing, changing, reviewing, or auditing tests. Gate new tests and audit redundant coverage without losing independent contracts.
---

# Test audit (US-021)

Adapted from [OpenClaw test-audit](https://github.com/openclaw/openclaw/blob/80930af448ebabc84174146b56bc106d37fab3b4/.agents/skills/test-audit/SKILL.md); see [LICENSE](LICENSE) for its MIT notice.

Three modes share one value bar. **Authoring** applies to each new or changed test. **Focused audit** reviews a few high-confidence candidates before editing. **Campaign** covers a whole commissioned subsystem; read [CAMPAIGN.md](CAMPAIGN.md) only for that scope. This skill decides which tests earn their cost; `verification-infrastructure` creates runnable product verification, and real-path proof remains required when the claim needs it. Do not start a wider cleanup because a test edit exposed one.

## Authoring gate

Before adding a test, answer:

1. Which observable behavior, invariant, or independent contract does it protect?
2. Which plausible consumer-visible regression would make it fail?
3. Why does existing coverage not catch that regression? Give each contract a primary owner at the strongest useful boundary. Another layer needs a distinct risk, such as transport or lifecycle behavior the owner cannot reach. Extend a table or keeper rather than replaying the same scenario.
4. Would it require an export, flag, wrapper, global, or injection hook used by no production caller? Test at the real boundary instead of creating a test-only production seam.

If an answer is missing, do not add the test yet. Apply the [junk checklist](#junk-patterns); retain an apparent match only when the [retention bar](#retention-bar) identifies an independent contract it guards. An internal refactor that preserves that contract should not break the test. For a bug, reproduce before repair and show the regression failing on the pre-fix owner for the intended reason when practical; backfill a meaningful regression if a prior failure cannot safely be demonstrated. Do not duplicate the same bug at each layer.

## Junk patterns

Reject or repair tests that only:

- probe coverage without an assertion; compare a value with itself; assert no throw or non-emptiness;
- copy the implementation's fixture, inventory, manifest, export list, computed expectation, or renderer output back to itself;
- grep private source, imports, incidental strings, or call shape rather than an independent contract;
- replay a private predicate, shared helper, or same contract at multiple layers without a distinct risk;
- preserve a test-only export, global, wrapper, or otherwise dead production path;
- assert behavior implemented by the mock rather than by the production owner, or use one mock as if it represented unlike APIs;
- supply the receipt, persistence, admission, or callback order the owner should produce and then assert that supplied value;
- restate a declared capability flag without exercising its promised delivery or acknowledgement;
- pass a negative control because an unrelated guard rejected the request, or name an outcome the inputs and assertions never exercise.

## Retention bar

Keep tests that independently enforce a public API, protocol, configuration, migration, storage, security, platform, release, package, architecture, or generated-artifact contract. Keep order when consumers observe it, credible regressions, and characterization of behavior that must survive a change. A constant, fixture, structural assertion, interaction mock, snapshot, round trip, or scoped smoke check can be valuable when its expectation is independent and its claim accurately states what it proves. Check a public byte, key, or path in the owned artifact when that exact value is the contract; do not mistake a source grep for runtime proof. Static or slow is not a deletion reason.

A test failing on the baseline may expose a product defect. Reproduce and repair its owner instead of deleting it as stale coverage. A test coupled to source organization is suspect, not automatically deletable: first check for a genuine independent contract.

## Focused audit

Keep discovery read-only and report evidence before editing. Read each complete candidate test, its production owner, entry point, callers and callees, sibling implementations, overlapping coverage, CI routing, and relevant history. Inspect dependency source or types when the claim relies on dependency behavior. Follow the repository's scoped guidance. Prefer a few high-confidence candidates to a speculative deletion inventory.

For each proposed removal or consolidation, record:

- exact test and location, and what failure its assertions actually detect;
- non-test callers or external consumers of its production seam;
- the stronger remaining owner-boundary proof, or why no contract needs proof;
- why the test or seam exists, including relevant history;
- production or test-support deletion unlocked, risk, and focused validation command.

Missing evidence means the candidate is not ready for deletion. Choose one coherent owner-boundary batch. Move valuable assertions to their keeper before removing a redundant layer. Remove obsolete test-only production seams rather than keeping aliases. Optimize for confidence and simpler production code, not deletion count; leave uncertain candidates alone.

## Validation and handoff

Use the owning repository's bounded test and verification commands; run the affected owner and sibling tests, then the relevant suite and actual consumer path. Here, `./scripts/verify [selection]` is the canonical bounded check; it reads working unit files but its installer check reads committed HEAD. For a changed install surface, also exercise the source installer in a disposable destination before claiming the working-tree package was deployed. Heavy suites and long-running services follow `skill://using-exe-dev`; local scratch stays run-scoped under `~/.cache/tmp`.

If deleting a static check, execute the script or artifact path that owns its real contract. Inspect the diff, run the repository's required semantic diff review before committing or opening a PR, and do not confuse an advisory finding with proof. Do not mutate tests or source while another runner is using the same checkout. Commit, push, or deploy only when authorized by the task and repository policy.

Report removed low-value categories, production-owner simplification, retained false positives and why they matter, focused and full proof actually run, production versus test changes, and remaining risks. For a campaign, add its ledger and preservation evidence. Do not claim full proof from a narrower smoke check.
