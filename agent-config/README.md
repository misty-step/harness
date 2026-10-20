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
| `bin/t3-runtime-mode.ts` | Set a local T3 thread's runtime mode through authenticated RPC |
| `bin/openrouter-key.ts` | OpenRouter key resolver: R90 checkouts get the R90 entry, others `--personal` (US-028) |
| `audio-sandbox/` | Silent agent sink contract and host deploy ([README](audio-sandbox/README.md), US-026) |
| `session-backup/` | Opt-in nightly session-store backup ([README](session-backup/README.md)) |

## Install contract

Preflight validates the whole selection before any write; unknown names, empty
sources, an invalid launcher, a foreign launcher destination and a missing
guidance marker all fail closed.

`--preserve-foreign-skills` requires an installed package's `.harness-owned`
marker before replacement or retirement. New packages receive that marker.
Unmarked collisions and symlinks fail preflight with a warning. Codex selects
this mode; existing unmarked packages are left for the operator to resolve.

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
`--audio-sandbox`; `--session-backup` is opt-in.

Each guidance file is one complete `##` section. The installer replaces the
harness file's `<!-- shared guidance: agent-config -->` line with the selected
sections in order; a missing marker aborts the deploy.

## Set a T3 thread's runtime mode

With Bun and the authenticated local `t3` CLI on `PATH`, run:

```sh
bun agent-config/bin/t3-runtime-mode.ts <threadId> full-access
```

From this directory, use `bun bin/t3-runtime-mode.ts`. Select
`--bin t3-runtime-mode.ts` in the shared installer to install `t3-runtime-mode`.
Modes are `approval-required`, `auto-accept-edits`, `auto`, and `full-access`.
The command reads `$T3CODE_HOME/userdata/server-runtime.json`, defaulting to
`~/.t3/userdata/server-runtime.json`, and accepts only a loopback HTTP server.

Each call mints a ten-minute session scoped to `orchestration:operate` with an
`agent-runtime-mode:<unique-id>` label. The token passes through a private pipe
and WebSocket authorization header, never arguments, URLs, or command output.
The CLI dispatches `thread.runtime-mode.set` over T3's protocol-2 Effect RPC,
waits for the matching acknowledgement, and revokes its session before printing
JSON with the thread, mode, sequence, session ID, and `revoked: true`.

Failures and handled termination signals also revoke the session. If cleanup
fails, the error names the unique label for recovery with `t3 auth session list`
and `t3 auth session revoke <session-id>`. An uncatchable kill or machine loss
leaves the ten-minute expiry as the fallback. A lost acknowledgement leaves the
command outcome unknown; read it with MCP `t3_thread_configuration` before retrying.
This transport targets T3 0.1.1-nightly and fails closed on an incompatible reply.

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
