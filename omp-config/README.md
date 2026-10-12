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
| `global/` | OMP guidance and native watchdog configuration |
| `agents/`, `extensions/`, `themes/` | Specialist definitions, runtime boundaries and presentation |
| `bin/omp-merge-config.ts` | Source-owned configuration overlay and retirement |
| `bin/omp-secrets-policy.ts`, `secrets.yml` | Source-owned credential masking configuration |
| `bin/omp-engineer.py`, `bin/omp-display.py`, `bin/omp-gui.py` | Memory/display isolation and private native GUI execution |
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
helpers. It stages safety code without activating the engineer cage or restarting
running sessions. Available targeted components are `config`, `guidance`, `mcp`,
`agents`, `extensions`, `secrets`, `audio-sandbox`, `cli`,
`engineer-cage`, and `skill:NAME`. `cli` now means only the four safety helpers,
not fleet management.

OMP uses `$PI_CODING_AGENT_DIR` when set, otherwise `$(omp config path)`.
Shared helpers and safety entrypoints deploy to `$HOME/.local/bin`. Foreign
entrypoints fail closed. Redirecting the agent directory alone does not isolate
HOME or host writes. The root `../install` installs both native harnesses;
component installers are preferable for targeted changes.

Configuration overlays source-owned keys while preserving foreign keys. MCP
overlays declared servers and preserves foreign inventory and owned-server auth.
Native project MCP definitions/imports remain project-owned. Neither installer
revokes OAuth or deletes pass entries.

### Config-only installation

From the reviewed merged revision in `omp-config/`, applying native fleet
defaults without the optional machine-local overlay:

```sh
bun bin/omp-merge-config.ts --source config.yml --dest "$(omp config path)/config.yml" --check
bun bin/omp-merge-config.ts --source config.yml --dest "$(omp config path)/config.yml"
```

Only `config.yml` changes. Retired owned settings are removed; foreign settings
and all auth/account content survive. No provider probe, extension write or
session restart occurs. Rollback is git revert and the same scoped install.

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

## Authenticated commands

Keep native tool logins. `pass-env` injects named encrypted entries into commands
without exposing values in prompts. Project `.env.pass` owns project mappings;
`openrouter-key` selects the existing project-aware billing route. Missing or
locked credentials fail rather than opening host pinentry or silently using a
foreign account. See the shared `authenticated-commands` skill.

OMP's source masking configuration retains credential-value redaction. Agent
audio stays in the silent `agent-sandbox`; startup configuration and the runtime
extension cover different child-process paths and are both necessary.

## Engineer memory containment

Explicit `OMP_INSTALL_COMPONENTS=engineer-cage ./install` changes future starts
only. It retains the native OMP executable, installs the stable safety wrapper,
and activates the owned systemd slice after validating layout support. It never
moves running PIDs or restarts the existing fleet. Native memory inspection is
`omp-engineer memory --json`, not a ticket/fleet admission command. Each verified
engineer leaf retains its independent memory boundary; capacity guidance warns
rather than replacing native safety checks with a scheduler.

The [desktop memory guard runbook](../docs/desktop-memory-guard.md) owns separate
opt-in host activation, evidence and rollback. Do not activate either boundary
merely to verify source changes.

## Engineer display isolation

Engineers cannot access the operator's live display. The native safety launcher
requires the supported Linux namespace/display prerequisites and removes host
display connections. Use `omp-gui -- sh` to run native applications and their
screenshot/input commands together on a private Xvfb display. Inspect saved
images before choosing coordinates. Never reconnect host display sockets or
browser/debug endpoints. Headless browser QA uses the native browser tool.

### Powder evidence notes

New Misty Step evidence goes to the exact existing work item in live Powder,
not the old board. Retain a native request file before sending:

```json
{"request_id":"unique-retained-request","actor":"exact-engineer-owner","id":"existing-initiative-id","expected_revision":"opaque-current-revision","change":{"kind":"note","comment":"Observed result, proof and remaining gap."}}
```

Bind the existing Powder Access credential references through `pass-env`
(`authenticated-commands`), then run:

```sh
omp-display append-note --powder existing-initiative-id < native-note-request.json
work-tracker --url https://powder.mistystep.io get existing-initiative-id
work-tracker --url https://powder.mistystep.io history existing-initiative-id
```

Follow History's cursor to completion. The command accepts only the native note
change for that exact ID and calls `work-tracker` at the explicit hosted origin;
it ignores `POWDER_URL` and never uses Glass or a local store as fallback.
Powder owns validation, revision checks, immutable history, outcome and request
replay. A lost acknowledgement remains unknown: replay the exact retained file,
with the same request ID, actor, revision and comment. Do not create a new
request, refresh its revision or retry automatically. Credentials stay out of
the request and receipts. R90 work remains in Habitat.

