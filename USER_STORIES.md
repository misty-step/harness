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
1. WHEN Pi or OMP selects engineering skills, THE SYSTEM SHALL provide concise
   `test-audit` guidance for preserving independent consumer contracts.
2. WHEN adding coverage, THE SYSTEM SHALL direct the engineer to name the real
   failure and inspect existing proof at its owner boundary.
3. WHEN pruning coverage, THE SYSTEM SHALL preserve valuable assertions and
   exercise affected paths; history is needed only for concrete uncertainty.
4. IF a subsystem audit is commissioned, THEN THE SYSTEM SHALL group work by
   contract without a per-test ledger; OTHERWISE it SHALL keep the original scope.

No-gos: no automatic portfolio sweep, model gate, or OpenClaw-specific runner
commands in a portable skill.

Evidence: `scripts/references.test.ts`,
`agent-config/skills/test-audit/SKILL.md`,
`agent-config/guidance/engineering.md`,
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
`agent-config/guidance/engineering.md`;
disposable Pi and OMP installer smoke.

## US-045 Open the exact review round from the board

Statement: When an agent hands me work to review, I want the board to open that
exact round and keep earlier rounds distinct, so I can review the right page
without searching folders or exposing private text.
Retired: 2026-10-01 — Phaedrus assigns review publication and choreography to
Kaylee's harness, not engineering guidance.

Criteria:
1. WHEN Pi or OMP composes global guidance, THE SYSTEM SHALL route review
   handoffs to the on-demand `engineering-operations` skill.
2. WHEN that skill is loaded for a handoff, THE SYSTEM SHALL direct each round
   to its own file under `~/review` and register one exact page with
   `glass review publish --item <board item id> --page <file under ~/review>`.
3. THE SYSTEM SHALL explain that publication links that page on the board and
   marks earlier rounds old.
4. THE SYSTEM SHALL keep private context, including pile words, in its owning
   tools, with R90 data in R90 tools and review pages containing public evidence.
5. THE SYSTEM SHALL define `~/review` as storage for distinct rounds.
6. IF the work has no board item, THEN THE SYSTEM SHALL direct the agent to ask
   Kaylee to add one before registering the review.

No-gos: no private text in review pages, folder links, overwritten rounds, or
review index pages. The board owns publication and history; this story owns
the shared instructions.

Evidence: `agent-config/review/README.md`; retained as maintainer-only procedure,
not installed engineering guidance.

## US-023 Keep verification cadence useful

Statement: When I plan repository checks, I want engineer-run affected proof,
one proven main candidate and owned complete nightly runs, so shipping does not
rerun an expensive suite on every PR or wait for unrelated regressions.

Criteria:
1. WHEN Pi or OMP installs shared skills, THE SYSTEM SHALL provide
   `story-qa/check-cadence.md` and route CI tiering decisions through `story-qa`.
2. WHEN migrating a repository to lean CI, THE SYSTEM SHALL retain affected local
   proof, independent exact-head review and cheap pre-main secret/privacy scans,
   and SHALL remove automatic PR and PR-target CI.
3. WHEN main selects a candidate, THE SYSTEM SHALL build once, prove affected
   journeys and consequential boundaries on isolated preprod, then automatically
   promote the same bytes only after proof succeeds.
4. WHEN a complete nightly suite runs, THE SYSTEM SHALL record its main revision,
   check completion and send failures or missing runs through the existing owned
   triage route; unrelated nightly red SHALL NOT become a blanket shipping veto.
5. WHEN claiming improved cadence, THE SYSTEM SHALL distinguish proposed
   schedules from observed candidate and nightly runs.

No-gos: no implicit deletion of required gates, unapproved recurring spend, or
CI change to Habitat or Tach in this harness PR.

Evidence: `scripts/references.test.ts`,
`agent-config/skills/story-qa/check-cadence.md`,
`agent-config/guidance/engineering.md`;
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
   affected by source files, feature files, and edited story sections; feature
   files SHALL count only if some `features/` file existed at the merge base,
   because the change that first creates the map adds no behaviour.
4. IF a walk receipt omits or fails an affected story, reports a set of
   criterion numbers that differs from that story's numbered criteria at HEAD
   (missing, duplicated, or extra), cites an unlisted or tampered artifact, or
   names a different head or tree, THEN THE SYSTEM SHALL reject it.
5. WHEN a receipt binds the candidate head and tree, passes every affected
   story and criterion, and matches all cited artifact digests, THE SYSTEM
   SHALL accept it.
6. WHEN catalog 1.5.0 applies, THE SYSTEM SHALL require README, AGENTS,
   USER_STORIES and DOMAIN with a well-formed invariants ledger; SHALL check
   the ADR-004 surface files, aliases, core links, routing targets, ADR
   integrity and executable CI gate; and SHALL reject `Check:` or an
   invariant's missing resolvable check.
7. IF a `satisfied` disposition cites a missing, committed, wrong-revision
   or wrong-digest receipt, THEN the checker SHALL reject it; IF a
   `not_applicable` or `exception` disposition lacks a matching tracked
   `foundation-approval/1` record THEN it SHALL reject it.
8. IF FND-SEC-001 is `satisfied`, THEN the checker SHALL confirm a
   secret-scanning job, a configured dependency bot with a green-gated
   auto-merge job, and an authorization-test job for applications; a runtime
   receipt SHALL carry the exercise these file checks cannot prove.

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

Evidence: `agent-config/guidance/workstation.md`,
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

## US-004 Close owned landing work and session resources

Statement: When I close an engineering session, including inherited repository
work, I want an owner-scoped gate that accepts only landed or explicitly parked
work, so unfinished changes cannot be called done, unrelated sessions continue,
and stale resources receive deliberate review. Operator-authorized intent
extension (2026-09-30): the original lease-only contract now includes landing.

Criteria:
1. WHEN repository work begins, THE ENGINEER SHALL run
   `session-close.ts track [--repo PATH]` before switching branches or deleting
   worktrees, including inherited worktrees; WHEN `check` runs in Git, THE SYSTEM
   SHALL auto-track as a safety net and preserve existing parked status.
2. WHEN a local worktree or non-standing exe.dev VM is created in-session,
   THE SYSTEM SHALL record an owner-scoped lease in the same turn; `ws up`
   SHALL lease its task worktree and `ws init` SHALL preserve a standing VM.
   WHEN expired, orphaned or legacy ownerless leases exist, `review` SHALL list
   them and exit 3 without deleting resources; expiry SHALL NOT erase owned
   landing obligations. WHEN a lease is dropped, THE SYSTEM SHALL print its
   recorded owner. `ws down` SHALL retain its ownership and pulled-evidence gate.
   WHEN `leases --json` runs, THE SYSTEM SHALL provide read-only introspection
   with `leases`, `own`, `foreign` and `needsReview`, without Git checks or
   auto-tracking.
