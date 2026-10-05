# Rule A shadow selection

`foundation-check test-selection` extends the existing checker. It reads the map exclusively from the supplied trusted base's `foundation.json`, compares that exact base with current main, and binds results to the candidate tree and an input key containing the changed/deleted paths, trusted policy and pinned toolchain. It reports selected tests and reasons separately from passed, failed, skipped, flaky and cached results. Full CI remains blocking. No tests are selected or run from candidate-controlled commands, and no new cache is enabled.

Unknown paths and incomplete maps fall back to the full suite. Changed components select their reverse dependents. Auth, contract, migration, dependency/lockfile and shared-config paths broaden coverage. Candidate selector edits and removed tests cannot grant release eligibility. A moved main or stale runner receipt invalidates eligibility. Selection without a runner receipt is evidence of selection only.

`bun test --max-concurrency=1 agent-config/bin/foundation-test-selection.test.ts` passes 10 CLI tests, including all four acceptance cases in Navi's verdict and injected shared-code, dependency and contract failure receipts. See [output](rule-a-tests.txt). These are synthetic selector tests, not proof that narrower tests detect every application bug. Full Scry CI continues to run.

The Scry adoption PR is a separate branch. The map begins influencing suggestions only after it lands in the trusted base; its adoption candidate itself correctly selects full CI. The existing checker regression suite passes 51 tests. Its test copy changed only the scratch directory from the read-only HOME cache to system tmp; it exercised the actual unchanged CLI entry point. See [regression output](checker-regression-tests.txt). The broad `scripts/check shared` cannot start in this sandbox because its scratch directory is read-only. See [failure](shared-check.txt).

Existing `check`, `affected`, `receipt` and review gates are unchanged. The command defaults to `refs/remotes/origin/HEAD` for current main; callers must refresh it or pass the actual current-main SHA. This comparison does not replace the integration authority's atomic base/head check.

Full-history Gitleaks scans reported five pre-existing findings, and the full working tree reported three pre-existing findings. A scan of `origin/HEAD..HEAD` passed with no findings. No existing secrets or fixtures were changed; independent review remains required before merge.