The positional `append-note ITEM` and its Glass socket bridge remain for
non-Misty-Step historical compatibility. Both the fresh CLI and fresh bridge
read the exact canonical scope and reject Misty Step before any append; unknown,
missing or mismatched owner reads also refuse. The CLI fence protects ordinary
invocations in cages still running an older bridge. An older bridge's raw socket
authority is not revoked by staging code: account for retained instances at the
cutover boundary without restarting engineers. Historical reads, original
sessions, launch records, journals and receipts remain unchanged.

After independent review and merge, request installation through
`omp-host-install` and read back the exact installed revision and managed
hashes. A fresh native command, acknowledged Powder note, exact replay and
complete History are runtime proof; green tests and staged files are not.

## Audited host installation (US-052)

`omp-host-install` uses Workbench's existing typed socket, not a host shell.
Selected-asset `install`, receipt `readback` and drift-safe `rollback` retain
their reviewed-source contract. `capabilities` lists the available operations.

For repository configuration and app updates, use the exact **merge commit**
of a PR merged into the repository's default branch:

```sh
omp-host-install install-repository --repository harness --revision FULL_MERGE_SHA
omp-host-install readback-repository --repository harness
omp-host-install install-repository --repository ai-usage --revision FULL_MERGE_SHA
omp-host-install readback-repository --repository ai-usage
omp-host-install install-repository --repository iron-forest --revision FULL_MERGE_SHA
omp-host-install readback-repository --repository iron-forest
```

For new Misty Step installations, retain the repository install/readback
receipts under the existing initiative and associate their exact revision,
managed hashes and evidence reference through the reviewed Powder note command
above. Repository operations do not invoke Glass receipt publication; do not
use selected-asset `install --item` as a substitute, because that route still
publishes to Glass. Old selected-asset receipts retain their original readback
and rollback authority. Iron Forest requires the companion reviewed Workbench
native recipe to be bootstrapped by the host owner before using this route.

Workbench fetches and verifies that commit itself; caller checkouts, commands,
environments, destinations, credentials and auth operations are not accepted.
The fixed repository allowlist is `misty-step/harness`, `misty-step/ai-usage`
and `misty-step/iron-forest`.
The existing host-only GitHub read binding also permits the private ai-usage
fetch; it never enters the source installer's environment or reply.

Harness runs its own OMP installer for `config guidance agents extensions cli`
and its Pi installer for `config pi-chrome accounts`. Local overlays and foreign
state remain owned by those installers; auth components and consumer restarts
are not selected. ai-usage runs its own `install.sh install-app`, including the
supported Omarchy plugin rescan, without replacing or activating its collector
timer. Live readback compares the managed code with the recorded install;
installation does not prove a running OMP/Pi process loaded the new code.
Repository installs do not use the selected-asset rollback engine.

Iron Forest builds only the embedded-UI `forest` binary with Cargo offline,
locked dependencies and two build jobs. It retains the immutable executable at
`~/.local/lib/iron-forest-ship/releases/<full-merge-sha>.native/bin/forest`,
preserving older releases. Its fixed activation changes only the exact
executable path in the existing protected `forest-view.service`, preserving
the publisher's sandbox, state and publish arguments; it reloads systemd and
restarts only that view unit. The existing API executable and process, Ready,
native authority/state, credentials and proxy routes remain untouched. No
caller-supplied command, state path or restart flag is admitted. Readback
records executable and view-unit hashes and verifies the running publisher;
it does not hash mutable projections or native authority.

The operator must bootstrap the reviewed, merged Workbench service once outside
the cage. Existing engineers then reach it through the read-only library mount;
do not bypass protected mounts when it is unavailable. Earlier lineage:
[Harness #233](https://github.com/misty-step/harness/pull/233) and
[Workbench #46](https://github.com/moomooskycow/workbench/pull/46) shipped the
client/broker without live bootstrap and admitted only CLI/single-skill/bin
recipes, not these configuration/app updates.

## Isolated installer checks

Run `../scripts/check omp` after integration. Its installer fixture uses a
sanitized disposable HOME, agent directories and source checkout; it checks
foreign settings/auth/MCP preservation, selected package deployment, native
entrypoint preservation and incompatible safety-layout refusal. It does not
activate host units or prove provider authentication. Native role/provider and
changed extension behavior also require a fresh-session smoke.

## Machine-local preferences

Portable defaults use the bundled Everforest themes. The installer overlays
`~/.config/harness/omp.yml` (override: `OMP_CONFIG_LOCAL_CONFIG`) after shared
config. When `themes/omarchy-system.json` is already installed, configuration
selects that generated palette for both backgrounds (US-017), without modifying
it. With the overlay, explicit local theme preferences take precedence.
The config-only commands above deliberately bypass it and never apply account policies.
Use native skill path settings or locally owned skill symlinks for OS/host-specific
packages; installers preserve unmanaged skills. Keep these local files outside
Git and credentials in native runtime storage. Missing overlays are optional;
malformed overlays fail preflight before deployment.
