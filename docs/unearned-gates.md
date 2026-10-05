# Self-made gates: ranked subtraction recommendations

2026-10-01. Recommendations for the owning repository engineers, not permission
to edit those repositories or bypass a failing product contract. Rank combines
reported delay and how directly the check measures the failure. Source audit only;
no remote test or workflow was run. The reported two-day enrollment delay,
release/rollback failures and 20-MiB admission refusal are operator observations.

| Rank | Owner / gate | Delete or shrink | Proof to retain |
|---|---|---|---|
| 1 | **Tach: claims/prose hash ledger** | Delete `site/generate/claims.ts` as a merge veto and retire prose-digest refresh artifacts. A changed sentence is not an enrollment failure. | Correct enrollment and accurate docs; package SHA/manifest checks when binding shipped bytes. |
| 2 | **Harness: review title/description hashes and rerun-label choreography** | Delete invalidation on PR prose edits and the `agent-review` label round trip / separate `foundation-review` approval bookkeeping. Keep one independent exact-code review through the normal owner. | Supported code/security/data-loss findings, observed CI, and refreshed review when relevant code or base changes. |
| 3 | **Tach: destructive migration matrix attached to enrollment repair** | Delete the cross-product matrix from this ticket; split unrelated migration machinery. Keep the actual new-RPC probes, not a blanket waiver. | Current-person/machine authorization, foreign-person refusal, non-disclosure, read-only inspection, source membership and active-key preservation. |
| 4 | **Tach: product-contract migration refusal / review-header gate** | Delete `-- tach: contract-reviewed <reason>` as machine proof of review and the resulting header-only refusal. Have the normal exact-code review assess the actual migration, rather than require a second prose attestation. | Real compatibility/authorization probes, data preservation and the bounded live-traffic lock timeout; do not waive review of destructive changes. |
| 5 | **Harness: broad admission veto for a lightweight reviewer** | Delete the unconditional fixed free-memory floor veto; have the resource owner replace it with demand-aware admission. Do not loosen limits or restart the fleet in this change. | Serialized admission, actual cgroup/ancestor ceilings, bounded children and operator capacity. The observed 20-MiB refusal is not a new reproduction. |
| 6 | **Habitat: full fresh migration replay on every non-doc change** | Delete replay from unrelated app-only changes; scope it to schema/migrations/bootstrap/DB guards and their dependencies. | Fresh replay, upgrade/projection negative controls and generated-type checks on DB-impacting changes. |
| 7 | **Habitat: migration-lineage SHA refresh obligation** | Delete `database.types.migrations.sha256` as a separate artifact obligation; compare candidate-schema-generated types with checked-in types instead. Index-only SQL need not change a hash-only receipt. | Real resulting-schema/type comparison and migration checks. Replacement requires candidate DB access. |
| 8 | **Glass: release reruns the complete project gate** | Delete release's duplicate `scripts/check` execution; publish only after canonical CI succeeds for the exact SHA. | Keyed privacy scan, canonical lint/tests, release build, checksums and publisher. |
| 9 | **Tach: standalone Intel-Mac adversarial package gate** | Delete the duplicate archive/manifest portion; move genuinely platform-specific checks to the relevant changed-path run. Whole-gate deletion is conditional on the owner showing overlap. | One approved-byte check and actual macOS enrollment/install behavior where platform-specific. Linux helpers do not prove native receiving. |
| 10 | **Nopalito: drill-marker credential-name exception** | Delete name/prefix-specific exemptions and do not add a broad extra preflight gate. Use the exact non-authenticating public marker value, with all other sensitive values rejected. | Credential isolation, final-candidate canary and complete prior-image recovery. PR275's unit results do not establish rollback success. |
| 11 | **Nopalito: duplicate manual release-stage receipts/checklists** | Delete narrative gates that reassert the same executable stage predicates. Do not delete stage/build/canary/snapshot/switch merely because recovery failed. | Ready restore point, exact source/image, live readback/health and safe recovery preserving accepted writes. A scheduled snapshot or exit 0 is insufficient. |
| 12 | **Harness: universal catalog-to-approval paperwork** | Delete the requirement to turn every ordinary repair into a foundation assessment, per-test ledger, approval/disposition refresh or separate QA-platform commission. Engineer guidance now keeps this out of normal fixes; the checker owner should simplify remaining adoption machinery separately. | Actual consumer proof and applicable access/data-safety contracts. Commissioned architectural assessment can still use the catalog. |

