# Stories

Consumer contracts for the harness-neutral method. IDs stay reserved when a
capability moves; private workstation contracts belong to `misty-step/workstation`.
Terms and invariants live in [DOMAIN.md](DOMAIN.md).

## US-001 Verify the method plugin

When I change mistystack, I want one canonical gate and an isolated consumer
proof, so skill moves do not depend on retired host installers.

Criteria:
1. `./scripts/check` runs the maintained release-protection, secret-scanner,
   plugin and skill tests sequentially, with Bun concurrency capped at one.
2. `./scripts/check plugin` uses isolated native installs for every available
   OMP, Claude Code, Codex and pi CLI, checking skills and core registration;
   OMP also observes a fresh session's loaded core without inference.
3. A failed test, invalid plugin or failed available-harness proof exits nonzero.
   Missing CLIs and lint-only installation skips are named, never reported passed.
4. Verification preserves the live profile, credentials and foreign state.

Proof: `scripts/verify`, `scripts/verify-plugin.ts`,
[verify-mistystack](.agents/skills/verify-mistystack/SKILL.md).

## US-006 Review named UI states

When I ship a visual change, I want the affected rendered states captured and
organized, so I can see what was reviewed before the change is called verified.

Criteria:
1. Design verification declares a named-state matrix and captures each state.
2. A missing capture fails the gallery check; an unreachable state remains
   explicitly unverified with its reason.
3. Generated proposals do not count as proof of behavior or accessibility.
4. Capture output stays outside Git by default.

Proof: `skills/design/scripts/gallery.test.ts`, [design](skills/design/SKILL.md).

## US-011 Explore useful design alternatives

When a task changes a UI, I want evidence-led design choices before production
code, so the result serves the user's job rather than the first plausible image.

Criteria:
1. The [design skill](skills/design/SKILL.md) routes work through relevant craft guidance.
2. Useful alternatives differ in structure or behavior, not just color; the
   recommendation explains the trade-off against the user's task.
3. Generated images remain proposals. Exact copy, behavior and accessibility
   are checked on the rendered product.
4. Durable design choices use the product's existing DESIGN.md. Exploration
   stops when the decision is supported rather than requiring a fixed round count.

Proof: `skills/design/SKILL.md` and the rendered product's comparison evidence.

## US-014 Assign rigor roles through setup

When I set up the method, I want model and reasoning choices assigned once to
rigor roles, so task briefs select risk and responsibility without a second
model roster in skill prose.

Criteria:
1. [Setup](skills/setup-mistystack/SKILL.md) assigns `rigor-light`,
   `rigor-standard` and `rigor-critical` through the active harness's authority:
   OMP model roles, Claude agent model fields or Codex user-agent TOML.
2. Native role agents select the tier where subagents exist; the brief supplies
   responsibility. pi runs rigor inline without inventing subagents or model roles.
3. Setup preserves unrelated config, credentials and runtime state, resolves
   native shadowing and reads assignments back.
4. A fresh session proves discovery and core loading. Successful authorized
   dispatch and its actual model identity prove a chosen subagent route; config
   readback alone proves persistence. Grok Bots establish their runtime contract.

Proof: `skills/setup-mistystack/`, `agents/`, `adapters/`, [rigor roles](skills/ship-loop/roles.md).

## US-015 Publish verified mistystack releases

When a change merits a release, I want its generated changelog verified before
publication, so an unverified default-branch candidate cannot be published.

Criteria:
1. Landmark stages generated notes in a PR rather than pushing to protected master.
2. A generator-only PR merges through native GitHub auto-merge after required
   exact-head checks pass, without another authored-policy review round.
3. Publication refuses an unlanded candidate or a tag pointing to another commit.
4. Retries preserve an already published version without duplicate notes or
   moving its tag.

Proof: `.github/workflows/landmark-release.yml`,
`scripts/protected-release.test.ts`, `scripts/protected-release-check.test.ts`.

## US-021 Keep test coverage meaningful

When agents write or prune tests, I want each consumer contract defended at its
useful owner boundary, so refactoring removes noise without losing protection.

Criteria:
1. [Test audit](skills/test-audit/SKILL.md) names the real failure and inspects
   existing proof before adding or deleting coverage.
