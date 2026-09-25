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

## US-022 Review work and walk product stories as an agent

Statement: When I assess a change or recurring product health, I want agents
to challenge their own work and walk affected user stories through the user's
real interface before calling user-facing work done, so I can see what actually
works rather than trusting automated tests alone.

Criteria:
1. WHEN Pi or OMP installs shared skills, THE SYSTEM SHALL provide an
   agent-invocable `story-qa` and route user-facing change review to it by
   default from composed guidance.
2. WHEN an agent prepares to call work done, THE SYSTEM SHALL direct it to
   adversarially review the entire change and verify the relevant path,
   proportionately for documentation-only and internal work.
3. WHEN selecting a QA walk, THE SYSTEM SHALL tie each affected journey to a
   root story ID or request criterion, user actions, observable postconditions,
   and owned cleanup.
4. WHEN a user-facing walk runs, THE SYSTEM SHALL report the candidate revision,
   actual end-user interface, observed outcomes, and unverified or blocked
   criteria rather than treating an automated pass as the walk.
5. WHILE reviewing recurring product health, THE SYSTEM SHALL guide rotation
   through a curated story list without requiring every story on every PR.

No-gos: no Playwright-only proof, invented browser walk for internal work,
universal receipt format, or scheduler created by installing a skill.

Evidence: `scripts/references.test.ts`,
`agent-config/skills/story-qa/SKILL.md`,
`agent-config/guidance/communication-and-verification.md`;
disposable Pi and OMP installer smoke.

## US-023 Keep verification cadence useful

Statement: When I plan repository checks, I want fast, risk-relevant pull
request feedback and owned slower runs on a regular cadence, so a green PR
means something without rerunning an expensive full suite each time.

Criteria:
1. WHEN Pi or OMP installs shared skills, THE SYSTEM SHALL provide
   `check-cadence` and route CI tiering decisions to it from composed guidance.
2. WHEN proposing a check moved off PR, THE SYSTEM SHALL require its independent
   contract, delayed-detection risk, scheduled trigger, owner, and failure
   response; IF those are missing, THEN THE SYSTEM SHALL leave the gate intact.
3. WHILE choosing PR checks, THE SYSTEM SHALL prioritize bounded meaningful
   contracts and required security gates over duplicated or slow full suites.
4. WHEN claiming improved cadence, THE SYSTEM SHALL distinguish measured PR
   feedback from proposed or observed nightly/weekly coverage.

No-gos: no implicit deletion of required gates, unapproved recurring spend, or
CI change to Habitat or Tach in this harness PR.

Evidence: `scripts/references.test.ts`,
`agent-config/skills/check-cadence/SKILL.md`,
`agent-config/guidance/communication-and-verification.md`;
disposable Pi and OMP installer smoke.

## US-024 Enforce repository foundations with required checks

Statement: When I change a project, I want its foundations checked against
its declared standard and affected user journeys, so an incomplete map or
unwalked behavior cannot be mistaken for release evidence.

Criteria:
1. WHEN a repository adopts the Foundation Standard, THE SYSTEM SHALL validate
   every catalog obligation and approved default against the pinned catalog
   digest and report pending items as needs-evidence, not compliance passes.
2. IF required project documents, mapped live stories, tracked source globs,
   or the verify-skill sections are missing, THEN THE SYSTEM SHALL fail the
   repository check with the deficient item named.
3. WHEN a base revision is supplied, THE SYSTEM SHALL identify live stories
   affected by source files, feature files, and edited story sections.
4. IF a walk receipt omits or fails an affected story, reports a set of
   criterion numbers that differs from that story's numbered criteria at HEAD
   (missing, duplicated, or extra), cites an unlisted or tampered artifact, or
   names a different head or tree, THEN THE SYSTEM SHALL reject it.
5. WHEN a receipt binds the candidate head and tree, passes every affected
   story and criterion, and matches all cited artifact digests, THE SYSTEM
   SHALL accept it.

No-gos: no deployment, automatic waivers, or replacing an actual story walk
with a syntactic receipt check.

Evidence: `agent-config/bin/foundation-check.test.ts`,
`agent-config/skills/foundation/foundation-standard.test.ts`;
`bun agent-config/bin/foundation-check.ts --help`.

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

Statement: When an agent needs to run heavy suites, browser verification, or
long-running services, I want execution in my project's owned exe.dev workspace,
so desktop responsiveness is preserved without case-by-case VM approval.

