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
`extensions`, `secrets`, `audio-sandbox`, `cli`, and `skill:NAME`.

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
until exit; fresh sessions get writable config/executable paths.

## Engineer display isolation

Engineers cannot access the operator's live display. The native safety launcher
requires the supported Linux namespace/display prerequisites and removes host
display connections. Use `omp-gui -- sh` to run native applications and their
screenshot/input commands together on a private Xvfb display. Inspect saved
images before choosing coordinates. Never reconnect host display sockets or
browser/debug endpoints. Headless browser QA uses the native browser tool.

### Native work records and installation

Use `work-tracker --url https://powder.mistystep.io` directly for work records.
The legacy Glass writer bridge and note-only Powder wrapper are removed.
Powder owns native validation, revisions and receipts; R90 work stays in Habitat.

Run this repository's scoped installer directly after merge when its native
filesystem paths suffice. Existing namespaces may retain earlier read-only
mounts; do not reconnect the live desktop or restart active engineers to escape
them. Use the approved Workbench route when an operation requires host context.

### Authorized application management

Display isolation prevents capture of the operator's live screen and control of
their cursor or input. It does not prohibit authorized application installation,
configuration or service activation through native owners. Never expose a host
shell, compositor/input socket or session bus to perform that work. Installing
files and proving a running process loaded them are separate obligations.

`omp-host-install` uses Workbench's existing schema-1 socket protocol and fixed
repository choices: `harness`, `ai-usage`, `iron-forest`, and `cantrip`. It accepts
an exact merged revision, not caller commands, source/destination paths,
environment overrides or arbitrary service names. Harness installation never
automatically installs or activates Cantrip.

For the published Cantrip 0.1.8 cloud-timeout fix:

```sh
omp-host-install capabilities
omp-host-install readback-repository --repository cantrip
omp-host-install install-repository --repository cantrip \
  --revision b23d488e82ab79886b17c1976197c4c2504dbf1d
omp-host-install readback-repository --repository cantrip
```

The explicit Cantrip recipe uses the existing `cantrip.service` startup owner,
preserving its unit, drop-ins and enablement along with configuration, keys,
models, history and audio. It refuses busy or unknown lifecycle state and proves
readiness plus the running MainPID executable's identity against the newly
installed binary. An installed `--version` result alone is not live activation
proof. Recovery remains application-owned: replacing the old binary is not a
safe automatic rollback after a possible history migration.

Only Cantrip repository installation has a 2100-second transport deadline for
source admission, a bounded build and lifecycle proof; other requests retain
900 seconds. This is not the speech-inference timeout and changes no app config.

#### Refreshing an existing broker without desktop authority

The broker's managed executable and its running service are distinct. From the
merged Workbench checkout, use its native owner installer to plan and stage the
broker release (these commands do not restart the service):

For a legacy broker without `service_refresh: quiescent`, coordinate an exclusive
host-install maintenance window before staging. Submit no other bridge
installations until the new capabilities reply. Ordinary desktop work continues.

```sh
./install.sh --profile mirrodin --only host-install
./install.sh --profile mirrodin --only host-install --apply
```

Make the updated Harness CLI source available as a merged default-branch
revision, then use the already supported host-side Harness repository recipe:

```sh
omp-host-install install-repository --repository harness --revision FULL_MERGED_HARNESS_SHA
omp-host-install capabilities
```

At successful CLI-install completion, the installer considers only the
UID-owned managed link at
`~/.local/lib/workbench-host-install/workbench-host-install`, resolving under
its exact `releases/<release>/bin/workbench-host-install` layout to a UID-owned,
executable file with all write bits cleared. If its successful `--help` advertises
the exact native `workbench-host-install refresh-service` usage line, the
installer invokes that fixed executable with only `refresh-service`.
Missing, old or unmanaged brokers do not change ordinary installation.

The native command no-ops when no update is pending. Otherwise a fixed
outside-cgroup worker uses the broker's quiescent handoff: earlier requests
complete and later connections wait on systemd's listener for the selected ELF.
The one-time legacy bootstrap lacks this protocol and restarts only
`workbench-host-install.service` within the coordinated maintenance window.
It must not treat a capabilities response as an idle reservation.
The worker proves the new running identity. The Harness installer runs in the
host context supplied by the existing broker,
not by breaking out of the engineer namespace. No OMP/Pi/Hermes restart,
Cantrip installation or new execution bridge is involved. Confirm capabilities
actually advertise Cantrip after the request and refresh complete, then run the
explicit Cantrip commands above; an installer receipt alone is not that proof.

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
