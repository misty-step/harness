# Verification

Canonical entry point: `./scripts/verify [all|shared|pi|omp|workspace]` from any cwd.
Requires Git, Bun >=1.4.2, jq, a POSIX shell, and Python 3 for shared gallery checks. No bootstrap, provider credentials,
or installed harness is needed. Unit suites read working files; the installer
check deliberately clones committed HEAD. Commit installer changes before using
that evidence. Both source identity and dirty-tree status are reported.

## Resource boundary

Tests run sequentially with Bun concurrency capped at one. All scratch is
run-scoped under `~/.cache/tmp` and removed on ordinary exit. Run:

```sh
./scripts/verify all
```

CI uses one job, the same command, and a 15-minute timeout. No browser, Electron,
model, cloud resource, or installed harness is needed. All scratch is run-scoped
under `~/.cache/tmp` and removed on ordinary exit; interrupted runs may leave an
owned directory. Remove only that directory once its process has ended.

## Observable contracts

- `scripts/references.test.ts` checks tracked Markdown file targets and canonical
  `harness/blob/master/` URLs against the working tree. It also deploys all shared
  skills and both guidance compositions into disposable directories and rejects
  missing/out-of-package references, including legacy backticked `references/`
  paths. Regression fixtures reproduce the original defect and package escapes.
  This is a CI guard, not an installer preflight or general Markdown/network
  crawler: external web availability, anchors, `skill://` discovery, and arbitrary
  prose/code paths need semantic review.
- `scripts/workspace-inventory.test.ts` creates real local Git repositories and
  worktrees to check external paths, nested repositories, dirty and prunable
  states, and non-destructive failure reporting while continuing past unreadable
  directories; it does not inspect or clean the host's worktrees.
- Existing shared, pi and OMP suites exercise component logic.
- `omp-config/bin/omp-task-usage.test.ts` checks price-weighted whole-tree cost,
  failed-task inclusion, unknown/unpriced evidence, split-task worker ownership,
  scope escape, malformed archives and content-free reporting (US-018).
- `omp-config/extensions/credentials/credentials.test.ts` checks stable opt-in
  credential context and recovery deduplication with a synthetic names-only store
  (US-019). The [token-efficiency procedure](token-efficiency.md) records the
  native pre-dispatch smoke and the separate task-quality promotion gates; unit
  assertions are not evidence of model quality or production cache savings.
- `scripts/verify-installers` clones committed HEAD and runs both actual installers
  with a sanitized environment, synthetic HOME, agent directories and development
  root. It prints individual PASS/FAIL results and exits nonzero on any failure.
- Exact guidance composition is compared with the committed intro/sections.
- Launcher bytes and executable bit must match the shared source.
- Foreign skill and synthetic auth files must remain byte-identical.
- Disposable clone and destinations are removed on exit.

`workspace` runs shell syntax, reference tests, and both installer checks without
component unit suites. All selections run both installer checks because their shared contract is
cheap to exercise. These checks do not claim scope-discovery, idempotence, native
extension loading, rendering, provider calls or OAuth validity. Component tests
cover some related behavior; consult their actual assertions before claiming it.
For changed native behavior use the fresh-session procedures in component READMEs.

Never pipe verification through tail without preserving its exit status. Do not
substitute a successful tool invocation or file presence for a postcondition.

## Selecting evidence (US-001)

Before changing uncertain behavior, identify plausible failures and choose checks
that distinguish the intended outcome from them. Prefer real consumer journeys
for complex changes; keep focused isolated tests for contracts and failure paths
that a journey cannot cover reliably or safely. Do not retain tests that merely
mirror implementation. For end-to-end evidence, record the exact revision,
repeatable setup and command, observed postconditions, and redacted output or
captures where relevant; passing one path does not prove another.

## Git hook setup

`./scripts/bootstrap` checks scanner availability and selects `.githooks` as the
repository hook directory. It refuses a foreign local hooksPath rather than taking
ownership silently. Pre-push scans outgoing commits with gitleaks and the worktree
with trufflehog; neither check is bypassed for migration. Runtime installers do
not configure Git hooks. Prose-only edits call for consistency review; changed
deployed guidance also needs composition inspection, not a model run.
