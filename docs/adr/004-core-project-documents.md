# ADR-004: Core project documents

Accepted 2026-09-25 (MIS-150). The operator approved option C, staged, with
the calls recorded under Decisions, relayed by Kaylee. This record amends
ADR-003's Documents row (FND-DOC-001), FND-WS-001's applicability, and the
Foundation Standard catalog.

Sequencing:

- The accepting PR fixes the harness's own contradictions.
- Stage 1 changes the catalog and the checker together, so that a pinned
  revision never carries a catalog that disagrees with its checker.
- A repository adopts only through an explicit pin-bump PR, with ratchet
  baselines absorbing the new gaps.

## Question

What is the smallest set of documents that makes any repository agent-ready?
An agent or a human must be able to understand intent, vocabulary and
boundaries; set the repository up in a fresh environment; walk its user
stories; ship it; and operate it, all without anyone explaining.

## Evidence

Census: the default branches at origin on 2026-09-25 of 37 active repositories
in misty-step and r90group. Three had no resolvable default ref (cyoa-video,
praetor, pii-gate), and Powder is archived. Eight read-only audits then covered
26 repositories in depth, with Scry as the reference. Citations use
`repo@sha:path:line`.

| Artifact | Repos | Note |
| --- | --- | --- |
| Full FND-DOC-001 set | 1/37 | Scry only |
| `README.md` | 36/37 | Kindred has none |
| `AGENTS.md` | 26/37 | All eleven without one were created between 2026-09-06 and 2026-09-21; Kindred's is scaffolder boilerplate |
| `USER_STORIES.md` | 19/37 | Waymark's has no ids or criteria |
| `DESIGN.md` | 10/37 | All ten describe the interface (visual system, interaction, copy); none holds architecture decisions |
| `.exe/setup.sh` | 1/37 | Scry only, and it supports only Ubuntu 22.04/24.04 on amd64 |
| `.env.pass` | 6/37 | Incomplete where present (see finding 6) |
| Verify or QA skill | 8/37 | |
| Vocabulary or boundary document | 13/37 | Six names: `DOMAIN.md`, `SPEC.md`, `ARCHITECTURE.md`, `docs/ARCHITECTURE.md`, `docs/architecture.md`, `project.md` |
| Decision records | 13/37 | Six homes: `docs/adr/`, `docs/decisions/`, `decisions/`, `docs/adr-*.md`, README-inline, `docs/architecture/adr-*` |

1. **Presence is not readiness.** Habitat is the closest to FND-DOC-001 after
   Scry, yet its migration ADR says r90tools has no `projectRef` and is never
   part of migration fan-out (`habitat@3082a4da:docs/adr/0008-schema-deploy-gate.md:120-122`).
   `config/tenants.json` lists r90tools as active with a `projectRef`, and every
   production build runs the gate. Other examples:
   - Sploot's ARCHITECTURE calls the retired Next.js runtime "deployed"
     (`sploot@32a1f989:ARCHITECTURE.md:6-8`), while its README records the
     retirement on 2026-09-10 (`README.md:221`). Two of its runbooks still
     operate DigitalOcean.
   - Chrondle's documents name two production web targets: a systemd release
     serving chrondle.app (`chrondle@a8fedab:README.md:210`) and a Worker on
     chrondle.mistystep.io (`wrangler.jsonc:34-40`). Its emergency runbook
     prescribes `pnpm` in a Bun-only repository
     (`docs/operations/emergency.md:17-24`; `AGENTS.md:33`).