## Evidence and limits

- **Tach**: [PR254](https://github.com/r90group/agent-usage-telemetry/pull/254)
  and [diff](https://github.com/r90group/agent-usage-telemetry/pull/254/files);
  [`claims.ts`](https://github.com/r90group/agent-usage-telemetry/blob/main/site/generate/claims.ts)
  rejects stale claims digests (including a distinct held exit), not actual runtime
  behavior. [`check-migration-rollout.ts`](https://github.com/r90group/agent-usage-telemetry/blob/main/scripts/check-migration-rollout.ts)
  checks ahead-of-release migrations against declared verifier files. Delete the
  unrelated matrix, not verification of the two new RPCs. PR reports SQL execution
  and hosted native qualification still outstanding; those are real evidence gaps.
  Current PR descriptions, not independently inspected raw CI logs, support the
  package-test recommendation. Do not label the whole Intel-Mac suite redundant.
  [`release-safety.ts`](https://github.com/r90group/agent-usage-telemetry/blob/main/scripts/release-safety.ts)
  accepts any alphanumeric reason in the contract-reviewed header. That is not
  evidence of review; it is separate from the executable lock-timeout constraint,
  which cannot be waived by that header.
- **Harness (historical evidence)**: At the inspected revision, `agent-review.ts`
  hashed PR title/description, recorded base/merge-base and toggled a label;
  `foundation-review.yml` was the separate review job; `foundation-check.ts`
  required tracked approval/disposition records. The review prompt required a
  demonstrated blocking defect and OMP did not install review choreography.
  These are historical source references, not current commands or gates.
  **Kaylee-owned taste criticism earns a place as an advisory critique** of scope,
  simplicity and deep modules, not a second automatic approval gate. Retain the
  standing independent-review policy unless its owner changes it.
  `omp-engineer.py` at that snapshot used a 20-GiB free-memory scale-up floor
  plus full-leaf reservations and ancestor headroom. Recommendation 5 is a design
  change for that owner, not a claim these different bounds are interchangeable
  or that a constant can safely be reduced arbitrarily.
- **Habitat**, inspected revision `dd5870c1edf7aa6a9017e4eb24551eecae9e9701`:
  [replay scheduling](https://github.com/r90group/habitat/blob/dd5870c1edf7aa6a9017e4eb24551eecae9e9701/.dagger/src/index.ts#L540-L580),
  [type/hash checker](https://github.com/r90group/habitat/blob/dd5870c1edf7aa6a9017e4eb24551eecae9e9701/scripts/check-db-types.mjs#L1-L23).
  Scope/cheaper-proof recommendations are architectural judgments, not measured
  speedups. Keep real affected-story walks; receipt binding alone is not proof.
- **Glass**, inspected revision `d96b23a9a1c9e2f57568f0787e36d43f93202e23`:
  [CI](https://github.com/misty-step/glass/blob/d96b23a9a1c9e2f57568f0787e36d43f93202e23/.github/workflows/ci.yml#L1-L25),
  [duplicate release check](https://github.com/misty-step/glass/blob/d96b23a9a1c9e2f57568f0787e36d43f93202e23/.github/workflows/release.yml#L29-L60).
  No run history was inspected; exact-SHA CI dependency must replace the removed
  invocation. Privacy and read-only product boundaries remain independently useful.
- **Nopalito**: infrastructure [PR275](https://github.com/r90group/infrastructure/pull/275)
  and [release contract](https://github.com/r90group/infrastructure/blob/main/nopalito/DEPLOY.md).
  At audit, PR275 reports primary restored, CD disabled and final-candidate recovery
  still unproven. Its drill-tag repair concerns infrastructure, not nopalito-home.
  Recommendations 10–11 are narrow subtraction, not permission to ship without recovery.

Mutable `main` links identify inspected implementations, not revision-pinned
verification. Repository owners should inspect the current candidate before acting.
