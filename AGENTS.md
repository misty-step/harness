# Harness

Shared standard: [Constitution](https://foundations.mistystep.io/) and [Way of working](https://foundations.mistystep.io/way-of-working).

Edit maintained source and use the affected component's native tools.

## Route the change

| Path | Owns |
| --- | --- |
| `agent-config/` | Harness-neutral skills, guidance sections, `pass-env`, the agent audio sandbox, and their shared deployment contract |
| `pi-config/` | pi settings, extensions, composer chrome, guidance intro, and shared-primitive selection |
| `omp-config/` | OMP routing, config/models/MCP, extensions, themes, guidance, and shared-primitive selection |
| `claude-config/` | Shared-primitive selection for Claude Code, which runs every T3 lane |
| Root | Workspace setup, verification, Git hooks, CI/releases, and cross-component architecture decisions |


## Source and deployment

Edit source here, never generated live copies. Root/component `AGENTS.md` files
instruct maintainers; harness `global/AGENTS.md` plus `agent-config/guidance/*.md`
are the source of deployed global guidance. Do not conflate them.

Harness installers declare their selection and call `agent-config/install`
(resolved as `../agent-config` unless `AGENT_CONFIG_DIR` overrides it); do not
duplicate its deployment logic. Preserve foreign settings, credentials,
sessions, packages and runtime state.

Deployment is a live mutation, not verification. Harness installers accept no
positional arguments and reject `--check`; only the base installer has an inert
preflight. Redirecting the agent directory alone does not isolate HOME, scope or
launcher writes; use `./scripts/verify`.

## Verify and ship

`./scripts/bootstrap` wires secret-scanning hooks. `./scripts/check` runs native
tests and isolated installer checks; installers test committed HEAD.
Root Landmark automation owns releases.
