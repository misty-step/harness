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

## US-021 Keep test coverage meaningful

Statement: When agents write or prune tests for either harness, I want each
contract defended at its useful owner boundary, so refactoring does not produce
redundant tests or lose independent regression coverage.

Criteria:
1. WHEN Pi or OMP selects shared skills, THE SYSTEM SHALL provide the same
   `test-audit` authoring, focused-audit, and optional campaign instructions.
2. WHEN an agent writes or changes a test, THE SYSTEM SHALL direct it to name
   the independent contract, plausible failure, existing owner, and any
   test-only production seam before adding coverage.
3. WHEN an agent proposes deleting or consolidating a test, THE SYSTEM SHALL
   require evidence of what it detects, remaining proof or lack of contract,
   relevant history, and a focused validation path before editing.
4. IF a whole-subsystem campaign is commissioned, THEN THE SYSTEM SHALL require
   a baseline, per-declaration ledger, keeper plan, and preservation review;
   OTHERWISE it SHALL keep the audit within the requested scope.

No-gos: no automatic portfolio sweep, model gate, or OpenClaw-specific runner
commands in a portable skill.

Evidence: `scripts/references.test.ts`,
`agent-config/skills/test-audit/SKILL.md`,
`agent-config/skills/test-audit/CAMPAIGN.md`,
`agent-config/guidance/communication-and-verification.md`,
`./scripts/verify all`; working-tree disposable installer smoke for both consumers.

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
`pi-config/extensions/continuation-nudge/` (pi only; OMP retired).

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

## Capability: Design exploration

## US-011 Explore divergent designs before committing UI

Statement: When a task has real UI/UX surface, I want divergent design
directions explored and synthesized into one defensible recommendation before
production UI code is written, so I can commit to a direction on evidence
instead of the first plausible mockup.

Criteria:
1. WHEN a task has real design surface (a new surface, a reimagining, a flow
   change, or focused component or motion work), THE SYSTEM SHALL run the
   `skill://design-studio` loop before production UI code is written.
2. WHEN a concept set is produced, THE SYSTEM SHALL name every concept with a
   surface archetype and a one-sentence divergence claim and SHALL never
   present two concepts that are the same structure with different paint. WHEN
   the set holds three or more concepts, THE SYSTEM SHALL span conservative,
   evolutionary, and radical possibilities.
3. WHEN concepts are critiqued, THE SYSTEM SHALL judge each against the primary
   user job rather than taste alone, record what it optimizes, sacrifices, wins
   for, and offers to keep, and recombine the strong pieces into one synthesized
   direction before refinement.
4. WHEN generated mockups are used, THE SYSTEM SHALL present them as visual
   proposals for early IA, navigation and content-model, layout, typography,
   hierarchy, component and content-hierarchy composition, and visual language
   (including exact labels and copy when the evaluation target needs them), and
   SHALL verify exact copy, behavior, and accessibility on rendered HTML/CSS
   with named-state QA (`skill://visual-state-review`); generated images SHALL
   never count as proof of UX, accessibility, or behavior.
5. WHEN exploration closes, THE SYSTEM SHALL hand off a DESIGN.md-compatible
   spec validated by the design-md CLI or the bundled structural fallback, and
   SHALL keep rejected options with their reasons in the lineage.
6. WHEN the bundled image adapter runs a batch, THE SYSTEM SHALL enforce the
   exploratory cost cap against caller-supplied price evidence; IF the price is
   unknown or non-finite, THEN THE SYSTEM SHALL fail closed before any spend.

No-gos: not a replacement for user research or journey tests; no fabricated or
numeric taste scores or model-vote winners; no further exploration round
without new evidence or a named open decision; no committed screenshots or
binary artifacts; no secrets or sensitive product data in prompts or artifacts.

Evidence: `agent-config/skills/design-studio/SKILL.md`,
`agent-config/skills/design-studio/references/loop.md`,
`agent-config/skills/design-studio/references/rubric.md`,
`agent-config/skills/design-studio/references/media-policy.md`,
`agent-config/skills/design-studio/references/handoff.md`,
`agent-config/skills/design-studio/scripts/check_design_md.test.ts`,
`agent-config/skills/design-studio/scripts/imagine.test.ts`,
`agent-config/guidance/design-routing.md`

## Capability: Design-surface verification

## US-013 Check player-surface copy before done

