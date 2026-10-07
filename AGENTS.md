# Harness

One Git repository, three components. Read the affected component's `AGENTS.md`
before editing. Cross-component changes land in one commit/PR.

## Route the change

| Path | Owns |
| --- | --- |
| `agent-config/` | Harness-neutral skills, guidance sections, `pass-env`, the agent audio sandbox, and their shared deployment contract |
| `pi-config/` | pi settings, extensions, composer chrome, guidance intro, and shared-primitive selection |
| `omp-config/` | OMP routing, config/models/MCP, extensions, themes, guidance, watchdog, and shared-primitive selection |
| Root | Workspace setup, verification, Git hooks, CI/releases, and cross-component architecture decisions |

Share a primitive only when it is harness-neutral and duplicated across, or
consumed by, multiple harnesses. Otherwise keep it with its consumer. Harness
policy stays with its harness; similar-looking code alone does not justify an
abstraction.

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

- `./scripts/bootstrap` wires root pre-commit/pre-push secret scans and advisory semantic checks; it does not deploy.
- `./scripts/check [shared|pi|omp|workspace|all]` is the fixed gate entry point
  (ADR-004). It runs `./scripts/verify`, the canonical checks, and CI invokes
  it; see [verification](docs/verification.md) for bounds and postconditions.
- Shared changes require both consumers' affected checks. Composed-guidance
  changes need composition inspection, not a model run.
- Installer checks read committed HEAD. Cap runner and test concurrency; CI has a
  single-job/test-concurrency budget.
- Report whether live deployment occurred. File presence does not prove native
  extension loading.
- Use conventional commits. Root Landmark automation owns the single release
  stream. Do not bypass secret scanners.

Cross-component decisions live in `docs/adr/`; component decisions stay in the
component's own `docs/adr/`.
