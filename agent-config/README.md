# agent-config

Shared, harness-neutral agent primitives for the Misty Step harnesses. It is the
base layer under `pi-config` and
`omp-config`: portable skills, shared
global guidance, and the `pass-env` secret launcher live here once, and each
harness declares which primitives it selects. `design-check`, `review-check` and the
`openrouter-key` directory-aware credential launcher deploy on the same contract.

A primitive belongs here only if it is harness-neutral and either duplicated
across harnesses or consumed by more than one. Model routing, trackers, settings,
extensions, themes, and vehicle pointers are harness policy and stay in the
harness repo. When in doubt, leave it in the harness.

## Layout

| Path | Purpose |
| --- | --- |
| `install` | The single deploy contract: skills, guidance, launchers, and the audio sandbox |
| `skills/` | Portable skill packages, clean-replaced when selected |
| `skills/test-audit/` | Concise independent consumer-proof guidance, no per-test ledger |
| `skills/story-qa/` | Short real-path proof and check-cadence guidance |
| `skills/remote-execution/` | Native SSH/exe.dev guidance, with no workspace controller |
| `skills/sachstand/scripts/` | Small explicitly requested TTS and operator-playback helpers |
| `guidance/*.md` | Shared global-guidance sections, spliced at the harness marker |
| `bin/pass-env.ts` | Standalone pass-backed environment launcher |
| `bin/openrouter-key.ts` | Shared OMP/Pi key resolver: R90 checkout or Git-common-dir gets the R90 pass entry; other directories use `--personal` (US-028) |
| `bin/foundation-check.ts` | Repository foundation validator: adoption record, documents, feature map, verify skill, affected stories, walk receipts (US-024) |
| `bin/design-check.ts` | Standalone player-surface copy checker, installed as `~/.local/bin/design-check` |
| `bin/review-check.ts` | Standalone headless-Chromium first-screen check for operator review pages: point and every ask above the fold, no dense block; installed as `~/.local/bin/review-check` (US-050) |
| `bin/semantic-check.ts` | Source candidate for an advisory semantic-quality CLI |
| `bin/story-deletion-check.ts` | Exact-commit base-story capability check, bundled for both harnesses (US-051) |
| `bin/semantic-held-out.ts` | Source-only held-out evaluator for the semantic-quality candidate |
| `bin/feature-map.ts` | Source-only pilot: Jev-drafted feature map and comparison against a reference `features/` map (ADR-003; not deployed) |
| `system-one/` | Shared typed judgments, immutable Git adapters, fixtures, and local cache |
| `audio-sandbox/` | Agent audio contract and host deploy: silent sink, Claude Code env, live routing proof (US-026) |
| `../.githooks/pre-push` | Workspace secret scanners, wired by root `scripts/bootstrap` |

## Native remote execution

[`remote-execution`](skills/remote-execution/SKILL.md) distinguishes the exe.dev
management lobby from a VM shell. Run the project's existing commands over SSH
in its approved VM and transfer source or evidence with Git/scp. Agent sessions,
model credentials and auth stores stay local. No snapshot/lease/workspace
orchestration CLI or PR-preview controller is supplied.


## Foundation check (US-024)

`foundation-check check --repo DIR` validates `foundation.json` against the
Foundation Standard catalog, the first-class documents, `check-stories.sh`,
the `features/` map, and a verify skill with Launch/Doctor/Drive/Evidence/Cleanup
sections. `affected --base REV` prints the live stories a diff touches (feature
files in the change that first creates `features/` do not count; source and
story edits do);
`receipt PATH --base REV` validates a same-job story-walk receipt against HEAD,
its tree, the affected stories, and artifact digests. Repository CI pins this
file from a harness revision; the deployed launcher resolves the catalog and
story checker from the installed skills (`$PI_CODING_AGENT_DIR` first).

Ratchet mode (US-027, ADR-003) lets a repository adopt with gaps. On a
repository with or without `foundation.json`, `baseline --owner NAME --write`
records every current gap (`doc:`, `stories:format`, `map:`, `skill:verify`, and
`walk:US-nnn` per live story) as a bootstrap baseline with an owner and an
expiry at most 30 days out; `check` then passes only while each gap stays
baselined, and fails an expired entry or one whose gap is fixed. In PR CI,
`check --base REV` lets the baseline only shrink: a new entry or a later expiry
needs an added `foundation/extensions/*.json` record
(`foundation-baseline-extension/1`: reason plus gap and expiry per entry),
reviewed through the repository's normal tools, and a story the PR edits cannot
stay unmapped. `receipt` accepts `unwalked` for any story with an unexpired `walk:`
entry (no walk yet), affected by the change or not, and prints it as
`advisory:`; a walk that ran and failed, or an `unwalked` story without an
entry, fails. A repository's walk runner therefore reports what it cannot walk
as `unwalked` and exits non-zero only for a failed walk or a crash. The nightly
full walk uses `receipt --all`, which requires every live story and flags walk
entries whose story now passes.

