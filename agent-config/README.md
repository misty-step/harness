# agent-config

Shared, harness-neutral primitives under `pi-config` and `omp-config`: portable
skills, global guidance sections, launchers and the agent audio sandbox. Each
harness installer declares which primitives it selects.

| Path | Purpose |
| --- | --- |
| `install` | The single deploy contract: skills, guidance, launchers, opt-in host components |
| `skills/` | Portable skill packages, clean-replaced when selected |
| `guidance/*.md` | Global-guidance sections spliced at the harness marker |
| `bin/pass-env.ts` | pass-backed environment launcher |
| `bin/openrouter-key.ts` | OpenRouter key resolver: R90 checkouts get the R90 entry, others `--personal` (US-028) |
| `bin/foundation-check.ts` | Foundation Standard validator (US-024; [ADR-003](../docs/adr/003-foundation-checks.md), [ADR-005](../docs/adr/005-operational-obligations.md), `--help`) |
| `bin/design-check.ts` | Player-surface copy checker |
| `bin/review-check.ts` | Headless-Chromium first-screen check for operator review pages (US-050) |
| `bin/story-deletion-check.ts` | Exact-commit base-story capability check (US-051) |
| `bin/semantic-*.ts`, `bin/feature-map.ts` | Undeployed source candidates ([semantic quality](../docs/semantic-quality.md), ADR-003) |
| `system-one/` | Shared typed judgments, Git adapters, fixtures and cache |
| `audio-sandbox/` | Silent agent sink contract and host deploy ([README](audio-sandbox/README.md), US-026) |
| `desktop-guard/` | Opt-in memory guard ([runbook](../docs/desktop-memory-guard.md), US-043) |
| `session-backup/` | Opt-in nightly session-store backup ([README](session-backup/README.md)) |

## Install contract

Preflight validates the whole selection before any write; unknown names, empty
sources, an invalid launcher, a foreign launcher destination and a missing
guidance marker all fail closed.

```sh
./install --check --agent-dir DIR \
  --skill all \
  --bin pass-env.ts \
  --guidance engineering --guidance workstation \
  --guidance-source ../pi-config/global/AGENTS.md
```

Drop `--check` to deploy. `--home` overrides `$HOME` for `~/.local/bin`.
Launchers are bundled into self-contained executables in private scratch and
replaced atomically; unchanged owned launchers stay, foreign files are rejected,
and preflight never executes candidate source. `--audio-sandbox`,
`--desktop-guard` and `--session-backup` are opt-in and not selected by normal
Pi/OMP installs.

Each guidance file is one complete `##` section. The installer replaces the
harness file's `<!-- shared guidance: agent-config -->` line with the selected
sections in order; a missing marker aborts the deploy.

## Story-preserving deletion (US-051)

```sh
pass-env run -f .env.pass -- bun --no-env-file --no-install \
  agent-config/bin/story-deletion-check.ts \
  --repo /path/to/project --base BASE --head HEAD --json
```

Use the merge base and exact PR head. Only a Jev `removes` choice with removal
probability ≥0.80 is a `hold` (exit 1); `pass`, `skipped` and `unavailable` exit
0, bad invocation or Git failure exits 2. Send a hold to Kaylee for Phaedrus's
approval of that exact change. The [PR workflow](../.github/workflows/story-deletion.yml)
runs trusted checker code from `github.workflow_sha` and never executes candidate
objects.

## Official TypeSafe skill

`skills/typesafe-ai/` is the unmodified MIT package from
[`typesafe-ai/skills`](https://github.com/typesafe-ai/skills/tree/65a39f393687675ce170e6094757de20370365b9/skills/typesafe-ai)
at `65a39f393687675ce170e6094757de20370365b9`. Refresh by replacing the whole
directory, keeping its licence, updating this pin and reviewing the thin
`system-one` companion, which owns only fleet OpenRouter wiring.

## Verification

```sh
../scripts/check shared
```

Installer checks read committed HEAD. Before trusting a shared-guidance change,
compose a harness file into a temporary directory and diff it against the live
deployed file.