Statement: When a design-surface change is about to be called done, I want the
deterministic copy checks from the design-toolkit trial run over the changed
player surfaces, so leaked engineering vocabulary, dash characters, and
placeholder text are caught before acceptance instead of after.

Criteria:
1. WHEN a design-surface change is called done, THE SYSTEM SHALL run
   `design-check` over the changed player-surface paths and SHALL route each
   reported finding to the file and line that produced it.
2. WHEN player copy sits on its own lines between tags, spans lines, or
   surrounds an interpolation, THE SYSTEM SHALL scan it all the same.
3. WHEN a finding is intentional, THE SYSTEM SHALL suppress it with a
   `design-check: ignore` comment on that line rather than weakening the rule.
4. WHEN a harness installer deploys shared guidance, THE SYSTEM SHALL deploy
   the `design-check` launcher with it, so the guidance step resolves outside
   this repository.

No-gos: no gate on taste; no mandatory vendor install; no model calls or
network from the check itself; API-route and other backend code stays out of
the scoped surface list.

Evidence: `agent-config/bin/design-check.test.ts`,
`agent-config/guidance/design-routing.md`,
`docs/decisions/002-design-toolkit-trial.md`

## Capability: Model routing

## US-014 Use subscriptions before paid model recovery

Statement: When I start or delegate work in OMP, I want working subscription
models selected for everyday roles and provider recovery before paid API routes,
so routine work uses the accounts I already have without making login failure
look like additional capacity.

Criteria:
1. WHEN a fresh OMP session or bundled worker selects a daily, `smol`,
   `commit`, review, or deep role, THE SYSTEM SHALL resolve its configured
   model to the corresponding authenticated Codex or Anthropic subscription
   route; WHERE `tiny` selects an on-device model, THE SYSTEM SHALL retain
   Luna as its configured cloud option before paid API routes.
2. IF a selected provider fails, THEN THE SYSTEM SHALL offer an image-capable
   subscription route from another provider before a paid OpenRouter route;
   WHERE the primary is Sol, THE SYSTEM MAY first try Luna on Codex.
3. WHEN configuration is deployed, THE SYSTEM SHALL preserve OAuth stores and
   the model already selected in existing sessions.
4. WHEN a configured role or provider-failure link selects Luna, THE SYSTEM
   SHALL request max reasoning; WHEN one selects Sol, THE SYSTEM SHALL request
   xhigh reasoning.

No-gos: no copying OAuth credentials between harnesses; no Pi default change
without Pi-native subscription authentication.

Evidence: `omp-config/config.yml`, `omp-config/global/AGENTS.md`,
`omp-config/README.md`, `./scripts/verify omp`, fresh OMP role-selection
and provider smoke checks.

## Capability: Protected releases

## US-015 Publish verified harness releases

Statement: When a harness change merits a release, I want its generated
changelog reviewed by the required CI gate before publication, so release
automation cannot bypass protection on the default branch.

Criteria:
1. WHEN a verified `master` change warrants a release, THE SYSTEM SHALL stage
   the generated changelog in a pull request instead of pushing directly to
   protected `master`.
2. WHEN that pull request passes the required `verify` check, THE SYSTEM SHALL
   merge it through branch protection before publishing its version tag and
   GitHub Release.
3. IF the release candidate has not landed or its tag points to a different
   commit, THEN THE SYSTEM SHALL refuse publication.
4. WHEN the release workflow is retried, THE SYSTEM SHALL preserve an already
   published version without duplicating its changelog or moving its tag.

No-gos: no default-branch rule bypass and no unverified release commit.

Evidence: `.github/workflows/landmark-release.yml`,
`../landmark/crates/landmark/src/protected_release.rs`, the protected release
workflow run and published tag.

## Capability: Workspace hygiene

## US-016 Inspect local checkout residue

Statement: When development checkouts accumulate, I want to see registered
worktrees and their Git-visible changes in one read-only inventory, so I can
decide what to retain without guessing from directory names or age.

Criteria:
1. WHEN inspecting a development directory, THE SYSTEM SHALL enumerate
   repositories and their registered linked worktrees, including paths outside
   that directory.
2. WHEN a registered worktree has changes or Git marks it prunable, THE SYSTEM
   SHALL distinguish that state from a Git-clean worktree.
3. WHEN inventory cannot inspect a repository or worktree, THE SYSTEM SHALL
   report the failure and exit nonzero without deleting any files, refs, or VMs.

