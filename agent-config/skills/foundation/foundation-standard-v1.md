# Foundation Standard

`foundation-standard-v1.json` is the sole normative catalog: applicability,
evidence, dispositions, defaults and exceptions. Its current version is 1.7.0.
The checker enforces structured claims, not product correctness.

Use this standard for commissioned adoption/assessment, not as permission to
widen a bug fix. Existing independent access, migration, privacy and recovery
contracts remain meaningful; documentation or receipt syntax is not their proof.

## Lean safety cadence

The approved 2026-10-02 amendment to
[ADR-007](../../../docs/adr/007-braver-engineers-continuous-deployment.md)
changes FND-CHG-002's cadence and FND-REL-001's deployment proof. No automatic
PR or PR-target CI: engineers verify affected contracts, obtain independent
review and run cheap secret/privacy scans before merge. Main builds one immutable
candidate, runs it on isolated production-like preprod, proves affected journeys,
then automatically promotes the same bytes. Mandatory access, data, migration,
artifact identity and recovery proof stays on the candidate path.

The complete suite and every live story run nightly and on demand at a recorded
main revision. Nightly is delayed broad detection, not a blanket shipping veto.
Failures and missed runs need an owner and the existing approved triage route;
the alert owner designs the scream, not a second per-repository notifier.
Failed or absent preprod proof always stops that candidate's production promotion.

Existing pins keep their adopted contract until deliberately migrated. Glass is
the first rollout; other repositories and harness CI triggers are unchanged.
Hosted runners stay; no server or plan purchase is authorized.


## Existing adoption interface

`foundation.json` pins the catalog ID/version/digest/revision and names surfaces.
The catalog gives each obligation's applicability and evidence. `satisfied`
references a candidate-job `foundation-evidence/1` receipt; committed receipts
are rejected. `pending` is a dated, owned bootstrap gap (maximum 30 days).
`not_applicable`/`exception` reference authenticated designated-review decisions;
exceptions expire within 30 days. Follow existing repository records and CLI
output rather than generating another ledger.

```sh
foundation-check check
foundation-check affected --base REV
foundation-check receipt PATH --base REV
foundation-check baseline --owner NAME --write
```

`check` validates declared adoption and owner routes; `affected` computes mapped
stories. `receipt` binds an existing executed walk to its candidate and artifacts.
A baselined `unwalked` is advisory, never a pass. Structural checks do not establish
live behavior. Review/approval orchestration belongs to Kaylee, not this skill.

## Where the real proof belongs

- Changed behavior: exercise the actual consumer path and relevant boundaries.
- Migration/release: prove compatibility, exact shipped identity and recovery
  without losing accepted writes. Do not infer success from a scheduled snapshot.
- Security: exercise allowed/denied identities and keep secrets out of committed
  code. Authenticated operations, not credential file presence, establish access.
- Operations: useful errors keep cause, release and environment; material failures
  and silent outside checks reach the agent triage intake and an owned repair.
- Telemetry: keep private content out; telemetry failure must not stall the product.

The product's existing runner, release script and native tracker own these paths.
No new platform, waiver paperwork or universal test matrix is implied here.
