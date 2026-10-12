# omp-config

Native OMP configuration for Phaedrus / Misty Step. Source owns model roles,
selected engineering skills, guidance, extensions and themes. Credentials,
sessions, foreign settings and runtime history remain native/user-owned.

This component belongs to [harness](../README.md). Shared primitives deploy
through `../agent-config/install`; `AGENT_CONFIG_DIR` can override that source.

## Layout

| Path | Purpose |
| --- | --- |
| `config.yml`, `models.yml` | Native roles, recovery, account policy and provider configuration |
| `mcp.json` | Selected native MCP servers; deployment preserves foreign servers and authentication |
| `global/` | OMP guidance and native watchdog configuration |
| `agents/`, `extensions/`, `themes/` | Specialist definitions, runtime boundaries and presentation |
| `bin/omp-merge-config.ts`, `bin/omp-model-policy.ts` | Installer overlay and concrete model/effort validation |
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
`agents`, `extensions`, `secrets`, `audio-sandbox`, `cli`, `engineer-cage`, and
`skill:NAME`. `cli` now means only the four safety helpers, not fleet management.

OMP uses `$PI_CODING_AGENT_DIR` when set, otherwise `$(omp config path)`.
Shared helpers and safety entrypoints deploy to `$HOME/.local/bin`. Foreign
entrypoints fail closed. Redirecting the agent directory alone does not isolate
HOME or host writes. The root `../install` installs both native harnesses;
component installers are preferable for targeted changes.

Configuration overlays source-owned keys while preserving foreign keys. MCP
overlays declared servers and preserves foreign inventory and owned-server auth.
Native project MCP definitions/imports remain project-owned. Neither installer
revokes OAuth or deletes pass entries.

Restart OMP after changing extensions, guidance or provider configuration.
Existing sessions keep their selected model; file presence does not prove loading.

## Model routing (US-014)

`config.yml` is the authority; do not duplicate its full recovery matrix here.

| Work | Primary |
| --- | --- |
| Engineering, planning, `slow`, `extreme`, `smol`, `tiny`, `commit` and sonic | GPT-6.1 Sol xhigh |
| Visual/design work | Opus 5.5 high or above |
| Scout, reviewer, security review and explicit advisor | Cursor Grok 4.7 xhigh |

`tier.openai: priority` requests OpenAI fast processing; `tier.subagent: inherit`
keeps it on Sol task/eval children. `defaultThinkingLevel: xhigh` also covers
explicit model selections without an effort suffix. Native OMP 18.10.0 exposes
these controls in `omp config list` and
[upstream settings](https://github.com/can1357/oh-my-pi/blob/main/docs/settings.md#sampling).
Grok has no OpenAI service-tier setting; the visual Claude route is unchanged.

All Sol engineering roles recover through the default chain: Astra xhigh, Cursor
Sonnet high, then Anthropic Sonnet high. Grok is never builder recovery. Reviewer recovery retries the selected
model or stops; it cannot inherit the engineer's fallback chain. The specialist
extension enforces the Grok pin and protected-agent startup.
Automatic Steward review remains disabled; explicit advisor invocation remains.

The installer checks approved concrete selectors and native effort support.
`OMP_MODEL_PROBE=1 OMP_INSTALL_COMPONENTS=config ./install` additionally makes
bounded native provider calls, requires the exact requested provider/model and a
terminal response, and disables fallback during the probe. Account authorization
and priority are not evidence of available quota. No OAuth is copied between Pi
and OMP. Use `ai-usage status` for observed subscription headroom; it does not
attribute quota changes to fast requests.

`omp-engineer` forwards native arguments without injecting a model or effort, so
fresh engineer sessions use this configuration. The retained `omp-roster` command
is retired from source: ticket launches use the ticket's explicit roster and
inherit native service-tier configuration. Its `defaults` subcommand reads
verdict-backed experiment history, not client startup defaults; it cannot write
policy defaults and refuses a missing journal. Do not restore experiments to
configure a native client. This ticket's Glass roster selects Sol xhigh.

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

The positional `append-note ITEM` and its Glass socket bridge are retained for
historical session compatibility, not a new Misty Step work route. No old
session, launch record, experiment journal or receipt is rewritten by this
cutover. Their presence is not permission to write the old board.

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
```

Workbench fetches and verifies that commit itself; caller checkouts, commands,
environments, destinations, credentials and auth operations are not accepted.
The fixed repository allowlist is `misty-step/harness` and `misty-step/ai-usage`.
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
it. Explicit local theme preferences take precedence. Account email policies
belong in this local file.
Use native skill path settings or locally owned skill symlinks for OS/host-specific
packages; installers preserve unmanaged skills. Keep these local files outside
Git and credentials in native runtime storage. Missing overlays are optional;
malformed overlays fail preflight before deployment.
