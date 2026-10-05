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

Runtime scope is native Pi/OMP configuration, installation, engineering skills,
and necessary credential/audio/workstation isolation. Custom ticket dispatch,
fleet rosters, experiment scheduling, automated audits and session-close control
are retired. Repository verification and release gates remain.
Native Herdr agent inspection/prompting and native OMP/Pi launch remain necessary
primitives. Source retirement does not remove active owners' separate worktrees,
assets, journals or installed launch/settlement dependencies. Operators keep the
existing native coordination path; caged engineers keep read-only/own-pane limits.

## Setup

```sh
git clone https://github.com/misty-step/harness.git
cd harness
./scripts/bootstrap
```

Bootstrap requires Git, gitleaks, trufflehog, and Python 3 and wires the tracked
root hooks. Pre-commit blocks staged secrets with gitleaks, then runs advisory
semantic test-evidence checks when Bun is available (`JEV_HOOK_OFF=1` skips only
that advice). Pre-push retains blocking gitleaks/trufflehog scans, outgoing diff
review, and advisory semantic checks. Advisory checks read keys from `.env.pass`
and never block, but each records its run through `outcome record`; one that
could not run is a failed run that reaches Kaylee's alert triage (ADR-009).
Bootstrap installs no dependencies and deploys no agent configuration.
Verification requires Bun 1.4.2 or later, Git, jq, and Python 3 (root scanner and shared gallery checks). Tests use synthetic
credentials and isolated destinations; no provider tokens or model calls are needed.
Keep the component directories as siblings. `AGENT_CONFIG_DIR` is an advanced
base-source override, not required for a normal clone.

## Workspace hygiene

Keep one canonical checkout per repository. `git worktree list --porcelain`
shows registered worktrees; `bun scripts/workspace-inventory.ts ~/development`
is a read-only inventory. Inspect tracked, untracked and ignored work before
removing only an owned worktree, without `--force`. Preserve other users' work
and standing VMs. Native Git/SSH own lifecycle; no custom lease ledger is required.

Update affected documentation with behavioral changes; root Landmark release
automation owns `CHANGELOG.md`, so do not manually edit it.

## Verify

```sh
./scripts/verify             # all checks, sequential
./scripts/verify pi          # pi logic and isolated pi install
./scripts/verify omp         # OMP logic and isolated OMP install
./scripts/verify shared      # shared unit tests and both isolated installs
./scripts/verify workspace   # shell syntax and both isolated installs
```

`./scripts/check` is the fixed gate entry point (ADR-004); it runs
`./scripts/verify` with the same arguments, and CI invokes it. See
[verification and local resource limits](docs/verification.md). The root owns
CI, hooks, and releases; component directories retain their focused tests.

## Foundation Standard

Catalog [1.8.1](agent-config/skills/foundation/foundation-standard-v1.json)
and its [rationale](agent-config/skills/foundation/foundation-standard-v1.md)
ship with the pinned `foundation-check` checker (ADR-006). A repository's
`foundation.json` pins its catalog digest and harness revision. Run
`foundation-check check --repo <path>` for documents, mapped stories, dated
`obl:`/`ops:` gaps, repository-side security and evidence shape;
`foundation-check affected --base <rev> --repo <path>` identifies stories to
walk and cite as `Stories: US-001` in a mapped-source PR.
Structural checks cannot prove runtime coverage. Exercise the affected path and
retain observed evidence. Existing adopters re-pin explicitly only after their
2026-10-25 cliff entries close or are extended (ADR-006).

Deletion proposals and PRs also have a narrow
[story-capability check](agent-config/README.md#story-preserving-deletion-us-051)
(US-051). Jev compares the exact change with base story criteria; only supported
capability removal is held for Phaedrus's explicit approval through Kaylee.
Ordinary deletion and unavailable judgments do not acquire an approval gate.
The independent reviewer handles uncertainty; no server setting is changed.


## Token-cost evidence (US-018, US-019)

[Token efficiency report](docs/token-efficiency.md): scoped whole-task accounting,
the measured baseline, provider/cache provenance, instruction audit, and the
off-by-default credential-context experiment. Run the analyzer with an explicit
task manifest; a session stop is not proof of task completion. The credential
experiment remains off by default. Current routing is owned by each harness's
settings: Sol xhigh for primary engineering, Sol low for lightweight work.

## Deploy (explicit live writes)

Install both harnesses, or invoke only the intended component:

```sh
./install
pi-config/install
omp-config/install
```

- pi: `$PI_CODING_AGENT_DIR`, default `~/.pi/agent`.
- OMP: `$PI_CODING_AGENT_DIR` when set, otherwise `$(omp config path)`.
  OMP also stages declared workstation safety helpers; see its component guide.
- Shared launchers: `$HOME/.local/bin`. Foreign destinations fail closed.
- Selections: `PI_CONFIG_COMPONENTS` and `OMP_INSTALL_COMPONENTS`, documented in
  the component guides. Harness installers accept no positional arguments:
  `install --check` is rejected rather than accidentally deploying. The base
  `agent-config/install --check` is an inert preflight with explicit arguments.

Restart the relevant harness to load changed extensions, guidance and OpenRouter
credentials. Only Pi's `auth.json.openrouter` mapping is source-owned; other
credentials, sessions, foreign packages, and generated desktop themes are not.
See [US-028](USER_STORIES.md) for project-aware billing and failure behavior.

Caged engineers use the [audited host-install client](omp-config/README.md#audited-host-installation-us-052)
after Workbench's explicit desk-side bootstrap. It admits named installations
from merged, independently reviewed, green source; it is not a host shell.
Installation, host readback, rollback and consumer activation remain distinct.
New `workbench-item` executable-release installs are deferred: launch-time
mounts cannot protect late-created assets from existing same-UID cages.
CLI, individual shared skills/bins, and historical receipt readback/rollback
remain on the typed route; no cage refresh is implied.

The opt-in [desktop memory guard](docs/desktop-memory-guard.md) (US-043) stages a
native Herdr user service, bounded development slices, two-slot local-job
admission and an Omarchy launcher override. Staging never activates or restarts
the fleet. Its runbook owns the operator-only cutover and rollback.


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

[Landmark](https://github.com/misty-step/landmark) owns release machinery.
