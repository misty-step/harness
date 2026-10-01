# Check cadence (US-023)

Change a commissioned repository's schedule by failure risk and measured runtime,
not filenames. `skill://test-audit` decides whether a check earns its cost; this
procedure decides when it runs.

Read stories, CI, native commands, failure history, and required security/release
gates. For each candidate, identify its consumer failure, independent owner,
dependencies, duration, signal, and current trigger. Measure unknown runtime.

- Local/changed-path: narrow owner check plus the affected real consumer journey.
- PR: bounded deterministic contracts, build/type safety, required security gates,
  and representative smoke. Aim for minutes of actionable feedback.
- Nightly: heavy integration/device/browser matrices and broader story walks.
- Weekly: expensive exploratory or long-horizon coverage and less frequent paths.

Delayed detection is acceptable only with an explicit risk tradeoff or a faster
independent pre-merge guard. Keep mandated security, migration, and release gates;
a slow test is not automatically junk. Use the product's runner and explicit
concurrency budget; heavy work follows workstation execution policy.

When moving a check, change its command and deployed trigger together. The later
run needs an owner, failure notification/triage, artifacts, cleanup, and an
on-demand path before risky releases. Without those, retain the current cadence
or report a proposal. Regular agent story walks complement automation and need
their own observed runs.

Compare measured PR wall time and diagnosis with the baseline, then inspect the
first scheduled run. Document what green PR checks do not prove. An undeployed
schedule proves no coverage or speedup; avoid a duplicate all-suite run solely
as ceremony.
