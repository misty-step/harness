# agent-config

Shared, harness-neutral primitives under `pi-config`, `omp-config` and `claude-config`: portable
skills, global guidance sections, launchers and the agent audio sandbox. Each
harness installer declares which primitives it selects.

| Path | Purpose |
| --- | --- |
| `install` | The single deploy contract: skills, guidance, launchers, opt-in host components |
| `skills/` | Portable skill packages, clean-replaced when selected |
| `guidance/*.md` | Global-guidance sections spliced at the harness marker |
| `bin/agent-accounts` | `agent-accounts roster --json`: read-only canonical account inventory and credential references |
| `bin/daybook-sync` | Isolated private-note prepare, selected commit/push, bounded rebase and safe cleanup (US-054) |
| `bin/workstation-guard` | PreToolUse hook for Claude Code and Codex: on mirrodin, serenity and nassau it refuses privileged or host-device containers and VMs, reboot/power-off, `pkill`/`killall` and display or session restarts, and points to exe.dev or `ssh hetzner-ci` (US-003) |
| `bin/pass-env.ts` | pass-backed environment launcher |
| `bin/remote-run.ts` | `remote-run`: tagged exe.dev VMs and unprivileged docker builds on hetzner-ci, with cleanup ([skill](skills/remote-execution/SKILL.md)) |
| `bin/t3-runtime-mode.ts` | Set a local T3 thread's runtime mode through authenticated RPC |
| `bin/t3-pool.ts` | Continue eligible WIP threads across accounts and providers; request succession from Home after a handoff refusal ([contract](t3-pool/README.md), US-050) |
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

## Account inventory

Claude Code and Codex install `agent-accounts roster --json`. It projects the
existing private `~/.config/t3-accounts/accounts.json` registry as schema 1,
preserving account order, managed and watch-only rows, host placements and
credential references. That historical storage path remains the reported
provenance; installation does not move or alter the registry. The command
never resolves credentials, starts subprocesses, contacts a service or writes
state. Missing or invalid configuration fails without exposing its values.

## Workstation guard

`bin/workstation-guard` reads the native PreToolUse hook JSON and acts only for
the shell tool (`Bash`) on the hosts in `WORKSTATION_GUARD_HOSTS` (default
`mirrodin serenity nassau`). It parses the command, looking through `sudo`,
`env`, `bash -c`, substitutions, pipelines and heredocs, so quoted text in a
commit message, `echo` or `grep` is not refused. A refusal exits 2 with the reason and the exe.dev alternative on stderr, plus
`hetzner-ci` for builds and tests only (it never hosts agent sessions); both
harnesses treat that as a block. Any other tool, host or unparsable input is
allowed. Residual risk: commands assembled at run time (`$cmd`, scripts,
compose files) are invisible, and a refused flag used as the container's own
argument (`docker run img prog --privileged`) is refused. Claude Code's
installer adds the hook to `settings.json`; Codex's adds it to `hooks.json`
and trusts it through Codex's own RPC.

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

## Cloudflare security-audit skill

`skills/security-audit/` is the unmodified MIT package from
[`cloudflare/security-audit-skill`](https://github.com/cloudflare/security-audit-skill/tree/c1c8a8c14710/skills/security-audit)
at commit `c1c8a8c14710`. Refresh by replacing the whole
directory, keeping its licence, updating this pin, and rerunning the package's
validator tests.

## Verification

```sh
../scripts/check shared
```

Installer checks read committed HEAD. Before trusting a shared-guidance change,
compose a harness file into a temporary directory and diff it against the live
deployed file.

## Publish private notes from any T3 provider

Claude and Codex installs select `daybook-sync`, install its executable into
`~/.local/bin`, and deploy the canonical skill to
`~/.agents/skills/daybook-sync/SKILL.md` as well as their native packages.
Repository AGENTS.md can point every provider, including Gemini, to that
canonical file. Host deployment must check shared PATH and that instruction
pointer in each provider; two installer checks alone do not prove all providers.

A targeted deployment uses the existing shared contract:

```sh
agent-config/install --agent-dir "$HOME/.agents" --preserve-foreign-skills \
  --skill daybook-sync --bin daybook-sync
```

The workflow is `prepare --repo <checkout> --agent <id> --email <email>`, edit
in its returned workspace, then `publish --workspace <path> --message <message>
-- <file>...` and `finish --workspace <path>`. Only private GitHub repositories
with one identical origin fetch/push URL and master are supported. Python 3,
Git, native `gh` access and `gitleaks` are required. Every external operation
has a 120-second timeout; publication has at most three attempts. Errors retain
local work. A clean successful workspace is removed only after remote readback.

Machine ingest/snapshot integration belongs to the note repository, not this
command. Those jobs may merge existing root commits in an isolated disposable
worktree to keep the human root a fast-forward ancestor. They then advance the
root only when Git preserves its pending bytes. Agent workspaces instead rebase
and cannot publish journal paths. No installer activates or replaces timers.

## Renew approved T3 watcher access

The opt-in `--t3-access-renew` installer selection deploys the separate renewal
CLI, `t3-agent`, and inactive daily user units. It preserves private catalogs,
receipts, credentials and timer activation. See [the watcher renewal
contract](t3-access/README.md) for approved native owner issuance, encrypted
staging, consumer validation, JSON errors and interrupted-attempt recovery.
