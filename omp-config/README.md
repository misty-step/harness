# omp-config

Native OMP configuration for Phaedrus / Misty Step. Source owns model roles,
selected engineering skills, guidance, extensions and themes. Credentials,
sessions, foreign settings and runtime history remain native/user-owned.

Status-line, TUI and composer settings use native OMP defaults. Config installs
retire the former owned preferences; foreign preferences and desktop palettes survive.

This component belongs to [harness](../README.md). Shared primitives deploy
through `../agent-config/install`; `AGENT_CONFIG_DIR` can override that source.

## Layout

| Path | Purpose |
| --- | --- |
| `config.yml`, `models.yml` | Native roles, recovery, account policy and provider configuration |
| `mcp.json` | Selected native MCP servers; deployment preserves foreign servers and authentication |
| `global/` | OMP guidance |
| `agents/`, `extensions/`, `themes/` | Specialist definitions, runtime boundaries and presentation |
| `bin/omp-merge-config.ts` | Source-owned configuration overlay and retirement |
| `bin/omp-secrets-policy.ts`, `secrets.yml` | Source-owned credential masking configuration |
| `bin/omp-engineer.py`, `bin/omp-display.py`, `bin/omp-gui.py` | Native launch, desktop isolation and private GUI execution |
| `bin/omp-host-install.py` | Typed Workbench host-install client, not a host shell |
| `bin/omp-task-usage.ts` | Explicit whole-task cost analysis; not a launcher or scheduler |
| `references/` | On-demand workstation runbooks |

Ticket rosters, automatic paired experiments, grievance bookkeeping, scheduled
repository auditors are retired. No replacement fleet
control plane or management skill is installed. Historical journals and runtime
evidence are not deleted or treated as launch policy.

## Install

```sh
./install
OMP_INSTALL_COMPONENTS='config guidance mcp' ./install
OMP_INSTALL_COMPONENTS=skill:story-qa ./install
```

The component installer accepts no positional arguments, including `--check`.
Use [root verification](../docs/verification.md), not live deployment, to check a
change. `all` selects owned configuration, guidance, MCP, engineering skills,
agents, themes, extensions, audio isolation and the four workstation safety
helpers. It updates future launches without restarting running sessions.
Available targeted components are `config`, `guidance`, `mcp`, `agents`,
`extensions`, `secrets`, `audio-sandbox`, `cli`, `browser-helper`, and `skill:NAME`.

OMP uses `$PI_CODING_AGENT_DIR` when set, otherwise `$(omp config path)`.
Shared helpers and safety entrypoints deploy to `$HOME/.local/bin`. Foreign
entrypoints fail closed. Redirecting the agent directory alone does not isolate
HOME or host writes. The root `../install` installs both native harnesses;
component installers are preferable for targeted changes.

### Kaylee pane input

Copy hermes-config's `plugins/delegate-agent-guard/pane_guard.py` beside this
extension's installed `index.ts`. Verify identical bytes in both native guards.

Configuration overlays source-owned keys while preserving foreign keys. MCP
overlays declared servers and preserves foreign inventory and owned-server auth.
Native project MCP definitions/imports remain project-owned. Neither installer
revokes OAuth or deletes pass entries.

### Scoped native cutover

From the reviewed merged revision in `omp-config/`, applying native defaults
without the optional machine-local overlay:

```sh
agent_dir=$(omp config path)
bun bin/omp-merge-config.ts --source config.yml --dest "$agent_dir/config.yml" --check
bun bin/omp-merge-config.ts --source config.yml --dest "$agent_dir/config.yml"
rm -f -- "$agent_dir/extensions/subagent-inheritance/index.ts" "$agent_dir/extensions/subagent-inheritance/index.test.ts" "$agent_dir/bin/omp-model-policy.ts"
rmdir -- "$agent_dir/extensions/subagent-inheritance" 2>/dev/null || true
install -m 600 global/AGENTS.md "$agent_dir/AGENTS.md"
rm -f -- "$agent_dir/OPERATIONS.md"
```

Only config, global instructions and the retired routing files change. Foreign
siblings and all auth/account content survive. No provider probe, credential
write, other extension update or session restart occurs. Use a new session after
the whole cutover. Rollback is git revert and the corresponding scoped install.

Native `path` and Git status replace ornamental `cwd` and `loc` extensions.
Use `git diff --numstat` for changed-line counts; `/loc` and `/loc-trend` are retired.

## Native models

`config.yml` owns the model and effort defaults. Native OMP resolves agents,
thinking levels and priority service; there is no custom routing validator,
usage gate or per-agent model overlay. Cross-model recovery is off; visual
requests have no fallback chain. Explicit held-model launches remain native.

Use a fresh session to check changed defaults. Existing healthy sessions keep
their selected models; file presence alone does not prove loading.

## Engineering skills

The installer declares a small engineering selection rather than installing every
shared package. Full skill bodies load on demand. Credential/tool-specific facts
belong with their skills; dispatch, experiment scheduling and approval posting do
not. `remote-execution` uses native SSH/exe.dev without a `ws` controller or lease
ledger. Task-specific video or requested speech helpers remain optional shared
source, not default session management.

### Default visual taste loading

`global/AGENTS.md` routes every UI/visual task, including app/dashboard repairs
and visual reviews, to the installed `design-taste-frontend` body and applicable
specialists before work. This is an always-loaded pointer, not an inline skill
library. Design remains on Claude; model routing and native skill discovery are
unchanged.

