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

## Capability: Context stewardship

## US-007 Advise compaction at a completed unit

Statement: When a harness session reaches a settled turn, I want a System One
judgment on whether the current unit of work is finished and hands-on, so
compaction is suggested near a safe boundary and never forced by a model guess.

Criteria:
1. WHEN context usage is below the configured minimum (40,000 tokens) or
   unknown, THE SYSTEM SHALL skip the judgment without a remote call.
2. WHEN the composed score clears the usage-dependent floor (0.90 through 10%
   used, relaxing to 0.50 by 90%), THE SYSTEM SHALL present a hint to run
   `/compact`.
3. IF the provider is unavailable or the answers are unusable, THEN THE SYSTEM
   SHALL fail open and present nothing.
4. WHERE the session is fully interactive and auto mode is explicitly enabled
   (`PI_COMPACT_HINT_AUTO=1`), THE SYSTEM MAY trigger compaction; THE SYSTEM
   SHALL NOT trigger compaction in unattended modes.
5. THE SYSTEM SHALL treat the judgment as advisory: never a permission or
   pre-tool gate, no fabricated scores, and one kill switch
   (`COMPACT_ADVISER_DISABLE`).

No-gos: no third-party compact-adviser package; no compaction from a failed
judgment; no transcript state above the request cap.

Evidence: `agent-config/system-one/compact.test.ts`,
`pi-config/extensions/compact-hint/decide.test.ts`

## Capability: Delegation review

## US-008 Judge a child summary after the run

Statement: When an agent delegates a run to a child, I want one advisory
verdict on the child's summary, so a reviewer sees pass, fail, or uncertain
before trusting the claim.

Criteria:
1. WHEN `jev-verdict` receives a child summary on stdin, `--file`, or `--text`,
   THE SYSTEM SHALL print one JSON verdict of `pass`, `fail`, or `uncertain`.
2. WHEN the provider is unavailable, the key is missing, or the summary is
   empty, THE SYSTEM SHALL print `uncertain` and exit 0.
3. IF the summary reports an unresolved blocker or unfinished work, THEN THE
   SYSTEM SHALL return `fail`; IF it claims results without evidence, THEN THE
   SYSTEM SHALL return `uncertain`.
4. THE SYSTEM SHALL redact credential shapes and cap the state at 32,000 bytes
   before any request.
5. THE SYSTEM SHALL remain advisory: exit 0 for every judgment, never a merge
   oracle or a failing gate.

No-gos: no merge decision, no permission gate, no unredacted state.

Evidence: `agent-config/bin/jev-verdict.test.ts`
