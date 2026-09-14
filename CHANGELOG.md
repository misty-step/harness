## Unreleased

### Features

* **workstation:** add a user-scope bounded execution workflow and tracked disk/inode, RAM, swap-growth, and slice-pressure notifier; document the 1 GiB containment and visible alert proof.

## [0.0.39](https://github.com/misty-step/omp-config/compare/v0.0.38...v0.0.39) (2026-09-14)


### Features

* **pass-env:** add portable pass launcher and harness guidance ([eb22181](https://github.com/misty-step/omp-config/commit/eb221816a409f9959c9b3d2ec51e5cb23df82856))

## [0.0.38](https://github.com/misty-step/omp-config/compare/v0.0.37...v0.0.38) (2026-09-11)


### Features

* **config:** subscription-first fallbacks at catalog-max effort ([523f46d](https://github.com/misty-step/omp-config/commit/523f46dd865a99a9f03406292fa018fc42b4b990))

## [0.0.37](https://github.com/misty-step/omp-config/compare/v0.0.36...v0.0.37) (2026-09-10)


### Features

* **config:** restore Astra-first routing and prune retired owned keys ([5343a1b](https://github.com/misty-step/omp-config/commit/5343a1b8e4366df2a073deaec2ee8bd07ad70a74))

## [0.0.36](https://github.com/misty-step/omp-config/compare/v0.0.35...v0.0.36) (2026-09-10)


### Features

* **config:** default Astra roles to high and introduce extreme alias ([6376169](https://github.com/misty-step/omp-config/commit/6376169aaf8d7fee74d77209f01eecff0405d9bf))

## [0.0.35](https://github.com/misty-step/omp-config/compare/v0.0.34...v0.0.35) (2026-09-10)


### Features

* **config:** prefer Flash default and consolidate fallback chains ([bfeaa19](https://github.com/misty-step/omp-config/commit/bfeaa1980bb71d3ed3777bccfa4e0a353b512c47))

## [0.0.34](https://github.com/misty-step/omp-config/compare/v0.0.33...v0.0.34) (2026-09-10)


### Bug Fixes

* **config:** remove hostname status segment ([53e10e4](https://github.com/misty-step/omp-config/commit/53e10e4b1afc9ae88fd9fac3949718a272483ada))


### Features

* **executive:** enforce recursive delegation and scoped deployment ([5c9be02](https://github.com/misty-step/omp-config/commit/5c9be02d239c40187384b30953540672f1ab00dd))
* **verification:** add repository-owned verification authoring ([6a7430b](https://github.com/misty-step/omp-config/commit/6a7430bd37cd5d024d12ba483f20c46d07bbb316))

## [0.0.33](https://github.com/misty-step/omp-config/compare/v0.0.32...v0.0.33) (2026-09-09)


### Bug Fixes

* **config:** restore hostname status segment (MIS-40) ([c0be3fc](https://github.com/misty-step/omp-config/commit/c0be3fc20e54335460c22f42eb8fbd7c4ea6b549))

## [0.0.32](https://github.com/misty-step/omp-config/compare/v0.0.31...v0.0.32) (2026-09-09)


### Features

* **harness:** vendor exe.dev skill and Astra default (MIS-40) ([fa8f7a4](https://github.com/misty-step/omp-config/commit/fa8f7a468ad310b9fe199866db1bdad3134e0569))

## [0.0.31](https://github.com/misty-step/omp-config/compare/v0.0.30...v0.0.31) (2026-09-07)


### Bug Fixes

* **hooks:** exclude .git from trufflehog filesystem scan ([39d0a5f](https://github.com/misty-step/omp-config/commit/39d0a5f193d61eb15afd4b7c877ac5e613f2f099))

## [0.0.30](https://github.com/misty-step/omp-config/compare/v0.0.29...v0.0.30) (2026-09-07)


### Features

* scope integrations and clarify documentation ownership ([7d7276b](https://github.com/misty-step/omp-config/commit/7d7276b7e38830ae636e9626dd0cbd0ca0ee6a6d))

## [0.0.29](https://github.com/misty-step/omp-config/compare/v0.0.28...v0.0.29) (2026-09-07)


### Features

* document privilege routing and deploy guidance safely ([1318755](https://github.com/misty-step/omp-config/commit/131875585a249a21b290519a7ccebf483eb8c9dc))

## Unreleased

### Added
- Add the explicitly invoked `agent-ergonomics` skill for evidence-backed
  agent-facing design and plan edits, with read-only review support and no
  implementation, deployment, or tracker writes.
- Add the explicitly invoked `verification-infrastructure` skill to create or
  repair repository-owned runnable verification and its agent-facing knowledge,
  preserving existing interfaces and requiring meaningful runtime evidence.
- Make Main and recursive executive agents delegation-only scope owners, with
  native tool enforcement, bounded worker/executive admission, durable briefs,
  and owned-subtree cancellation. Keep implementation workers fully capable
  and provide an explicit launch-time hands-on opt-out.
- Add the portable pass-backed `pass-env` launcher and neutral
  `authenticated-commands` Agent Skill. Standalone use requires Bun/pass/GPG,
  not OMP; the OMP-specific `secrets` component (included in `all`) installs the
  executable under `~/.local/bin` and clean-replaces only the owned skill.

### Changed
- Permit delegation and execution through both native OMP and Herdr, including
  agent spawning and work dispatch. Preserve Main/executive tool boundaries
  and worker capabilities; distinguish native lifecycle accounting from Herdr
  ownership, readiness, results, and cleanup. Fresh sessions receive the corrected
  policy after deployment.
- Prefer explicit `pass-env run` mappings and names-only references over
  bulk-exported credentials or a global AGENTS secret policy. Keep local static
  inventories under `~/.config/pass-env`; preserve historical migration evidence
  in `~/.local/state/omp-secrets`. Retire the old launcher only after exact
  SHA-256 ownership verification, with no alias or store/key/value changes.
- Document human values-only editing, newline-exact nvim saves, pass insertion
  semantics, authorized agent maintenance, reference updates, issuer revocation
  boundaries, and explicit skill portability beyond OMP.
- Recast owned guidance, executive instructions, and homebrew skills around
  outcome-driven autonomy and proportionate evidence. Make foundation a coherent
  first-principles recommendation rather than a checklist, and move specialized
  operating and verification concerns into conditional package references.
  Preserve authority boundaries and executable executive policy.
- Prefer Antigravity Gemini 3.8 Flash high for fresh sessions, ordinary task
  workers, smol/tiny/commit/vision roles, and explicit scout/sonic routing. Retain
  Astra for slow/plan/advisor/review and design judgment (`@designer` max); pin
  nested executives to `@plan`. Document manual selection, live-session limits,
  and native agent precedence without adding a classifier or automatic switching.
- Flatten plan/tiny/commit role values to concrete selectors: installed OMP
  18.1.16 failed to resolve `plan: "@slow"` and selected a fallback instead.
  Keep `@plan`, `@tiny`, and `@commit` as native invocation aliases.
- Consolidate all 12 OpenRouter fallback tails to DeepSeek V4.1 Flash max, with
  one entry per chain. Preserve the order and reasoning effort of every
  non-Google fallback; add Flash high to Astra-backed recovery chains without
  repeating Flash in its own primary chains.
- Add selective `executive` deployment and recursion depth 3 without overlaying
  unrelated pending configuration. Use native YAML serialization to preserve
  live string values that resemble numbers.
- Make fresh-agent verification capability an early foundation assessment and
  maintain affected verification knowledge with ordinary executable changes.
  Keep authoring, read-only assessment, and separately authorized recurring
  execution distinct; do not start a repository rollout or provision services.
- Ask foundation assessments to separate failure/uptime observability from
  privacy-safe evidence that promised user journeys actually happen.

- Vendor the official `using-exe-dev` skill unchanged from
  `boldsoftware/exe.dev` at `9af0789cf2417fc16cab7684cc401967a17060d0`
  (skill blob `5c3018342ee964c0c5384772e42e30256e10def8`). Keep local
  workspace, hosting, and recovery policy in `AGENTS.md`, `WATCHDOG.md`,
  and `foundation`. Prefer approved persistent workspaces and useful
  private previews without a fleet migration.
- Remove the hostname status-line segment as requested.


- Make install ownership-aware: overlay source-owned config keys, preserve
  undeclared runtime keys, clean-replace selected owned skills/agents, and leave
  foreign packages in place. Add explicit `config` and `agents` components.
  Preflight every selected input before writes. Stop implicit pre-push install;
  keep gitleaks and trufflehog. Retire global `RULES.md`, `ast-grep`, and
  `now-next`. Refresh Wrangler from Cloudflare skills
  `d924cd8`. Retire global Todoist discovery
  only after the Daybook owner `SKILL.md` exists. Distill always-loaded
  philosophy into `global/AGENTS.md` and collapse the separate canon/RULES
  manuals.


- Document local `pkexec`, interactive SSH `sudo`, and unattended privilege
  routing in always-loaded guidance; distinguish an approval channel from an
  OS authorization grant.
- Add selective deployment with `OMP_INSTALL_COMPONENTS` (`guidance`, `config`,
  `mcp`, `scopes`, `agents`, `skill:<name>`), replacing the unreleased
  guidance-only switch. Ownership-aware `all` is the default.

- Scope Linear to native local imports beneath the Misty Step and moomooskycow
  development roots; remove the global connector and preserve R90 exclusion.
- Retire the global Parlor skill in favor of Parlor-owned, source-aligned imports
  in consuming repositories. Keep OAuth credentials outside this repository.
- Add bounded UX/AX judgment, precise professional naming, reviewer-oriented
  explanations, and U.S. Graphics-inspired functional visual direction without
  changing vendored skills or requiring narrated video and TDD ceremony.
- Document the solo Linear experiment and a separately authorized Deepsec pilot;
  do not enable recurring scans, paid plans, or historical work migration.
- Separate version-bound knowledge, work coordination, and per-run evidence;
  make vision documents optional context instead of product locks.
- Document observed in-session Linear authentication recovery, remove the
  duplicated Deepsec proposal manual, and clarify that ASCII support currently
  provides aesthetic guidance and browser authoring rather than a conversion API.
- Migrate all configured GPT-5.6 roles and fallback entries to GPT-6 Astra,
  preserving their reasoning effort and Codex provider.
- Reimagine the interactive harness around concise collaboration guidance,
  engineering taste in `RULES.md`, and independent watchdog judgment.
- Consolidate 33 repository skills into three homebrew outcomes (`foundation`,
  `now-next`, and `capture`) and five unchanged vendor packages. Remove the
  review, delivery, release, routing, and other workflow entry points, plus the
  vendored agent-writing package.
- Replace the separate design critic and executive skill with a native
  `executive` agent using `@plan` for operator-directed sustained work.
- Keep the fast default model, native role assignments and fallback chains,
  and Exa search; remove advisor catch-up waits while retaining the read-only
  Steward.
- Restore deployment of nonempty `AGENTS.md`, `RULES.md`, and `WATCHDOG.md`.
  Keep recurring review and delivery systems outside this configuration.
- Reframe `foundation` as an explicitly invoked, read-only first-principles
  assessment of product purpose, backlog, and technical foundations. Separate
  the recommended destination and transition from authorization to implement.
- Make verification proportional to concrete risk. Prose and instruction-only
  edits normally need content review and relevant loading or deployment checks,
  not model runs or synthetic applications.
- Show cwd/loc status, then model, then Git.

## [0.0.28](https://github.com/misty-step/omp-config/compare/v0.0.27...v0.0.28) (2026-09-03)


### Features

* **loc:** add in-process async cache worker and worktree resolution ([06e082a](https://github.com/misty-step/omp-config/commit/06e082a1f663130fd635ca7f83d7c47917ff5058))
* **statusbar:** replace built-in path with cwd extension ([7de6a75](https://github.com/misty-step/omp-config/commit/7de6a7508304fc61babf9966a591e395a271f479))
* **statusbar:** surface cwd and loc on the main status segment ([87c40e6](https://github.com/misty-step/omp-config/commit/87c40e6abd5484306f561c532df81868817a0cfa))
* **statusline:** restore mode segment for loop and goal visibility ([c110ed1](https://github.com/misty-step/omp-config/commit/c110ed1a0ebac41439a1f91b2bfee86a0707cfea))
* **statusline:** streamline segments and update host icon to padded server glyph ([1871261](https://github.com/misty-step/omp-config/commit/1871261ca92964f7d18cf5f7bc636c3f81aa8881))

## [0.0.27](https://github.com/misty-step/omp-config/compare/v0.0.26...v0.0.27) (2026-09-03)


### Features

* **config:** set default gemini 3.8 flash, switch muse spark to contributor, restore external skills verbatim, and establish provenance rule ([216d378](https://github.com/misty-step/omp-config/commit/216d37851a2d86b8526cc9f32563b496d4d22505))
* **skills:** vendor show-me, wrangler, and find-bugs verbatim from upstream ([cc75b01](https://github.com/misty-step/omp-config/commit/cc75b013907f022f7934736223137bab9e633dd0))
* **theme:** align default omp theme with tokyonight ([f4cef25](https://github.com/misty-step/omp-config/commit/f4cef25e6937a29a9f40c2bd4ddbf97fa403df24))

## [0.0.26](https://github.com/misty-step/omp-config/compare/v0.0.25...v0.0.26) (2026-09-02)


### Features

* **skills:** give groom a default multi-lens investigation pass ([8139ca0](https://github.com/misty-step/omp-config/commit/8139ca013900a445ad41a5e2617ac9fe6cf14c16))

## [0.0.25](https://github.com/misty-step/omp-config/compare/v0.0.24...v0.0.25) (2026-09-02)


### Bug Fixes

* **config:** update google-antigravity gemini-3.8-flash model slug ([06c1c17](https://github.com/misty-step/omp-config/commit/06c1c179d6f1e7b4dd1297ea3f271fd6ab0a82bd))

## [0.0.24](https://github.com/misty-step/omp-config/compare/v0.0.23...v0.0.24) (2026-09-02)


### Bug Fixes

* **config:** update google-antigravity gemini-3.8-flash model slug ([ff2165a](https://github.com/misty-step/omp-config/commit/ff2165a1d193753522c878527865d346a5d39a79))
* **sdlc:** clarify native attachment capabilities and fallback boundaries ([8e67e39](https://github.com/misty-step/omp-config/commit/8e67e396900dcc2c215bc6ef84bd3c60232fcb58))
* **skills:** require primary-source research in core-docs ([94b8895](https://github.com/misty-step/omp-config/commit/94b889506fbe7257f4b7f613b6218ea4c485bfbf))


### Features

* **config:** tune fallback chains to Pareto frontier with Muse Spark 1.3 and GLM-5.3 ([0cbfbe7](https://github.com/misty-step/omp-config/commit/0cbfbe75c692ea938e3c1d6279552faba37ee1da))
* **config:** update Gemini Flash to 3.8 ([58d56dd](https://github.com/misty-step/omp-config/commit/58d56dd199c4ca551023db5cef26ae9c6cb8de0d))
* **skills:** add core-docs skill and design note ([1151ae2](https://github.com/misty-step/omp-config/commit/1151ae2ea8369d3e05b5e97a384033883aeaf732))

## [0.0.23](https://github.com/misty-step/omp-config/compare/v0.0.22...v0.0.23) (2026-09-02)


### Features

* **sdlc:** establish pull request visual and native media standard ([85c5c25](https://github.com/misty-step/omp-config/commit/85c5c257b142fca6d94dd708660c76480afd9b61))

## [0.0.22](https://github.com/misty-step/omp-config/compare/v0.0.21...v0.0.22) (2026-09-02)


### Features

* **config:** update Claude Fable to 5.1 ([4af2b35](https://github.com/misty-step/omp-config/commit/4af2b35d82c087a70986332557cd52c4e4e4ed94))

## [0.0.21](https://github.com/misty-step/omp-config/compare/v0.0.20...v0.0.21) (2026-09-02)


### Bug Fixes

* **forest:** scope credential authority ([9b9d619](https://github.com/misty-step/omp-config/commit/9b9d6191a69781189e77375c0fbf8a909bd982ec))

## [0.0.20](https://github.com/misty-step/omp-config/compare/v0.0.19...v0.0.20) (2026-09-02)


### Bug Fixes

* **skills:** separate credentials from workload identity ([216dfaf](https://github.com/misty-step/omp-config/commit/216dfafa7e3ae91ba395d2d703a0cd1dbb69fcc1))

## [0.0.19](https://github.com/misty-step/omp-config/compare/v0.0.18...v0.0.19) (2026-09-01)


### Bug Fixes

* **executive:** respect operational authority boundaries in step 9 and escalation ([fe4f464](https://github.com/misty-step/omp-config/commit/fe4f46498bffb91ea3a699b86806b5d088e0e76c))

## [0.0.18](https://github.com/misty-step/omp-config/compare/v0.0.17...v0.0.18) (2026-09-01)


### Features

* **executive:** add tracker mode branches and separate gates from deploy commands ([9745cca](https://github.com/misty-step/omp-config/commit/9745ccaaa97e584cd32e1b102204a0bb57e5c25b))

## [0.0.17](https://github.com/misty-step/omp-config/compare/v0.0.16...v0.0.17) (2026-09-01)


### Bug Fixes

* **executive:** separate pre-merge gates from post-merge deploy and harden lease handling ([1ff31d4](https://github.com/misty-step/omp-config/commit/1ff31d4a3fb4e0a97990f9683a71afd2779084b7))

## [0.0.16](https://github.com/misty-step/omp-config/compare/v0.0.15...v0.0.16) (2026-09-01)


### Features

* **skills:** add general executive skill ([2f2f38f](https://github.com/misty-step/omp-config/commit/2f2f38ff34bc6ffb2ee2928a3e0fb3f14f6a7155))

## [0.0.15](https://github.com/misty-step/omp-config/compare/v0.0.14...v0.0.15) (2026-09-01)


### Features

* **skills:** add forest-executive skill ([f008bd3](https://github.com/misty-step/omp-config/commit/f008bd3993a239f8f4378e27a7d05b8b0ce3b399))
* **skills:** add resilience skill and wire prerequisites into foundation ([2a2e8d9](https://github.com/misty-step/omp-config/commit/2a2e8d94786b2c9c9e2da2013d73f7dfd49c1c48))

## [0.0.14](https://github.com/misty-step/omp-config/compare/v0.0.13...v0.0.14) (2026-09-01)


### Features

* **skills:** separate deterministic linting from contextual review ([b11c5bd](https://github.com/misty-step/omp-config/commit/b11c5bd94008ee9c9e11d80014506f4a9aceb644))

## [0.0.13](https://github.com/misty-step/omp-config/compare/v0.0.12...v0.0.13) (2026-09-01)


### Features

* **harness:** repartition core rules and session context ([21213a1](https://github.com/misty-step/omp-config/commit/21213a1b904f84987e363538de58ef230625f783))

## [0.0.12](https://github.com/misty-step/omp-config/compare/v0.0.11...v0.0.12) (2026-09-01)


### Features

* **harness:** add agent ergonomic judgment ([e78eea5](https://github.com/misty-step/omp-config/commit/e78eea55bc7db2bb263b97d7191713dff7a194ca))

## [0.0.11](https://github.com/misty-step/omp-config/compare/v0.0.10...v0.0.11) (2026-09-01)


### Bug Fixes

* **skills:** preserve backlog read-only contract ([7128c37](https://github.com/misty-step/omp-config/commit/7128c374a0312568597673f630161067c890ee99))


### Features

* **skills:** add show-me visual guidance ([914aa47](https://github.com/misty-step/omp-config/commit/914aa47adb59d69c13bcbb734abdd726866f5f6a))
* **themes:** switch defaults to Everforest ([42cde5c](https://github.com/misty-step/omp-config/commit/42cde5cd0ecf47af5eded6d750feb47aa012aa64))

## [0.0.10](https://github.com/misty-step/omp-config/compare/v0.0.9...v0.0.10) (2026-08-31)


### Features

* **skills:** add Field Station repository reports ([#66](https://github.com/misty-step/omp-config/issues/66)) ([784c6f2](https://github.com/misty-step/omp-config/commit/784c6f2f10211e4fc9c7d9e080ed2ac96bf20280))

## [0.0.9](https://github.com/misty-step/omp-config/compare/v0.0.8...v0.0.9) (2026-08-30)


### Features

* **skills:** add executable-design and now-next flows ([c4a4a08](https://github.com/misty-step/omp-config/commit/c4a4a08c2c54a920c7e3e2c9697336e62e03729c))

## [0.0.8](https://github.com/misty-step/omp-config/compare/v0.0.7...v0.0.8) (2026-08-29)


### Features

* **skills:** add operator-invoked understanding flow ([1b74783](https://github.com/misty-step/omp-config/commit/1b747830afc89d114f403d4443cfeb8f5130cb5a))

## [0.0.7](https://github.com/misty-step/omp-config/compare/v0.0.6...v0.0.7) (2026-08-29)


### Features

* **evidence:** publish reviewer-open PR media on here.now ([c88980f](https://github.com/misty-step/omp-config/commit/c88980f432d65502dd8e66ba577583181f133047))

## [0.0.6](https://github.com/misty-step/omp-config/compare/v0.0.5...v0.0.6) (2026-08-28)


### Features

* **watchdog:** adopt philosophy-first CANON and continuous Steward advisor ([f7b3487](https://github.com/misty-step/omp-config/commit/f7b3487aba61e63ebad2a215ecec4667a4957e0f)), closes [hi#reasoning](https://github.com/hi/issues/reasoning)

## [0.0.5](https://github.com/misty-step/omp-config/compare/v0.0.4...v0.0.5) (2026-08-26)


### Features

* **skills:** consolidate brief skill on brief-editor specification ([d39088f](https://github.com/misty-step/omp-config/commit/d39088fb047624b260ba8ae257fe6c151f027df7))

## [0.0.4](https://github.com/misty-step/omp-config/compare/v0.0.3...v0.0.4) (2026-08-26)


### Features

* **exocortex:** generate skill from misty-step/exocortex ([789ae58](https://github.com/misty-step/omp-config/commit/789ae58ddd0aecad34063f53304665f215a9418a))

## [0.0.3](https://github.com/misty-step/omp-config/compare/v0.0.2...v0.0.3) (2026-08-26)


### Bug Fixes

* **foundation:** differentiate Rust structural nesting proxy from size limits ([7f3ed0f](https://github.com/misty-step/omp-config/commit/7f3ed0f0889ce665fd54d0006c8790831989b7d6))
* **foundation:** scope Rust complexity proxies to control flow ([b2ce5e2](https://github.com/misty-step/omp-config/commit/b2ce5e2fa4c2233c567a23a676587f07766050cb))
* **loc:** batch committed object reads and cache-only passive hooks ([3f2eb56](https://github.com/misty-step/omp-config/commit/3f2eb564f08aee768ef90124aa9d21d21ac36580))
* **pulse:** condition complexity percentile aggregates on numeric analyzers ([3757c7f](https://github.com/misty-step/omp-config/commit/3757c7f1c474bd813992da172de64f8f6a11b038))


### Features

* **skills:** add backlog assessment and grooming flows ([0232cd0](https://github.com/misty-step/omp-config/commit/0232cd064b6b0160345c5b0ec7af04486c937372))
* **skills:** add cyclomatic and structural complexity controls to foundation, audit, and pulse ([2f5065e](https://github.com/misty-step/omp-config/commit/2f5065e821ef9454032263c225ef51367b3f3ab3))
* **tooling:** add grievance inbox CLI, install target, and headless config ([e36798b](https://github.com/misty-step/omp-config/commit/e36798b583d61f9ddc7a6227a28365c163ca568f))

## [0.0.2](https://github.com/misty-step/omp-config/compare/v0.0.1...v0.0.2) (2026-08-26)


### Bug Fixes

* **pulse:** condition complexity percentile aggregates on numeric analyzers ([7b914a6](https://github.com/misty-step/omp-config/commit/7b914a69046c5d75dff2256403f427bb599788d5))


### Features

* **skills:** add cyclomatic and structural complexity controls to foundation, audit, and pulse ([69aecf6](https://github.com/misty-step/omp-config/commit/69aecf695e7603403e5edd4cc06c159b7bc8c8d1))

## [0.0.1](https://github.com/misty-step/omp-config/compare/v0.0.0...v0.0.1) (2026-08-25)


### Bug Fixes

* **audit:** needs-user stops the run per premise gate ([349043b](https://github.com/misty-step/omp-config/commit/349043b4647c2c35714ba2d65744aff293c4fc20))
* **ci:** pin Landmark action to nested-extends repair ([552deaa](https://github.com/misty-step/omp-config/commit/552deaa6fb0e23252b113a4924eb34c9ff3217ea))
* **config:** align openrouter x-ai/grok-4.6 and google gemini model identifiers ([9ab66a5](https://github.com/misty-step/omp-config/commit/9ab66a50739e6404176134e1c7959d429a78b2c8))
* **config:** disable browser relay by default ([3433283](https://github.com/misty-step/omp-config/commit/3433283b914e07ba0c46dbe1bbb2400037fec42b))
* **config:** persist Pi composer shape ([6c5da23](https://github.com/misty-step/omp-config/commit/6c5da23c57d0a153ec10a2fd8e922a40adbad03a))
* **config:** retune task/smol roles and expand fallback chains ([5b7e668](https://github.com/misty-step/omp-config/commit/5b7e6688ee5a6c75e94a7f7f173e120d34332d0b))
* **elicitation:** agents hand off to /explore-unknowns, never self-load ([73c9c3a](https://github.com/misty-step/omp-config/commit/73c9c3aa7fa1230e6729f66c76baff24c6ffb326))
* **evidence:** inspect sanitizes before unprimed critique dispatch ([968641f](https://github.com/misty-step/omp-config/commit/968641f497935b20f94509382b95e6649e329251))
* **extensions:** pin LOC metrics to HEAD snapshot and simplify status row ([c9d6b23](https://github.com/misty-step/omp-config/commit/c9d6b23babf9a72d4af5e3075f39f79d0957d60e))
* **foundation:** gate counts packed output; use lean pack flags ([40dcaa5](https://github.com/misty-step/omp-config/commit/40dcaa5bfde78f5bc3ae0fd5723407025dbaea5b))
* **install:** maintain workspace root AGENTS.md symlink ([d05727d](https://github.com/misty-step/omp-config/commit/d05727d5f73d2d7bee9d3b4c6431f3b7ad77c634))
* **models:** keep DeepSeek V4 Pro at max effort ([5e319d2](https://github.com/misty-step/omp-config/commit/5e319d28c060eec16148ac23734efa08049ed57d))
* omit unset optional fields from Landmark manifest ([aa0fcad](https://github.com/misty-step/omp-config/commit/aa0fcada8c3b0615aada99e6b1aae7db686fdec5))
* **policy:** portable skill://research reference in grounding mandate ([7618176](https://github.com/misty-step/omp-config/commit/76181765d4ebc27f1987433692be56bfc54ce9f8))
* **pulse:** make report baselines deterministic ([c30d758](https://github.com/misty-step/omp-config/commit/c30d7582d6a7def14fa5a8d09d06e08b78e95022))
* **release:** complete Landmark product context ([5142993](https://github.com/misty-step/omp-config/commit/514299363155362d2793f053ddd92696be1fbdb5))
* **skills:** make six options a floor on every prototype pass ([4a0150c](https://github.com/misty-step/omp-config/commit/4a0150c09e3e6d76fe85b6e84cd049efaa207103))
* **skills:** require annotated Hunk walkthroughs ([4d6cb43](https://github.com/misty-step/omp-config/commit/4d6cb43128d3eff2e91aeab61b58ed9cf8d4c82a))
* **skills:** taste-gate code-review and deliver findings ([fbb35fa](https://github.com/misty-step/omp-config/commit/fbb35fabb5d1ade898d86603e60509891b25cb66))
* **skills:** taste-gate code-review and deliver findings ([#55](https://github.com/misty-step/omp-config/issues/55)) ([b644052](https://github.com/misty-step/omp-config/commit/b6440521e61fc7bd72c3e2fcb61778d1f292be82))
* **telemetry:** track the parser 5330df9 claimed but gitignored ([a92b889](https://github.com/misty-step/omp-config/commit/a92b8895aaba05a854f139977fd5c7c147cb1226))
* **theme:** enforce dark-ember across dark and light slots ([c7c52f0](https://github.com/misty-step/omp-config/commit/c7c52f068f33a2b095802ce7c1e178da2797d302))


### Features

* add polish interaction loop ([324ea63](https://github.com/misty-step/omp-config/commit/324ea630a05fce75a582e49518ed6e3febc37782))
* add Torvalds design review ([0d34d97](https://github.com/misty-step/omp-config/commit/0d34d97afe7c188a2c1b48c220f419b951c1b142))
* **advisors:** add focused review council ([f160031](https://github.com/misty-step/omp-config/commit/f160031440fd497965283b77b58a93e1f31df475))
* **advisors:** strengthen lane model routing ([3aa0112](https://github.com/misty-step/omp-config/commit/3aa0112f078a4a77d98741bd85c66234324b28fc))
* **audit-simplifications:** add dependency-ladder lenses ([3c42760](https://github.com/misty-step/omp-config/commit/3c42760cf6b218b7d4abd81b1182504e1948fcb6))
* **audit:** port audit-choices skill ([41a9c9c](https://github.com/misty-step/omp-config/commit/41a9c9c732bfc54abdab8b4bebc617b361fd4cf0))
* **brief:** consolidate orient and priorities into one executive brief ([3554717](https://github.com/misty-step/omp-config/commit/355471782d2abcc5e029500c668ac2d81ead8ef3))
* codify software delivery workflow ([242dad9](https://github.com/misty-step/omp-config/commit/242dad9f9446080affce02db03af2aad7f61d31a))
* **config:** add ast-grep skill, tokyonight theme, and statusline ([c50d018](https://github.com/misty-step/omp-config/commit/c50d0186d3f70b53679d7c19f282c264640653ea))
* **config:** expand enabledModels with frontier, Grok 4.6, and high-performance open weights ([bc0302f](https://github.com/misty-step/omp-config/commit/bc0302fc98b3b12b83c6f3c1b8207b38cf3dbd17)), closes [hi#performance](https://github.com/hi/issues/performance)
* **config:** pin security reviewer to deepseek, keep fallback chains flat-rate ([a4e76b0](https://github.com/misty-step/omp-config/commit/a4e76b03626669baffab6f525355ccccbf64a716))
* **config:** remove enabledModels allowlist to expose all catalog models ([eebcbf2](https://github.com/misty-step/omp-config/commit/eebcbf2dfa834bd2383f3e858c305cd1c62f390a))
* **config:** shrink default model and MCP surface ([1cb8044](https://github.com/misty-step/omp-config/commit/1cb8044262db6f3cfdf18cfe339e41fef98b63bf))
* **dispatch:** update model roles, fallback chains, and policy ([b07f8fb](https://github.com/misty-step/omp-config/commit/b07f8fb0a899715804e41e013fd3828e2f40b2c3))
* **elicitation:** adopt explore-unknowns wholesale, retiring grilling ([5bac8ed](https://github.com/misty-step/omp-config/commit/5bac8ed28c580f929f6d7243ff71ca027674f851))
* **evidence:** require reviewer-open PR attachments ([357de87](https://github.com/misty-step/omp-config/commit/357de87dbc0c468985c266dd7a332975b473e587))
* **evidence:** unprimed subagent critique gates visual acceptance ([fa17d89](https://github.com/misty-step/omp-config/commit/fa17d893e1eda40fb6a046931d41a6edfe8bae97))
* **extensions:** deploy LOC extension with hook-maintained cache ([cb9d440](https://github.com/misty-step/omp-config/commit/cb9d4402decbaf6bd29f39fe8555094a0055ff60))
* **foundation:** add behavioral test baseline controls ([495bba9](https://github.com/misty-step/omp-config/commit/495bba934cfbbad63d0e98fb73be757af9272b6f))
* **foundation:** add per-module context budget control ([bbd29ff](https://github.com/misty-step/omp-config/commit/bbd29ff75fea48ef1895ca94f93a07a40322f07f))
* **foundation:** test discipline — outermost surface, stored-value assertions ([ffb7e32](https://github.com/misty-step/omp-config/commit/ffb7e32bf20c7f2a9b891219cd85b5855fafd301))
* **install:** reinstall OMP config on pre-push ([941f904](https://github.com/misty-step/omp-config/commit/941f904aec731c93f2ea3b41fa66f54153b1c4fa))
* introduce evidence-packet skill and clean runtime configuration ([#44](https://github.com/misty-step/omp-config/issues/44)) ([b1042cd](https://github.com/misty-step/omp-config/commit/b1042cddc9c46b0df4e8b6d7ccbbbccb0c285564))
* **measurement:** fleet telemetry parser; checkpoint removed; CR-03 edge ([5330df9](https://github.com/misty-step/omp-config/commit/5330df9a9d80fdf60efc42249c5357b0f49af246))
* **policy:** render operator policy statements before acting on them ([63e49ba](https://github.com/misty-step/omp-config/commit/63e49ba1eb5c45f45057bd1148651f86e4a2a714))
* **policy:** vendor exocortex skill; aggressive ground-and-write-back mandates ([128f4a5](https://github.com/misty-step/omp-config/commit/128f4a5390b13900a96cb8ff2c165f1a04e896c6))
* **pulse:** render indexed engineering health reports ([c7b0a46](https://github.com/misty-step/omp-config/commit/c7b0a461fe3e94ad9676bd6c1b59726038b8a4a4))
* **research:** add primary-source research skill ([6d2a8b2](https://github.com/misty-step/omp-config/commit/6d2a8b2494468d6e73a738b4c2da497c5a904af4))
* **security-review:** enforce approved-model policy, block remediation ([bbe7f03](https://github.com/misty-step/omp-config/commit/bbe7f032ee0fe6fdb20f13ba2202caf6128cdef4))
* **skills:** add audit-simplifications coverage audit ([1bb7ba5](https://github.com/misty-step/omp-config/commit/1bb7ba5b270d4594d574fce2dafe89fc0fdbb9c7))
* **skills:** add backlog skill ([bd6b51a](https://github.com/misty-step/omp-config/commit/bd6b51adef64a3aa1c9f7c944da5c216693bc28c))
* **skills:** add checkpoint skill for the interval ledger CLI ([8dcf51a](https://github.com/misty-step/omp-config/commit/8dcf51a4ec7a47c184822cf5fe21cf82231aa677))
* **skills:** add curated global skills and installer wiring ([4955db6](https://github.com/misty-step/omp-config/commit/4955db6b8d3983afa87e8adb3d084bc19ade2628))
* **skills:** add deliver ([178bf66](https://github.com/misty-step/omp-config/commit/178bf660304d6cacdcfeec08af2e9700225c8b6f))
* **skills:** add diagnose ([8443b77](https://github.com/misty-step/omp-config/commit/8443b77e58bde1c26499c55a29b85a74b489e0d6))
* **skills:** add extract-module investigation pipeline ([3d95aa7](https://github.com/misty-step/omp-config/commit/3d95aa7a777773fbbd62901ff5dc251f3041dda3))
* **skills:** add observability audit program ([1832432](https://github.com/misty-step/omp-config/commit/18324325cb2e7e74d98e5b2e1757bdabd6ff33d7))
* **skills:** add tri-model security-review skill (GLM 5.3, Kimi K3, DeepSeek V4 Pro) ([f501825](https://github.com/misty-step/omp-config/commit/f50182543e097a1eeac15a2e09b96447cde718f3))
* **skills:** add user-invoked brief variants for evaluation ([1730870](https://github.com/misty-step/omp-config/commit/17308702e269a9c3e435b28333e7b03ad53ba423))
* **skills:** add user-invoked product-description skill ([46d3582](https://github.com/misty-step/omp-config/commit/46d358257e86380b069c53c15ab558fe0a7e2dc3))
* **skills:** add user-invoked pulse dashboard skill ([da500c3](https://github.com/misty-step/omp-config/commit/da500c32fc6a5da08416c96b046aa792f690c915))
* **skills:** gated lens code-review ([c474660](https://github.com/misty-step/omp-config/commit/c4746605b579faa4acc454e0da4a5da6637f0224))
* **skills:** instruct code-review to delegate to verifier subagents ([a1dc090](https://github.com/misty-step/omp-config/commit/a1dc09047c19a8bceef3dc038b54b49f21cc030f))
* **skills:** introduce hunk tool skill and interactive review guidance ([#45](https://github.com/misty-step/omp-config/issues/45)) ([b3936eb](https://github.com/misty-step/omp-config/commit/b3936eb948377acee2f4d3b10ee2454fb7bfe472))
* **skills:** overhaul SDLC suite with capture, refactor, explore-design, and decoupled review ([4a8cbec](https://github.com/misty-step/omp-config/commit/4a8cbecefc74c6b0731ef276855187de2c49c8c0))
* **skills:** prototype catalog and Emil/Leon refs ([837f1de](https://github.com/misty-step/omp-config/commit/837f1de92c033457ba67e1dd1a26f474c132e5eb))
* **skills:** replace grill-me with grilling ([70dda1b](https://github.com/misty-step/omp-config/commit/70dda1b36ebbc8d6fc3773a01427d04d09f0c27a))
* **skills:** rewrite release as review, CI, ship, watch ([6b0b6ba](https://github.com/misty-step/omp-config/commit/6b0b6bacfe5520f68bbecea4068f1ada6c8670d7))
* **skills:** task security-review models with full-spectrum audits and fix script paths ([580e59d](https://github.com/misty-step/omp-config/commit/580e59d151c0ae7dbae7f9df7a4eb560a5d1dd90))
* **themes:** add ember-dawn light theme ([63a684d](https://github.com/misty-step/omp-config/commit/63a684d5164d3cb8982c9d897ef6bb2f65e74d9e))
* **watch-deploy:** add soak gate, hand off from deliver ([886d2fb](https://github.com/misty-step/omp-config/commit/886d2fb69ee826fba57f1bb4ce320c06cb0d050f))
* **watchdog:** slim closeout to flat-rate correctness advisor ([9c92312](https://github.com/misty-step/omp-config/commit/9c92312f6cf42d33fccca0256cffd187067e2748))


### Reverts

* **install:** remove workspace root AGENTS.md coupling ([34eea5b](https://github.com/misty-step/omp-config/commit/34eea5b2b3bceb63627283530dceb4cc10b795f7))
