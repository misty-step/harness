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

Bootstrap requires Git, gitleaks, trufflehog, and Python 3 and wires the
tracked root pre-push hook. It installs no dependencies and deploys no agent configuration.
Verification requires Bun 1.4.2 or later, Git, jq, and Python 3 (root scanner and shared gallery checks). Tests use synthetic
credentials and isolated destinations; no provider tokens or model calls are needed.
Keep the component directories as siblings. `AGENT_CONFIG_DIR` is an advanced
base-source override, not required for a normal clone.

## Workspace hygiene (US-016, US-004)

Keep one canonical checkout per repository. Before making another worktree,
inspect registered checkouts rather than cloning the same repository again:

```sh
bun scripts/workspace-inventory.ts ~/development
git worktree list --porcelain   # from the affected repository
```

The inventory is read-only and reports Git-visible dirty and prunable states;
`clean` does not mean merged, published, inactive, or free of ignored build
outputs. Use the existing `skill://session-close` gate, not a parallel cleanup
tool. At the start of owned repository work, including inherited worktrees, run
`bun path/to/session-close.ts track [--repo PATH]` before switching or deletion.
Its `check` auto-enrollment is a safety net, not a replacement for early tracking.

A finished session means merged after observed green CI and independent exact-head
model review, deployed to the repository's actual targets with production sanity
evidence, local/origin feature branches deleted, own worktree removed, and the
canonical checkout clean on the fetched origin default head. Shared harness
changes deploy to both Pi and OMP through the [installers below](#deploy-explicit-live-writes);
restart and exercise the changed installed behavior. Keep the PR and relevant
existing ticket current with revision, status and evidence; use Habitat only
where routed there, and Linear for Misty Step/personal work.

Run `session-close.ts check` before yielding. It checks persistent owned landing
records after worktree removal, fetches the authoritative origin default and
uses live GitHub/origin facts; auth, command and malformed-data errors fail
closed. Explicit `park --repo PATH --note TEXT` permits unfinished close with a
meaningful reason, owner and resume steps; report **parked**, retained resources
and PR/ticket status, never done. `unpark --repo PATH` resumes work. Parking keeps
matching owned worktree leases; live non-worktree leases still block.

Session-created worktrees and non-standing VMs still require create-time leases.
Inspect branch changes, untracked/ignored files and evidence before
`git worktree remove <path>` without `--force`; retain uncertain work. Run
`git worktree prune --dry-run` to inspect missing registrations before pruning
only confirmed owned stale registrations. Never delete another agent's active
worktree or a standing VM on the basis of age. Foreign records are informational;
stale leases require manual review, and lease expiry does not erase landing
obligations. `leases --json` is read-only lease introspection, not landing proof;
an empty lease store says nothing about older or unleased resources.

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

Catalog [1.6.0](agent-config/skills/foundation/foundation-standard-v1.json)
and its [rationale](agent-config/skills/foundation/foundation-standard-v1.md)
ship with the pinned `foundation-check` checker (ADR-006). A repository's
`foundation.json` pins its catalog digest and harness revision. Run
`foundation-check check --repo <path>` for documents, mapped stories, dated
`obl:`/`ops:` gaps, repository-side security and evidence shape;
`foundation-check affected --base <rev> --repo <path>` identifies stories to
walk and cite as `Stories: US-001` in a mapped-source PR. The separate
`foundation-check review --pr N` diagnoses independent model-review records and
designated decisions on the candidate head, not a server merge prerequisite.
One exact-head model approval supplies the delegated decision. Structural checks
cannot prove runtime coverage or what a reviewer judged: preserve execution and
review receipts. Existing adopters re-pin explicitly only after their
2026-10-25 cliff entries close or are extended (ADR-006).


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

Restart the relevant harness to load changed extensions, guidance and OpenRouter
credentials. Only Pi's `auth.json.openrouter` mapping is source-owned; other
credentials, sessions, foreign packages, and generated desktop themes are not.
See [US-028](USER_STORIES.md) for project-aware billing and failure behavior.

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

[linear-cli](https://github.com/misty-step/linear-cli) remains an independent host
tool. [Landmark](https://github.com/misty-step/landmark) owns release machinery.
