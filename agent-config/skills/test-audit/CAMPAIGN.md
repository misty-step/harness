# Subsystem test-audit campaign (US-021)

Use this only when the requested scope is a whole subsystem's test surface. The authoring gate, retention bar, candidate evidence, and validation in [SKILL.md](SKILL.md) still apply. A focused audit does not silently become a campaign. Follow the repository's branch, review, and resource rules rather than OpenClaw's release workflow.

## 1. Baseline

Pin the candidate revision. Record every in-scope test file and QA scenario, its pass/fail result, and test/support versus production line counts. Treat a baseline failure as a possible product defect, not permission to prune it.

Done when every in-scope file has a result and baseline failures are separate.

## 2. Lanes and ledger

Partition by production owner boundaries, including shared-boundary cases and live/QA paths, so every test declaration belongs to exactly one lane. Run read-only discovery lanes in parallel when useful. For each declaration, read its full parameter table, production owner, callers, history, overlapping tests, and CI route. Mark it:

- **R** retain: name the independent contract and credible bug it catches;
- **F** fix assertion: keep the contract but repair a vacuous or wrong check;
- **C** consolidate: name the existing keeper that absorbs its distinct assertion;
- **D** delete: name the remaining proof, or why no contract exists.

Split table rows only if they require different decisions. Judge assertions rather than titles. Record one evidence line per decision before editing.

Done when every declaration and QA scenario has a mark and evidence.

## 3. Layer plan

A second read-only pass looks for redundant *layers*, not just weak tests. Name the keeper for each contract, the assertions that move into it, retired suites, test-only production seams unlocked, and CI routing changes. Prefer a real consumer boundary with controlled external dependencies to a mocked collaborator that supplies the result. Correct ledger mistakes before cutover.

Done when every retired layer has an identified owner and no unique contract disappears.

## 4. Cutover

Edit one owner-boundary batch at a time; serialize shared support-file changes through one owner. Move retained regressions and assertions first, then remove redundant tests and test-only exports, injection parameters, globals, getters, or wrappers. Update CI registration and affected verification procedures. Do not add a new keeper that merely restates the same implementation.

Done when each keeper and its affected sibling tests pass.

## 5. Preservation review

Have an independent reviewer compare deleted assertions with remaining proof, grouped by owner boundary. Check that negative cases reach the guard claimed and that restored assertions can actually fail. For a restored contract whose effect is uncertain, deliberately mutate the production owner in an isolated exercise and confirm the keeper goes red; restore the source exactly afterward. Do not use a passing test-only mock as proof of a production defect.

Done when every reported gap is restored or rejected with source evidence and the restored contracts have credible failure proof.

## 6. Product defects and reconciliation

A retained baseline failure is a bug investigation. Repair the owner in a separately reviewable change and confirm failing control versus passing candidate on the same consumer path. Record unrelated discrepancies for a separately authorized task. If the base branch changes during a long campaign, reconcile new contracts into keepers and rerun the affected and whole-subsystem paths; use the repository's merge policy rather than assuming a branch strategy.

Hand off the baseline and final test/support and production counts separately, lanes and keepers, preservation gaps and failure checks, product defects, exact proof run, and remaining limits. Campaign work ends at the commissioned subsystem; a second subsystem needs its own scope decision.