2. **Drift comes from facts copied out of code and config, not from missing
   files.**
   - Landmark gives two Node floors in four places: 22+ in AGENTS and the
     package engines, 24 in CONTRIBUTING and CI.
   - Chrondle's AGENTS says Next.js 15 (`AGENTS.md:6`); `package.json:105` pins 16.3.3.
   - Canary's AGENTS lists three API scopes (`AGENTS.md:48`); its compatibility
     policy has four (`docs/compatibility-policy.md:73`).
   - Linejam's README says "Parlor is not installed" (`README.md:33`), while
     `package.json:89-91` depends on it.
   - Pantry's access runbook verifies `/api/items`
     (`pantry@6138d85:docs/access-setup.md:34,145`); the Worker serves
     `/api/stock` (`src/api.ts:141`).
   - Habitat's DOMAIN omits the `closed` status and the `prd` and `story` kinds
     (`src/lib/work/statuses.mjs:9`, `types.ts:12`). Its QA skill expects nine
     capabilities; `scripts/qa/capabilities.mjs` defines ten.
   - Cantrip has three open tickets for the same class: MIS-65 (config
     template), MIS-77 (CLI reference) and MIS-79 (CI description).

   A mechanical scan of root documents in 44 repositories flagged 30 of 1,348
   path references. Manual classification: 13 citations (12 distinct paths in
   Polymorph, Olympus, Chrondle and Steno) are stale, for example Olympus
   AGENTS naming `scripts/sprite.sh` after #782 deleted it. The other 17 are
   false positives: code symbols, build outputs, paths in consumer
   repositories, and templates. Deleted files are the cheap class of drift;
   duplicated facts are the expensive one.
3. **One job, many names.**
   - The vocabulary or boundary document has six names, and 24/37 repositories have none.
   - Decision records collide:
     - The harness's `docs/decisions/001-003` share numbers with the ADR-001 to ADR-021 kept inline in `pi-config/README.md`. `pi-config` also cites an ADR-022 that was never written.
     - Estate has two ADRs numbered 0011.
     - Scry has two 001s and two 002s.
4. **`DESIGN.md` means interface design.** Scry's says it "specifies how
   the interface looks" (`scry@e5374e2:DESIGN.md:1-9`), and `design-studio`
   hands off in that format. FND-DOC-001 calls it "design decisions". For a
   CLI, service, library or vault it is noise: Canary and Landmark keep theirs
   under `site/`.
5. **Status, history and authority live in durable documents.**
   - Stories are marked proposed or pending review in Habitat
     (`USER_STORIES.md:3-10`), Kindred, Parlor (US-004) and Double-Take.
   - Tach's AGENTS carries a spent one-time release permission as "Current
     delivery authority" (`agent-usage-telemetry@80006f5:AGENTS.md:41-57`). The
     standard already says repository text grants no authority.
   - Runbooks mix procedure with chronology: Scry's is 892 lines and Tach's
     provisioning runbook is 1,485.
   - Scry's README sends agents to `docs/design/concept-centered-study.md`,
     which still endorses the rejected "Scrying glass" direction and Map
     search. `docs/api/scry-v1.md` still describes the retired Rust `/v1`
     contract. Scry's other retained QA, evidence and history files are
     labelled as history and are not in conflict.
   - Workstation paths appear in Waymark, Tangle (`~/Development/r90`) and
     Liminal (`/home/exedev/shots`).
6. **Setup is executable or it is missing.** Outside Scry, every sampled
   repository assumes its toolchains are already installed. `.env.pass` files
   are incomplete: Linejam's names one secret while its deploy guide needs
   several, and Double-Take's lacks its Convex and Parlor keys. Scry has no
   `.env.pass`; its deploy secret names are in `deploy/scry.env.example`.
7. **The harness contradicts itself.**
   - The harness itself fails FND-DOC-001: it has no `DESIGN.md`, keeps its
     ADRs in `docs/decisions/`, and keeps its postmortems in `omp-config/`.
   - The `user-stories` skill has the operator approve story diffs (rule 3 and
     init mode); ADR-003 gives first stories to the agent reviewer.
   - The skill allows a `USER_STORIES/` split layout, but `foundation-check`
     reads only the root file (`agent-config/bin/foundation-check.ts:177,275,318,527,609`).
   - The credentials guidance says every misty-step repository ends with an
     `.env.pass`; the standard does not require one.

Two tensions rather than violations:

- `check-stories.sh` deliberately only warns about missing evidence paths
  until a repository has lived with stories for a few PRs. Polymorph is inside
  that window: two PRs since 2026-09-18. Its stories cite five paths that no
  longer exist at HEAD, and one of those tests now lives under `src/media/`.
  The window has no end, so nothing ever turns that warning into a failure.
- MIS-11 (2026-09-07) made VISION optional context everywhere, and Iron
  Forest's operator asked to retire its VISION. Scry's VISION owns authorized
  direction upstream of its stories, but no clause overrides accepted criteria.
  The other VISION files are not drift by presence alone.

What already works:

