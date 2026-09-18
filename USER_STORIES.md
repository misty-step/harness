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

## Capability: Session close

## US-004 Close session-owned host resources

Statement: When I finish a session that created git worktrees or exe.dev VMs, I
want a single check that fails until those creates are leased and then dropped,
so leftover machines and trees cannot be treated as done.

Criteria:
1. WHEN a worktree or exe.dev VM is created in-session, THE SYSTEM SHALL record
   a lease via `session-close.ts add` in the same turn.
2. WHEN any lease remains, `session-close.ts` SHALL exit nonzero.
3. IF the lease directory is empty of valid leases, THEN `session-close.ts`
   SHALL exit 0.
4. IF a lease file is corrupt, THEN `session-close.ts` SHALL exit nonzero
   without treating the store as clean.

No-gos: no destruction of unleased or standing VMs; no global scan of other
sessions' worktrees; no network in the unit check.

Evidence: `agent-config/skills/session-close/session-close.test.ts`

## Capability: Semantic Review

## US-005 Semantic diff review and security sentinel

Statement: When an agent produces working tree diffs, I want continuous semantic
evaluation against our standing harness principles, security rules, and pokayoke
invariants using a System One decision model, so violations and credential leaks are
intercepted before commit without token or latency waste.

Criteria:
1. WHEN diff review runs with neither `OPENROUTER_API_KEY` nor `TYPESAFE_API_KEY`
   configured, THE SYSTEM SHALL report disabled-uncredentialed status without
   fabricating confidence scores or failing live turns.
2. WHEN evaluating diffs via OpenRouter (`typesafe/jev-1.13`) or TypeSafe direct,
   THE SYSTEM SHALL encode queries to the native System One API schema
   (`map<string, Question>` with Noul, Choice, and Score).
3. IF a diff contains an active credential, unmasked disk secret, or authority
   escalation, THEN THE SYSTEM SHALL flag a hard block.
4. IF a diff silences an error or handles invalid state after occurrence rather
   than eliminating root cause, THEN THE SYSTEM SHALL flag a pokayoke violation.
5. WHEN the OMP or Pi extension is installed, THE SYSTEM SHALL load all review modules
   self-contained from the deployed extension directory.
6. WHEN testing offline or without remote keys, THE SYSTEM SHALL evaluate using
   deterministic heuristics only under explicit request (`--provider heuristic` or
   `MOCK_SYSTEM_ONE=1`).

No-gos: no fabricated probability or confidence numbers in live sessions; no
live credential storage on disk; no uncredentialed blocking of interactive turns.

Evidence: `omp-config/bin/omp-diff-review.test.ts`, `omp-config/extensions/diff-review/diff-review.test.ts`, `pi-config/extensions/diff-review/diff-review.test.ts`
