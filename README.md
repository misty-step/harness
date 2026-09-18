# Harness

Misty Step's agent configuration: one shared base and two thin harness adapters.
One clone records a compatible combination; one PR can change the contract and
both consumers. Runtime state and credentials are not source.

```text
agent-config/ ── shared install contract ──┬── pi-config/  → pi runtime
                                         └── omp-config/ → OMP runtime
```

| Component | Owns | Guide |
| --- | --- | --- |
| `agent-config/` | Portable skills, shared global guidance, `pass-env`, shared deployment | [README](agent-config/README.md) |
| `pi-config/` | pi settings, extensions, chrome, guidance intro | [README](pi-config/README.md) |
| `omp-config/` | OMP routing, config/MCP, extensions, themes, guidance, watchdog | [README](omp-config/README.md) |

## Setup

```sh
git clone https://github.com/misty-step/harness.git
cd harness
./scripts/bootstrap
```

Bootstrap requires Git, gitleaks, and trufflehog and wires the tracked root
pre-push hook. It installs no dependencies and deploys no agent configuration.
Verification requires Bun 1.4.2 or later, Git, jq, and Python 3 (shared gallery checks). Tests use synthetic
credentials and isolated destinations; no provider tokens or model calls are needed.
Keep the component directories as siblings. `AGENT_CONFIG_DIR` is an advanced
base-source override, not required for a normal clone.

## Verify

```sh
./scripts/verify             # all checks, sequential
./scripts/verify pi          # pi logic and isolated pi install
./scripts/verify omp         # OMP logic and isolated OMP install
./scripts/verify shared      # shared unit tests and both isolated installs
./scripts/verify workspace   # shell syntax and both isolated installs
```

See [verification and local resource limits](docs/verification.md). The root owns
CI, hooks, and releases; component directories retain their focused tests.

## Deploy (explicit live writes)

Run only for the harness you intend to change:

```sh
pi-config/install
omp-config/install
```

- pi: `$PI_CODING_AGENT_DIR`, default `~/.pi/agent`.
- OMP: `$PI_CODING_AGENT_DIR` when set, otherwise `$(omp config path)`.
  OMP also writes declared scope imports and host launchers; see its component guide.
- Shared launchers: `$HOME/.local/bin`. Foreign destinations fail closed.
- Selections: `PI_CONFIG_COMPONENTS` and `OMP_INSTALL_COMPONENTS`, documented in
  the component guides. Harness installers accept no positional arguments:
  `install --check` is rejected rather than accidentally deploying. The base
  `agent-config/install --check` is an inert preflight with explicit arguments.

Installers do not configure repository Git hooks; run bootstrap separately.
Restart the relevant harness to load changed extensions/guidance. This repository
does not own auth stores, sessions, foreign packages, or generated desktop themes.

## Contributing and releases

Use conventional commits and the root issue tracker. Labels `area:shared`,
`area:pi`, `area:omp`, and `area:workspace` identify ownership, not separate release
units. CI runs all components sequentially in one check job, including both consumers.
Pull requests use the same commands as local verification.

Landmark produces one release stream from `main`, gated on verification. The
migration starts a new `v0.1.0` baseline; old component tags are preserved under
`legacy/<component>/<tag>` so their versions cannot collide. Historical component
changelogs remain in place; new release notes belong at the root. Optional LLM
synthesis is disabled so release publishing requires no model credential.

## Migration and related tools

The former `misty-step/{agent-config,pi-config,omp-config}` repositories are
historical archives. Their original commit histories are reachable here through
unsquashed subtree imports. Use `git log --all` for pre-import history (old commits
retain their original paths), or browse the archived repositories and releases.
See [ADR-001](docs/decisions/001-monorepo.md) and the
[migration record](docs/migration.md).

[linear-cli](https://github.com/misty-step/linear-cli) remains an independent host
tool. [Landmark](https://github.com/misty-step/landmark) owns release machinery.
