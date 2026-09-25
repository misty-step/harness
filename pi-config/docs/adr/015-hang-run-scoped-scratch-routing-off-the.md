# ADR-015: Hang run-scoped scratch routing off the `pi()` launch hook

Accepted 2026-09-15.

Element A3-pi of the 2026-09-15 workstation pressure
report: the [scratch-routing design](../../../omp-config/references/scratch-routing.md) specifies the mechanism —
run-scoped `TMPDIR` under `~/.cache/tmp/runs/<run-id>`, an owner trap, and a
`flock`-keyed sweep, proven by an executed five-act POC — and its §6.2 assigns
deployment to the launcher owners. This repo owns the launcher for pi:
`~/.bashrc`'s marked `pi()` block (ADR-010). The hook now composes scratch
routing with the existing key injection, selecting the runner through an
array so the empty case stays a plain launch. Decisions recorded:

- **Injection point only.** `omp-scratch` and the run lifecycle stay in
  omp-config (§6.1). Reimplementing the owner in a dotfile would create a
  second lifecycle that drifts — the unowned hand-edit class the design
  rejects, of which the shell's shared `TMPDIR` export is the existing proof.
- **Fail-open, deliberately.** No `omp-scratch` degrades to that shared
  bridge; no pass entry degrades to plain pi. A launch must not depend on
  scratch infrastructure, and the bridge's failure mode is disk growth, not
  desktop pressure.
- **The ADR-014 prose is not shrunk yet.** Routing is not deployed until
  `bin/omp-scratch` lands; that is ADR-014's own review trigger, and
  `scratch-routing.md` §6.4 says the same.
- **The residual gap is named, not papered over.** GUI, herdr, and systemd
  launches never run this function and get no run-scoped `TMPDIR`; that needs
  a systemd user environment or an Omarchy-level default.

Deployed by hand to the marked block, per ADR-010. Verified: `bash -n` on the
source block and the live file, and the four degradation branches exercised
with stubs, asserting the exact argv and that nothing is written outside
`~/.cache/tmp`.
