# agent-config

Shared, harness-neutral agent primitives for the Misty Step harnesses. It is the
base layer under `pi-config` and
`omp-config`: portable skills, shared
global guidance, and the `pass-env` secret launcher live here once, and each
harness declares which primitives it selects. `design-check` and the
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
| `skills/test-audit/` | Shared authoring gate and focused test audit; subsystem campaign is opt-in (US-021) |
| `skills/story-qa/` | Curated user-story walks by agents on the real product surface (US-022) |
| `skills/check-cadence/` | Risk-based PR/nightly/weekly check selection without losing owned gates (US-023) |
| `guidance/*.md` | Shared global-guidance sections, spliced at the harness marker |
| `bin/pass-env.ts` | Standalone pass-backed environment launcher |
| `bin/openrouter-key.ts` | Shared OMP/Pi key resolver: R90 checkout or Git-common-dir gets the R90 pass entry; other directories use `--personal` (US-028) |
| `bin/ws.ts` | Owned exe.dev project workspace launcher: snapshot, task worktrees, remote commands, evidence, browser tunnel (US-025) |
| `bin/foundation-check.ts` | Repository foundation validator: adoption record, documents, feature map, verify skill, affected stories, walk receipts (US-024) |
| `bin/design-check.ts` | Standalone player-surface copy checker, installed as `~/.local/bin/design-check` |
| `bin/semantic-check.ts` | Source candidate for an advisory semantic-quality CLI |
| `bin/semantic-held-out.ts` | Source-only held-out evaluator for the semantic-quality candidate |
| `bin/feature-map.ts` | Source-only pilot: Jev-drafted feature map and comparison against a reference `features/` map (ADR-003; not deployed) |
| `system-one/` | Shared typed judgments, immutable Git adapters, fixtures, and local cache |
| `audio-sandbox/` | Agent audio contract and host deploy: silent sink, Claude Code env, live routing proof (US-026) |
| `candidates/effective-verification/` | Child-mandate skill source, kept outside automatic skill deployment |
| `../.githooks/pre-push` | Workspace secret scanners, wired by root `scripts/bootstrap` |

## Workspace CLI (US-025)

From the checkout of record: `ws init` creates or reuses the standing
`<project>-ws` VM and runs `.exe/setup.sh` when its digest changes. `ws up --task T`
pushes a snapshot (including non-ignored untracked files) and leases a detached
task worktree; `ws sync --task T` refreshes it. Run commands with
`ws run --task T -- cmd`; to forward a named secret only over stdin use
`pass-env run -e NAME=entry -- ws run --task T --env NAME -- cmd`.
`ws browser --task T` prints a `cdp_url`; `ws browser --task T --stop` stops
the owned tunnel and Chromium. `ws pull --task T [paths]` saves evidence and
SHA-256 digests to `~/.cache/tmp/ws/<project>/<task>/`; `ws down --task T`
refuses unpulled or changed evidence, then removes the worktree and lease,
not the VM. `ws attach --task T` opens a remote shell; `ws status` checks
VM presence. Agent sessions and model credentials stay local.

## Foundation check (US-024)

`foundation-check check --repo DIR` validates `foundation.json` against the
Foundation Standard catalog, the first-class documents, `check-stories.sh`,
the `features/` map, and a verify skill with Launch/Doctor/Drive/Evidence/Cleanup
sections. `affected --base REV` prints the live stories a diff touches;
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
approved by the designated agent reviewer, and a story the PR edits cannot stay
unmapped. Against a change, `receipt` accepts `unwalked` only for a mapped,
unaffected story with an unexpired `walk:` entry: an unmapped story's impact is
unknown, so it must be walked. The nightly full walk uses `receipt --all`, which
requires every live story and flags walk entries whose story now passes.

