# ADR-024: Prototype a System 1 layer on raw pi, outside the daily profile

Proposed 2026-09-25.

The operator asked for a System 1 / System 2 harness designed from first
principles on raw pi and measured head to head against OMP
([design](../../../docs/system1-system2-harness.md), US-029, US-030). System 1 is
one extension, `extensions/s1s2/`, that runs batched Jev judgments at four loop
boundaries (brief, triage, monitor, done-gate) and fails open to stock pi.

It is deliberately not installed: `./install` does not deploy it and the daily
profile never loads it. Its `run.sh` and the evaluation runner in
`extensions/s1s2/eval/` start pi with an empty agent directory, so the arm under
test is raw pi plus System 1 and nothing else. It lives here because it is
pi-specific. Because it is never materialized, it imports the shared System One
engine and redaction directly from `agent-config`, with no shim.

Alternatives rejected: a fourth top-level component (a topology change for an
unproven experiment) and folding it into the daily profile before any
measurement.
