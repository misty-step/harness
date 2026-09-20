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
7. WHEN reviewing working tree diffs, THE SYSTEM SHALL include untracked files
   by default unless explicitly disabled.
8. WHEN a diff exceeds context limits, THE SYSTEM SHALL chunk changes by file
   and hunk boundaries, evaluating chunks in parallel without truncation.

No-gos: no fabricated probability or confidence numbers in live sessions; no
live credential storage on disk; no uncredentialed blocking of interactive turns;
no silent truncation of multi-file diffs.
Evidence: `omp-config/bin/omp-diff-review.test.ts`, `omp-config/extensions/diff-review/diff-review.test.ts`, `pi-config/extensions/diff-review/diff-review.test.ts`

## US-010 Bounded continuation nudge

Statement: When an agent settles with unfinished actionable work inside the
user's existing request, I want one bounded advisory continuation nudge from
Jev, so the agent can advance carried-forward work without looping, without
stalling on permission or external events, and without the classifier ever
becoming authority.

Criteria:
1. WHEN the agent settles with unfinished, actionable work in the user's
   existing request and Jev returns `nudge` with sufficient confidence, THE
   SYSTEM SHALL inject exactly one bounded advisory continuation message and a
   marker, triggering a single follow-up turn.
2. WHEN the request is complete, a direction is undecided, or progress needs
   permission, information, or an external event, THE SYSTEM SHALL not nudge.
3. WHEN the previous nudge in the same user-prompt span saw no new tool
   result, THE SYSTEM SHALL not nudge again and SHALL not call Jev.
4. WHEN Jev is unreachable, uncredentialed, or returns an unusable answer,
   THE SYSTEM SHALL fail open and end the run like stock.
5. WHEN nudges accumulate, THE SYSTEM SHALL bound consecutive nudges per user
   prompt (default 2, `JEV_NUDGE_MAX`) and SHALL NOT trap the loop.
6. WHEN `JEV_NUDGE_MODE=off`, THE SYSTEM SHALL behave like stock (no message,
   no decision log).

No-gos: no tool, permission, or merge gate; no authorization for new work; no
credentials, whole transcripts, or file contents in classifier state; no
unbounded loop.

Evidence: `agent-config/system-one/continuation.test.ts`,
`pi-config/extensions/continuation-nudge/`, `omp-config/extensions/continuation-nudge/`

## Capability: Visual verification

## US-006 Review named UI states

Statement: When I ship a visual change, I want every named UI state captured
and organised, so I can see how each state looks before the work is called
verified.

Criteria:
1. WHEN frontend work is claimed verified, THE SYSTEM SHALL present a named-state
   matrix whose captured files match the declared state list.
2. WHEN a declared captured state has no screenshot, THE SYSTEM SHALL treat that
   state as unverified and `scripts/gallery.py --check` SHALL exit nonzero.
3. WHEN a state cannot be produced, THE SYSTEM SHALL record it as skipped with a
   reason rather than omit it.
4. THE SYSTEM SHALL keep PNG capture artifacts out of Git by default.

No-gos: not a pixel-diff CI product; not a replacement for journey tests.

Evidence: `agent-config/skills/visual-state-review/scripts/gallery.test.ts`