Criteria:
1. WHEN an agent starts heavy or long-running execution from the workstation,
   THE SYSTEM SHALL direct it to the project's `<project>-ws` workspace through
   `ws`; WHERE a CI job runs on a GitHub-hosted runner, THE SYSTEM SHALL treat
   it as already off the workstation (operator decision 2026-09-25).
2. WHERE checks are bounded with explicit low concurrency caps, THE SYSTEM
   SHALL permit local execution with run-scoped `~/.cache/tmp` scratch.
3. IF execution requires an additional VM beyond the one project-owned VM
   covered by the 2026-09-25 standing approval within the $40 exe.dev plan,
   THEN THE SYSTEM SHALL require separate operator approval.
4. WHILE stage A is in effect, THE SYSTEM SHALL keep agent sessions and model
   credentials on the desktop.

No-gos: no automatic additional VM or model-credential transfer.

Evidence: `agent-config/guidance/host-resources.md`,
`omp-config/global/AGENTS.md`

## US-025 Work in an owned exe.dev project workspace

Statement: When I need to execute and collect evidence away from my local
checkout, I want a repeatable project workspace, so my source and proof stay
attached to the task without moving my agent credentials.

Criteria:
1. WHEN `ws up --task T` runs, THE SYSTEM SHALL push a snapshot including
   non-ignored untracked files and create a remote task worktree without changing
   the local index or HEAD.
2. WHEN the local working tree matches committed HEAD, THE SYSTEM SHALL check
   out that exact commit on the VM so story-walk receipts bind the same HEAD.
3. WHEN `ws run --task T --env NAME -- cmd` runs, THE SYSTEM SHALL execute in
   the remote worktree with login PATH and forward named values only over stdin.
4. WHEN remote evidence is generated, THE SYSTEM SHALL copy requested files
   locally with SHA-256 digests via `ws pull --task T`.
5. IF any remote evidence is unpulled or changed, THEN THE SYSTEM SHALL refuse
   `ws down --task T` without removing the worktree.
6. WHEN a task worktree is brought up or down, THE SYSTEM SHALL add or drop its
   owner-scoped lease while preserving the standing VM.
7. IF a VM named `<project>-ws` exists without the `ws` tag, THEN `ws` SHALL
   refuse to adopt or modify it.

No-gos: no transfer of model credentials or automatic removal of project VMs.

Evidence: `agent-config/bin/ws.test.ts`

## Capability: Session close

## US-004 Close session-owned host resources

Statement: When I finish a session that created worktrees or non-standing VMs,
I want a check scoped to my own live leases, so unrelated sessions can continue
and stale resources receive deliberate review.

Criteria:
1. WHEN a local worktree or non-standing exe.dev VM is created in-session,
   THE SYSTEM SHALL record an owner-scoped lease in the same turn.
2. WHEN the caller owns live leases, `session-close.ts check` SHALL exit 2;
   WHEN only foreign leases remain, THE SYSTEM SHALL exit 0 and print them.
3. WHEN an expired, orphaned, or legacy ownerless lease exists,
   `session-close.ts review` SHALL list it and exit 3 without deleting it.
4. IF a lease file is corrupt, THEN `session-close.ts` SHALL exit 1 without
   treating the store as clean.
5. WHEN a lease is dropped by target, THE SYSTEM SHALL print its recorded owner.

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
9. WHEN an OMP session reviews a diff without a Jev key in its environment,
   THE SYSTEM SHALL read the OpenRouter key at runtime through `pass-env` from
   the names-only `jev.env.pass` mapping, keep the value out of the process
   environment and disk, record each review's provider and resolved model in
   `diff-review.jsonl`, and show a `no-key` status when resolution fails.

No-gos: no fabricated probability or confidence numbers in live sessions; no
live credential storage on disk; no uncredentialed blocking of interactive turns;
no silent truncation of multi-file diffs.
Evidence: `omp-config/bin/omp-diff-review.test.ts`, `omp-config/extensions/diff-review/diff-review.test.ts`, `omp-config/extensions/diff-review/jev-key.test.ts`, `pi-config/extensions/diff-review/diff-review.test.ts`

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
`docs/adr/002-design-toolkit-trial.md`

## Capability: Model routing

## US-014 Use subscriptions before paid model recovery

Statement: When I start or delegate work in any harness, I want my model policy
applied per role (Claude Opus 5.5 preferred and orchestrating, Opus for
anything visual, GPT-6 workhorse subagents with Sol and Luna at max, Astra at
high or above for system design, architecture, and code review, Grok 4.7 last)
with subscription recovery before paid API routes, so routine work uses my
preferred accounts without making login failure look like additional capacity.

