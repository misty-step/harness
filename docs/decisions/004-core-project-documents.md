# ADR-004: Core project documents

Proposed 2026-09-25 as an amendment to ADR-003's Documents row (FND-DOC-001)
and to the Foundation Standard catalog. It is not accepted and not enforced.
Nothing here changes a repository until the operator accepts it and each
repository takes an explicit pin-bump PR, with ratchet baselines absorbing the
new gaps.

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

   A mechanical scan of root documents in 44 repositories found at most 30
   dangling path references out of 1,348; a few are build outputs or code
   symbols. Deleted files are the cheap class of drift; duplicated facts are
   the expensive one.
3. **One job, many names.**
   - The vocabulary or boundary document has six names, and 24/37 repositories have none.
   - Decision records collide:
     - The harness's `docs/decisions/001-003` share numbers with `pi-config/README.md`'s inline ADR-001 to ADR-022.
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
   - Scry keeps 139 Markdown files. Its QA path uses about ten; the rest are
     receipts, research, and history.
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
   - `check-stories.sh` only warns when evidence paths are missing, and
     Polymorph's stories cite five evidence paths that do not exist at HEAD;
     one test has moved to `src/media/`.
   - MIS-11 (2026-09-07) made VISION optional context, but Scry's chain puts
     VISION above USER_STORIES, against global guidance that USER_STORIES is
     the root artifact.

What already works:

- Olympus's AGENTS routes each question to one named owner (`olympus@f16fd037:AGENTS.md:63-112`).
- Pantry's README plus stories is compact and sufficient for a small application.
- Scry's feature files plus `qa/walk` receipts bind stories to source and evidence.
- Landmark's `describe --json` is generated from the CLI parser.
- Tangle's `okf.toml` is a machine-checked content contract.
- Nopalito's `DEPLOY.md` stages, canaries, snapshots, switches and rolls back;
  Sanctum proves rollback per application.
- `CLAUDE.md` is already a symlink to `AGENTS.md` in 24 of the 26 repositories
  that have both, across the three development trees.

## Decision (proposed)

**Rule:** every readiness question has exactly one owner.

- Setup, QA and shipping are owned by executables that CI runs. Documents name
  those executables and never restate their steps.
- Facts that live in code or config are never written in prose. That covers
  versions, commands, environment names, routes, enums and deployment
  topology. Generate them into a marked block or link to their owner.
- Status, history, receipts and grants of authority never live in a core
  document. They belong in the tracker or in CI artifacts.

### Core set: every repository

**`README.md`: orientation.**

- Owner: project maintainer.
- Must answer: what this is, who it is for, lifecycle state
  (active, maintenance or archived), purpose and non-goals, and where each
  other owner lives.
- Never holds: toolchain pins, environment lists, procedures, deployment
  topology, release history, roadmap, or dated status.
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
  - a routing table to every owner in this ADR.
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
  - an evidence path is missing (upgraded from a warning to a failure);
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

**Executable entry points.** These are fixed paths, so any agent in any repository runs the same three commands:

- `.exe/setup.sh`: idempotent and credential-free bootstrap (FND-WS-001),
  applying to every repository. "Arbitrary environment" means a fresh Ubuntu
  LTS exe.dev VM and a GitHub-hosted Ubuntu runner.
- `scripts/check`: the full deterministic gate, which CI runs. "check" is the
  fleet's majority name: eight npm `check` scripts, four `scripts/check`, and
  three `scripts/check.sh`. For npm repositories it is a two-line wrapper.
- `qa/walk`: the story walk that emits receipts (FND-WLK-001).

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
| `deployed` (changes a live system outside the repository) | `docs/runbook.md` with Release, Rollback and Recover sections that name the deploy config as the topology owner; `docs/postmortems/` appears at the first incident, using the harness template | A command or config path does not resolve; the rollback drill fails (FND-CHG-002) |
| `content` | A machine content schema such as `okf.toml`, plus a content lint in `scripts/check`; DOMAIN holds taxonomy, provenance, privacy and agent write rules | The lint fails |

How the requested tiers map onto surfaces:

- Web app: `ui` and `deployed`.
- Service: `api` and `deployed`.
- Library: `library`.
- CLI: `cli`.
- Content vault: `content`.
- Infrastructure and config repositories, including the harness: `deployed`.

