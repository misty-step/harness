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

Evidence: `scripts/verify-installers`,
`agent-config/skills/test-audit/SKILL.md`,
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
   verify the relevant actual user path; documents and measurements need no
   review round.
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

Evidence: `scripts/verify-installers`,
`agent-config/skills/story-qa/SKILL.md`;
disposable Pi and OMP installer smoke.

## US-023 Keep verification useful

Run affected native checks and walk the real user path. Code that ships gets
one independent review, repeated only for real bugs. Documents, briefs and
measurements need no review.

Evidence: `agent-config/skills/story-qa/check-cadence.md`.

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

## US-052 Manage authorized applications without controlling the desktop

Statement: While an engineer is isolated from my desktop, I want it to finish
authorized application installation, configuration and activation through native
owner paths, with host readback and explicit live-state evidence, without taking
over my screen or cursor.

Criteria:
1. THE SYSTEM SHALL expose only typed capabilities, named installation,
   selected-asset receipt readback/rollback, and fixed repository install/readback
   through Workbench's owned socket. Arbitrary commands, destinations,
   environments, caller-authored source proof and unknown repositories SHALL fail.
2. THE SYSTEM SHALL preserve operator screen, cursor and capture isolation,
   hidden live Hermes state and namespace boundaries. Writable installed code
   and authorized application management SHALL NOT require desktop authority.
3. WHEN `cli` is selected, THE SYSTEM SHALL stage the client without activating
   the cage, altering the retained native OMP binary or restarting active engineers.
4. THE SYSTEM SHALL delegate source eligibility, fixed native installer execution,
   host byte/mode/link checks and recipe-specific recovery to Workbench.
   Selected-asset receipts SHALL remain on the existing Glass commission.
5. THE SYSTEM SHALL distinguish installed code from live activation and SHALL
   permit Kaylee skill installation without whole-profile, identity, credential,
   other-profile, cron-runtime or live-state replacement.
6. WHEN an explicitly requested application recipe owns activation, THE SYSTEM
   SHALL use that application's existing startup owner, preserve unrelated
   configuration and runtime data, and prove the running process loaded the
   installed executable. Cantrip SHALL use the fixed `cantrip` repository route,
   not an arbitrary command or automatic Harness-install side effect.
7. WHEN CLI installation finds a UID-owned managed Workbench broker advertising
   the exact `refresh-service` command, THE SYSTEM SHALL invoke only that command.
   It SHALL no-op when the running broker is current; otherwise its fixed native
   worker SHALL wait behind the current host installer request and restart only
   `workbench-host-install.service` to load the changed broker executable.

No-gos: No arbitrary host shell, new live-profile mount, display/input/session-bus
exposure, unrelated consumer restart or second deployment engine. Initial broker
provisioning uses its authorized native owner installer; existing broker updates
use the managed release plus host-side Harness installer refresh.

