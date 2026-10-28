# Full audit planning

## Setup and state

Resolve skill root, absolute target, repo identity and source commit/dirty state.
Create a fresh output directory outside the target, by default
`~/security-audit-skill/<repo>/run-<next-unused-N>`. An explicitly selected path
inside the target must be wholly ignored by version control; otherwise use an
external path before starting. Read [safety.md](safety.md) before any execution.

The parent owns `run-metadata.json`, `architecture.md`, `coverage-ledger.json`,
`findings.json`, `REPORT.md`, `FINDINGS-DETAIL.md` and `NEEDS-VALIDATION.md`.
Workers have distinct `agents/<id>/{scratch,artifacts}/` roots, with scratch-only
writes and parent-only bounded promotion into artifacts.

Metadata records `run_id`, `repo`, `target`, `source_ref`, `profile`, `scope_paths`,
`budget` (null when unset), `execution_policy: "sandboxed-source-and-local-only"`,
selected companions, prior-run paths, shared-file owners and
`run_status: "in_progress"`. Candidate state belongs in the ledger/findings, not
another metadata copy.

## Prior runs

Read every compatible prior ledger and findings set. Compare relevant source and
conditions, not just revision labels:

- An unchanged prior confirmation keeps its fingerprint and qualifying evidence,
  enters the current candidate set and a `planned` unit, and excludes only that
  root cause from hunters. Its current independent verifier becomes the unit's
  first owner/check and moves it to `candidate`.
- Changed confirmations become planned revalidation, with no hunter exclusion.
- Prior needs-validation, blocked, deferred, out-of-scope and changed-source units
  remain current work. A still-external needs-validation record carries only
  after a fresh source trace, keeping its blocker and current verifier ownership.
- An unchanged rejection suppresses only that failed claim, not its coverage unit.
  Same-source covered units inform priority without disappearing from the ledger.

Record missing/incompatible prior ledgers. A prior quick/scoped pass contributes
only its recorded evidence and gaps. No run claims exhaustive target safety.

## Profiles

| Profile | Coverage and independent validation |
| --- | --- |
| quick | Coarse surface × boundary × attack-class units; canonical subsystem `profile/quick/all-in-scope-subsystems`; exactly one hunter wave, one final post-wave critic, and one fresh verifier per candidate combining candidate/final checks. Critic discoveries/reassignments stay deferred. |
| standard | Workflow as written: post-wave critics and a distinct final-clean critic; separate fresh candidate and final record verifiers. Default. |
| deep | Split by subsystem/lifecycle, critic waves to clean, separate candidate/final verifiers and independent second passes for prior-covered same-source units. |

Scoped runs seed only in-scope units; excluded discovered surfaces remain
`out_of_scope`, never covered. Quick, scoped and budget-limited reports state
partial coverage. Profiles change breadth/redundancy, not candidate, sandbox,
needs-validation, schema or independent confirmation requirements.

## Invocation budget

A strict budget counts every reconnaissance, hunter, critic and verifier call.
Before reconnaissance, reserve four baseline readers, the quick post-wave critic
or standard/deep post-wave plus distinct final-clean critics, and at least one
verifier. Repeat the gate for each extra focused reader. If it cannot fit, run
nothing: seek narrower scope/profile or a larger budget; unchanged requests end
`incomplete` with `budget_cannot_fund_reconnaissance_and_reserves`.

Before wave one, update the estimate from seeded units and candidate validation
cost. Before every wave reserve its immediate critic, the distinct final-clean
critic for standard/deep, and one/two verifiers per expected candidate according
to profile (30% of the balance after critics when uncertain). Rank hunters within
what remains; never spend the reserve on hunting.

After a wave, spend its immediate critic. Before another wave, reserve its new
critic again. If the minimum cannot fit, launch no hunters; mark untouched planned
units `deferred` with `budget_cannot_reserve_critics_and_validation` and use the
retained final-clean critic to expose gaps. Exhausted critic reserve means
`incomplete_reason: "critic_budget_exhausted"` and no clean-coverage claim.

Unexpected candidates or material final-record replacements may exceed the
validation reserve. Stop hunting, validate in fingerprint order while the strict
budget permits, then set `incomplete_reason: "validation_budget_exhausted"`.
Unvalidated fingerprints stay linked to `candidate` ledger units, not findings
under any verdict. Partial reports list each unresolved fingerprint/unit first.
A budget is never silently exceeded or met by relabelling an unverified candidate.

## Candidate and priority contract

Trace principal → accepted action/input → strongest control → boundary → concrete
result. Use a bounded local observation, not guessed topology or missing best
practice. Recommend the narrowest source fix enforcing the invariant at the last
trusted decision point, plus its regression case. The audit leaves source intact.

Only confirmed records have severity. Overall cannot exceed demonstrated impact:

| Severity | Demonstrated consequence |
| --- | --- |
| critical | Unauthenticated code execution, full datastore access or arbitrary-account takeover |
| high | Full defeat of an explicit control: cross-tenant read/write, authentication bypass, stored script affecting others, authenticated code execution or unauthenticated stop of a shared service |
| medium | Boundary violation with limited blast radius, uncommon conditions or a narrow resource set |
| low | Non-secret internal disclosure or sustained effort for little gain |
| informational | Confirmed minimal impact, mainly a prerequisite to another finding |

Missing deployment/provider/browser/identity facts produce `needs_validation`
with exact blockers and safe local/owner-observed plans, without severity.
Source-refuted or same-principal claims are rejected, not parked for validation.
The final source/local report never asks an owner to launch a live attack.
