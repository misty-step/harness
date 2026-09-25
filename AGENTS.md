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
abstraction. `linear-cli` remains an independent host tool.

## Source and deployment

Edit source here, never generated live copies. Root/component `AGENTS.md` files
instruct maintainers; harness `global/AGENTS.md` plus `agent-config/guidance/*.md`
are the source of deployed global guidance. Do not conflate them.

Harness installers declare their selection and call `agent-config/install`.
Do not duplicate its shared-primitive deployment logic. Preserve foreign settings,
credentials, sessions, packages, and runtime state. Keep the sibling paths:
installers resolve `../agent-config` unless `AGENT_CONFIG_DIR` overrides it.

Deployment is a live mutation, not verification. See [README.md](README.md) for
targets and selection. Harness installers accept no positional arguments and
reject `--check`; only the base installer provides an inert preflight. Use
`./scripts/verify` for isolated checks. Never assume redirecting the agent directory
alone isolates HOME, scope, or launcher writes.

## Verify and ship

- `./scripts/bootstrap` wires the root pre-push scanners; it does not deploy.
- `./scripts/verify [shared|pi|omp|workspace|all]` is the canonical check entry
  point; see [verification](docs/verification.md) for bounds and postconditions.
- Shared changes require both consumers' affected checks. Prose needs consistency
  review; composed-guidance changes need composition inspection, not a model run.
- Keep scratch in run-scoped `~/.cache/tmp`; cap runner and test concurrency.
  CI has an explicit single-job/test-concurrency budget.
- Inspect status first, preserve unrelated work, and report evidence plus whether
  live deployment occurred. File presence does not prove native extension loading.
- Use conventional commits. Root Landmark automation owns the single release
  stream. Do not bypass secret scanners.

Cross-component decisions live in `docs/adr/`; component decisions stay with
their component, in its own `docs/adr/` (`pi-config/docs/adr/`).
[ADR-001](docs/adr/001-monorepo.md) supersedes only pi-config ADR-021's
separate-repository topology, not its ownership boundary.