Evidence: `omp-config/bin/omp-host-install.py`, `omp-config/install`,
`omp-config/bin/test_omp_host_install.py`,
`omp-config/bin/test_omp_display.py`; Workbench owns host readback and audited
selected-asset rollback. The [application-management runbook](omp-config/README.md#authorized-application-management)
and [decision 0013](docs/decisions/0013-application-management-not-desktop-control.md)
describe the Cantrip and existing-broker paths.

## Capability: Execution offload

## US-003 Offload heavy execution to exe.dev

Statement: When an agent needs to run heavy suites, browser verification, or
long-running services, I want execution in my project's owned exe.dev workspace,
so desktop responsiveness is preserved without case-by-case VM approval.

Criteria:
1. WHEN an agent starts heavy or long-running execution from the workstation,
   THE SYSTEM SHALL direct it to the project's owned exe.dev workspace through
   native SSH; WHERE a CI job runs on a GitHub-hosted runner, THE SYSTEM SHALL treat
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

## US-025 Work in an owned exe.dev project workspace — retired automation

The custom `ws` snapshot, lease and teardown controller is retired by the
operator's configuration/install/skills-only scope decision. Native SSH/exe.dev
and the `remote-execution` skill retain off-host execution guidance. Automatic
snapshot transfer, receipt hashes and evidence-gated teardown are no longer
harness capabilities. Preserve standing VMs and existing task data.

## Capability: Session close

## US-004 Close owned landing work and session resources — retired automation

The owner-scoped landing/lease ledger and mandatory close gate are retired by
the operator's scope decision. Inspect native Git/SSH state, preserve foreign
work, remove only owned resources when authorized, and report unfinished work
honestly. No replacement control plane, tracker or automatic cleanup is added.

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

## Capability: Model routing

## US-014 Use approved model routing and recovery

Statement: When I start or delegate work in either harness, I want intentional
model roles and bounded subscription recovery, with Sol for engineering and
Opus required for visual, motion, UX and communications work, so work uses the
selected reasoning tier without mistaking an authorized account for capacity.

Criteria:
1. WHEN a fresh OMP session selects `default`, `task`, `slow` or `plan`,
   THE SYSTEM SHALL use Sol xhigh with native OpenAI priority service.
2. WHEN OMP resolves `vision` or `designer`, THE SYSTEM SHALL use the configured
   Opus visual hold through native model/effort selection. Explicit held levels
   SHALL remain available. Provider failure SHALL stop rather than switch models.
3. WHEN OMP delegates ordinary work, THE SYSTEM SHALL use native agent/model
   resolution, without custom usage routing, per-agent model overlays or
   protected-agent startup guards. Native effort and explicit held-model
   selection SHALL remain available. Automatic advisor review SHALL stay off.
4. OMP SHALL have no paid or cross-model fallback and no default Grok/Gemini
   reviewer or scout. Visual work SHALL retain the configured Opus hold.
   Pi recovery SHALL use Sol xhigh then Astra xhigh through its native Codex
   pool, without depending on SuperGrok. Explicit effort overrides SHALL remain
   available; the default effort SHALL be xhigh rather than low.
   All shared subscription accounts SHALL be authorized for any work and
   SHALL fail over between each other; no engineer launch SHALL require any
   one account. Authorization SHALL NOT be treated as proof of available quota.
5. WHEN the Pi installer runs, THE SYSTEM SHALL select GPT-6.1 Sol xhigh as
   Pi's default, request priority service for native Codex inference, and report
   a missing Pi-native Codex login rather than restore
   the retired DeepSeek default. Pi SHALL use only OpenAI Codex, xAI and
   OpenRouter routes: any Anthropic model, direct or through OpenRouter,
   SHALL be refused before inference. If native startup selects an unapproved
   model after login loss, agent prompts, provider requests, compaction and
   branch summaries SHALL be refused before paid inference.
   Source-owned retry and automatic compaction SHALL be enabled on deployment;
   unrelated live settings SHALL remain unchanged.
6. WHEN configuration is deployed, THE SYSTEM SHALL preserve OAuth stores and
   the model already selected in existing sessions.
7. WHEN OMP configuration is deployed, THE SYSTEM SHALL remove retired owned
   routing settings while preserving foreign settings and all live auth/account
   content. Native OMP, not a copied model/effort validator, owns resolution.

No-gos: no copying OAuth credentials between harnesses; no frontier model
through OpenRouter as a default; no unauthenticated route treated as usable
capacity; no Grok builder fallback; no retired Sonnet or unapproved paid model
fallback.

Evidence: `omp-config/config.yml`, `omp-config/agents/designer.md`,
`omp-config/bin/omp-merge-config.test.ts`,
`omp-config/global/AGENTS.md`, `omp-config/README.md`,
`pi-config/settings.json`, `pi-config/install`,
`./scripts/verify all`, fresh native OMP model-selection and loading checks.

## US-046 Launch engineers only on the ticket's model roster — retired

Ticket roster enforcement, usage-based launch admission, automatic paired
experiments, learned effort defaults and their journal controller are retired
by the operator's native configuration/install/skills-only scope decision.
Native OMP model roles and explicit selectors remain; historical experiment
records are preserved as data and are not used to control launches.

## US-047 Queue engineer work when the fleet is full — retired

Custom fleet counting, board queue admission and capacity commands are retired.
Installs remove stale `omp-roster` launchers. Native task dispatch and desktop
isolation remain; memory caps and admission checks are removed.

## Capability: Protected releases

## US-015 Publish verified harness releases

Statement: When a harness change merits a release, I want its generated
changelog verified before publication, so
release automation cannot publish an unverified default-branch candidate.

Criteria:
1. WHEN a verified `master` change warrants a release, THE SYSTEM SHALL stage
   the generated changelog in a pull request instead of pushing directly to
   protected `master`.
2. WHEN that pull request contains only generated notes for reviewed changes
   and passes required exact-head checks against the current base, THE SYSTEM
   SHALL merge through native GitHub auto-merge before publishing its version
   tag and GitHub Release, without a second review or human approval.
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
3. WHERE speech is explicitly requested, THE SYSTEM SHALL attempt speech and
   report its output or error while retaining the written brief. Ordinary status
   SHALL remain in chat without mandatory/default audio.

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
   bare keyword name, a leading underscore or an unquoted value containing spaces,
   THE SYSTEM SHALL send the provider a placeholder instead of a value of eight
   or more characters.
2. WHEN any tool prints a URL with a password of eight or more characters in its
   user-info field, even with an empty username, THE SYSTEM SHALL mask the full
   password through the final authority delimiter, including an embedded `@`,
   before the path, query or fragment.
3. IF the committed policy holds a plain entry or a regex that does not compile,
   THEN installation SHALL fail before deploying anything.
4. IF the agent directory's `secrets.yml` lacks the managed first line, THEN
   installation SHALL fail without replacing it.

No-gos: no secret values in the repository; no change to where credentials are
stored; no network or model call in the check.

Evidence: `omp-config/bin/omp-secrets-policy.test.ts`,
`scripts/verify-installers`

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
`pi-config/extensions/accounts/pool.test.ts`, `pi-config/docs/decisions/historical/026-pool-accounts-behind-one-provider-with-shared-blocks.md`,
`pi-config/docs/decisions/historical/024-extra-accounts-are-cloned-providers-with-pi-owned-logins.md`,
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
5. WHEN verifying changed guidance, THE ENGINEER SHALL inspect the composed
   instructions and exercise the affected actual consumer.

No-gos: no code/config permission changes or new message templates; Kaylee's
existing Hermes operating skill remains outside this operator-approved
harness-only slice.

Evidence: `docs/lean-agent-guidance.md`, `scripts/verify-installers`,
`agent-config/bin/install.test.ts`; installed OMP/Pi guidance and skill reads.

## US-049 Inspect a pull request's running candidate and agent evidence — retired controller

The shared automatic private-VM PR preview/replacement/teardown controller is
retired by the operator's scope decision. Application-owned preview deployments
and native GitHub evidence remain application capabilities, not harness-managed
lifecycle. `story-qa` still guides actual affected-path verification; no replacement
preview service, scheduler or upload credential is introduced.