3. WHEN `check` runs, THE SYSTEM SHALL evaluate all unparked owned landing records
   after the original worktree disappears, fetch the authoritative origin
   default, and require clean owned/current checkouts plus a canonical checkout
   on that fetched default head. Remaining owned linked worktrees, local/origin
   feature branches, open branch PRs or unmerged HEADs SHALL block.
   WHEN squash/rebase merge proof is used, THE SYSTEM SHALL require a merged PR
   whose final HEAD contains the recorded work and whose merge commit is in the
   fresh default, fetching retained PR refs when needed; direct merge proof
   SHALL require recorded-HEAD ancestry. WHEN local tips advance, THE SYSTEM
   SHALL refresh them and retain divergent prior tips as independent obligations,
   so branch reuse/rewriting cannot erase abandoned work.
4. WHEN owned deterministic landing facts or live leases remain unresolved,
   `check` SHALL exit 2; WHEN all owned work is landed or explicitly parked and
   no other owned live leases block, it SHALL exit 0. Foreign records SHALL be
   informational and SHALL NOT be mutated or deleted.
   IF storage is malformed, or unparked work has malformed API data, failed
   GitHub authentication/commands or an unknown authoritative default, THEN
   THE SYSTEM SHALL fail closed with exit 1 rather than treating work as landed.
5. WHEN `park --repo PATH --note TEXT` is used, THE SYSTEM SHALL retain the owned
   landing records, meaningful resume note and matching owned worktree leases;
   live non-worktree leases SHALL still block. THE ENGINEER SHALL report
   **parked/unfinished**, reason, owner, resume steps, retained resources and
   PR/ticket status, never done. `unpark --repo PATH` SHALL resume the obligation.
6. WHEN the engineer is about to yield, THE ENGINEER SHALL run `check`. Done
   SHALL additionally mean
   merged through green required CI and exact-head model review, deployed to
   actual targets with production sanity evidence, feature branches deleted,
   own worktree removed and default canonical checkout clean/up-to-date.
   THE ENGINEER SHALL update the PR and relevant existing ticket's status,
   context and evidence using project routing: Habitat where used, Linear for
   Misty Step/personal work. These judgment facts remain doctrine, not checker
   assertions.

No-gos: no parallel close tool, automatic Git/resource deletion, global cleanup
of other sessions' worktrees or destruction of unleased/standing VMs; no Habitat
mandate for projects without it and no invented ticket prerequisite. Unit
fixtures SHALL avoid live network; the owner-path walk uses real Git/GitHub.

Evidence: `agent-config/skills/session-close/session-close.test.ts`,
`agent-config/skills/session-close/SKILL.md`, `docs/verification.md`.

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
5. WHEN the Pi extension is installed, THE SYSTEM SHALL load all review modules
   self-contained from the deployed extension directory.
6. WHEN testing offline or without remote keys, THE SYSTEM SHALL evaluate using
   deterministic heuristics only under explicit request (`--provider heuristic` or
   `MOCK_SYSTEM_ONE=1`).
7. WHEN reviewing working tree diffs, THE SYSTEM SHALL include untracked files
   by default unless explicitly disabled.
8. WHEN a diff exceeds context limits, THE SYSTEM SHALL chunk changes by file
   and hunk boundaries, evaluating chunks in parallel without truncation.
9. WHEN OMP is installed, THE SYSTEM SHALL remove the retired automatic
   turn-end diff-review extension. Explicit CLI review remains available.
10. IF a review or semantic check cannot run (no key, unreadable key entry,
    provider error, provider unavailable), THEN THE SYSTEM SHALL treat it as a
    failed run, never a pass: the diff review CLI exits 2, `semantic-check`
    exits 3, and the root hooks and the Pi automatic review record a failed
    outcome with its cause through `outcome record` (ADR-009).

No-gos: no fabricated probability or confidence numbers in live sessions; no
live credential storage on disk; no uncredentialed blocking of interactive turns;
no silent truncation of multi-file diffs; no unreported review that did not run.
Evidence: `omp-config/bin/omp-diff-review.test.ts`, `agent-config/bin/hook.test.ts`, `agent-config/bin/semantic-check.test.ts`, `scripts/verify-installers`, `pi-config/extensions/diff-review/diff-review.test.ts`

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
1. WHEN designing a changed surface, THE SYSTEM SHALL provide `design-studio`
   craft and non-obvious tool knowledge without mandatory exploration rounds.
2. WHEN alternatives are useful, THE SYSTEM SHALL distinguish structure or
   behaviour rather than present recolours as different concepts.
3. WHEN choosing a direction, THE SYSTEM SHALL judge it against the user's job,
   not a numeric taste score or a model-vote winner.
4. WHEN generated mockups are used, THE SYSTEM SHALL present them as visual
   proposals for early IA, navigation and content-model, layout, typography,
   hierarchy, component and content-hierarchy composition, and visual language
   (including exact labels and copy when the evaluation target needs them), and
   SHALL verify exact copy, behavior, and accessibility on rendered HTML/CSS
   with named-state QA (`skill://visual-state-review`); generated images SHALL
   never count as proof of UX, accessibility, or behavior.
5. WHEN design decisions need a durable home, THE SYSTEM SHALL use the product's
   existing DESIGN.md rather than add handoff or provenance templates.
6. WHEN the bundled image adapter runs a batch, THE SYSTEM SHALL enforce the
   exploratory cost cap against caller-supplied price evidence; IF the price is
   unknown or non-finite, THEN THE SYSTEM SHALL fail closed before any spend.

No-gos: not a replacement for user research or journey tests; no fabricated or
numeric taste scores or model-vote winners; no further exploration round
without new evidence or a named open decision; no committed screenshots or
binary artifacts; no secrets or sensitive product data in prompts or artifacts.

Evidence: `agent-config/skills/design-studio/SKILL.md`,
`agent-config/skills/design-studio/scripts/check_design_md.test.ts`,
`agent-config/skills/design-studio/scripts/imagine.test.ts`.

## US-044 Subtract content before shipping a designed surface

Statement: When agents finish a UI design, I want every element on each screen
challenged and unnecessary content removed, so I can see simpler screens
without losing the primary task or required information.

Criteria:
1. WHEN refining a design, THE SYSTEM SHALL remove elements that serve neither
   the primary task nor required information.
2. WHEN claiming subtraction complete, THE SYSTEM SHALL inspect the affected
   rendered state and ensure the task and required information remain reachable.

No-gos: no global word budget, automatic judgment of semantic redundancy, or
hiding required safety, status, or accessibility information to meet a count.

