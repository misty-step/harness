# Harness

Misty Step's agent configuration: one shared base, four thin harness adapters,
and native Codex model defaults. One clone records a compatible combination;
one PR can change the contract and consumers. Runtime state and credentials
are not source.

```text
agent-config/ ── shared install contract ──┬── pi-config/     → pi runtime
                                         ├── omp-config/    → OMP runtime
                                         ├── claude-config/ → Claude Code (T3 lanes)
                                         └── codex-config/  → Codex
```

| Component | Owns | Guide |
| --- | --- | --- |
| `agent-config/` | Portable skills, shared global guidance, `pass-env`, shared deployment | [README](agent-config/README.md) |
| `pi-config/` | pi settings, extensions, chrome, guidance intro | [README](pi-config/README.md) |
| `omp-config/` | OMP routing, config/MCP, extensions, themes, guidance | [README](omp-config/README.md) |
| `claude-config/` | Shared skills and guidance Claude Code sessions select, such as `lage`; composes `~/.claude/AGENTS.md` with no legacy alias | [README](claude-config/README.md) |
| `codex-config/` | Shared skills and guidance Codex sessions select; composes `~/.codex/AGENTS.md`; native model, effort and service-tier defaults | [README](codex-config/README.md) |

Foundations: [FOUNDATIONS.md](FOUNDATIONS.md). Intent: [USER_STORIES.md](USER_STORIES.md). Vocabulary, boundaries and
invariants: [DOMAIN.md](DOMAIN.md). Decisions: [docs/decisions/](docs/decisions/index.md). Agent
rules: [AGENTS.md](AGENTS.md).

Runtime scope is native Pi, OMP, Claude Code and Codex configuration, native Codex model defaults,
installation, engineering skills, and necessary credential/audio/workstation isolation. Custom ticket dispatch,
fleet rosters, experiment scheduling, automated audits and session-close control
are retired. Native Herdr and OMP/Pi launch own coordination. Installers remove
retired launchers, automatic review, and resource admission while preserving
sessions, journals, private credentials, and desktop isolation.

## Setup

```sh
git clone https://github.com/misty-step/harness.git
cd harness
./scripts/bootstrap
```

Bootstrap requires Git, gitleaks, trufflehog, and Python 3 and wires the tracked
root hooks. Pre-commit scans staged secrets with gitleaks. Pre-push scans outgoing
commits with gitleaks and trufflehog. Neither invokes a model or a review service.
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

`bun scripts/loc-delta.ts [--repo misty-step/harness] [--from DATE] [--to DATE]`
reads Glass's existing complexity ledger and prints project and per-module code
lines with net change; it is read only and defaults to the week ending today.

Update affected documentation with behavioral changes; root Landmark release
automation owns `CHANGELOG.md`, so do not manually edit it.

## Verify

```sh
./scripts/verify             # all checks, sequential
./scripts/verify pi          # pi logic and isolated pi install
./scripts/verify omp         # OMP logic and isolated OMP install
./scripts/verify shared      # shared unit tests and the isolated installs
./scripts/verify workspace   # shell syntax and the isolated installs
```

`./scripts/check` is the fixed gate entry point (ADR-004); it runs
`./scripts/verify` with the same arguments, and CI invokes it. See
[verification and local resource limits](docs/verification.md). The root owns
CI, hooks, and releases; component directories retain their focused tests.

## Foundations