Every application owes three operational obligations (US-040, ADR-005):
continuous deployment (FND-REL-001), loud production alerting (FND-ALR-001) and
incident response that closes the class (FND-INC-001), with no `exception` and
no `not_applicable` for an application. A record whose `surfaces` include `ui`,
`cli`, `api` or `deployed`, or that has no `surfaces`, is an application. Each
obligation still pending is the gap `ops:ship`, `ops:alert` or `ops:incident`,
timed by the ratchet like any other. A `satisfied` claim must hold up: the
record's `operations.ship` names the confirmed default branch (trunk) and a
workflow and job that fires on every push to it (no path or tag-only filters)
and waits on the gate, with an `if:` limited to default-branch push guards
(or a platform for a single-tenant app, proved in the receipt). Its `tenancy`
declares `{"model":"single"}` or, for multi-tenant apps:

```json
{
  "model": "multi",
  "registry": "tenants/registry.json",
  "state": "scripts/tenant-state.sh",
  "migrate": "migrate",
  "excluded": [{ "tenant": "id", "reason": "reviewed reason" }]
}
```

For multi-tenancy, the registry and state files must exist, a workflow ship
must transitively `needs` the migration job, and every excluded tenant must
appear in the registry with a reason; edits to exclusions are reviewable
adoption-record changes. Migrations run before the deploy against each tenant
and stay backward-compatible with the running code; failure stops rollout.
The checker cannot prove actual fan-out from files: the receipt reads back
every non-excluded tenant's deployed revision and migration level, while the
state command reports all tenants including those excluded.

