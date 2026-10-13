# Check cadence (US-023)

Make end-user verification easy and lean: show the real thing working, not more
checking instead of shipping. Keep few good consumer tests; delete implementation/
wording pins, duplicates, mock echoes and checks costing more than they catch.
Preserve independent access/data/migration/package/protocol/privacy/recovery proof.

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

Migrate useful checks with deployed triggers and existing failure response; remove
repeated PR/main execution rather than layering nightly on top. When runtime matters,
measure the real changed path, not proposed coverage. Glass rolls out first; other
adopted pins retain their cadence until explicitly migrated. No server or plan purchase is authorized.