[Foundations](https://foundations.mistystep.io/) is the sole operating reference,
including verification and review policy. `FOUNDATIONS.md` is a pointer, not a
second rubric.


## Token-cost evidence (US-018, US-019)

[Token efficiency report](docs/token-efficiency.md): scoped whole-task accounting,
the measured baseline, provider/cache provenance, instruction audit, and the
off-by-default credential-context experiment. Run the analyzer with an explicit
task manifest; a session stop is not proof of task completion. The credential
experiment remains off by default. Current routing is owned by each harness's
settings: Sol xhigh with native fast processing; Claude design and Grok scouting/review.

## Deploy (explicit live writes)

Install every harness, or invoke only the intended component:

```sh
./install
pi-config/install
omp-config/install
claude-config/install
codex-config/install
```

- pi: `$PI_CODING_AGENT_DIR`, default `~/.pi/agent`.
- OMP: `$PI_CODING_AGENT_DIR` when set, otherwise `$(omp config path)`.
  OMP also stages declared workstation safety helpers; see its component guide.
- Claude Code: `$CLAUDE_CONFIG_DIR`, default `~/.claude`.
- Codex: `$CODEX_HOME`, default `~/.codex` (skills, `AGENTS.md` and the guard hook in `hooks.json`; `config.toml` only for that hook's trust, written by Codex's own RPC).
- Shared launchers: `$HOME/.local/bin`. Foreign destinations fail closed.
- Selections: `PI_CONFIG_COMPONENTS` and `OMP_INSTALL_COMPONENTS`, documented in
  the component guides; claude-config and codex-config declare its skills and guidance in their
  installers and take no selection variable. Harness installers accept no positional arguments:
  `install --check` is rejected rather than accidentally deploying. The base
  `agent-config/install --check` is an inert preflight with explicit arguments.

Installation does not prove an active runtime loaded changed code or guidance.
Use a fresh native harness session to load changed extensions, guidance and
OpenRouter credentials; do not restart unrelated consumers. Only Pi's
`auth.json.openrouter` mapping is source-owned; other credentials, sessions,
foreign packages, and generated desktop themes are not. See
[US-028](USER_STORIES.md) for project-aware billing and failure behavior.

### Application management is not desktop control

Desktop isolation protects the operator's live screen, cursor and capture
surfaces; it is not a ban on authorized application installation, configuration
or service activation. Use the application's native owner paths. When host
context is required, Workbench's fixed host-install recipes provide it without
exposing a host shell, display/input socket or session bus. Installation and
live activation require separate readback.

The [OMP application-management runbook](omp-config/README.md#authorized-application-management)
documents the explicit Cantrip install/readback commands and the existing-broker
refresh bootstrap. See [decision 0013](docs/decisions/0013-application-management-not-desktop-control.md)
for the boundary and rejected alternatives.



### Codex defaults (native installation)

[`codex-config/config.toml`](codex-config/config.toml) owns only the native Codex
CLI defaults: GPT-6.1 Sol, xhigh reasoning in ordinary and Plan modes, and Fast
service. Plan mode otherwise uses its separate Medium preset. Codex 0.159.0's
model catalog advertises `xhigh` and the `priority` tier for Sol; the native
`fast` setting maps to `priority`. `features.fast_mode` is enabled by default,
so no redundant feature override is stored. See the
[configuration reference](https://developers.openai.com/codex/config-reference),
[speed guide](https://developers.openai.com/codex/speed), and
[Plan preset source](https://github.com/openai/codex/blob/main/codex-rs/models-manager/src/collaboration_mode_presets.rs).

`codex-config/install` deploys skills, guidance and the workstation guard hook; its only `config.toml` write is that hook's trust, made through Codex's own RPC.
Do not replace or symlink `~/.codex/config.toml` with this four-key source;
preserve unrelated settings, credentials, plugins, approvals and runtime state.
After merge/review, an authorized host operator applies only these keys through
Codex's native [`config/batchWrite`](https://developers.openai.com/codex/app-server)
RPC. This is a live write; caged engineers must not bypass a missing approved
installation route.

Start the native server without model/profile/effort overrides. This output
filter retains only the relevant settings, never the full configuration:

```sh
codex app-server --stdio | jq --unbuffered '
  select(.id != null) |
  if .error then {id, error}
  elif .id == 2 then {id, config: (.result.config |
    {model, model_reasoning_effort, plan_mode_reasoning_effort, service_tier})}
  elif .id == 4 then {id, session: (.result |
    {model, reasoningEffort, serviceTier})}
  else {id, completed: (.result != null)} end'
```

Send these newline-delimited protocol messages in order, waiting for the
initialization response before sending `initialized`, and for each numbered
response before continuing:

```json
{"id":1,"method":"initialize","params":{"clientInfo":{"name":"harness_config","version":"1.0.0"}}}
{"method":"initialized","params":{}}
{"id":2,"method":"config/read","params":{"includeLayers":false}}
{"id":3,"method":"config/batchWrite","params":{"edits":[{"keyPath":"model","value":"gpt-6.1-sol","mergeStrategy":"upsert"},{"keyPath":"model_reasoning_effort","value":"xhigh","mergeStrategy":"upsert"},{"keyPath":"plan_mode_reasoning_effort","value":"xhigh","mergeStrategy":"upsert"},{"keyPath":"service_tier","value":"fast","mergeStrategy":"upsert"}]}}
```

Stop that server, start a fresh one with the same command, and send only
`initialize`, `initialized`, `config/read`, then the following fresh-thread
request (no model, effort or tier override):

```json
{"id":4,"method":"thread/start","params":{}}
```

Retain the four-key config readback and session response: expect
`model = gpt-6.1-sol`, `reasoningEffort = xhigh`, and `serviceTier = priority`.
Also check a fresh interactive `codex --no-daemon` session with `/status` and
`/fast status`; switch to `/plan` and confirm xhigh remains selected.
Project config, selected profiles and managed policy can override defaults:
perform the readback in the intended working directory, not just an empty home.
Existing sessions retain their model/effort/tier, so resuming one or requesting
hot reload is not fresh-session proof. This source does not own Hermes profiles
or either client's authentication.



## Contributing and releases

Use conventional commits. Branches, commits, and pull requests do not require
an issue; link a relevant existing issue when one exists, but never create one
merely to satisfy naming. Cite user stories for behavioral changes. Labels
`area:shared`, `area:pi`, `area:omp`, and `area:workspace` identify ownership,
not separate release units. CI runs all components sequentially in one check
job, including every consumer. Pull requests use the same commands as local
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
Native GitHub auto-merge closes generated release PRs after required checks;
the [release ADR](docs/decisions/0012-native-release-promotion.md) records the
existing version policy and host-install boundary.

## Migration and related tools

The former `misty-step/{agent-config,pi-config,omp-config}` repositories are
historical archives. Their original commit histories are reachable here through
unsquashed subtree imports. Use `git log --all` for pre-import history (old commits
retain their original paths), or browse the archived repositories and releases.
See [ADR-001](docs/decisions/historical/001-monorepo.md) and the
[migration record](docs/migration.md).

[Landmark](https://github.com/misty-step/landmark) owns release machinery.