`operations.alert` names the error-capture file, a scheduled health workflow or
external monitor, and an approved agent triage route as the destination (currently
`kaylee-alert-intake`, never a person's inbox or phone). For Sentry, every alert
rule targets the intake and no alert email goes to org members; the route itself
is owned in `hermes-config/docs/alert-routing.md`. The triage agent opens the
incident ticket for a real alert and starts an engineer or escalates to Kaylee;
`docs/runbook.md` has an `## Incidents` section, and a ticket closes only with
its linked postmortem and class-closing fix. For a
pin bump, `baseline --owner NAME --revision SHA --write` re-pins the standard
and adds new catalog obligations as `pending`, keeping existing walk entries;
`--surfaces a,b` sets the record's surfaces. Applicability changes and baseline
extensions need ordinary review; the checker does not authenticate the reviewer.


## Story-preserving deletion (US-051)

Before proposing deletion, run the installed `story-deletion-check --repo PATH
--base BASE --head HEAD`. From a trusted harness checkout:

```sh
pass-env run -f .env.pass -- bun --no-env-file --no-install \
  agent-config/bin/story-deletion-check.ts \
  --repo /path/to/project --base BASE --head HEAD --json
```

Use the merge base and exact PR head, not moving branch names in a receipt.
The checker reads base `USER_STORIES.md` as immutable data: live `## US-NNN`
statements and numbered criteria remain binding when the proposal deletes,
retires, or weakens the story text. The root file remains the discovery contract;
capability sections and existing `features/` specs organize it without a second
story registry. Reconcile criteria/evidence with the actual product when intent
changes; only Phaedrus authorizes capability removal.

No deletion makes no provider request. Deletion, replacement, and rename are
judged by capability, not byte count; identical bytes moved away from an
entrypoint can still break a story. One bounded OpenRouter Decisions call uses
the existing engine and pinned Jev revision. All base stories and the full patch
are included; nothing is silently truncated or excluded by a candidate map.
Limits: 64 live stories, 96 KB state, 128 KB request, 15-second provider timeout.
Credential files, binary/submodule content, missing contracts, and oversized or
malformed evidence produce explicit `unavailable`. Suspected secret values are
redacted before egress; redacted evidence may identify loss but cannot grant
clearance. Credentials are never model state.

Only Choice `removes` with removal probability ≥0.80 creates `hold` and exit 1.
Confidence is recorded, not confused with removal probability. `pass`, `skipped`,
and `unavailable` exit 0; bad invocation/Git failure exits 2. Uncertainty and
service failure do not invent a capability-loss finding or block ordinary
deletion. Ordinary independent review still assesses the full base-story contract.

A hold names base/head, affected story criteria, raw judgment and deletion
evidence. Send it to Kaylee for Phaedrus's explicit approval of that exact change.
Restore capability at a new head for ordinary reassessment. An intentional
removal needs the operator's explicit authorization for that exact change;
shared-account reviews and author claims are not authorization.
No server-required check or GitHub setting is added.

The harness's [PR workflow](../.github/workflows/story-deletion.yml) loads trusted
base checker code at the immutable workflow revision (`github.workflow_sha`) and
fetches candidate Git objects without checking out or executing them. A PR's
recorded base can predate adoption and supplies story evidence, not checker code;
the provider key reaches only that trusted checker. It fails only for
`hold` or an execution/protocol error, reports unavailable judgments as advisory,
and leaves ordinary independent review in place. Other repositories are not
silently deployed or re-pinned by this source change.

Both installers bundle launchers with their owned local modules into one
self-contained executable, preserving the ownership header and foreign
destination guard. Package imports and source escapes are rejected in inert
preflight; candidate source is never executed by that preflight.


## Agent audio sandbox (US-026)

Agent sessions play into a silent PipeWire sink, `agent-sandbox`, never the
operator's speakers. `audio-sandbox/env.ts` is the one contract: `PULSE_SINK`
and `PULSE_SOURCE` for PulseAudio clients, `PIPEWIRE_NODE` for native PipeWire
and ALSA clients (it also overrides an explicit native target), and
`node.dont-fallback`, so a stream aimed at a missing sink stays unlinked
instead of falling back to the default device. `AGENT_AUDIO_SANDBOX` lists the
routing keys. Each harness applies the contract in two layers, so its bash tool
stays routed even when an extension fails to load:

| Harness | Startup layer (no extension code) | Extension layer |
| --- | --- | --- |
| OMP | owned block in the agent `.env` | `extensions/audio-sandbox` sets `process.env` (JavaScript eval, browser, MCP, and LSP children) and revises each Python eval cell to apply the contract first |
| Pi | `shellCommandPrefix` in `settings.json` | `extensions/audio-sandbox` sets `process.env`, which Node mirrors to every child |
| Claude Code | `env` in `~/.claude/settings.json` | none needed |

`install --audio-sandbox` runs `audio-sandbox/install.ts host`. It writes
`~/.config/pipewire/pipewire.conf.d/60-agent-sandbox.conf` (lowest priority, so
any available hardware sink wins the default; with no hardware output at all,
WirePlumber may select it until one returns, keeping the configured default)
and merges the contract into Claude Code's `env`, keeping every
other key. When PipeWire is reachable it creates the sink live, without a
restart, and proves routing with silent `pw-play` and `paplay` streams:
sandboxed streams link only to the sink, streams aimed at a missing sink link
nowhere, and the default and configured sinks are unchanged. An unowned drop-in
or malformed Claude Code settings fail before any write.

Agents verify sound by recording it: a default `pw-record out.wav` or
`parecord out.wav` captures the sandbox monitor. The operator chooses when to
listen, from their own terminal (an agent session's `!` command is sandboxed):
`mpv render.mp4` or `pw-play render.wav` plays a render;
`pw-loopback --capture-props='target.object=agent-sandbox stream.capture.sink=true'`
plays agent audio live until Ctrl-C. Only explicitly requested speech uses the
small [`sachstand` helper](skills/sachstand/SKILL.md); `speak.ts` drops the listed
keys and uses the default device. Ordinary status stays in chat.

OMP's Python eval runner receives an allowlisted environment without these
keys, so the OMP extension revises each Python cell through the `tool_call`
hook: one leading line applies the contract before the cell runs (after any
`from __future__` imports; `%%bash` cells get shell exports; a standalone
`%load local://…` is rewritten to load its backing file by path, and fails
closed when the session root is unknown). Streams are routed at creation,
never moved after linking, and tracebacks count one extra line. That path,
like JavaScript eval and the managed browser, depends on the extension
loading; the bash tool does not. OMP shares a managed browser per project
through a broker daemon, so a browser or broker started before a deploy, like a
session started before it, keeps the old environment until it exits.

Deliberate bypass stays out of scope: processes started outside the session
environment (`env -i`, `systemd-run`, D-Bus activation, `hyprctl dispatch
exec`), raw ALSA `hw:` devices while the card is idle, and IPC into operator
apps that are already running (the browser relay or `app.cdp_url`, browser
tabs opened with `xdg-open`, `playerctl`).

Revert: remove the drop-in and run `pw-cli destroy agent-sandbox`; delete the
owned block from `~/.omp/agent/.env`, `shellCommandPrefix` from
`~/.pi/agent/settings.json`, and the listed keys from `~/.claude/settings.json`
`env`; remove both `extensions/audio-sandbox` directories.

## Install contract

Harness installers invoke one CLI and declare their selection. Preflight
validates the whole selection before any write; unknown names, empty sources, an
invalid launcher, a foreign launcher destination, and a missing guidance marker
all fail closed.

```sh
./install --check --agent-dir DIR \
  --skill all \
  --bin pass-env.ts \
  --guidance engineering --guidance workstation \
  --guidance-source ../pi-config/global/AGENTS.md
```

Drop `--check` to deploy. `--skill all` selects every package; name packages
individually for a narrower set. `--home` overrides `$HOME` for `~/.local/bin`.
Unchanged owned launchers with mode `700` remain in place. Bundles build in
private scratch first; only changed launchers need a writable binary directory.
Updates still replace the destination atomically and reject foreign files.

### Guidance composition

Each guidance file is a complete `##` section. The harness guidance file carries
the insertion marker:

```markdown
<!-- shared guidance: agent-config -->
```

`./install` replaces that line with the selected sections, in the order given,
and leaves the rest of the harness file — its title, intro, and vehicle-specific
sections — untouched. The marker is required; its absence aborts the deploy.

Technology defaults live once in [shared Engineering guidance](guidance/engineering.md),
not in each harness intro.

Shared guidance references only knowledge selected by both engineering consumers.

## What each harness selects

[`pi-config/install`](../pi-config/install) and
[`omp-config/install`](../omp-config/install) declare their own skill, guidance,
helper and safety-component selections. The shared layer supplies engineering
craft, native execution facts, explicit small helpers and repository verification.
It does not supply fleet dispatch, review-approval choreography, workspace leases,
or source-only factory/executive prototypes. Actual review uses native tools.


The installer retires `agent-ergonomics`, `capture`, `decide`, `check-cadence`
and `verification-infrastructure` after migrating their useful content.

### Official TypeSafe skill

`skills/typesafe-ai/` is the complete, unmodified MIT-licensed package from
[`typesafe-ai/skills`](https://github.com/typesafe-ai/skills/tree/65a39f393687675ce170e6094757de20370365b9/skills/typesafe-ai),
pinned at `65a39f393687675ce170e6094757de20370365b9` (`SKILL.md` and `LICENSE`).
The [official installation guide](https://docs.typesafe.ai/agent-skill.md) supports
copying that entire directory. Harnesses select it through the shared installer;
no registry install or duplicate copy is needed.

`system-one` remains a thin companion: OpenRouter Decisions, credential
separation, and deployed consumers. Upstream owns primitive/question/confidence
guidance. Refresh by replacing the entire upstream directory, retaining its
license, updating this pin, and reviewing the companion against current docs.
The official SDKs (`@typesafe-ai/sdk` on npm and `typesafe-sdk` on PyPI) are
clients, not the agent skill; no SDK dependency is needed for this adoption.

## Semantic-quality source candidate

Semantic-quality files remain undeployed source candidates, outside the
engineering skill selection. Typed findings advise; deterministic product
contracts own actual failures.

See [the build, pilot, and rollback guide](../docs/semantic-quality.md).

## Fresh setup

Clone [harness](https://github.com/misty-step/harness) once; this base and both
consumers are sibling components. Follow the [root setup guide](../README.md).
Harness installers invoke this component's `install`; a missing base fails closed.
`AGENT_CONFIG_DIR` remains an advanced override.

## Opt-in desktop memory guard

`./install --desktop-guard` stages the harness-neutral native Herdr boundary
and two-slot local-job launcher (US-043). It does not activate user units or
desktop bindings and is not selected by normal Pi/OMP installs. The
[operating runbook](../docs/desktop-memory-guard.md) owns verification and the
operator's cutover/rollback; source lives in `desktop-guard/`.

## Opt-in agent session backups

`./agent-config/install --session-backup` from the workspace root installs the
backup CLI, names-only pass references and **inactive** user units. It is not
selected by normal Pi/OMP installs; no gateway, Kaylee or Herdr restart is needed.
`--check` is inert; foreign destinations fail before any selected file is written.

The source in `session-backup/` reuses Pile's existing encrypted workstation R2
restic repository and four credential references. It does not initialize a new
repository or buy a service. Snapshots have tag `agent-session-stores`; retention
matches Pile: 30 daily and 24 monthly snapshots, scoped by tag and host. Shared
repository pack pruning remains with the repository owner.

Each run saves the entire `~/.omp/agent/sessions` tree directly, without a second
32-GB local copy. Kaylee's `~/.hermes/profiles/kaylee/state.db`, `sessions/`,
`cron/` and `plugin-data/kaylee/` supply her history, execution records, Glass item
history and dispatch mappings. Every SQLite database in those selected directories
is snapshotted through SQLite's online backup API, including committed WAL data;
live DB files and sidecars are never copied. Snapshots are individually consistent,
not a transaction across separate databases and transcript files. Active OMP files
may end between turns; a subsequent night captures their later records.

The nightly command restores its exact uploaded Hermes staging tree, verifies
restored content and compares all SQLite snapshot hashes before reporting success
or applying retention. Unreadable source files / restic exit 3 fail the run, even
if restic created an incomplete snapshot. Staging and nightly proof scratch are
removed on exit; `~/.local/state/agent-session-backup/last-success.json` records
the exact successful snapshot, counts and bytes.

Activate only after review and verification:

```sh
systemctl --user daemon-reload
systemctl --user enable --now agent-session-backup.timer
systemctl --user start agent-session-backup.service
journalctl --user -u agent-session-backup.service --no-pager
pass-env run -f "$HOME/.config/agent-session-backup.env.pass" -- \
  restic snapshots --tag agent-session-stores
```

The timer runs nightly at 04:10 local time, with up to ten minutes randomized
delay and missed-run persistence. The service uses a 1-GiB memory ceiling, idle
I/O scheduling and the existing Kaylee host success/failure hooks. It requires
the workstation's installed `pass-env`, Bun, Python 3, restic and Glass launcher.

For a full isolated recovery drill, choose an exact snapshot and a finished item
with a readable ledger in `glass query item ITEM --json`:

```sh
target=$(mktemp -d "$HOME/.cache/tmp/agent-session-drill.XXXXXX")
pass-env run -f "$HOME/.config/agent-session-backup.env.pass" -- \
  python3 agent-config/session-backup/drill.py \
  --snapshot SNAPSHOT_ID --item FINISHED_ITEM_ID --target "$target" \
  --glass-source "$HOME/development/misty-step/board"
```

The drill restores **all** backed-up content with restic verification, compiles
the ledger helper against the exact Glass revision recorded in the snapshot and
runs Glass's own ledger reader and display aggregation. Bubblewrap hides both
live owner roots beneath restored mounts and disables network access; original
absolute session bindings stay intact. It compares agents, parents, models,
effort, token components, timestamps, wall time, unknown reasons and aggregate
counts against live Glass, ignoring only transient read timestamps. It rejects a
changed live ledger or Glass build. No alternate ledger algorithm or live source
fallback is used. Requires Go, Git, Bubblewrap and a local Glass source repository
containing the recorded revision.

`$target/ledger-proof.json` is the accounting evidence; preserve it on the board
before removing the owned scratch directory. The restore contains sensitive
transcripts and is private (umask 077); do not publish raw source files. Unknown
token rows remain unknown, not invented zeros. Recovery also requires the
existing restic password and R2 credentials; keep their independent recovery
path with the credential owner.

## Not yet here

Single-owner or repo-local pieces that stay with their harness for now:

- [Scratch-routing design](../omp-config/references/scratch-routing.md) — host
  design retained with its operational implementation.
- [Pressure monitor](../omp-config/bin/tmp-health.py) — workstation-specific tool.
- Repository hooks and release automation belong to the monorepo root.

A reference from another harness does not make machine-specific setup a portable
primitive. Keep deployable skill dependencies inside their package; use canonical
repository URLs for optional workstation context outside a deployed package.

## Verification

```sh
../scripts/verify shared
```

Compose a harness file into a temporary directory and diff it against the live
deployed file before trusting a change to shared guidance.

## Related repositories

- `pi-config` and
  `omp-config` consume this base.

## Ecosystem

Release automation is [Landmark](https://github.com/misty-step/landmark);
conventional commits become semantic versions and release notes. Pre-push runs
gitleaks and trufflehog. `origin` is `misty-step/harness`; releases are workspace-wide.
