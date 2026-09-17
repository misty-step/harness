# Stories

<!-- Root artifact: what users must be able to do. One file, ids never
reused, criteria a check can fail on. skill://user-stories guides edits. -->

## Capability: Verification

## US-001 Verify harness components

Statement: When I make changes to harness components, I want a single canonical
verification command with bounded concurrency, so I can verify observable
behavior without risking workstation failure.

Criteria:
1. WHEN running `./scripts/verify [selection]`, THE SYSTEM SHALL execute all
   selected unit tests with concurrency capped at one.
2. WHEN running `./scripts/verify all`, THE SYSTEM SHALL clone committed HEAD
   and test fresh installer deployments for both Pi and OMP in isolated
   temporary environments.
3. IF any test, installer check, or cross-reference fails, THEN THE SYSTEM
   SHALL exit nonzero and report the failure.

No-gos: no network testing or unapproved remote calls during local verification.

Evidence: `./scripts/verify all`

## Capability: Deployment

## US-002 Deploy shared primitives

Statement: When a harness installs its agent configuration, I want shared
primitives deployed through a single contract, so obsolete files are cleaned up
and foreign configurations are preserved.

Criteria:
1. WHEN a harness installer runs, THE SYSTEM SHALL clean-replace selected
   owned skills and remove retired skills from the agent directory.
2. WHEN guidance is composed, THE SYSTEM SHALL splice declared shared guidance
   sections at the insertion marker.
3. IF unmanaged or foreign files exist in the agent directory, THE SYSTEM
   SHALL preserve them without overwrite.

No-gos: no unowned file deletion or live credential tampering.

Evidence: `./scripts/verify-installers`

## Capability: Execution offload

## US-003 Offload heavy execution to exe.dev

Statement: When an agent needs to run heavy test suites, coverage, browser
verification, or long-running tasks, I want work offloaded to an exe.dev
persistent VM, so workstation desktop RAM and responsiveness are preserved.

Criteria:
1. WHEN an agent identifies a heavy or long-running workload, THE SYSTEM SHALL
   require offloading to an approved exe.dev VM using `skill://using-exe-dev`.
2. WHERE local execution is bounded with explicit concurrency caps, THE SYSTEM
   SHALL permit execution under run-scoped `~/.cache/tmp` scratch.
3. IF an uncontained or unbounded execution is attempted locally, THEN THE
   SYSTEM SHALL reject running on `/tmp` and require explicit concurrency limits.

No-gos: no automatic VM creation without authorized account and spend limits.

Evidence: `agent-config/guidance/host-resources.md`