Criteria:
1. WHEN a fresh OMP session selects the default role, THE SYSTEM SHALL resolve
   Claude Opus 5.5 with medium reasoning on the Anthropic subscription;
   `slow` SHALL resolve Opus xhigh and `extreme` Opus max.
2. WHEN OMP resolves `vision` or the `designer` agent, THE SYSTEM SHALL select
   Opus 5.5 at high or above, and the `vision` role's fallback chain SHALL
   contain only Opus.
3. WHEN OMP resolves `task`, THE SYSTEM SHALL select GPT-6 Sol with max
   reasoning; WHEN it resolves `smol`, `commit`, or `advisor`, GPT-6 Luna with
   max reasoning; WHEN it resolves `plan` or `reviewer`, GPT-6 Astra high; and
   `security-reviewer`, Astra max.
4. IF a selected provider fails, THEN THE SYSTEM SHALL offer a subscription
   route from another provider before a paid OpenRouter route, with every Sol
   or Luna link at max reasoning and Grok 4.7 only as the last subscription
   link.
5. WHEN the Pi installer runs, THE SYSTEM SHALL select Opus 5.5 as Pi's default
   only if Pi-native Anthropic and Codex logins report ready, and otherwise
   SHALL keep the DeepSeek default and print the login instruction.
6. WHEN configuration is deployed, THE SYSTEM SHALL preserve OAuth stores and
   the model already selected in existing sessions.

No-gos: no copying OAuth credentials between harnesses; no frontier model
through OpenRouter as a default; no Pi default that is not authenticated.

Evidence: `omp-config/config.yml`, `omp-config/agents/designer.md`,
`omp-config/global/AGENTS.md`, `omp-config/README.md`,
`pi-config/settings.subscription.json`, `pi-config/install`,
`./scripts/verify all`, fresh OMP role-selection and forced-outage smoke checks.

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

## Capability: Agent audio isolation

## US-026 Keep agent audio out of my ears until I choose to listen

Statement: When agent sessions play or record audio on my desktop, I want their
sound routed to a silent sink they can record and analyze, so overlapping agent
audio never reaches my headphones and I decide when to listen.

Criteria:
1. WHEN any process an OMP, Pi, or Claude Code agent session spawns plays
   audio without naming a device, THE SYSTEM SHALL link its stream only to the
   `agent-sandbox` sink and to no hardware sink.
2. WHEN such a process records without naming a device, THE SYSTEM SHALL capture
   the `agent-sandbox` monitor, so the agent can analyze what it played.
3. IF the `agent-sandbox` sink is missing, THEN a sandboxed stream SHALL stay
   unlinked rather than fall back to the operator's default device.
4. IF an OMP or Pi audio-sandbox extension fails to load, THEN THE SYSTEM SHALL
   still route the bash tool through startup configuration (the OMP agent
   `.env`, the Pi `shellCommandPrefix`).
5. WHEN the audio sandbox is installed, THE SYSTEM SHALL leave the default and
   configured default sinks unchanged, keep foreign Claude Code settings, refuse
   an unowned PipeWire drop-in, and prove live routing when PipeWire is reachable.
6. WHEN the operator requests a spoken sachstand brief, THE SYSTEM SHALL play it
   on the operator's default device.
7. WHEN the operator plays a file or loops the sandbox monitor back from their
   own terminal, THE SYSTEM SHALL play it on their default device.

No-gos: no change to the default device, Kaylee's voice, or apps the operator
launches; no PipeWire restart on install; no claim to stop deliberate bypass
(scrubbed environments, raw ALSA devices, IPC into running operator apps).

Evidence: `agent-config/audio-sandbox/audio-sandbox.test.ts`,
`omp-config/extensions/audio-sandbox/audio-sandbox.test.ts`,
`scripts/verify-installers`, the live routing proof in
`agent-config/audio-sandbox/install.ts host`, and a fresh engineer-session smoke
recorded in the pull request.

## Capability: Incremental foundation adoption

## US-027 Adopt foundations incrementally without stalling work

Statement: When a repository adopts the Foundation Standard with existing gaps,
I want those gaps recorded as an expiring baseline that can only shrink, so work
continues while compliance grows and no gap is silently waived.

Criteria:
1. WHEN a repository has no `foundation.json`, `foundation-check check` SHALL
   list every document, story, map, and verify-skill gap instead of failing to
   run, and `foundation-check baseline --write` SHALL create a bootstrap
   adoption record whose baseline names exactly those gaps plus one walk entry
   per live story.