### Generated, never hand-edited

A check regenerates or verifies each of these and fails on any difference:

- `CLAUDE.md` and `GEMINI.md`: symlinks.
- `CHANGELOG.md`: written by Landmark.
- The `docs/adr/` and `features/` indexes.
- README command and toolchain blocks, rendered from the entry points and pin files.
- CLI and API references.

The DOMAIN code map is checked as a set of directories; its prose is authored.

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

All checks are deterministic, run in milliseconds, and live in `foundation-check`.
New gap keys extend `gapPattern` (`agent-config/bin/foundation-check.ts:57-61`,
ratchet mode as merged for US-027):

- `doc:AGENTS.md`, `doc:DOMAIN.md`, `doc:DESIGN.md` (`ui`), `doc:runbook`
  (`deployed`), `doc:content-schema` (`content`); existing `doc:README.md` and
  `doc:USER_STORIES.md` stay.
- `doc:aliases`: `CLAUDE.md` and `GEMINI.md` are symlinks to `AGENTS.md`.
- `doc:agents-budget`: `AGENTS.md` is at most 150 lines.
- `doc:refs`: relative links, backticked repository paths, and
  `npm run`/`pnpm`/`bun run`/`just`/`make` targets in core documents and
  skills resolve at HEAD.
- `doc:adr`: this key changes meaning to location, unique numbers, status,
  supersede targets, and index.
- `doc:generated`: every marked block equals its re-render.
- `doc:locality`: no user-specific paths (`/home/<user>/`, `/Users/<user>/`,
  `~/Development/...` checkouts) in core documents or the repository's verify
  skill; no spent or dated authority phrases in `AGENTS.md`. Skills a
  repository ships as its product, such as the harness's, are out of scope.
- `domain:codemap`: the code map equals the set of tracked, non-hidden
  top-level directories.
- `stories:format` (existing): `check-stories.sh` additionally fails on
  missing evidence paths and on status words.
- `entry:check`: `scripts/check` exists, is executable, and is invoked by CI.
- `doc:postmortems` is removed, and the count rule leaves `doc:adr`.

Not detectable by lint: prose that contradicts config, as in Habitat ADR-0008
and Sploot's ARCHITECTURE. Ownership removes the prose copy instead. Jev
contradiction review stays advisory under ADR-003 decision 3.

## Harness reconciliations (same PR as acceptance)

1. The `user-stories` skill adopts ADR-003's rule for approving first stories.
2. The split `USER_STORIES/` layout is removed from the skill, because the
   checker, `affected` and receipts all key on the root file.
3. The credentials guidance adopts the conditional `.env.pass` rule.
4. FND-DOC-001's text and catalog evidence adopt this ADR, including the
   `surfaces` field and FND-WS-001 applying to every repository.
5. The harness complies with its own standard:
   - Rename `docs/decisions/` to `docs/adr/`.
   - Extract the inline ADRs in `pi-config/README.md` and `omp-config/README.md`
     into their components' `docs/adr/` directories.
   - Add a root `DOMAIN.md`.
   - Keep one postmortem template.
6. Software-factory templates, which produced the product-brief, architecture,
   acceptance and run shape seen in Rings and Seedbed, emit the core set instead.

## Adoption cost

- **Scry (pilot):**
  - Extract `DOMAIN.md` from `SPEC.md` and AGENTS.
  - Move `docs/architecture/adr-*` into history.
  - Add a `scripts/check` wrapper and an `.env.pass` for release secrets.
  - Drop the VISION-first chain.
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

## Open decisions for the operator

1. Approve the core set and the surface matrix.
2. Name the vocabulary document `DOMAIN.md` (recommended; used by Tach,
   Habitat and Olympus) or `ARCHITECTURE.md` (used by Canary, Sploot and Steno).
3. Choose the gate entry point: fixed `scripts/check` (recommended) or a
   declared `commands` field in `foundation.json`.
4. Drop the "at least one ADR" and per-repository postmortem template requirements.
5. Retire `VISION.md` fleet-wide, completing MIS-11.
6. Enforce only through ratchet baselines and pin bumps, after acceptance.