The pinned taste library is maintained and installed by hermes-config into
`~/.agents/skills/<frontmatter-name>/SKILL.md`, including supporting files.
Deploy that shared library first; this component's `guidance` selection does not
install it. The main skill's public-page workflow is not an app/dashboard
workflow: those fixes use `redesign-existing-projects` or `minimalist-ui` while
preserving the existing design, semantics, accessibility and requested scope.
Specialists load by applicability, not all at once; their instructions do not
authorize paid tools or credential access.

From the harness repository root, install only the guidance:

```sh
OMP_INSTALL_COMPONENTS=guidance ./omp-config/install
```

This replaces the owned OMP `AGENTS.md` and removes retired `RULES.md`,
`OPERATIONS.md`, `WATCHDOG.md` and `WATCHDOG.yml`. It leaves credentials,
configuration, models, extensions, skills, launchers and sessions untouched.
Use a fresh native OMP session after installation to verify automatic loading;
isolated installer checks prove deployment, not model instruction-following.

## Authenticated commands

Keep native tool logins. `pass-env` injects named encrypted entries into commands
without exposing values in prompts. Project `.env.pass` owns project mappings;
`openrouter-key` selects the existing project-aware billing route. Missing or
locked credentials fail rather than opening host pinentry or silently using a
foreign account. See the shared `authenticated-commands` skill.

OMP's source masking configuration retains credential-value redaction. Agent
audio stays in the silent `agent-sandbox`; startup configuration and the runtime
extension cover different child-process paths and are both necessary.

## Native engineer launch

`OMP_INSTALL_COMPONENTS='config guidance cli' ./install` removes the stale
`omp-roster` and experiment controller, replaces the installed `omp-engineer`,
and removes the owned `omp.slice` unit. It preserves the retained native OMP
binary and the stable `omp` alias. Launch directly with `omp --model MODEL`.
No ticket roster, provider probe, memory inspection, lock, resource cap, or
systemd readiness handshake runs before OMP.

The CLI install lifts owned slice and active engineer scope memory limits without
stopping or relocating PIDs. Existing namespaces retain old read-only mounts
until exit. The display boundary protects host config/executable paths; project
files and ordinary runtime state remain writable.

## Engineer display isolation

Engineers cannot access the operator's live display. The native safety launcher
requires the supported Linux namespace/display prerequisites and removes host
display connections. Use `omp-gui -- sh` to run native applications and their
screenshot/input commands together on a private Xvfb display. Inspect saved
images before choosing coordinates. Never reconnect host display sockets or
browser/debug endpoints. Headless browser QA uses the native browser tool.

### Optional Chromium helper boundary

`OMP_INSTALL_COMPONENTS=browser-helper ./install` stages only `omp-display` and
the standalone Rust `omp-browser-helper`; it does not run the CLI retirement
step, change accounts/settings, register an owner, or alter any shared limit.
It requires Rust/libsystemd, Chromium, bubblewrap, slirp and disk-backed private
scratch. Active CLI updates also preflight the browser/display prerequisites.
The default component selection remains unchanged.

Opt in with `OMP_ENGINEER_BROWSER_ISOLATION=chromium-v1` only inside an already
registered, uncapped `omp-engineer-<24 lowercase hex>.scope` under `omp.slice`.
The current launcher stays uncapped; this component is not an owner scheduler.
Unregistered/capped owners fail closed, never launching Chromium in the owner.
The display controller pins its root pidfd and real unit InvocationID plus the
private namespace root. The supported native `PUPPETEER_EXECUTABLE_PATH` hook
starts the immutable-pidfd shim. Only an authenticated same-namespace shim can
move to a separate sibling scope. Manager/cgroup membership, 4-GiB helper-only
bounds, zero swap, group OOM and actual ancestor/oomd exclusion are read back
before EXEC; the shim independently verifies actual placement and controls.
No owner cap, whole-fleet inventory or aggregate capacity admission is restored.
Each additional helper is another finite leaf, not a combined per-owner bound.

Private `.omp/run`, `/tmp`, `/var/tmp` and default scratch use per-namespace disk
storage, removed after namespace teardown. Host profiles/brokers stay hidden;
PID, process group, stdio and native cancellation are not wrapped/replaced.
Native browser use, abort/reopen and helper-only kernel OOM with the same native
root surviving still need independent host acceptance; component tests are not
that evidence. Browser operations use the JS eval prelude, not a standalone
model browser tool. Never reconnect a personal browser or host display endpoint.

### Native work records and installation

Use `work-tracker --url https://powder.mistystep.io` directly for work records.
The legacy Glass writer bridge and note-only Powder wrapper are removed.
Powder owns native validation, revisions and receipts; R90 work stays in Habitat.

Run this repository's scoped installer directly after merge. The optional
Workbench host-install client remains available for its existing operator route,
but writable local config and executable paths no longer require that broker.

## Isolated installer checks

Run `../scripts/check omp` for native tests and isolated installer checks.
They preserve foreign settings/auth/MCP and exercise the desktop boundary.
An actual native OMP launch proves the launch path; installer checks do not
prove a running session loaded new guidance.

## Machine-local preferences

Portable defaults use the bundled Everforest themes. The installer overlays
`~/.config/harness/omp.yml` (override: `OMP_CONFIG_LOCAL_CONFIG`) after shared
config. When `themes/omarchy-system.json` is already installed, configuration
selects that generated palette for both backgrounds (US-017), without modifying
it. With the overlay, explicit local theme preferences take precedence.
The scoped commands above deliberately bypass it and never apply account policies.
Use native skill path settings or locally owned skill symlinks for OS/host-specific
packages; installers preserve unmanaged skills. Keep these local files outside
Git and credentials in native runtime storage. Missing overlays are optional;
malformed overlays fail preflight before deployment.
