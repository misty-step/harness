---
name: engineering-operations
description: Run engineering work from orientation through review, durable-note capture, and handoff; use for workstation execution and normal merges.
---

# Engineering operations

Orient from the repository's `AGENTS.md`, root `USER_STORIES.md`, existing work
record, and runnable commands. Use an existing issue when relevant; a descriptive
branch and conventional commit work without one. Repository code and versioned
docs own technical facts; work records own priorities, owners, and blockers.

Capture durable findings in that owner's existing repository note or work record.
Search by outcome, including completed/superseded work, and reconcile matches.
Preserve owners, claims, dependencies, decision rationale, and observable
completion; distinguish ideas from accepted work. Keep sensitive raw evidence
in approved storage with sanitized revision-bound links. Read back meaningful
record changes rather than assuming a write succeeded.

Choose the smallest independently shippable outcome and preserve the behavior it
replaces. Discover existing runs and checkouts before starting another. Record
owned repositories and resource leases through `skill://session-close` at the
start, not after switching branches or removing resources.

Load detail for the work at hand:

- [workstation.md](workstation.md): scratch, heavy execution, fleet guard, audio.
- `skill://authenticated-commands`: native auth, credential discovery, `pass-env`.
- `skill://story-qa`: affected real-path proof, verification capability, CI cadence.
- `skill://test-audit`: independent test contracts and pruning.
- `skill://design-studio`: design exploration; `skill://visual-state-review`: rendered states.
- [review.md](review.md): model review, exact-head merge, operator review publication.
- `skill://pokayoke`: close an error class structurally and write its postmortem.
- `skill://sachstand`: status and material decision briefs.

Exercise the changed owner or consumer path and report observed postconditions,
not activity. Update the owning procedure with the behavior. Finish through the
repository's normal review and release path, then `skill://session-close` checks
landing and owned resources. Its checker does not prove deployment or product
correctness; those claims still need observation.