Evidence: `agent-config/skills/design-studio/SKILL.md`.

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
`agent-config/skills/visual-state-review/SKILL.md`,
`docs/adr/002-design-toolkit-trial.md`

## Capability: Model routing

## US-014 Use approved model routing and recovery

Statement: When I start or delegate work in any harness, I want the approved
lower-spend model policy applied per role, with Sonnet 5.5 for routine work,
Opus required for visual, motion, UX and communications work, and bounded
subscription recovery, so ordinary work does not silently inherit premium
reasoning or mistake an authorized account for available capacity.

Criteria:
1. WHEN a fresh OMP session selects `default` or `task`, THE SYSTEM SHALL
   resolve Claude Sonnet 5.5 medium; `slow` SHALL resolve Sonnet high and
   `extreme` Opus 5.5 xhigh.
2. WHEN OMP resolves `vision` or `designer`, THE SYSTEM SHALL select Opus 5.5
   at high or above. A designer child of a non-Opus parent SHALL use Opus high;
   a designer child of an Opus high/xhigh/max parent SHALL retain that level.
   Missing Opus authentication SHALL block designer dispatch before native
   startup can substitute the parent's authenticated model.
   The vision fallback chain SHALL contain only Opus. IF a session starts on
   the configured Opus primary and that provider fails, THEN THE SYSTEM SHALL
   stop after same-model recovery rather than switch models, at every
   reasoning level.
3. WHEN OMP resolves `smol`, `tiny`, `commit`, `scout`, or `sonic`, THE SYSTEM
   SHALL select GPT-6 Luna max; `advisor` SHALL select Sonnet 5.5 medium;
   `plan` SHALL select GPT-6.1 Sol xhigh. Astra SHALL require explicit selection.
   OMP SHALL leave automatic Steward review off by default while preserving
   explicit `--advisor` and `/advisor on` invocation.
   Ordinary task children SHALL use their configured agent routes rather than
   inherit the live parent's model and thinking; explicit tagged model
   selections and per-item effort SHALL remain available, except designer
   effort below high SHALL be rejected.
   Under the operator's 2026-09-30 review rule, reviewer and security-reviewer
   task/eval dispatch SHALL choose Sonnet 5.5 high for an OpenAI author and
   GPT-6.1 Sol medium for an Anthropic author. Missing/unknown author family or
   unavailable reviewer authentication SHALL block dispatch. Reviewer recovery
   SHALL retry the selected model or stop, with no fallback chain, even under
   an engineer roster overlay; the engineer's recovery SHALL remain unchanged.
   `agent-review` SHALL require the actual author selector, reject same-family
   overrides, and verify native reviewer identity before posting an approval.
   Missing/unloadable specialist enforcement SHALL keep protected agents
   disabled; failed reviewer initialization SHALL abort before any provider
   request, never continue with inherited recovery.
4. WHERE cross-model recovery is allowed, THE SYSTEM SHALL use only approved
   subscription routes, with Gemini 3.8 Flash last. Grok 4.7 SHALL be allowed
   only as read-only advisory recovery and SHALL NOT occur in OMP builder fallback chains;
   Pi's chain ends at Grok 4.7 (criterion 5).
   All shared subscription accounts SHALL be authorized for any work;
   native account-policy priority SHALL prefer eligible r90.dev Anthropic
   and Codex accounts without bypassing blocked-account or reserve rules.
   Authorization or priority SHALL NOT be treated as proof of available quota.
5. WHEN the Pi installer runs, THE SYSTEM SHALL select GPT-6.1 Sol xhigh as
   Pi's default and report a missing Pi-native Codex login rather than restore
   the retired DeepSeek default. Pi SHALL use only OpenAI Codex, xAI and
   OpenRouter routes: any Anthropic model, direct or through OpenRouter,
   SHALL be refused before inference. If native startup selects an unapproved
   model after login loss, agent prompts, provider requests, compaction and
   branch summaries SHALL be refused before paid inference.
6. WHEN configuration is deployed, THE SYSTEM SHALL preserve OAuth stores and
   the model already selected in existing sessions.
7. WHEN OMP model routing is checked, THE SYSTEM SHALL reject every chat role,
   task agent override, or fallback outside Opus 5.5, Sonnet 5.5, GPT-6,
   Grok 4.7, and Gemini 3.8 Flash; an online predeployment probe SHALL reject
   a selector not accepted by its provider or resolved to a different model.

No-gos: no copying OAuth credentials between harnesses; no frontier model
through OpenRouter as a default; no unauthenticated route treated as usable
capacity; no Grok builder fallback; no retired Sonnet or unapproved paid model
fallback.

Evidence: `omp-config/config.yml`, `omp-config/agents/designer.md`,
`omp-config/bin/omp-merge-config.test.ts`, `omp-config/bin/omp-model-policy.test.ts`,
`omp-config/global/AGENTS.md`, `omp-config/README.md`,
`pi-config/settings.json`, `pi-config/install`,
`./scripts/verify all`, the online model-policy probe, fresh OMP role-selection
and forced-outage smoke checks.

## US-046 Launch engineers only on the ticket's model roster

Statement: When I put a ranked model roster on a board item and Kaylee launches
an OMP engineer for it, or an OMP engineer is launched on a single model with no
ticket, I want that engineer's own session to run only on the roster (or that one model)
and stop when it runs out, so recovery never lands on a model I did not name.
Other helper roles retain US-014's routes and can recover only onto the roster.
Reviewers instead use US-014's contrasting author-family route and stop after
same-model retries.
Qualifying build, design and research launches also start an identical-brief,
same-model effort twin automatically, so a blind done-check verdict can change
future routing with cited evidence instead of experiments remaining optional prose.

Criteria:
1. WHEN a ticket has a roster and Kaylee launches an OMP engineer, THE SYSTEM
   SHALL launch it on the first roster entry whose ai-usage verdict is `usable`
   or `low`, and SHALL refuse with exit status 3 and write no launch overlay
   when no entry qualifies, naming each entry's skip reason and reset time.
2. IF the launched model fails, or the approved primary of a recoverable
   helper (scout, sonic, plan, smol, tiny, commit or the advisor sidecar) fails,
   THEN THE SYSTEM SHALL switch that call only to roster models, in rank order,
   and stop with the provider's error when the roster runs out.
   Reviewer and security-reviewer recovery SHALL remain empty even when their
   model appears on the roster. Helpers keep their US-014 routes; only their
   recovery is restricted. The `vision` role, which the designer agent uses,
   keeps its own Opus-only route unless the roster names Opus.
