# agent-config

Shared, harness-neutral agent primitives for the Misty Step harnesses. It is the
base layer under `pi-config` and
`omp-config`: portable skills, shared
global guidance, and the `pass-env` secret launcher live here once, and each
harness declares which primitives it selects. The `design-check` player-copy
launcher deploys here on the same contract.

A primitive belongs here only if it is harness-neutral and either duplicated
across harnesses or consumed by more than one. Model routing, trackers, settings,
extensions, themes, and vehicle pointers are harness policy and stay in the
harness repo. When in doubt, leave it in the harness.

## Layout

| Path | Purpose |
| --- | --- |
| `install` | The single deploy contract: skills, guidance, and launchers |
| `skills/` | Portable skill packages, clean-replaced when selected |
| `skills/test-audit/` | Shared authoring gate and focused test audit; subsystem campaign is opt-in (US-021) |
| `skills/story-qa/` | Curated user-story walks by agents on the real product surface (US-022) |
| `skills/check-cadence/` | Risk-based PR/nightly/weekly check selection without losing owned gates (US-023) |
| `guidance/*.md` | Shared global-guidance sections, spliced at the harness marker |
| `bin/pass-env.ts` | Standalone pass-backed environment launcher |
| `bin/design-check.ts` | Standalone player-surface copy checker, installed as `~/.local/bin/design-check` |
| `bin/semantic-check.ts` | Source candidate for an advisory semantic-quality CLI |
| `bin/semantic-held-out.ts` | Source-only held-out evaluator for the semantic-quality candidate |
| `system-one/` | Shared typed judgments, immutable Git adapters, fixtures, and local cache |
| `candidates/effective-verification/` | Child-mandate skill source, kept outside automatic skill deployment |
| `../.githooks/pre-push` | Workspace secret scanners, wired by root `scripts/bootstrap` |

## Install contract

Harness installers invoke one CLI and declare their selection. Preflight
validates the whole selection before any write; unknown names, empty sources, an
invalid launcher, a foreign launcher destination, and a missing guidance marker
all fail closed.

```sh
./install --check --agent-dir DIR \
  --skill all \
  --bin pass-env.ts \
  --guidance pokayoke --guidance communication-and-verification --guidance host-resources --guidance credentials \
  --guidance user-stories --guidance session-close --guidance design-routing \
  --guidance-source ../pi-config/global/AGENTS.md
```

Drop `--check` to deploy. `--skill all` selects every package; name packages
individually for a narrower set. `--home` overrides `$HOME` for `~/.local/bin`.

### Guidance composition

Each guidance file is a complete `##` section. The harness guidance file carries
the insertion marker:

```markdown
<!-- shared guidance: agent-config -->
```

`./install` replaces that line with the selected sections, in the order given,
and leaves the rest of the harness file — its title, intro, and vehicle-specific
sections — untouched. The marker is required; its absence aborts the deploy.
Shared guidance sections may reference shared primitives and vehicles deployed across both harnesses, such as `skill://using-exe-dev`.

## What each harness selects

| Harness | Skills | Guidance | Launcher |
| --- | --- | --- | --- |
| `pi-config` | all | pokayoke, communication-and-verification, host-resources, user-stories, session-close, design-routing | `pass-env`, `design-check` |
| `omp-config` | all | pokayoke, communication-and-verification, host-resources, user-stories, session-close, design-routing | `pass-env`, `design-check` |

`omp-config`'s own guidance file adds Working together (including model roles),
Execution environments (exe.dev vehicle), and Authority
and operations. `pi-config`'s file is title and intro only.

`test-audit` owns test authoring, consolidation, and pruning decisions for both
harnesses; it avoids repeated verification of the same contract. `story-qa`
guides agent walks through curated product stories on the user surface.
`check-cadence` guides fast PR checks and owned nightly/weekly coverage. The
shared guidance routes all three; it does not schedule a run. Their scope is
distinct from `verification-infrastructure`, which creates repository-owned
runnable verification. The `effective-verification` candidate below judges
test and execution evidence; it is not deployed.

## Semantic-quality source candidate

The semantic-quality files are not selected by either installer. Candidate skills
stay outside `skills/`, because both consumers currently select every directory there.
They remain a
source candidate until a separate rollout completes repository pilots and fresh-process
Hermes verification. The engine uses fixed Choice questions through OpenRouter
Decisions. Its findings remain advisory, and deterministic exits stay authoritative.

See [the build, pilot, and rollback guide](../docs/semantic-quality.md).

## Fresh setup

Clone [harness](https://github.com/misty-step/harness) once; this base and both
consumers are sibling components. Follow the [root setup guide](../README.md).
Harness installers invoke this component's `install`; a missing base fails closed.
`AGENT_CONFIG_DIR` remains an advanced override. `linear-cli` is installed separately.

## Not yet here

Single-owner or repo-local pieces that stay with their harness for now:

- [Workstation runbook](../omp-config/references/dev-exec.md) and
  [scratch-routing design](../omp-config/references/scratch-routing.md) — host docs,
  retained with their operational implementation; linked by both harnesses.
- [Pressure monitor](../omp-config/bin/tmp-health.py) — workstation-specific tool.
- The Linear CLI is its own repo, [linear-cli](https://github.com/misty-step/linear-cli).
- Repository hooks and release automation belong to the monorepo root.

A reference from another harness does not make machine-specific setup a portable
primitive. Keep deployable skill dependencies inside their package; use canonical
repository URLs for optional workstation context outside a deployed package.

## Verification

```sh
../scripts/verify shared
```

Compose a harness file into a temporary directory and diff it against the live
deployed file before trusting a change to shared guidance.

## Related repositories

- `pi-config` and
  `omp-config` consume this base.
- [linear-cli](https://github.com/misty-step/linear-cli) is an independent host
  tool.

## Ecosystem

Release automation is [Landmark](https://github.com/misty-step/landmark);
conventional commits become semantic versions and release notes. Pre-push runs
gitleaks and trufflehog. `origin` is `misty-step/harness`; releases are workspace-wide.
