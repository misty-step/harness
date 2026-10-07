# Foundation Standard

`foundation-standard-v1.json` is the sole normative catalog: applicability,
evidence, dispositions, defaults and exceptions. Its current version is 1.8.1.
The checker enforces structured claims, not product correctness.

Use this standard for commissioned adoption/assessment, not as permission to
widen a bug fix. Existing independent access, migration, privacy and recovery
contracts remain meaningful; documentation or receipt syntax is not their proof.

## Application feedback and brand kit

Application assessments include two catalog obligations:

| Obligation | Assessment |
| --- | --- |
| FND-FBK-001: Agent feedback loop | Trace an exercised structured bug or missing-feature report from the agent endpoint to the project backlog, an agent's draft fix and a person's approval before application. |
| FND-BRD-001: Brand and marketing kit | Inspect the complete kit named in the catalog, including the custom-art marketing page and playable promo video; placeholders are not assets. |

Assess both for applications, including internal tools and private betas; the
constitution's website and portfolio exceptions do not waive them. This guidance
does not install a scheduled auditor or build either obligation in a project.
Existing catalog pins migrate explicitly.

## Lean safety cadence

The approved 2026-10-02 amendment to
[ADR-007](https://github.com/misty-step/harness/blob/master/docs/adr/007-braver-engineers-continuous-deployment.md#lean-ci-amendment-2026-10-02)
changes FND-CHG-002's cadence and FND-REL-001's deployment proof;
`skill://story-qa/check-cadence.md` owns the cadence. Existing pins keep their
adopted contract until deliberately migrated; Glass is the first rollout.

## Existing adoption interface

`foundation.json` pins the catalog ID/version/digest/revision and names surfaces.
The catalog gives each obligation's applicability and evidence. `satisfied`
references a candidate-job `foundation-evidence/1` receipt; committed receipts
are rejected. `pending` is a dated, owned bootstrap gap (maximum 30 days).
`not_applicable`/`exception` reference tracked disposition records assessed through
the repository's normal review. Follow existing records and CLI output rather
than generating another ledger; record syntax is not reviewer authentication.

```sh
foundation-check check
foundation-check affected --base REV
foundation-check receipt PATH --base REV
foundation-check baseline --owner NAME --write
```

`check` validates declared adoption and owner routes; `affected` computes mapped
stories. `receipt` binds an existing executed walk to its candidate and artifacts.
A baselined `unwalked` is advisory, never a pass. Structural checks do not establish
live behavior. Independent exact-head review uses the repository's normal tools.