3. WHEN a session is checked against its ticket, THE SYSTEM SHALL judge each
   session file against the launch record of the newest launch that started at
   or before it (a subagent file with its session), from launch time on, exit
   with status 4 when the ticket's roster has changed since that launch or the
   board cannot give it (while still judging every turn), report every assistant
   turn on a model outside the roster and every fallback switch to a model
   outside the roster, in any file including scout, reviewer and advisor files,
   and exit with status 4 when there is one, or when a launched file has turns and
   none was judged; a helper turn on its role's US-014 primary, and a designer
   turn on Opus 5.5, SHALL be counted as helper turns, not violations, and a cash
   route SHALL never count as on the roster. A roster that names Opus governs
   every Opus turn, the designer's included.
4. WHEN launching, THE SYSTEM SHALL give the engineer's environment the same
   overlay (`PI_CONFIG_FILES`) so nested `omp` runs inherit the roster, write one
   overlay file per launch so a running session's file is never rewritten, and
   report the launch route's `low` and degraded state instead of hiding them.
5. IF the ticket has no roster, an empty roster, an unapproved model, an
   unsupported effort or a duplicate entry, or the usage view is not ok or
   malformed, or the harness is not OMP, THEN THE SYSTEM SHALL refuse the
   launch with one plain sentence and write nothing.
6. WHEN an OMP engineer is launched without a ticket, THE SYSTEM SHALL accept
   `--model provider/model --thinking effort` and no `--item`, run the same
   approved-model, effort, cash and ai-usage checks on that one route, refuse with
   exit status 3 and write nothing when the route cannot launch, and otherwise
   write the overlay and launch record under a synthetic `adhoc-` id with every
   engineer chain empty so the engineer stops when its model fails; it SHALL
   refuse `--item` together with `--model` or `--thinking`, neither, and a
   `:effort` suffix on `--model`, call no board, and let `check --item adhoc-...`
   judge a session against the recorded route with no board.
7. WHEN a build, design or research ticket qualifies and no live experiment is
   reserved, THE SYSTEM SHALL start both OMP lanes from the same clean commit
   in separate Herdr worktrees, with the identical complete ticket brief (or
   supplied `--brief-file`) and done checks. The current checkout SHALL be used
   unless `--cwd` is supplied; a qualifying launch SHALL NOT require a second
   twin command. The candidate SHALL differ only by supported reasoning effort
   and SHALL be capable of changing a nature/model effort default; build lanes
   SHALL NOT merge or install before the verdict.
   JSON `started: true` SHALL mean both lanes are already dispatched and
   provide their identities; callers SHALL NOT dispatch a third engineer.
   Only `started: false` SHALL return environment and arguments for one
   explicitly pinned engineer.
8. WHEN `--tiny REASON`, `--live-data REASON` or `--no-experiment REASON` is used,
   THE SYSTEM SHALL require a nonempty reason, record it with item and timestamp
   in the existing experiment journal and return an ordinary launch plan.
   Nonqualifying work and launches while a live pair is reserved SHALL retain
   the ordinary roster-enforced plan; missing required experiment context or
   malformed journal state SHALL fail closed, not degrade to a suggestion.
9. WHEN starting a pair, THE SYSTEM SHALL hold an exclusive journal lock,
   reserve `starting` before side effects, bind real pane/session identities,
   and record `running`. It SHALL allow at most one live reservation, keep
   ambiguous failures reserved and roll back only its own definitely failed
   launch resources. Settled lanes SHALL become `awaiting-verdict` without
   losing unfinished evidence and SHALL NOT prevent the next live pair.
   Stopped or replaced sessions SHALL NOT count as live lanes.
   `abandon --experiment E-NNN --reason TEXT` SHALL preserve the record and
   refuse while a bound lane remains working.
10. WHEN `verdict` receives the real lane artifacts and an approved usable native
    judge, THE SYSTEM SHALL anonymize/randomize the lanes, withhold their key and
    authors, require a judge family distinct from both lanes, disable fallback
    and verify actual judge identity. It SHALL score each ticket done check per
    lane 0–2 with evidence and rationale, choose the larger sum and lower effort
    on a tie, and only then record the verdict and update the preregistered
    `<nature>:<provider>/<model>` effort default with its E-id as evidence.
    A confounded, incomplete or fallback verdict SHALL NOT change a default.
11. WHEN querying `defaults`, THE SYSTEM SHALL report usable evidence-backed
    entries with optional nature/model filters. Ticket-pinned rosters SHALL NOT
    be silently overridden; `launch --use-default` SHALL be required to consume
    learned effort and SHALL report its evidence without rewriting the ticket
    or native interactive/subagent defaults.
12. WHEN installing or recording experiments, THE SYSTEM SHALL keep the existing
    Markdown journal as the sole durable ledger, preserve legacy prose and
    confounds, number new records after legacy E-ids and never manufacture
    historical verdict/default evidence. CLI installation SHALL deploy
    `omp-experiments.ts` beside `omp-roster` without overwriting runtime history.

No-gos: no cash routes (OpenRouter entries are never launched or used as
recovery until a per-ticket cash cap exists, and a cash turn is never on the
roster); no Pi enforcement yet; no gating in the board; no silent roster edits or
model-family choice by the launcher. Explicit learned effort consumption is
scoped to the selected model, not global role defaults. Not covered, and said
so in `omp-config/README.md`: Pi
lanes and any `omp` not launched through `omp-roster launch` (a ticketless item is
covered only when launched with `--model` and `--thinking`); agent definitions that
pin their own model and the `find` judge's `model_usage` calls; prevention at spawn
time (`check` detects afterwards).

Evidence: `omp-config/bin/omp-roster.test.ts`, `omp-config/bin/omp-roster.ts`,
`omp-config/bin/omp-experiments.ts`, `omp-config/README.md`,
`docs/verification.md`, `./scripts/verify omp`, and the forced-outage smoke
recorded in the PR (Codex exhausted: a Sol-then-Sonnet roster hopped to Sonnet
only, a Sol-only roster stopped with the usage-limit error, and
`omp-roster check` was clean for both). A scout spawned by a Sonnet engineer on a
Sol-then-Sonnet overlay (with `PI_CONFIG_FILES` exported and `--config` given the
same file, `omp` 18.4.3) started on its Luna primary, and with Codex exhausted
hopped to Sol and then Sonnet, never Gemini; `check` was clean. Without a ticket
(same day, `omp` 18.4.3, Codex exhausted): `omp-roster launch --model
openai-codex/gpt-6-sol --thinking medium` exited 3 and wrote nothing; a Sonnet
launch answered on Sonnet only and `check --item adhoc-...` was clean; the same
`omp -p --model openai-codex/gpt-6-sol` with no overlay hopped Sol to Luna to Gemini
and `check` against a Sol-only record exited 4.

## US-047 Queue engineer work when the fleet is full