`review --pr N` is the gate for the two approvals an author cannot give
(ADR-003 Review authority). From the GitHub API it reads the PR's base, head,
author and reviews, and passes at once unless the PR gives `USER_STORIES.md`
its first stories or adds a `foundation/extensions/` record. Then it needs an
approving review on the PR head from the organisation's agent reviewer, written
into the checker (misty-step: `kaylee-agent[bot]`). After that reviewer's
`foundation-escalation: product-direction` review on the head, only its later
approval recording the operator's decision and opening with
`foundation-escalation: resolved` as its exact first line counts; approvals from the operator's shared account never do. Copy
[`skills/foundation/foundation-review.yml`](skills/foundation/foundation-review.yml)
into a repository's workflows and pin the same harness revision as its
`foundation` job. It runs on `pull_request_target`, so the base branch's copy of
the gate judges each PR; after any review action the reviewer toggles a label to
re-run it. Land it in the adoption PR on its own, before any PR adds first
stories or an extension record: a gate that is not yet on the base branch judges nothing.

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
plays agent audio live until Ctrl-C. The spoken sachstand brief is requested
playback, so `speak.ts` drops the listed keys and uses the default device.

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
  --guidance pokayoke --guidance communication-and-verification --guidance host-resources --guidance credentials \
  --guidance user-stories --guidance session-close --guidance design-routing \
  --guidance-source ../pi-config/global/AGENTS.md
```

Drop `--check` to deploy. `--skill all` selects every package; name packages
individually for a narrower set. `--home` overrides `$HOME` for `~/.local/bin`.

### Guidance composition

Each guidance file is a complete `##` section. The harness guidance file carries
the insertion marker:

```markdown
<!-- shared guidance: agent-config -->
```

`./install` replaces that line with the selected sections, in the order given,
and leaves the rest of the harness file — its title, intro, and vehicle-specific
sections — untouched. The marker is required; its absence aborts the deploy.
Shared guidance sections may reference shared primitives and vehicles deployed across both harnesses, such as `skill://using-exe-dev`.

## What each harness selects

| Harness | Skills | Guidance | Launcher | Audio sandbox |
| --- | --- | --- | --- | --- |
| `pi-config` | all | pokayoke, communication-and-verification, host-resources, user-stories, session-close, design-routing | `pass-env`, `design-check`, `foundation-check`, `ws` | component `audio-sandbox` |
| `omp-config` | all | pokayoke, communication-and-verification, host-resources, user-stories, session-close, design-routing | `pass-env`, `design-check`, `foundation-check`, `ws` | component `audio-sandbox` |

`omp-config`'s own guidance file adds Working together (including model roles),
Execution environments (exe.dev vehicle), and Authority
and operations. `pi-config`'s file is title and intro only.

`test-audit` owns test authoring, consolidation, and pruning decisions for both
harnesses; it avoids repeated verification of the same contract. Shared
guidance requires adversarial self-review of every change and invokes
`story-qa` for affected user-facing story walks before done. Docs-only and
internal changes get proportionate owner-path checks, not artificial browser
walks. `check-cadence` guides fast PR checks and owned nightly/weekly coverage.
The shared guidance routes all three; it does not schedule a run. Their scope
is distinct from `verification-infrastructure`, which creates repository-owned
runnable verification. The `effective-verification` candidate below judges
test and execution evidence; it is not deployed.

## Semantic-quality source candidate

The semantic-quality files are not selected by either installer. Candidate skills
stay outside `skills/`, because both consumers currently select every directory there.
They remain a
source candidate until a separate rollout completes repository pilots and fresh-process
Hermes verification. The engine uses fixed Choice questions through OpenRouter
Decisions. Its findings remain advisory, and deterministic exits stay authoritative.

See [the build, pilot, and rollback guide](../docs/semantic-quality.md).

## Fresh setup

Clone [harness](https://github.com/misty-step/harness) once; this base and both
consumers are sibling components. Follow the [root setup guide](../README.md).
Harness installers invoke this component's `install`; a missing base fails closed.
`AGENT_CONFIG_DIR` remains an advanced override. `linear-cli` is installed separately.

## Not yet here

Single-owner or repo-local pieces that stay with their harness for now:

- [Workstation runbook](../omp-config/references/dev-exec.md) and
  [scratch-routing design](../omp-config/references/scratch-routing.md) — host docs,
  retained with their operational implementation; linked by both harnesses.
- [Pressure monitor](../omp-config/bin/tmp-health.py) — workstation-specific tool.
- The Linear CLI is its own repo, [linear-cli](https://github.com/misty-step/linear-cli).
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
- [linear-cli](https://github.com/misty-step/linear-cli) is an independent host
  tool.

## Ecosystem

Release automation is [Landmark](https://github.com/misty-step/landmark);
conventional commits become semantic versions and release notes. Pre-push runs
gitleaks and trufflehog. `origin` is `misty-step/harness`; releases are workspace-wide.