2. Pruning preserves independent access, data, migration, package and protocol
   contracts and exercises the affected consumer path.
3. A commissioned subsystem audit groups work by contract; ordinary changes
   retain their original scope instead of starting a portfolio sweep.

Proof: `skills/test-audit/SKILL.md` and the changed consumer's native checks.

## US-022 Review work through product stories

When I assess a change or recurring product health, I want agents to walk the
user's real interface, so the report distinguishes observed behavior from tests
and inferred completion.

Criteria:
1. [Verification](skills/verification/SKILL.md) guides affected-story walks through the actual product.
2. Each walk names its story or request criterion, candidate revision, actions,
   observable postconditions and owned cleanup.
3. A product with sign-in uses the agent-owned QA account and proves the
   required role; missing access remains unproved rather than replaced by a mock.
4. A report separates measured outcomes, inferences and blocked criteria. An
   internal change uses composition proof rather than an invented browser walk.
5. Recurring health review rotates through a curated story list without
   requiring every journey on every PR.

Proof: `skills/verification/SKILL.md` and the consumer's verification evidence.

## US-023 Keep review and verification useful

When work reaches review, I want risk-scaled independent proof and a bounded fix
round, so a new thread cannot restart review or turn an unrelated finding into scope.

Criteria:
1. `ship-loop` records rigor, its concrete reason and diff size on the PR; light
   work uses combined QA/review and an independent judge, while riskier work
   separates QA, review and judge.
2. The PR's native ledger survives head changes and new sessions. Only a judge's
   FIX naming eligible blockers authorizes the one permitted fix round.
3. The blocking reporter rechecks the named fixes. The next verdict is SHIP with
   tickets or REVERT / SPLIT; new unrelated findings become tickets.
4. Proof names the checked revision, real path, exact commands and observed
   result. Generated output lives outside the checkout and is reviewer-accessible.
5. The judge treats a missing real-path proof as missing evidence, not a passing
   unit test. A recorded `no deploy` skips release watching for internal changes.

Proof: `skills/ship-loop/scripts/ship-loop.test.ts`, `skills/ship-loop/roles.md`,
`skills/judge/SKILL.md`.

## US-044 Subtract before shipping a designed surface

When a design is refined, I want unnecessary elements removed, so the primary
task becomes simpler without hiding required information.

Criteria:
1. [Design](skills/design/SKILL.md) challenges elements against the primary task and required
   safety, status and accessibility information.
2. The affected rendered state is inspected after subtraction and the task and
   required information remain reachable.
3. A numeric word budget or taste score does not substitute for that inspection.

Proof: `skills/design/SKILL.md` and the affected rendered-state evidence.

## US-048 Carry lean, useful method guidance

When I start work, I want a small core and on-demand procedures, so instruction
context serves the task rather than repeating facts.

Criteria:
1. The core routes nontrivial work to `misty`; principles and procedures have
   one home and load through its index or the relevant skill.
2. Skills follow DOMAIN.md's frontmatter and directory-wide source convention.
3. [Agent design](skills/agent-design/SKILL.md) guides instruction and tool/context changes; the skill
   diet compares a proposed instruction against both the prior version and none.
4. A cutover migrates current callers and removes obsolete method copies.
   Workstation facts remain with the workstation plugin.
5. Changed instructions are checked through the affected actual consumer, not
   just their word count or installed file bytes.

Proof: `rules/core.md`, `skills/misty/`, `skills/agent-design/`,
`skills/principle-skill-diet/`, plugin lint and fresh-session proof.

## US-053 Lead full-value initiatives through atomic delivery

When I commission an initiative, I want the full useful outcome shaped and split
into independently shippable slices, so small PRs do not conceal a narrowed goal.

Criteria:
1. [Grill](skills/grill/SKILL.md) records the complete outcome, boundaries and acceptance criteria.
2. Each dispatched slice has an Oracle and is useful with main still working.
3. Independent slices run in parallel; true dependencies sequence or stack.
4. [Ship-loop](skills/ship-loop/SKILL.md) carries the affected story IDs, risk-scaled proof and an
   independent judge through delivery.

