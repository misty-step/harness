# ADR-007: Engineer authority and continuous deployment safety

Status: Accepted 2026-09-30. Phaedrus dictated this outcome through Kaylee:
engineers are braver, opinionated and autonomous; continuous deployment is a
foundation every app is built to, not a ticket. An invented Nopalito README
rule that a human operator must release prompted the decision.

Approval source: the originating operator request, relayed by Kaylee on
2026-09-30: “Continuous deployment is the default for every app: merge to main
deploys everywhere” and “What makes that safe is agile slices, a production-like
QA environment with production-like data, every user story walked by agents,
rigorous verification, and automatic rollback.” This is direct authorization
for the foundation amendment, not a repository exception requiring an
`approval_ref` record.

## Decision

Engineers act with full authority for the requested outcome, state their own
stance on software, testing and docs, and reason from first principles. They
own quality through production and never invent approval gates or human-only
steps. Actual permission boundaries, material operator decisions and explicit
review stops remain binding. This is not authority to bypass a repository gate,
copy private data, spend beyond an approved budget or change product intent.

Merge to the default branch deploys everywhere. Small independently shippable
slices and production-like QA with representative privacy-safe data make this
safe. The 2026-10-02 amendment below sets the candidate and nightly cadence.
Release health checks automatically roll a bad release back to the last healthy
version without losing accepted writes or requiring destructive data restoration;
a recorded drill proves that path.
Missing safety mechanisms are engineering work, not a reason to invent a human
release ritual.

## Consequences

Shared guidance reaches both Pi and OMP through the existing composition
contract (US-002). Foundation catalog 1.6.0 strengthens FND-REL-001's QA and
rollback evidence, keeping the constitution, catalog and rationale aligned
(US-024). This authorized amendment to ADR-005 changes no other obligation,
exception authority or recorded tenant-exclusion mechanism. Existing pinned
adoptions are unchanged until explicitly re-pinned under ADR-006; this PR does
not claim to implement deployment or rollback in other apps.

The sibling-repository audit is read-only. Kaylee dispatches those fixes; this
change does not edit or release those repositories. No live harness installation
is part of this change.

## Lean CI amendment (2026-10-02)

Status: Accepted. Phaedrus approved the radical-CI recommendation, relayed by
Kaylee in the Lean CI first-rollout brief: no automatic PR CI; main builds once
and deploys preprod; exact-candidate targeted proof then automatic promotion;
full suite nightly; hosted runners and no server purchase.

Catalog 1.7.0 amends FND-CHG-002 (safety cadence) and FND-REL-001 (deploy proof):

1. Engineers exercise changed contracts, obtain independent review and run cheap
   secret/privacy scans before code reaches main. No automatic `pull_request`
   or `pull_request_target` build, test, foundation or model-review workflow.
   An explicit pre-merge scan is not abandoned merely because its old trigger
   was PR automation.
2. Every main candidate is an immutable revision, built once and deployed to
   isolated preprod with representative synthetic or sanitized data. Read back
   revision and digest; prove affected real journeys there. Access allow/deny,
   data preservation, migration compatibility and recovery remain candidate
   proof. Shared dependencies, lockfiles, deployment configuration and uncertain
   impact need broader relevant proof, not optimistic path filters.
3. Automatically promote those same bytes only after successful candidate-bound
   proof. No rebuilding moving main, release PR, human promotion or unrelated
   nightly wait. Serialize promotions; older slow candidates cannot replace
   newer ones. Do not cancel an in-progress migration. Observe production identity
   and one read-only critical journey; retain the previous known-good artifact.
   Existing non-destructive automatic rollback and tenant obligations remain.
4. Run the complete regression suite and every live story nightly and on demand
   at a recorded main revision. This deliberately accepts later broad-regression
   detection and does not prove intermediate commits. Check completion, including
   delayed or missed schedules; a cron declaration is not a successful run.
5. Nightly failures and missing runs must scream through the existing approved
   `kaylee-alert-intake` and become owned repair or revert work. The nothing-fails-
   silently engineer owns that design. Do not create a second alert path.
   Nightly red is not a blanket shipping veto, but a demonstrated defect in the
   candidate being shipped is its failed proof. Failed or missing preprod proof
   always stops production promotion.

This supersedes ADR-003's automatic PR cadence and ADR-005's blanket candidate
gate only for explicitly migrated pins. It does not waive security, privacy,
independent review, tenancy, migrations or rollback. Existing security metadata
checks retain cheap pre-main scanning and blocking authorization proof, accepting
explicit scan dispatch and main authorization jobs without requiring automatic
PR CI. Their receipts must retain exact-head runtime evidence rather than claim
an automatic PR job ran. This reconciles FND-SEC-001's trigger wording, not a
waiver of its independent security contracts.

Rollout is Glass only after the harness amendment, with an independent
cross-family review on each PR, one real lean deployment and one real nightly.
Other repositories, including this harness's own workflow triggers, wait for
separate tickets after Glass is proven. No live harness installation, server or
plan purchase is part of this amendment.