No-gos: no automatic deletion, no inference that a clean branch is merged or
inactive, and no claim that Git status accounts for ignored build outputs.

Evidence: `scripts/workspace-inventory.ts`,
`bun scripts/workspace-inventory.ts ~/development`

## Capability: Desktop theme alignment

## US-017 Follow the local desktop theme in OMP

Statement: When I change the desktop theme, I want OMP's terminal colors to
follow the locally generated palette, so the two interfaces stay legible together.

Criteria:
1. WHEN the Omarchy theme integration has generated `omarchy-system.json`,
   THE SYSTEM SHALL select it for both dark and light terminal backgrounds.
2. WHEN the harness installs OMP configuration, THE SYSTEM SHALL preserve the
   generated theme file rather than overwriting it with a static repository copy.

No-gos: no generated palette committed to the repository or requirement that
non-Omarchy hosts provision this local theme.

Evidence: `omp-config/config.yml`, `omp-config/install`,
`omp config get theme.dark`, `omp config get theme.light`,
`~/.omp/agent/themes/omarchy-system.json`.

## Capability: Task cost evidence

## US-018 Measure whole-task token cost

Statement: When I compare harness changes, I want scoped, price-weighted usage
for complete task trees, so cheaper requests cannot conceal more turns, failed
tasks, or expensive background agents.

Criteria:
1. WHEN analyzing an explicit task manifest, THE SYSTEM SHALL include recorded
   parent, worker, advisor, and auxiliary model usage, keeping uncached input,
   output, cache reads, and cache writes separate.
2. WHEN all task outcomes and prices are known and at least one task succeeds,
   THE SYSTEM SHALL divide total cohort cost, including failed tasks, by the
   number of successful tasks; OTHERWISE it SHALL report the metric unavailable.
3. IF a manifest double-counts events, escapes its session directory, or reads
   malformed records, THEN THE SYSTEM SHALL fail without a partial report.
4. THE SYSTEM SHALL emit aggregate metadata rather than transcript text,
   commands, tool arguments, or credentials.

No-gos: no inferred success from an agent's final message; no catalog estimate
presented as an invoice; no automatic scan outside the selected session directory.

Evidence: `omp-config/bin/omp-task-usage.test.ts`,
`omp-config/bin/omp-task-usage.ts`

## US-019 Compare on-demand credential context

Statement: When I evaluate prompt overhead, I want an opt-in credential
discovery pointer instead of the full pass inventory, so I can measure cost
without removing authentication recovery or changing normal sessions.

Criteria:
1. WHERE `OMP_CREDENTIAL_CONTEXT=on-demand` is set before extension loading,
   THE SYSTEM SHALL inject a stable discovery pointer without listing pass
   entries in the startup prompt.
2. WHEN an authentication failure or unavailable-credential claim occurs,
   THE SYSTEM SHALL retain targeted credential reminders in either mode, with
   at most one claim follow-up per matching entry and one for unmatched claims.
3. WHEN the experiment is not selected, THE SYSTEM SHALL retain the full
   inventory behavior; a later environment change SHALL NOT change the mode
   of an already loaded extension.

No-gos: no credential values in prompts, no weaker lookup-order guidance,
no default promotion without task-level quality and cost evidence.

Evidence: `omp-config/extensions/credentials/credentials.test.ts`,
`docs/token-efficiency.md`

## US-020 Receive an executive status brief

Statement: When I ask for sachstand, I want a concise, evidence-based status
brief identifying its session and decisions, with optional speech, so I can
orient across concurrent work without changing that work.

Criteria:
1. WHEN invoked, THE SYSTEM SHALL identify the project, task and repository
   context and distinguish verified outcomes from open work and inferences.
2. WHEN a decision is needed, THE SYSTEM SHALL state options, consequences,
   recommendation and missing information without taking that decision.
3. WHERE `quiet` is requested, THE SYSTEM SHALL skip speech; OTHERWISE it
   SHALL attempt speech and report the audio path, duration and estimated cost,
   or report the speech error while retaining the written brief.

No-gos: no unrequested project mutations or decisions during a status brief.

Evidence: `agent-config/skills/sachstand/SKILL.md`,
`agent-config/skills/sachstand/scripts/speak.ts`; native online synthesis smoke
produced a two-second WAV with `--no-play` on 2026-09-24.