Statement: When ideas create more work than the engineer fleet should run at
once, I want the launch tool to refuse another working engineer at the fleet
limit, so dispatch queues work on the board instead of consuming more usage.

Criteria:
1. WHEN `omp-roster launch` prepares a ticketed or ticketless engineer, THE
   SYSTEM SHALL count every Herdr agent whose `agent` is `omp` and
   `agent_status` is `working` across the current session, including other
   workspaces and the caller, excluding other agent kinds (including Kaylee's
   Hermes window), `idle`, `done`, `blocked` and `unknown`.
2. WHEN that count is at or above the configured limit, THE SYSTEM SHALL exit
   5, emit one stderr line naming the working engineers (pane id for an unnamed
   engineer) and directing the caller to queue work on the board, leave stdout
   empty and write no overlay or launch record.
3. WHEN `OMP_ROSTER_ENGINEER_LIMIT` is absent, THE SYSTEM SHALL use the default
   cap owned in `omp-config/bin/omp-roster.ts`, requiring no per-call export.
   WHERE the environment override is configured, THE SYSTEM SHALL use that
   positive safe integer and offer no override flag. Successful `--json`
   output SHALL report the working count and effective limit in `engineer_capacity`.
4. WHEN the count is below the limit, THE SYSTEM SHALL retain the roster and
   usage admission checks of US-046 and write the launch artifacts when they
   pass; unreadable Herdr state or an invalid limit SHALL refuse with exit 1
   and no artifacts.
5. WHEN a caller requests `omp-roster capacity --json`, THE SYSTEM SHALL return
   exit 0 and `{ "engineer_capacity": { "working": N, "limit": L } }`, including
   a fleet at or above its limit, using the same validated count and limit as
   launch. It SHALL read no ticket, usage, memory, display or journal state;
   write no journal, migration, lock or launch artifacts; and create no
   worktree, pane or agent. Corrupt/unwritable journals and dirty or unrelated
   checkouts SHALL NOT prevent this read. Unknown fleet state or an invalid
   limit SHALL fail nonzero with a visible error, never a guessed count.
   This snapshot SHALL NOT reserve capacity or replace actual launch admission.

No-gos: no changes to Herdr or Kaylee's tools, no closing agents, no reservation
or spawn transaction. The tool checks a live snapshot before writing; it cannot
reserve a slot for a later start or prevent simultaneous below-limit dispatches.

Evidence: `omp-config/bin/omp-roster.test.ts`, `omp-config/bin/omp-roster.ts`,
`omp-config/README.md`, `./scripts/check omp`, and the live CLI walk in the PR.

## Capability: Protected releases

## US-015 Publish verified harness releases

Statement: When a harness change merits a release, I want its generated
changelog independently model-reviewed and verified before publication, so
release automation cannot publish an unverified default-branch candidate.

Criteria:
1. WHEN a verified `master` change warrants a release, THE SYSTEM SHALL stage
   the generated changelog in a pull request instead of pushing directly to
   protected `master`.
2. WHEN that pull request has an independent model review, green observed
   checks and verification against the current base, THE SYSTEM SHALL merge
   the exact reviewed head normally before publishing its version tag and
   GitHub Release; server-required CI and human approvals SHALL NOT gate it.
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
   THE SYSTEM SHALL leave tool results and assistant turns uninterrupted;
   the startup inventory or discovery pointer and standing guidance SHALL
   remain available for the agent to consult.
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
4. WHEN validating a walk receipt, THE SYSTEM SHALL accept `unwalked` for a
   story with an unexpired baseline walk entry (no walk yet), whether or not the
   change affects it, and report it as advisory; IF a story's walk ran and
   failed, or a story is `unwalked` without such an entry, THEN THE SYSTEM SHALL
   fail the receipt (operator decision 2026-09-26). WITH `--all`, THE SYSTEM
   SHALL require every live story and fail a walk entry whose story now passes.
5. WHEN a pull request gives `USER_STORIES.md` its first stories or adds a
   baseline extension record, `foundation-check review` SHALL pass only with an
   approving review on the PR head from the organisation's designated agent
   reviewer, named by the pinned harness and not the repository. AFTER that
   reviewer's escalation review on the head, only its later approval recording
   the operator's decision and opening with `foundation-escalation: resolved` as
   its exact first line SHALL count. The
   PR author's approval, and any approval from the operator's shared GitHub
   account, SHALL never count. WHERE the organisation has no reviewer App
   (r90group), THE SYSTEM SHALL instead accept a review or comment from the
   designated account whose exact first line is `foundation-review: approved`
   and the head SHA, and after an entry whose first line is the escalation
   marker, only a later `foundation-escalation: resolved` line naming the head.
6. WHEN an applicable non-ADR-005 obligation stays `pending`, `check` SHALL
   require its current `obl:<ID>` baseline entry with an owner and expiry
   within 30 days; `baseline --revision SHA` SHALL add new obligation gaps,
   while ADR-005's three existing `ops:` keys remain their sole gaps.
7. WHEN `foundation-check review` judges a PR, it SHALL require an
   independent approval on its head for every change, designated-review
   triggers included: where the organisation has a reviewer App (misty-step)
   only that App's approval counts, it must carry `agent-review`'s record of the
   base, merge base, title and description judged, and its latest change request
   stands. The reviewing agent gives it after a model review of the PR, in which
   image content is read by the vision role (`agent-review`; operator rule,
   2026-09-28). An invariants-ledger edit or a new/changed
   `foundation-approval/1` disposition SHALL additionally require the designated
   reviewer, making five designated-review triggers. The exact-head model
   approval SHALL supply that delegated decision, without a second approval.
   IF every changed path is a submodule pointer or a recognized inert opaque
   artifact (format signature, matching suffix, mode `100644`), THEN THE SYSTEM
   SHALL require a clean
   model review of the immutable pointer/blob metadata and PR description,
   recorded as a current-head comment bound to the same state. Content remains
   advisory and SHALL never be claimed inspected or approved. A change request
   or dismissal SHALL still stand; mixed opaque/reviewable changes SHALL be split.
   NUL-bearing source/config, unknown binary formats and executable artifacts
   SHALL never qualify for metadata-only review.
   Classification and image bytes SHALL come from immutable Git objects, preserving
   quoted/tab paths, rename-only images and gitlink-to-text transitions. Vision
   output SHALL reach the reviewer in full or the review SHALL refuse to post.
   IF mapped source changes, the PR description SHALL cite every affected
   live story id computed from the candidate git objects.

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
   THE SYSTEM SHALL resolve `workstation/OPENROUTER_R90_HARNESS_WORKSTATION_INFERENCE_API_KEY`; from
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
   KEY, TOKEN, SECRET, PASSWORD, PASS, AUTH, CREDENTIAL or PRIVATE, including a
   bare keyword name or an unquoted value containing spaces, THE SYSTEM SHALL
   send the provider a placeholder instead of a value of eight or more characters.
