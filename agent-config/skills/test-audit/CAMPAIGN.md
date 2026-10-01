# Subsystem test-audit campaign (US-021)

For a commissioned whole subsystem, apply [SKILL.md](SKILL.md)'s value bar.
Pin the baseline and inventory every in-scope test file/QA scenario with its
result; separate baseline failures and production counts from test/support counts.

Partition by production owner, including shared/live paths. Give each complete
declaration/table one evidence-backed ledger decision:
- **R** retain: independent contract and plausible regression.
- **F** fix: sound contract, wrong/vacuous assertion.
- **C** consolidate: keeper absorbing valuable assertions.
- **D** delete: remaining proof or absent contract.

Review redundant layers before cutover: name keepers, moved assertions, retired
suites, CI changes, and unlocked seams. Correct uncertain decisions first.
Move regressions before removal, one owner batch at a time; serialize shared
support edits and exercise distinct affected paths.

An independent reviewer compares deleted assertions with remaining proof.
Negative cases reach their named guard. For uncertain restored coverage, mutate
the production owner in an isolated exercise to prove failure, then restore it
exactly. A mock-supplied result is not that proof.

Repair product failures in separate changes; reconcile contracts if the base
moves. Report baseline/final counts, keepers, preservation findings, defects,
observed checks, and limits.