- Olympus's AGENTS routes each question to one named owner (`olympus@f16fd037:AGENTS.md:63-112`).
- Pantry's README plus stories is compact and sufficient for a small application.
- Scry's feature files plus `qa/walk` receipts bind stories to source and evidence.
- Landmark's `describe --json` is generated from the CLI parser.
- Tangle's `okf.toml` is a machine-checked content contract.
- Nopalito's `DEPLOY.md` stages, canaries, snapshots, switches and rolls back;
  Sanctum proves rollback per application.
- `CLAUDE.md` is already a symlink to `AGENTS.md` (Git mode `120000`) in 24
  of the 26 repositories that have both, across the three development trees.
  Chrondle's `GEMINI.md` is a regular file: 85 lines against AGENTS's 345.

## Decision

**Rule:** every readiness question has exactly one owner.

- Setup, QA and shipping are owned by executables that CI runs. Documents name
  those executables and never restate their steps.
- Facts that live in code or config are never written in prose. That covers
  versions, commands, environment names, routes, enums and candidate deploy
  targets. Generate them into a marked block or link to their owner. Which
  target is live and what release is authorized come from release and
  readback evidence (for example, Scry's runbook authority and Estate's
  readback), never from config alone.
- Transient status (progress, proposals awaiting review, handoffs), history,
  receipts and grants of authority never live in a core document. They belong
  in the tracker or in CI artifacts. A durable lifecycle classification
  (active, maintenance or archived) is not transient status; README states it.

### Core set: every repository

**`README.md`: orientation.**

- Owner: project maintainer.
- Must answer: what this is, who it is for, lifecycle state
  (active, maintenance or archived), purpose and non-goals, and where each
  other owner lives.
- Never holds: toolchain pins, environment lists, procedures, deployment
  topology, release history, roadmap, or transient status.
- Stale when:
  - a link, repository path or script target fails to resolve;
  - a generated block differs from its re-render.
- Replaces: `VISION.md` (purpose and non-goals move here; direction moves to
  Linear) and `CONTRIBUTING.md`. Hand-kept ADR indexes give way to the
  generated `docs/adr/` index.

**`AGENTS.md`: operating contract.** `CLAUDE.md` and `GEMINI.md` are symlinks
to it.

- Owner: project maintainer. Authority itself is never granted in text.
- Must answer:
  - local rules that override the global defaults;
  - invariants that code does not enforce;
  - what an agent may do without asking;
  - review priorities;
  - a routing table to every owner in this ADR, including the repository's
    walk runner and release command.
- Never holds: product description, glossary, procedures, one-time
  permissions, workstation state, personas, scaffolder boilerplate, or model
  and vendor names.