2. WHEN any tool prints a URL with a password of eight or more characters in its
   user-info field, THE SYSTEM SHALL mask the full password through the final
   authority delimiter, including an embedded `@`, before the path, query or fragment.
3. IF the committed policy holds a plain entry or a regex that does not compile,
   THEN installation SHALL fail before deploying anything.
4. IF the agent directory's `secrets.yml` lacks the managed first line, THEN
   installation SHALL fail without replacing it.

No-gos: no secret values in the repository; no change to where credentials are
stored; no network or model call in the check.

Evidence: `omp-config/bin/omp-secrets-policy.test.ts`,
`scripts/verify-installers`

## US-040 Hold every application to shipping, alerting and incident response

Statement: When I run an application in either org, I want the foundation
check to require that green on the default branch ships, that production
failures alert loudly, and that incidents end in a fix for the whole class, so
none of the three can be waived and a missing one cannot pass as done.

Criteria:
1. WHEN an adoption record's surfaces include `ui`, `cli`, `api` or `deployed`,
   or it has no surfaces, `foundation-check check` SHALL treat FND-REL-001,
   FND-ALR-001 and FND-INC-001 as owed, report each one still pending as the
   gap `ops:ship`, `ops:alert` or `ops:incident`, and fail it unless a valid
   bootstrap baseline entry covers it.
2. IF one of the three is dispositioned `exception`, or `not_applicable` for an
   application, THEN `check` SHALL fail.
3. WHEN FND-REL-001 is `satisfied`, `check` SHALL fail unless
   `operations.ship` names the repository's confirmed default branch and either
   a platform or a workflow that fires on every push to that branch (or on its
   successful `workflow_run`), honouring branch globs and exclusions and
   rejecting path and tag-only filters and a `workflow_run` whose upstream is
   not itself that push-triggered gate, with a named ship job that waits on the
   gate, where the ship job and every job it needs exist, use only `if:` guards
   that keep every green push to the default branch, and (for gate jobs) do not
   continue on error.
4. WHEN FND-ALR-001 is `satisfied`, `check` SHALL fail unless
   `operations.alert` names an error-capture file that references its
   provider, a scheduled health workflow or a named external monitor, and an
   alert destination.
5. WHEN FND-ALR-001 is `satisfied`, `operations.alert.destination` SHALL
   name an approved agent triage route; no other destination SHALL pass.
6. WHEN FND-INC-001 is `satisfied`, `check` SHALL fail unless
   `docs/runbook.md` has a non-empty `## Incidents` section and every
   postmortem in `docs/postmortems/` has `## Pokayoke` and `## Follow-up`
   sections, with a closed one linking the change that closed its class.
7. WHEN `baseline --revision SHA` runs on an existing record, THE SYSTEM SHALL
   re-pin its standard to that revision and add every obligation the catalog
   gained as `pending`, leaving existing dispositions and walk entries
   unchanged and adding no new walk entry.
8. WHEN a pull request changes `foundation.json` from an application to a
   non-application, `foundation-check review` SHALL require the designated
   reviewer, as for a baseline extension.
9. WHEN FND-REL-001 is `satisfied`, `operations.ship.tenancy` SHALL declare
   `single` or `multi`; for `multi`, `check` SHALL require an existing complete
   tenant registry and tenant-state command or workflow, with each exclusion
   naming a registry tenant and giving a reason. A platform-only multi-tenant
   ship SHALL fail; the migration job SHALL exist in the ship workflow and be
   in the ship job's transitive `needs` chain, subject to the same gate guards.
   The receipt SHALL read back every non-excluded tenant's deployed revision
   and migration level after deploy; migrations SHALL run for each tenant
   before deploy, remain backward-compatible with still-running code, and
   stop rollout on failure (operator decision 2026-09-26).
10. WHEN an ADR-005 operational obligation is satisfied, its ordinary
    `foundation-evidence/1` receipt SHALL bind a retained payload digest and
    HEAD revision without weakening the existing structural ship, alert and
    incident checks. Its pending `ops:` gap SHALL still be dated under the
    ratchet, rather than silently treated as compliance.

No-gos: no exception path for the three; no lint claiming runtime practice (a
receipt carries the controlled-failure, migration and every-tenant shipping
readback evidence); no heuristic guessing of deploy commands or silent tenant
exclusions.

Evidence: `agent-config/bin/foundation-check.test.ts` (ADR-005 block);
`docs/adr/005-operational-obligations.md`.

## US-041 Meet the foundations while working

Statement: When an agent works in any of my projects, I want it to meet the
foundations every project keeps, stated once in a short constitution, so its
work implements, maintains and improves them without me restating them.

Criteria:
1. WHEN Pi or OMP installs shared guidance, THE SYSTEM SHALL name the
   constitution as `skill://foundation/constitution.md` and as a path, relative
   to deployed `AGENTS.md`, that resolves to the deployed constitution.
2. WHEN Pi or OMP installs shared skills, THE SYSTEM SHALL deploy the
   constitution with the `foundation` skill, and every relative link in that
   package SHALL resolve inside it.
3. WHEN composed guidance is deployed, THE SYSTEM SHALL equal the harness
   intro plus every selected section in the declared order.

