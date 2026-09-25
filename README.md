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

Intent: [USER_STORIES.md](USER_STORIES.md). Vocabulary, boundaries and
invariants: [DOMAIN.md](DOMAIN.md). Decisions: [docs/adr/](docs/adr/). Agent
rules: [AGENTS.md](AGENTS.md).

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

## Workspace hygiene (US-016)

Keep one canonical checkout per repository. Before making another worktree,
inspect registered checkouts rather than cloning the same repository again:

```sh
bun scripts/workspace-inventory.ts ~/development
git worktree list --porcelain   # from the affected repository
```

The inventory is read-only and reports Git-visible dirty and prunable states;
`clean` does not mean merged, published, inactive, or free of ignored build
outputs. For a finished task, verify its branch and any untracked/evidence files,
then use `git worktree remove <path>` without `--force`; retain uncertain work.
Run `git worktree prune --dry-run` to inspect missing registrations before
pruning them. Never delete another agent's active worktree or a standing VM on
the basis of age. Session-created worktrees and VMs require create-time leases
and a successful `skill://session-close` check; an empty lease store says
nothing about older or unleased resources.

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

## Token-cost evidence (US-018, US-019)

[Token efficiency report](docs/token-efficiency.md): scoped whole-task accounting,
the measured baseline, provider/cache provenance, instruction audit, and the
off-by-default credential-context experiment. Run the analyzer with an explicit
task manifest; a session stop is not proof of task completion. The credential
experiment remains off by default. Separately, the operator-approved advisor
route uses Luna max, then Gemini 3.8 Flash high, Grok 4.7 xhigh, and DeepSeek
V4.1 Flash max; other model roles remain unchanged.

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

Use conventional commits. Branches, commits, and pull requests do not require
an issue; link a relevant existing issue when one exists, but never create one
merely to satisfy naming. Cite user stories for behavioral changes. Labels
`area:shared`, `area:pi`, `area:omp`, and `area:workspace` identify ownership,
not separate release units. CI runs all components sequentially in one check
job, including both consumers. Pull requests use the same commands as local
verification.

Landmark prepares one release stream from `master`: a generated root
`CHANGELOG.md` change enters a release pull request, the required `verify`
check gates its automatic merge, and only the landed commit is tagged and
published. `RELEASE_BOT_APP_ID` and `RELEASE_BOT_PRIVATE_KEY` must be available
as Actions secrets so bot-created pull requests trigger CI. The migration
started at `v0.1.0`; old component tags remain under
`legacy/<component>/<tag>` so their versions cannot collide. Historical
component changelogs remain in place; new release notes belong at the root.
Optional LLM synthesis is disabled, so publishing requires no model credential.

## Migration and related tools

The former `misty-step/{agent-config,pi-config,omp-config}` repositories are
historical archives. Their original commit histories are reachable here through
unsquashed subtree imports. Use `git log --all` for pre-import history (old commits
retain their original paths), or browse the archived repositories and releases.
See [ADR-001](docs/adr/001-monorepo.md) and the
[migration record](docs/migration.md).

[linear-cli](https://github.com/misty-step/linear-cli) remains an independent host
tool. [Landmark](https://github.com/misty-step/landmark) owns release machinery.
