---
name: check-cadence
description: Tier product checks between fast pull-request feedback and owned nightly or weekly runs without losing meaningful protection.
disable-model-invocation: true
argument-hint: "[repository, CI workflow, or check set]"
---

# Check cadence (US-023)

Use when designing or changing a repository's verification schedule. `skill://test-audit` decides whether a test protects an independent contract; this skill decides when valuable checks run. A slow test is not necessarily junk, and a fast test is not necessarily useful. Do not change another product's CI merely because this harness recommends a cadence.

## Map before moving

Read the root stories, current CI workflows, local commands, runtime/failure history, and any required security/release gates. For each check under consideration, name the consumer failure it catches, unique contract owner, dependencies, typical duration, failure signal, and current run trigger. Identify duplicate paths with `skill://test-audit` before scheduling them twice. If duration is unknown, measure a representative run rather than guessing from file count. Preserve legally or operationally mandated gates; do not move a check simply to meet a numeric target.

| Tier | Default use | Tradeoff |
| --- | --- | --- |
| Local/changed-path | Narrow owner check and a real affected consumer journey during development | Fastest diagnosis; does not claim all-product coverage. |
| Pull request | Bounded deterministic contracts, build/type safety, required security gates, and a small representative smoke where feasible | Target minutes to actionable feedback, not a 45-minute all-suites rerun. Keep checks that can block a bad merge. |
| Nightly | Heavy end-to-end/integration/device/browser matrices, broader story walks, and slow compatibility checks | Detects cross-cutting failures after merge; assign an owner and response path. |
| Weekly | Full, expensive, exploratory or long-horizon matrices and rotation of less frequent stories | Wider coverage with longer discovery latency. |

Tier by risk, runtime, and feedback value, not by test filename. Promote a scenario to PR if delaying its failure would make an unacceptable release or security regression; demote only when a faster independent guard or explicit delayed detection makes the risk tolerable. Prefer one primary owner boundary and a small number of independently valuable cross-boundary journeys over duplicated suites. Keep pre-merge policy/security checks and critical migrations where the organization requires them. Use the product's runner and an explicit concurrency/resource budget; heavy work uses the approved off-host vehicle. Do not introduce a scheduler, hosted credentials, or spend without authority.

## Make delayed detection real

For each moved check, update both its command and trigger together: a nightly/weekly workflow or existing scheduled agent run, named owner, failure notification/triage, artifacts and cleanup, and a way to run it on demand before a risky release. If those do not exist, keep the check at its current cadence or present the gap as a proposal; never silently drop it from PR. Regular story QA through `skill://story-qa` complements automated end-to-end checks and must have its own actual run and report. Document what a green PR does **not** prove and which later run will test it.

Compare measured PR wall time and failure diagnosis against the baseline, then check the first scheduled run's observed result. If the schedule is not yet deployed, report a proposal rather than claiming faster CI or coverage. Don't add a second all-suite pass solely as proof of this policy change.
