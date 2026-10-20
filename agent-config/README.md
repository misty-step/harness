# agent-config

Shared, harness-neutral primitives under `pi-config`, `omp-config` and `claude-config`: portable
skills, global guidance sections, launchers and the agent audio sandbox. Each
harness installer declares which primitives it selects.

| Path | Purpose |
| --- | --- |
| `install` | The single deploy contract: skills, guidance, launchers, opt-in host components |
| `skills/` | Portable skill packages, clean-replaced when selected |
| `guidance/*.md` | Global-guidance sections spliced at the harness marker |
| `bin/pass-env.ts` | pass-backed environment launcher |
| `bin/openrouter-key.ts` | OpenRouter key resolver: R90 checkouts get the R90 entry, others `--personal` (US-028) |
| `audio-sandbox/` | Silent agent sink contract and host deploy ([README](audio-sandbox/README.md), US-026) |
| `claude-settings/` | Owned-key merges into Claude Code `settings.json`; `.env` read denial (#351) |
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
and preflight never executes candidate source. Both harness installs select
`--audio-sandbox`; claude-config selects `--deny-env-reads`; `--session-backup`
is opt-in.

Each guidance file is one complete `##` section. The installer replaces the
harness file's `<!-- shared guidance: agent-config -->` line with the selected
sections in order; a missing marker aborts the deploy.

## Retired checks

Foundation adoption, story-deletion judgments, prose density, copy lint, semantic
review, launch admission and memory cages are removed. Installs remove owned
stale check binaries, resource launchers, units and foundation skills while
leaving running processes alone. Native user-path proof and one independent
code review remain.

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