No-gos: no catalog obligations restated in guidance; no authoring
instructions in the constitution (they live in the skill's authoring notes);
no authority granted beyond ADR-006.

Evidence: `scripts/references.test.ts`, `scripts/verify-installers`;
`docs/adr/006-foundation-decisions.md`.

## US-042 See where a foundation looks weak before a check can decide it

Statement: When a foundation in one of my adopted repositories cannot yet be
decided by a deterministic check, I want an advisory read of the repository's
own evidence, so agents see likely gaps early, uncertain answers go to a
frontier agent, and no merge ever waits on a model's guess.

Criteria:
1. WHEN `foundation-assess` runs, THE SYSTEM SHALL read only tracked Git
   content at the chosen ref (`origin/HEAD`, else `HEAD`) and SHALL NOT write
   to the repository.
2. WHEN it assesses a packet within the request budget using OpenRouter, THE
   SYSTEM SHALL ask `typesafe/jev-1.13` every question for that packet in one
   request and record the packet hash, coverage manifest, requested and
   resolved models, raw answers and an outcome of `finding`, `no_finding`,
   `escalate`, `abstained` or `unavailable` from the thresholds stored beside
   the questions; a packet over the budget, and a run with the offline
   heuristic, SHALL send nothing to Jev and report `abstained`, and a run with
   no provider SHALL report `unavailable`.
3. IF the provider fails or times out, THEN THE SYSTEM SHALL report
   `unavailable`; IF the requested model is not `typesafe/jev-1.13`, THEN THE
   SYSTEM SHALL NOT send the packet; IF any revision other than the approved
   one resolves, THEN THE SYSTEM SHALL report `abstained`; none of these SHALL
   become `no_finding`.
4. IF an answer would conclude from code excerpts that a setting is absent,
   THEN THE SYSTEM SHALL abstain however complete the excerpts look; IF other
   evidence was truncated, THEN THE SYSTEM SHALL abstain instead of reporting
   a confident absence; IF ledger prose has no single-rule boundaries, THEN THE
   SYSTEM SHALL list it as not assessed.
5. WHEN selected evidence contains a secret, THE SYSTEM SHALL redact it before
   any provider receives the packet.
6. THE SYSTEM SHALL exit 0 for every advisory outcome and 2 for invalid
   invocation.

No-gos: no required check, merge gate or disposition change, and no
replacement for a drill or walk (ADR-003, ADR-006); no working-tree reads; no
credential values in output.

Evidence: `agent-config/system-one/foundation-assess.test.ts`,
`docs/semantic-quality.md`.

## Capability: Desktop memory containment

## US-043 Keep development memory failures out of the desktop fleet

Statement: When engineers and verification jobs run on my workstation, I want
native resource boundaries and bounded local admission, so a terminal-scope
memory kill cannot take the entire fleet with it.

Criteria:
1. WHEN the desktop guard is staged, THE SYSTEM SHALL preserve running servers,
   engineers, active desktop configuration, and existing user-unit configuration.
2. WHEN the managed launcher starts or attaches to Herdr, THE SYSTEM SHALL
   verify the server belongs to its bounded user service outside every active
   oomd monitoring ancestor, and refuse an unmanaged server without replacing it.
3. WHEN that service restores panes or starts explicit-command panes, THE SYSTEM
   SHALL charge their newly allocated memory beneath the same bounded fleet
   hierarchy without relying on an interactive-shell wrapper.
4. WHEN a child exhausts a deliberately small test memory limit, THE SYSTEM
   SHALL keep the test Herdr server and an unrelated sentinel alive, without
   systemd stopping the fleet service because of the child OOM.
5. WHILE two admitted local heavy jobs are active, THE SYSTEM SHALL refuse a
   third; admitted jobs SHALL have independent memory/swap bounds and preserve
   command arguments, working directory, exit status, and environment except
   for the guard-owned TMPDIR under `~/.cache/tmp`.
6. WHEN cutover is requested, THE SYSTEM SHALL provide explicit operator-owned
   activation and rollback steps that reconcile existing limits without
   silently restarting a running fleet.
7. WHEN OMP engineer caging is explicitly activated, THE SYSTEM SHALL serialize
   live inspection through verified native startup and retain each leaf's
   independent 4-GiB containment while descendants remain.
8. WHEN available memory is below the 20-GiB guideline or measured fleet memory exceeds
   its advisory guideline, THE SYSTEM SHALL warn in stderr and launch JSON,
   then launch anyway. Memory capacity SHALL NOT refuse a wrapper or roster
   launch, and no opt-out flag SHALL be required. Memory warnings SHALL NOT
   create or update Glass board items; verified containment remains mandatory.
9. WHEN an interactive native OMP engineer starts, THE SYSTEM SHALL verify effective 4-GiB memory,
   zero swap, group-OOM and actual membership outside every live oomd-monitored
   ancestor, while preserving argv, cwd, environment, PTY and session identity.
10. WHEN a caged engineer is killed, THE SYSTEM SHALL restore sane terminal
    state and discard stale query input before returning to the shell, without
    replaying the interrupted tool or releasing the surviving leaf's containment.
11. WHEN the rollout is activated, THE SYSTEM SHALL preserve running Herdr and
    existing engineers; only their natural exits/restarts migrate them.
    Mandatory inspection SHALL NOT enumerate legacy processes, ancestry,
    RSS/PSS/smaps or heavy jobs; unavailable capacity guidance SHALL only warn.
12. WHEN the native binary updates or Herdr restores a saved engineer, THE
    SYSTEM SHALL retain the caged entrypoint; staging on an unactivated host
    SHALL preserve the native executable and leave active units unchanged.
13. WHEN an installed Workbench updater has not accepted the versioned cage
    layout, explicit activation SHALL refuse before changing the entrypoint or
    live units; source-only updater changes SHALL NOT count as compatibility.
14. WHEN OMP is used for native print, explicit modes, management roots/aliases,
    help/version/export/profile alias creation or non-TTY stdin, THE SYSTEM SHALL
    execute the native binary in the caller's cgroup without engineer inspection.
    Native argument value boundaries and end-of-options SHALL be preserved;
    print-shaped prompt data SHALL NOT bypass interactive containment.

No-gos: no Herdr fork, privileged changes, global oomd tuning, automatic live
cutover, or claim of protection from arbitrary same-user cgroup escapes or a
kernel OOM selecting the Herdr server itself. A shared fleet cap is not
per-engineer memory isolation. Transitional uncaged engineers remain unbounded
until their natural restart; advisory guidance does not retroactively cap them.

Evidence: `agent-config/desktop-guard/`, `omp-config/bin/omp-engineer.py`,
`omp-config/bin/test_omp_engineer.py`, `omp-config/bin/omp-roster.test.ts`,
`docs/desktop-memory-guard.md`, and
`docs/postmortems/2026-09-26-shared-terminal-oom.md`.

## US-045 Sign Pi into more than one account per provider

Statement: When one subscription account is exhausted or blocked, I want Pi to
hold further accounts for the same provider, each signed in by me through Pi's
own login, so I can switch accounts without a second harness's credentials.

Criteria:
1. WHEN the Pi installer deploys the `accounts` component, `/login` SHALL list
   `OpenAI Codex (account 2)` through `(account 4)` beside the base provider,
   and `--model openai-codex-2/<model>` SHALL resolve without a login instead
   of failing as an unknown model.
2. WHEN I sign in to a slot, THE SYSTEM SHALL store that login under the slot
   id in Pi's `auth.json`, and every request on a slot model SHALL use the
   slot's login, never the base provider's.
3. WHEN the component is removed, THE SYSTEM SHALL leave the base providers and
   their stored logins working as stock Pi.
4. WHEN a slot model is selected, Pi's model policy SHALL approve exactly the
   models it approves for the base provider, at the same thinking level, and
   SHALL refuse unlisted look-alike provider ids.

5. WHEN I select a pool model (`openai-pool/…`, `xai-pool/…`,
   `openrouter-pool/…`), THE SYSTEM SHALL serve the request from one signed-in
   account of that provider, keep it for the session while usable, and start
   other sessions on the least recently used account.
6. WHEN an account fails on a usage or rate limit before producing output,
   THE SYSTEM SHALL block it until the reset the provider states (else a
   conservative default), share that block with every Pi session, and serve
   the same request from the next account; other failures SHALL surface
   unchanged, and with every account blocked or signed out the request SHALL
   fail with that reason.
7. WHEN an API-key slot has no stored key, THE SYSTEM SHALL treat it as signed
   out rather than read the base provider's environment key.

No-gos: no reading, copying, or refreshing another harness's stored tokens; no
Claude Code or Google client impersonation added by this repository.

Evidence: `pi-config/extensions/accounts/slots.test.ts`,
`pi-config/extensions/accounts/pool.test.ts`, `pi-config/docs/adr/026-pool-accounts-behind-one-provider-with-shared-blocks.md`,
`pi-config/docs/adr/024-extra-accounts-are-cloned-providers-with-pi-owned-logins.md`,
and the isolated `/login` walk recorded in the PR.

## US-048 Carry lean, useful agent guidance

Statement: When I start engineering work, I want positive principles and local
facts in a small global prompt, with procedures available on demand, so agents
spend context on the task rather than repeated rules.

Criteria:
1. WHEN Pi or OMP composes global guidance, THE SYSTEM SHALL carry positive
   engineering principles and operational discovery facts; the commissioned
   OMP subtraction SHALL reduce the 2026-09-30 baseline of 3,907 words to at most
   800 words, excluding the separately discovered skill index.
2. WHEN a relevant procedure is needed, THE SYSTEM SHALL provide its commands,
   paths, credential locations and review/landing facts through on-demand skills
   or the harness-specific reference, while configuration owns enforced policy.
3. WHEN an agent builds or changes an agent, THE SYSTEM SHALL provide a short
   `agent-design` skill with source-linked progressive disclosure, prompt-cache,
   tool/context, authored-message and positive-guidance facts.
4. WHEN skills are consolidated, THE SYSTEM SHALL migrate current callers,
   remove retired owned packages and preserve foreign packages and executable
   contracts.
5. WHEN verifying this subtraction, THE ENGINEER SHALL replay the same five
   authentic recent engineer first turns before and after, report word counts
   and scope/delivery regressions, and distinguish planning proof from execution.

No-gos: no code/config permission changes or new message templates; Kaylee's
existing Hermes operating skill remains outside this operator-approved
harness-only slice.

Evidence: `docs/lean-agent-guidance.md`, `scripts/verify-installers`,
`agent-config/bin/install.test.ts`; installed OMP/Pi guidance and skill reads.

## US-049 Inspect a pull request's running candidate and agent evidence

Statement: When an agent finishes a unit of work, I want its pull request to
carry a production-like running preview and the agent's story evidence, so I
can click through the candidate, see proof for every affected story and what
was not affected, and approve it before merge.

Criteria:
1. WHEN a trusted same-repository pull request opens, reopens, or changes head,
   THE SYSTEM SHALL run that exact head in its own private exe.dev VM using the
   application's production build and existing privacy-safe QA data.
2. WHEN an agent posts QA evidence, THE SYSTEM SHALL attach screenshots or video
   directly to the PR with `gh pr comment --attach`, bind the preview and evidence
   to the candidate revision, and walk every affected criterion through every
   adapter it claims; affected verification gaps SHALL block completion until
   repaired, and untouched stories SHALL be marked not affected.
3. WHEN the pull request merges or closes without merging, THE SYSTEM SHALL
   destroy only its owned preview VM while preserving the GitHub-native evidence
   attached to the PR independently of the VM.
4. WHEN a pull request receives another head, THE SYSTEM SHALL replace the old
   preview and SHALL NOT publish obsolete evidence as proof of the new head.
5. IF a fork pull request appears, THEN THE SYSTEM SHALL skip its preview and
   post that exception on the PR without changing exe.dev account policy.
6. WHEN either harness installs shared skills, THE SYSTEM SHALL provide the same
   small preview lifecycle skill while the application owns its QA seed,
   production setup, user stories, and verification.
7. WHEN CI deploys a preview, THE SYSTEM SHALL limit CI to deployment and teardown;
   the agent SHALL walk affected stories and attach evidence from its own session
   using its existing GitHub sign-in, without provisioning an upload token in CI.
   CI SHALL post only the current preview link or an explicit fork exception,
   keeping deployment machine facts in the controller output.

No-gos: no real customer data unless explicitly approved for the application's
existing QA; no controller SSH/GitHub credentials in the VM; no accepted affected
verification gaps; no upload credentials in CI; no VM-hosted evidence or Actions
artifacts; no changes to account-wide exe.dev integrations.

Evidence and ownership:
- Shared controller boundary: `agent-config/skills/pr-preview/pr-preview.test.ts`.
- C2: Habitat PR #641's revision-bound private preview, GitHub-native
  screenshots/video, and four-adapter walk.
- C6: isolated Pi/OMP installation and composition through `scripts/check shared`.
- C1, C3–C5, and C7 event wiring: the separately reviewed application integration
  in [Habitat PR #692](https://github.com/r90group/habitat/pull/692), not this
  shared skill alone. The refreshed #641 loop must prove automatic deployment
  and teardown before end-to-end acceptance.

## US-050 Understand every review page at a glance

Statement: When an agent hands me a review page, I want its whole point and every
ask on the first laptop screen, in short lines, with detail one click down, so I
can decide without scrolling or reading a book.

Criteria:
1. WHEN an agent is asked for an operator review page, THE SYSTEM SHALL carry
   the one-screen rule on demand through `engineering-operations`: point, each
   ask and short blocks first, all detail folded behind drill-down, none deleted.
2. WHEN an agent checks a page with `review-check`, THE SYSTEM SHALL load it in
   real headless Chromium at 1280x640 and report a missing point or ask, a point
   or ask hidden, folded, clipped or below the first screen, a visible block
   over 35 words and a screen over 300 visible words. Visual occlusion SHALL be
   judged from the saved screenshot, not mouse hit targets.
3. IF the browser or the page cannot be loaded, THEN THE SYSTEM SHALL exit 2
   with the reason, never a pass.
4. WHEN either harness installs shared skills, THE SYSTEM SHALL deploy the same
   `review-check` launcher and the guidance beside it.
5. WHEN the maintainer procedure publishes a review round, THE SYSTEM SHALL direct
   `review-check` before `glass review publish`, with each round its own file
   beside the earlier rounds.

No-gos: no restyling of pages, no content rules beyond the first screen, no model
call, no change to Glass, no second registry of pages.

Evidence: `agent-config/bin/review-check.test.ts`, `scripts/verify-installers`,
`agent-config/skills/engineering-operations/review-page.md`,
`agent-config/review/README.md`.
