# Check cadence (US-023)

First ask whether the check earns its place: name the real consumer failure it
catches and inspect its signal. Delete redundant or paperwork-only checks rather
than merely moving them. Keep independent access, data-safety and recovery proof.

For a repository deliberately migrated to catalog 1.7.0's lean cadence (ADR-007):
- Before merge: engineer-run affected-contract proof, independent exact-head
  review and cheap secret/privacy scans. No automatic PR or PR-target CI.
- Main candidate: build once, deploy isolated production-like preprod, prove
  affected real journeys and consequential access/data/migration/recovery
  boundaries, then automatically promote the same bytes and read back production.
  Broaden proof for shared or uncertain impact; do not substitute a path filter.
- Nightly/on demand: the complete suite and every live story at a recorded main
  revision. Check completion and route failed or missing runs to the existing
  approved triage intake and owned repair; coordinate with its alert owner.

Nightly accepts delayed broad-regression detection, not fail-open shipping.
A demonstrated defect in the shipping candidate stops that candidate; unrelated
nightly red is not a blanket veto. Preserve hosted runners, existing scanners,
artifact identity, serialization and non-destructive rollback.

Migrate useful checks with their deployed triggers and existing failure response,
not by adding the nightly suite on top of repeated PR/main execution. Measure the
real changed path when runtime matters; do not call proposed schedules observed
coverage. Glass is the first rollout; other adopted pins retain their cadence
until explicitly migrated. No server or plan purchase is authorized.