Proof: `skills/grill/SKILL.md`, `skills/misty/SKILL.md`, `skills/ship-loop/`.

## US-057 Install and refresh the method plugin

When I adopt or update mistystack, I want the harness's native lifecycle, so one
content tree serves my runtime without a host installer or method fork.

Criteria:
1. Setup detects the harness and follows its native
   [reference](skills/misty/SKILL.md) to install the shared tree.
2. Refresh follows that harness's rule and verifies installed content; a catalog
   update or success message alone is not an installed-content upgrade.
3. Native inventory lists the enabled install and skills, and a fresh session
   proves core loading and role discovery where the harness supports subagents.
4. Setup preserves unrelated plugins and profile state.

Proof: `skills/setup-mistystack/SKILL.md` and isolated native plugin installation.

## US-058 Load the core in every enabled session

When I start a session with mistystack enabled, I want the core applied without
remembering a command, so its routing and guardrails are present first.

Criteria:
1. `rules/core.md` stays at most 20 lines; native adapters load that same core.
2. A fresh native session exposes the installed core in its loaded instructions;
   file presence and a model's self-report alone do not prove loading.
3. Principle leaves remain reachable from the mode rather than expanding the
   always-on core into every procedure.

Proof: `scripts/verify-plugin.ts`, `scripts/verify-plugin.test.ts`,
[verify-mistystack](.agents/skills/verify-mistystack/SKILL.md).

## US-059 Route nontrivial work through misty

When a task needs engineering judgment, I want one mode to select the relevant
method, so task agents receive a coherent brief instead of duplicated rule sets.

Criteria:
1. The core routes nontrivial work to [misty](skills/misty/SKILL.md).
2. The mode indexes the principle leaves and selects a task-type playbook and
   relevant shaping, research, design, delivery or verification skills.
3. A brief carries outcome and why, domain terms, raw material, Oracle, scope
   and keep, and effort.
4. Referenced skills and playbooks resolve to their maintained homes; hidden
   principle leaves remain explicitly reachable.

Proof: `skills/misty/SKILL.md`, `skills/misty/playbooks/`, plugin reference checks.

## US-060 Require an Oracle before dispatch

When work is delegated, I want a falsifiable outside check named first, so the
worker's completion claim is not its own proof.

Criteria:
1. Shaping supplies the exact check command or real user path and the expected
   observable result before dispatch.
2. A brief without an Oracle returns to shaping rather than launching work.
3. Completion drives that check on the real consumer path and reports the
   observed result or exact unproved criterion.

Proof: `skills/misty/SKILL.md`, `skills/grill/SKILL.md` and the dispatched brief's
consumer evidence.

## US-061 Run isolated work on Boat workers

When an agent builds, tests, runs browser QA or executes untrusted code, I want
it placed on a fresh Boat worker dispatched from wherever the agent runs, so the
machines agents work from stay responsive and isolated work does not depend on
a retiring coordinator.

Criteria:
1. The core routes execution placement to the
   [boat-workers](skills/boat-workers/SKILL.md) skill for every harness without
   naming one; that skill owns the list of worker cases. Other work stays where
   the agent runs unless its harness note says otherwise: the
   [OMP note](skills/misty/harnesses/omp.md) names Tern+OMP, and the
   [Grok Bot note](skills/misty/harnesses/grok-bot.md) keeps Bots on their own
   computer without adopting Tern+OMP.
2. Platform, device, signed-in-session, private-network and
   non-transferable-data checks stay where the agent runs, within any limits its
   harness note states. An agent inside a worker runs its checks there without
   nesting workers.
3. Workers withhold stored account secrets by default, carry an explicit size
   and timeout, and keep exit status and output as evidence.
4. Cleanup retains the deletion result and confirms each owned ID is absent
   from all-state inventory; a stopped worker is not deleted.
5. Workers stay inside the plan's included time. Wallet charges, purchases,
   plan changes, provider connections and new keys need Phaedrus; a missing
   Boat credential is a reported prerequisite, not a reason to run less isolated.

Proof: `rules/core.md`, `skills/boat-workers/SKILL.md`,
[ADR 0017](docs/decisions/0017-tern-omp-and-boat-workers.md) and a fresh-session
worker dispatch with all-state cleanup.