- Stale when:
  - an alias is not a symlink;
  - the file is longer than 150 lines, since it loads every session (three
    repositories exceed that today; Chrondle's is 345);
  - a reference does not resolve;
  - it contains a spent or dated authority phrase.
- Replaces: `WATCHDOG.md`, which holds review priorities.

**`USER_STORIES.md`: the intent contract.** Its format is unchanged.

- Owner: the operator owns intent; the agent reviewer approves first stories (ADR-003).
- Must answer: what users or consumers must be able to do, as criteria a check can fail.
- Never holds: status words ("proposed", "pending review"), intent-revision
  chronicles, or implementation identities.
- Stale when:
  - `check-stories.sh` fails;
  - an evidence path is missing (a failure once the repository's mode is `enforced`);
  - a live story has no current walk receipt (FND-WLK-001).
- Replaces: the criteria half of `SPEC.md`.

**`DOMAIN.md`: vocabulary and boundaries.**

- Owner: project maintainer. Boundary changes land with an ADR.
- Must answer:
  - a glossary, including retired terms;
  - what the system owns and what it delegates, including who holds authority
    over each piece of state;
  - invariants, each naming the check that enforces it or marked `unenforced`;
  - a code map from top-level directory to responsibility;
  - for libraries and APIs, the compatibility policy.
- Never holds: deployment topology or live state, pins, environment
  inventories, or status.
- Stale when:
  - the code map's set of directories differs from the tracked, non-hidden
    top-level directories;
  - a reference does not resolve;
  - an invariant cites a missing check.
- Replaces: `ARCHITECTURE.md`, `docs/architecture.md`, `project.md`, the model
  half of `SPEC.md`, and the boundary sections of `VISION.md`.

**`docs/adr/NNNN-slug.md`: why. Zero or more records.**

- Owner: whoever made the decision. Product direction belongs to the operator.
- Must answer: the context, the decision, and its consequences at the time it
  was made.
- Never holds: a present-tense claim about current state. Habitat's r90tools
  line is an example.
- Stale when:
  - a record exists outside `docs/adr/`;
  - numbers are duplicated;
  - `Status:` is missing;
  - a `Superseded by` target does not resolve;
  - the generated index differs from its re-render.
- Replaces: `docs/decisions/`, `decisions/`, README-inline ADRs and
  `docs/architecture/adr-*`. A declared monorepo may keep one `docs/adr/` per
  component, and each directory is its own number namespace.

**Executable entry points.** Two paths are fixed, so an agent runs the same
commands in every repository (operator call, 2026-09-25):

- `.exe/setup.sh`: an idempotent, credential-free bootstrap, already defined
  by FND-WS-001.
  - This ADR amends FND-WS-001 to apply to every active repository, because
    the host-resources mandate sends each project's heavy execution to its own
    exe.dev workspace.
  - "Arbitrary environment" means a fresh Ubuntu LTS exe.dev VM and a
    GitHub-hosted Ubuntu runner.
- `scripts/check`: the executable entry to the full deterministic gate, which
  CI invokes.
  - It may be a two-line wrapper around the native command, for example
    `exec npm run ci "$@"` in Scry or `exec ./scripts/verify "$@"` in the
    harness.
  - The native command stays the gate, as ADR-003 requires.
  - This entry point is the one exception to `verification-infrastructure`'s
    rule against wrapping a working command under a common name.

The walk runner stays the repository's own (FND-WLK-001), and AGENTS.md's
routing table names it together with the release command.

The verify skill keeps Launch, Doctor, Drive, Evidence and Cleanup; its Drive
section names walk specs rather than restating them. Feature files
(FND-MAP-001) keep Stories, Source and Gotchas, and their driving section also
names the walk spec: today Scry repeats story ids and routes by hand across
`USER_STORIES.md`, the feature files and `qa/walk-specs.mjs`. A setup document
is proved true only when a fresh runner executes it; FND-WS-001 and
FND-WLK-001 already make CI do that.

**`.env.pass`: names-only credential manifest.**

- Required when setup, check, walk or ship needs a credential. This replaces
  the "every misty-step repo" rule.
- Holds `NAME=pass-entry` lines only; a lint rejects anything else.
- Completeness is proved by the real run through `pass-env run -f .env.pass`,
  not by a lint.
- It is the only list of secret names. `.env.example` keeps non-secret
  configuration only.

### Surface additions

`foundation.json` gains `surfaces`, a list drawn from a controlled vocabulary.
It replaces free-text capabilities as the input that decides which documents
apply.

| Surface | Adds | Stale when |
| --- | --- | --- |
| `ui` | `DESIGN.md`: interface design (visual system, interaction, copy) in `design-studio` format | The design lint fails or a referenced token file is missing |
| `cli` | A command reference generated from the parser (`--help` or `describe --json`) into a README block | The re-render differs |
| `library`, `api` | A machine contract (OpenAPI, JSON Schema or typed exports) and a generated reference; the compatibility policy goes in DOMAIN | The re-render differs; the contract check fails |
| `deployed` (changes a live system outside the repository) | `docs/runbook.md` with Release, Rollback and Recover sections; it names the deploy config for candidate targets and the release or readback evidence that shows what is live; `docs/postmortems/` appears at the first incident, using the harness template | A command or config path does not resolve; the rollback drill fails (FND-CHG-002) |
| `content` | A machine content schema such as `okf.toml`, plus a content lint in the repository's gate; DOMAIN holds taxonomy, provenance, privacy and agent write rules | The lint fails |
| `public` | A public face (see below) | The catalog description differs from the README lede, or the link fails |

How the requested tiers map onto surfaces:

- Web app: `ui` and `deployed`.
- Service: `api` and `deployed`.
- Library: `library`.
- CLI: `cli`.
- Content vault: `content`.
- Infrastructure and config repositories, including the harness: `deployed`.

`public` combines with any of these; see the next section for who it applies to.

### Public face (`public`)

The operator asked whether every project needs a marketing site. Evidence:

- mistystep.io (the `misty-step` repository, Cloudflare Worker
  `mistystep-site`) already lists public projects in a hand-kept
  `content/work.ts`: name, one-line description, link and action.
- Canary, Landmark and Linejam publish sites to GitHub Pages; Cantrip and
  Vibe Machine keep a `site/`; Parlor serves `apps/site` at parlor.mistystep.io.
- Parlor is a library and Landmark a CLI, and both have outside consumers. The
  line is audience, not tier.

- **Applies to:** products offered to people outside the operator's household
  and organization. That covers public games and apps, public CLIs and tools,
  and public libraries such as Parlor.
- **Does not apply to:** private products (Scry, Pantry, Central), r90group's
  private repositories, content vaults, or infrastructure and config
  repositories. For these a public page would reveal private systems and need
  upkeep for no audience.
- **Minimum:** one public page that says:
  - what it is and who it is for;
  - the primary action (play, install, get started or view source);
  - its lifecycle state and a link to source or docs;
  - how data is handled, if the product collects any.

  A web app's own landing page satisfies this; it needs no separate site.
- **Generation:** the words come from the README lede and non-goals, which
  already answer what it is and who it is for. DOMAIN is internal vocabulary
  and boundaries, not public copy. The minimum can be a mistystep.io entry
  rendered from each public README. Richer sites (docs, brand, screenshots)
  are authored and follow DESIGN.md.
- **Hosting:** the default is a page on mistystep.io, already on Cloudflare.
  A project that warrants its own domain hosts it on Cloudflare, per the
  infrastructure default. The existing GitHub Pages sites stay until there is
  a reason to move them.
- **Check:** generating `content/work.ts` from public READMEs crosses
  repositories, so it is a follow-up candidate, not stage 1.

### Generated, never hand-edited

Nobody edits these by hand. Stage 1 checks the symlinks; checking the rest is
a follow-up candidate.

- `CLAUDE.md` and `GEMINI.md`: symlinks.
- `CHANGELOG.md`: written by Landmark.
- The `docs/adr/` and `features/` indexes.
- CLI and API references.

The DOMAIN code map's prose is authored.

### Removed from FND-DOC-001

- **Unconditional `DESIGN.md`.** It becomes `ui` only.
- **"At least one ADR".** A count invites filler; location and integrity are
  what matter.
- **A postmortem README or template in every repository.** The template has
  one home in the harness, and repositories keep real postmortems only.

Outside the standard: `SECURITY.md` remains GitHub's disclosure convention for
public repositories. Sediment (receipts, handoffs, research, dated reports)
belongs in CI artifacts or the tracker. If it is kept in Git, it lives under
`docs/history/`, and a core document never links to it as current.

## Checks and gap keys for ratchet mode

All checks are deterministic, take milliseconds, and live in `foundation-check`.
New gap keys extend `gapPattern` (`agent-config/bin/foundation-check.ts:57-61`,
ratchet mode as merged for US-027).

**Stage 1 (this amendment).** Each check below answers a failure seen in the
fleet evidence:

- `doc:AGENTS.md`, `doc:DOMAIN.md`, `doc:DESIGN.md` (`ui`), `doc:runbook`
  (`deployed`), `doc:content-schema` (`content`); the existing `doc:README.md`
  and `doc:USER_STORIES.md` stay.
- `doc:aliases`: `CLAUDE.md` and `GEMINI.md`, when present, have Git mode
  `120000` and point at `AGENTS.md`.
- `doc:refs`: relative Markdown links in core documents resolve at HEAD, and
  every command in the AGENTS routing table resolves to a script, package
  script or target. Backticked paths stay out of stage 1: 17 of the 30 paths
  the scan flagged were false positives.
- `entry:check`: `scripts/check` exists, is executable, and a CI workflow
  invokes it.
- `doc:adr`: this key changes meaning, from "at least one ADR" to: records in
  `docs/adr/` only, unique numbers, a status line, and resolving supersede
  targets.
- `stories:format` (existing): once a repository's adoption mode is
  `enforced`, `check-stories.sh` fails on missing evidence paths. That gives
  the migration window a defined end.
- `doc:postmortems` is removed.

**Follow-up candidates.** These are not validated, so this amendment does not
adopt them:

- generated-block diffs, and the generated ADR and feature indexes;
- a user-path and dated-authority lint;
- a DOMAIN code-map check;
- a line budget for AGENTS.md;
- a status-word lint for stories;
- backticked-path resolution;
- the `public` catalog check.

The per-document "stale when" lists above show what these checks could detect.

Not detectable by lint: prose that contradicts config, as in Habitat ADR-0008
and Sploot's ARCHITECTURE. Ownership removes the prose copy instead. Jev
contradiction review stays advisory under ADR-003 decision 3.

## Harness reconciliations

Done in the accepting PR:

1. **User stories.** The `user-stories` skill adopts ADR-003's rule: the
   designated agent reviewer approves first stories, and the operator keeps
   later changes of intent. The skill keeps one root `USER_STORIES.md`, and
   `check-stories.sh` rejects a `USER_STORIES/` directory. No repository uses
   the split layout, and `foundation-check` reads only the root file.
2. **Credentials.** The credentials guidance adopts the conditional `.env.pass` rule.
3. **Gate entry point.** `verification-infrastructure` allows the
   `scripts/check` entry point.
4. **Harness compliance.**
   - `docs/decisions/` moves to `docs/adr/`.
   - `pi-config`'s inline decision log moves to `pi-config/docs/adr/`.
     ADR-022 is recovered from commit 7590ad2, which cited it without writing
     it; `omp-config` has no inline ADRs.
   - A root `DOMAIN.md` is added.
   - The one postmortem template moves into the `pokayoke` skill, so both
     harnesses deploy it.
   - ADR-003's Documents row points here.

Stage 1, the next pin bump, handed to the harness engineer:

1. **Catalog.** FND-DOC-001's text and evidence adopt this ADR, the adoption
   record gains `surfaces`, and FND-WS-001's `applies_when` covers every
   active repository.
2. **Checker.** It implements the stage 1 gap keys, in the same change as the
   catalog.
3. **Scry.** It adopts first, through its pin bump.
4. **Factory templates.** The software-factory templates, which produced the
   product-brief, architecture, acceptance and run shape seen in Rings and
   Seedbed, emit the core set instead.

## Adoption cost

- **Scry (pilot):**
  - Extract `DOMAIN.md` from `SPEC.md` and AGENTS.
  - Move `docs/architecture/adr-*` into history.
  - Add a `scripts/check` wrapper around `npm run ci`, name its walk runner in
    the AGENTS routing table, and add an `.env.pass` for release secrets.
  - Retire `VISION.md`: purpose and non-goals move to README, authorized
    direction to Linear.
  - Fix the README link to the superseded concept study.
  - Remove release chronology from the runbook.
  - A follow-up decision settles the future of the `SPEC.md` S-ids.
- **Wave one:**
  - Tach and Habitat already have a DOMAIN; their work is trimming and fixing
    contradictions.
  - Sploot renames and trims ARCHITECTURE.
  - Linejam merges `project.md` with `docs/ARCHITECTURE.md`.
  - Infrastructure writes its DOMAIN from the README's topology section.
- **Checker:** [INFERENCE] about 300 to 500 lines of TypeScript plus tests,
  without model calls.

## Rejected alternatives

- **Keep FND-DOC-001's presence list.** Only Scry passes it. Habitat is one
  missing postmortem template away from passing while its ADR-0008 contradicts
  the tenant registry that drives production migrations.
- **Have Jev generate DOMAIN and AGENTS.** Boundaries and authority are
  decisions, and Jev's map pilot measured 0.75 area precision (ADR-003).
- **Merge README into AGENTS.** READMEs run from 21 to 1,161 lines, and AGENTS
  loads every session.
- **Let each repository declare its own document names.** Six names for one
  job show that convergence does not happen without a fixed name.

## Decisions (2026-09-25)

1. Approved: option C, staged. Stage 1 checks ship in the next pin bump; the
   follow-up candidates wait for evidence.
2. `DOMAIN.md` is the vocabulary and boundary document.
3. A fixed `scripts/check` is the gate entry point.
4. The "at least one ADR" count and the per-repository postmortem template
   are dropped.
5. `VISION.md` is retired fleet-wide.
6. Stories stay universal, CLIs and services included.
7. The public-face section is approved as written: scoped by audience.
8. Enforcement comes only through ratchet baselines and pin bumps.
