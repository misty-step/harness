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
slices, production-like QA with representative privacy-safe production-like
data, agent walks of every user story and rigorous verification make this safe.
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
