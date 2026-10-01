# Foundation Standard

`foundation-standard-v1.json` is the sole normative catalog: applicability,
evidence, dispositions, defaults and exceptions. Its current version is 1.6.0.
The checker enforces structured claims, not product correctness.

Use this standard for commissioned adoption/assessment, not as permission to
widen a bug fix. Existing independent access, migration, privacy and recovery
contracts remain meaningful; documentation or receipt syntax is not their proof.

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
