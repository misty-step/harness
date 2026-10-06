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
| Default and task engineering | GPT-6.1 Sol xhigh |
| Lightweight `smol`, `tiny`, `commit`, scout and sonic | GPT-6.1 Sol low |
| Planning | GPT-6 Astra xhigh |
| Visual/design work | Opus 5.5 high or above |
| Reviewer for an OpenAI author | Opus 5.5 xhigh |
| Reviewer for an Anthropic author; security review | GPT-6.1 Sol xhigh |
| Explicit advisor | Cursor Grok 4.7 xhigh |

Default/task recovery is Astra xhigh, Cursor Sonnet high, then Anthropic Sonnet
high. Grok is advisory-only, never builder recovery. Reviewer recovery retries
the selected model or stops; it cannot inherit the engineer's fallback chain.
The specialist extension enforces reviewer family and protected-agent startup.
Automatic Steward review remains disabled; explicit advisor invocation remains.

The installer checks approved concrete selectors and native effort support.
`OMP_MODEL_PROBE=1 OMP_INSTALL_COMPONENTS=config ./install` additionally makes
bounded native provider calls, requires the exact requested provider/model and a
terminal response, and disables fallback during the probe. Account authorization
and priority are not evidence of available quota. No OAuth is copied between Pi
and OMP. Luna is retired; explicitly select `openai-codex/gpt-6.1-sol:low` for
lightweight work.

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

## Audited host installation (US-052)

`omp-host-install` submits only `capabilities`, `install`, `readback` and `rollback`
to Workbench's typed service. Workbench owns source eligibility, named recipes,
readback and durable receipts. It does not accept arbitrary shells, environments
or destinations. Installation, readback, rollback and consumer activation are
separate. The operator must bootstrap the host service outside the cage; do not
bypass protected host mounts when that service/recipe is unavailable.

## Isolated installer checks

Run `../scripts/check omp` after integration. Its installer fixture uses a
sanitized disposable HOME, agent directories and source checkout; it checks
foreign settings/auth/MCP preservation, selected package deployment, native
entrypoint preservation and incompatible safety-layout refusal. It does not
activate host units or prove provider authentication. Native role/provider and
changed extension behavior also require a fresh-session smoke.
