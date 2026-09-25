# ADR-014: Carry the host-resource rule into every pi session

Accepted 2026-09-15.

The 2026-09-09 workstation memory-exhaustion class recurred on
2026-09-15 (omp-config's postmortem; the workstation pressure report, §B1),
and the report found one of the gaps in this repo: `global/AGENTS.md`
(ADR-012) carried only pokayoke, so every pi session on this machine —
including the sessions doing the heavy local work — was never told the host's
resource discipline. Scratch landed in `/tmp` (46 GiB of RAM tmpfs), runner
fan-out ran uncapped (one two-project run observed at 16 workers × ~4 GiB),
a second fleet stacked on a live first fleet, and artifacts accumulated
without bound. Pi and OMP are two harnesses that share conventions, not
files, so the rule must be written in both global files; ADR-012 already
made `global/AGENTS.md` the hook that reaches every pi session, and this
fills its content. It is pi's own expression of the rule, not a copy of
omp-config's § Execution environments: OMP's file names an offload vehicle
(`skill://using-exe-dev`) pi does not own, so pi's file says "off-host by
default" without harness-specific pointers. The section stays five sharp
rules because the file loads into every session's context and length is a
real cost:

- Scratch and evidence go to a run-scoped `TMPDIR` under `~/.cache/tmp`
  (disk), never `/tmp` (the 46 GiB RAM tmpfs).
- Heavy execution — full suites, coverage, browser/Electron verification —
  runs off-host by default or in a bounded local scope with an explicit
  worker budget.
- Runner concurrency is capped in repo config, never left to host defaults.
- No second fleet: check for a live run before starting one; stop only the
  scope this session owns.
- Artifacts are bounded: scoped to the run that made them, not accumulated.

Per the report's §6 this is the transition bridge, not the structural fix:
the durable levers are harness-level `TMPDIR` routing, `dev-exec.slice`
admission, per-repo runner caps, and CI/CD owning the heavy checks. It is
also the standing pointer — the report's §B3 is the argument against
restating the rule across the 63 repository `AGENTS.md` files under
`~/development`; repository files add to the global rule (as the file's own
header states), never restate it.