2. WHILE a repository is in bootstrap mode, `check` SHALL pass only if every
   current gap has an unexpired baseline entry with an owner and an expiry at
   most 30 days out, and SHALL fail an expired entry, an entry whose gap is
   fixed, or a baseline carried in enforced mode.
3. WHEN a base revision is supplied, `check` SHALL fail a new baseline entry or
   a later expiry unless an added `foundation/extensions/` record names that
   gap and expiry, and SHALL fail a story edited in the change that stays
   unmapped; a first adoption MAY create its baseline.
4. WHEN validating a walk receipt against a change, THE SYSTEM SHALL accept
   `unwalked` only for a mapped story with an unexpired baseline walk entry that
   the change does not affect; an unmapped story's impact is unknown, so it SHALL
   be walked. WITH `--all` (a full walk that judges no change), THE SYSTEM SHALL
   require every live story, accept `unwalked` under an unexpired walk entry, and
   fail a walk entry whose story now passes.
5. WHEN a pull request gives `USER_STORIES.md` its first stories or adds a
   baseline extension record, `foundation-check review` SHALL pass only with an
   approving review on the PR head from the organisation's designated agent
   reviewer, named by the pinned harness and not the repository. AFTER that
   reviewer's escalation review on the head, only its later approval recording
   the operator's decision and opening with `foundation-escalation: resolved` as
   its exact first line SHALL count. The
   PR author's approval, and any approval from the operator's shared GitHub
   account, SHALL never count.

No-gos: no automatic waivers, no baseline for adoption-record errors, no
baseline entry more than 30 days out.

Evidence: `agent-config/bin/foundation-check.test.ts` (US-027 block);
`docs/adr/003-foundation-checks.md`.

## US-028 Bill OpenRouter to the project account

Statement: When I work in an R90 checkout through OMP or Pi, I want OpenRouter
requests billed to R90 rather than my personal account, without changing how
Misty Step sessions are billed.

Criteria:
1. WHEN a fresh OMP or Pi session runs from `~/development/r90group` or a
   descendant, OR from a linked worktree whose Git common directory is there,
   THE SYSTEM SHALL resolve `workstation/OPENROUTER_R90_HARNESS_API_KEY`; from
   other directories it SHALL resolve that harness's existing personal entry.
   A real request from each harness and each account class SHALL show usage on
   the selected OpenRouter key, not on the other account's key.
2. IF the R90 pass entry is missing or is not a usable `sk-or-` token, THEN an
   OpenRouter request in either harness SHALL fail authentication rather than
   fall back to a stored or ambient personal key; the personal key's usage
   SHALL NOT increase from that request.
3. WHEN `openrouter-key --which` is run, THE SYSTEM SHALL print only the
   selected pass entry name and SHALL NOT decrypt or print any key.
4. WHEN Pi installs OpenRouter auth, THE SYSTEM SHALL replace only the
   `openrouter` credential mapping, retaining other providers' credentials.

No-gos: no secrets in versioned files or diagnostic output; no silent personal
fallback from an R90 lookup error; no copying OMP's stored login into Pi.

Evidence: `agent-config/bin/openrouter-key.test.ts`,
`scripts/verify-installers`, and the real OMP/Pi calls and OpenRouter billing
checks recorded in the PR.

## Capability: Credential hygiene

## US-039 Keep credential values out of model context

Statement: When an agent's search or read prints a file that holds credentials,
I want the values replaced before any text reaches a model provider, so a broad
search cannot leak a secret whichever tool or ignore flag produced it.

Criteria:
1. WHEN any tool prints an env-style assignment whose upper-case name contains
   KEY, TOKEN, SECRET, PASSWORD, PASS, AUTH, CREDENTIAL or PRIVATE, THE SYSTEM
   SHALL send the provider a placeholder instead of a value of eight or more
   characters.
2. WHEN any tool prints a `scheme://user:password@host` URL, THE SYSTEM SHALL
   send the provider a placeholder instead of a password of eight or more
   characters.
3. IF the committed policy holds a plain entry or a regex that does not compile,
   THEN installation SHALL fail before deploying anything.
4. IF the agent directory's `secrets.yml` lacks the managed first line, THEN
   installation SHALL fail without replacing it.

No-gos: no secret values in the repository; no change to where credentials are
stored; no network or model call in the check.

Evidence: `omp-config/bin/omp-secrets-policy.test.ts`,
`scripts/verify-installers`
