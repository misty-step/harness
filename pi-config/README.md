# pi-config

Pi coding-agent configuration for Phaedrus / Misty Step. This is the versioned
source of truth for how pi iterates on raw upstream pi: settings, the custom
composer chrome, the LOC status extension, the Exa web-search tool, the
image-budget extension, the OpenRouter live-model bridge, and
the `pi()` key-injection wrapper block in `~/.bashrc`. Shared primitives —
skill packages, global guidance, and the `pass-env` and `openrouter-key`
launchers — come from the sibling
base `agent-config`. `./install`
deploys the owned agent-directory components into `$PI_CODING_AGENT_DIR`
(default `~/.pi/agent`); the wrapper block is applied to `~/.bashrc` by hand
(snippet below, source of truth is this repo).

Sister repository to `omp-config`,
which owns the same intent for the OMP harness, over the shared base
`agent-config`. Pi and OMP discover
their configuration differently; harness-specific work stays in each harness,
while harness-neutral primitives live once in the base (ADR-021).

One shared convention is **pokayoke**: after a class of error, change the system
so that class cannot recur. Prefer shape, type, ownership, a missing affordance,
or a failing-closed check over a warning. The standing prompt is: how can I
pokayoke this so this kind of error never happens again? The installer already
practices it — unknown components, empty sources, and invalid settings fail
closed before mutation; owned packages are clean-replaced; foreign live keys and
unmanaged agent files are never overwritten.

The rule for this repo: **every line we add to raw pi must earn its place.**
Each divergence is either *aesthetic* (it changes only what we see) or
*behavioral* (it changes what the agent can do or what the model receives). We
track both here, with a reason and a review trigger.

## How this repo relates to raw pi

`~/.pi/agent` is the live, mutable runtime. This repo owns a declared subset and
never assumes ownership of the rest:

- `./install` overlays source-owned settings keys, clean-replaces owned
  extension packages, and deploys shared primitives through `agent-config`.
- Foreign live settings keys (runtime state such as `lastChangelogVersion`) are
  preserved by `bin/pi-merge-settings.ts`.
- Files this repo does not declare — credentials other than
  `auth.json.openrouter`, sessions, telemetry, herdr integration, Omarchy
  skills, generated themes — are never written.
- One owned file lives outside the agent directory: the marked `pi()` wrapper
  block in `~/.bashrc`'s user section (the only sanctioned touch of the user's
  shell rc; snippet and mark in *The launch hook* below).

To adopt a change: edit the source here, run `./install`, restart pi.

## Divergence ledger

What we add to raw pi, and how it is classified. "Aesthetic" changes only
presentation; "behavioral" changes agent capability, model input, or data flow.

| Component | Owner | Class | Installed by `./install` | Divergence |
| --- | --- | --- | --- | --- |
| `settings.json` | this repo | config | yes | OpenRouter `deepseek/deepseek-v4.1-flash-1017` at max for every fresh session; enabled retry and compaction; editor padding, markdown, theme name |
| `global/AGENTS.md` | this repo | behavioral | yes | Global `~/.pi/agent/AGENTS.md`: pi's intro plus shared sections spliced from `agent-config` |
| `extensions/pi-chrome.ts` | this repo | aesthetic | yes | Session card, composer rail layout, live working state, footer |
| `extensions/loc/` | this repo | behavioral (read-only) | yes | `/loc`, `/loc-trend`, LOC status row |
| `extensions/web-search/` | this repo | behavioral | yes | `web_search` tool (Exa); registers nothing without `EXA_API_KEY` |
| `extensions/image-budget/` | this repo | behavioral | yes | Inline-image ceiling: oldest images dropped over 15 MB per request; large images shrunk with ffmpeg at ingest (ADR-019) |
| `extensions/openrouter-live/` | this repo | behavioral | yes | Live OpenRouter bridge: models the `pi.dev` mirror lacks are appended to `models.json`, additive-only, at session start (≥2 h) and `/models-live` (ADR-022) |
| `extensions/audio-sandbox/` | this repo | behavioral | yes (component `audio-sandbox`; shared contract materialized) | Agent audio routed to the silent `agent-sandbox` sink (US-026): owned `shellCommandPrefix` for the bash tool plus `process.env` for every other child |
| `auth.json.openrouter` | this repo (only this entry) | behavioral | yes (component `openrouter-auth`) | Command key bills R90 for its checkout or linked worktrees and the existing Pi personal entry elsewhere; invalid token on failed lookup blocks fallback (US-028, ADR-023) |
| `agent-config` (skills, guidance, credential and skill helpers) | shared base | behavioral | yes | Selected engineering skills and self-contained helpers; management packages are not default runtime |
| `~/.bashrc` (`pi()` block) | this repo (marked block only) | behavioral | by hand | Launch hook: Exa key from pass (ADR-010); run-scoped scratch `TMPDIR` via `omp-scratch` when installed (ADR-015) |
| `~/.config/omarchy/themed/pi.json.tpl` | this repo (hand-managed) | aesthetic | by hand | pi theme template override for every Omarchy theme: readable semantic ink, accent-derived thinking ramp, deeper surfaces (ADR-018) |
| `extensions/agent-usage-telemetry.ts` | external (managed) | telemetry | no | Reports usage to an external endpoint |
| `extensions/herdr-agent-state.ts` | herdr (managed) | integration | no | Reports pane agent state to herdr |
| `skills/omarchy`, `skills/diagnose-crash` | Omarchy (symlinks) | skills | no | Omarchy-owned agent skills |
| `themes/omarchy-system.json` | Omarchy (generated) | generated | no | Theme regenerated on every theme change |
| `mcp.json`, `mcp-auth.json`, `mcp.log` | pi (runtime) | runtime | no | Personal MCP servers (including Mobbin), native OAuth grants and connection logs; managed with `pi mcp` and `/mcp`, preserved by the installer |
| `auth.json` (except `openrouter`), `models-store.json`, `sessions/`, `trust.json`, `usage-outbox/` | pi (runtime) | runtime | no | Other credentials, sessions, state |

### Global guidance

**`global/AGENTS.md` — behavioral.** Deploys `~/.pi/agent/AGENTS.md`, the file
pi concatenates into every session in every repository (ADR-012). The file is
composed at install time: pi's title and intro, then `agent-config`'s shared
sections — engineering principles and workstation facts —
spliced at the marker line (ADR-021). The shared sections carry the conventions
every session inherits; the intro is pi's own. `./install` overwrites the
deployed copy, and the file tells agents not to hand-edit it.

### Owned extensions

**`pi-chrome.ts` — aesthetic.** Replaces the stock header, editor, and footer
with a four-part layout: a session card (pi mark, version, session name,
compact keyhints) replaces the stock logo banner, the composer's bottom border
is empty, session identity (model + reasoning) is right-aligned on the top
border beside pi's working spinner, and a single footer carries location
+ codebase on the left and session economics on the right. While a tool runs the
working row names it ("reading src/foo.ts"). It reads git status and session
usage but writes nothing and changes no agent behavior. Remove the file and
stock pi returns. It is a deliberate rebuild of the popular
`pi-powerline-footer` idea, kept local so we control the layout and take on no
third-party dependency.

**`loc/` — behavioral, read-only.** A port of the OMP LOC extension. Adds the
`/loc` and `/loc-trend` commands and a status row showing top-language share,
committed code lines, file count, and live net working-tree line movement vs
`HEAD`. `analyze.ts` counts committed code at `HEAD`; the delta adds staged,
unstaged, and untracked movement so it moves as you edit. It shells out to `git`
and reads tracked/untracked files, but never writes to a repository except its
own `.git/loc_cache`. Session-start refresh and explicit commands populate the
cache; optional Git-hook warming is retired. It changes the command surface and
footer output, not the model's tools or autonomy.

**`web-search/` — behavioral.** One tool, `web_search` (query, num_results,
full_text), backed by a single fetch to `api.exa.ai` — no dependencies beyond
pi's runtime (ADR-010). `format.ts` is pure and bun-tested; `index.ts` is the
harness-facing half, mirroring the loc split. The key comes from `EXA_API_KEY`
in the environment, injected from pass by the `pi()` launch hook in
`~/.bashrc` (ADR-010; snippet under *The launch hook* below), so plain `pi`
always has it.

Non-interactive launches, or a missing pass entry, start pi plain; without the
key the tool does not exist at all — stock behavior, no dead affordance.
Failures carry the HTTP status and raw body excerpt, never a bare
"search failed" (the Cerebras 402 lesson).

**Model and recovery — config.** `settings.json` selects OpenRouter
`deepseek/deepseek-v4.1-flash-1017` at max for every fresh session; switching
models is an explicit user choice. Retry and automatic compaction are
source-owned and enabled: `retry.maxRetries` attempts at delays doubling from
`retry.baseDelayMs` (3 attempts at 2 s / 4 s / 8 s), and quota and billing
errors are deliberately never retried. Stock pi owns recovery; no owned
extension switches the model, rotates accounts, or gates providers. Deploying
`config` repairs live retry/compaction disables without overwriting unrelated
settings or credentials. Deployment also removes retired pooled-provider
effort pins and preserves foreign providers' settings.

For readback after installation, start a fresh `pi --mode rpc --no-session` and
send `{"id":"defaults","type":"get_state"}`: expect
`openrouter/deepseek/deepseek-v4.1-flash-1017` and `thinkingLevel: "max"`.

**`image-budget/` — behavioral.** Owns a hard ceiling on inline image bytes
per request (ADR-019). Two layers, in order of authority. `context` enforces a
15 MB decoded-image budget before every LLM call, dropping the oldest images
first: the invariant that makes OpenRouter's 30 MB "Downloaded image content"
413 unreachable, and the repair for a session that already holds too much
history — only the request is trimmed, the session file is untouched, so the
next prompt in that same session succeeds. `tool_result` then shrinks a large
image at ingestion with ffmpeg (longest edge 1536 px, mjpeg quality 5, only
above 600 KB), so a 1.6 MB contact sheet reaches the model as a fully legible
~120 KB JPEG and a long visual-QA session stays inside the budget. The
compressor is fail-open — no ffmpeg, no change — while the budget is
fail-closed. `budget.ts` is pure and bun-tested; `compress.ts` is the ffmpeg
edge; `index.ts` is the harness-facing half. Removing the directory restores
stock behavior: images accumulate until the provider refuses the request.

**`openrouter-live/` — behavioral.** Closes pi's model-availability gap
(ADR-022). pi's remote catalog is a `pi.dev` mirror, refreshed on a 4-hour
ETag cycle, so a brand-new OpenRouter model is invisible to pi until the
mirror crawl catches up — while `omp`, which queries `openrouter.ai`
directly, lists it in minutes. This extension queries the live public list
(key-free) on session start (at most every 2 h) and on `/models-live`, maps it
to the exact entry shape the mirror serves, and **appends** the tool-capable
models pi does not already know to `~/.pi/agent/models.json` — the user
overlay pi merges on top of its builtins. It never removes models, never
rewrites an existing entry, refuses to act on an implausibly small catalog
(fail-closed, the 2026-09-16 union-alpha incident), and keeps one status file
(`openrouter-live-status.json`, extension-owned runtime state). `live.ts` is
pure and bun-tested; `index.ts` is the fetch/write/UI half. Because the mirror
replaces same-id entries through pi's own merge, the overlay needs no cleanup
once `pi.dev` catches up. Removing the directory restores stock behavior: pi
sees OpenRouter models on the mirror's schedule.


**`audio-sandbox/` — behavioral, installed.** Keeps agent audio out of the
operator's ears (US-026). The component writes an owned `shellCommandPrefix`
into `settings.json` (a prefix it did not write fails the install instead of
being replaced), so pi's bash tool is routed to the silent
`agent-sandbox` sink from settings alone, before and independent of extension
loading. The extension applies the same contract to `process.env`, which Node
mirrors to every child pi spawns. The shared host step adds the sink drop-in,
Claude Code env, and live routing proof; the agent-config README documents
listening, residuals, and revert.

**Shared primitives — `agent-config`.** Skill packages, guidance sections, and
the `pass-env` and `openrouter-key` launchers live once in the base and deploy
through its single contract (ADR-021). pi selects the portable skills and
shared guidance sections, plus `pass-env` and `openrouter-key`. `web-search`
uses `pass-env` for its Exa key (ADR-010); `auth.json.openrouter` invokes
`openrouter-key` when Pi first needs its credential (US-028).

### The launch hook: `pi()` in `~/.bashrc`

One of two owned files outside the agent directory: a marked block in the user
section of `~/.bashrc`, the only sanctioned touch of the user's shell rc
(ADR-010). It does two jobs at launch — inject the Exa key from pass (ADR-010)
and, once `omp-config` installs `bin/omp-scratch`, run the session under a
run-scoped scratch `TMPDIR` (ADR-015).

```sh
# pi-config (ADR-010, ADR-015): the pi launch hook. Injects the Exa key from
# pass so web-search is always live, and — once omp-config installs
# bin/omp-scratch — runs the session under a run-scoped TMPDIR under
# ~/.cache/tmp, so suite scratch and evidence never reach the /tmp RAM tmpfs.
# Pieces degrade on their own: no omp-scratch keeps the shell's shared
# TMPDIR; no pass entry starts pi plain. A pass-side failure fails loudly.
if type pass-env >/dev/null 2>&1 || type omp-scratch >/dev/null 2>&1; then
  pi() {
    local -a runner=()
    type omp-scratch >/dev/null 2>&1 && runner=(omp-scratch exec --)
    if [ -n "$(command pass-env list workstation/EXA_API_KEY 2>/dev/null)" ]; then
      command "${runner[@]}" pass-env run \
        -e EXA_API_KEY=workstation/EXA_API_KEY -- pi "$@"
    else
      command "${runner[@]}" pi "$@"
    fi
  }
fi
```

`omp-scratch` owns the run lifecycle — creation, owner trap, `flock`-keyed
sweep ([scratch-routing design](../omp-config/references/scratch-routing.md), §6.1). This repo owns only
the injection point and deliberately does not reimplement the owner in a
dotfile: a second lifecycle implementation is the unowned, drifting hand-edit
that design rejects (the shell's shared `TMPDIR=~/.cache/tmp` export is the
proof). The hook is deliberately fail-open — no `omp-scratch` degrades to that
bridge, no pass entry to plain pi — because a launch must not depend on
scratch infrastructure, and the bridge's failure mode is disk growth, not
desktop pressure.

Named residual gap: the function covers interactive-shell launches only. A pi
session started from a desktop launcher, herdr, or a systemd unit never runs
it, so it gets no run-scoped `TMPDIR`; closing that needs a systemd user
environment or an Omarchy-level default, not this file.

### Foreign and managed components (never overwritten)

**`agent-usage-telemetry.ts` — telemetry.** Managed by an external
`agent-usage-telemetry` install. It posts usage events to a hosted endpoint. Its
configuration, including an API key and machine identity, lives under
`~/.config/agent-usage-telemetry/`, **outside this repo**, and must never be
committed. To disable, remove the extension and its config in the owning tool.

**`herdr-agent-state.ts` — integration.** Installed and overwritten by herdr;
its header forbids editing. It reports this pane's working/blocked/idle state to
the herdr socket. It is a property of herdr, not of pi-config.

**Omarchy skills (`omarchy`, `diagnose-crash`).** Symlinks into
`/usr/share/omarchy/default/agents/skills/`. Omarchy owns and updates them; this
repo neither copies nor replaces them.

**Generated themes.** `themes/omarchy-system.json` is written by
`omarchy-theme-set-pi` from the active Omarchy theme. Select this theme in the machine-local `~/.config/harness/pi.json` overlay;
portable `settings.json` uses `system`. Never version the generated file. The source of that render is our
own `~/.config/omarchy/themed/pi.json.tpl`, which overrides Omarchy's built-in
pi template for every theme (ADR-018). It is hand-managed like the `~/.bashrc`
block: edit it, then `omarchy-theme-refresh` to re-render and deploy. Every value
must stay a hex or a resolvable `vars` reference, because `sync-omp-theme`
resolves the same file into the OMP theme.

## Core things: have, omit, and why

| Capability | Status | Reason |
| --- | --- | --- |
| Global settings | have | Model default, thinking, padding, markdown are stable preferences |
| Custom chrome | have | The one surface we look at constantly; we want it exactly so |
| LOC / codebase awareness | have | Cheap, read-only context that changes review behavior |
| Omarchy theme integration | have | Omarchy hosts select `omarchy-system` locally; other hosts use the terminal palette |
| Telemetry | present, not owned | Installed by its own tool; we do not add or version it |
| Web search | have | Research-backed `web_search` (Exa); the tool exists only when the key is in the environment (ADR-010) |
| Model recovery | stock Pi | Same-model retry and automatic compaction only; no cross-model fallback or account rotation (ADR-028) |
| Image budget | have | Hard 15 MB per-request image ceiling (oldest dropped first) plus ffmpeg shrink at ingest; a 30 MB provider 413 is unreachable, and a session that already holds too much history is repaired by its next request (ADR-019) |
| Approval / permission gates | **omit** | We run with full permissions by choice (pi's default is no gate). Revisit on untrusted repos |
| OS sandbox | **omit** | Work is on a trusted workstation. Revisit for third-party code |
| Subagents | **omit for now** | Native OMP specialist agents cover heavy delegation |
| Persistent memory | **omit for now** | Source authority is the repo and OMP's guidance. Revisit deliberately |
| Notifications | **omit for now** | Terminal focus is usually present; revisit for long unattended runs |
| Plan mode | **omit for now** | Covered by prompt discipline; revisit if it earns a keybinding |
| Prompt templates / homebrew skills | have | Selected engineering packages come from `agent-config`; task-specific helpers are loaded on demand |
| Pinned third-party packages | **omit** | Owned code is vendored here. Add packages only with a named reason |

## Decision log

Decisions live one per file under [docs/decisions/](docs/decisions/index.md);
former ADRs keep their original ids, statuses and dates in `historical/`. These
ids are pi-config's own namespace; cross-component decisions live in the
harness's [docs/decisions/](../docs/decisions/index.md).

See [ADR-023](docs/decisions/historical/023-resolve-openrouter-account-by-launch-directory.md)
for the OpenRouter account policy (US-028).

## Pi versus OMP

Both harnesses share engineering guidance and portable skills. Pi keeps a small
single-agent tool surface, custom chrome, and one OpenRouter model. OMP owns
role-based routing, parallel specialist agents, structured repository tools,
browser workflows, and Cursor Ultra integration.

Use Pi for focused interactive work or as an independent harness diagnostic.
Use OMP for sustained engineering, architecture, cross-family review, and visual
work. Pi runs the single configured OpenRouter model; changing models is an
explicit user choice.

The divergence ledger above owns Pi's actual installed components;
[`omp-config/config.yml`](../omp-config/config.yml) owns OMP routing. Do not
maintain a second upstream feature catalog or extension wishlist here.


## Review triggers

Revisit a decision when its trigger fires, not on a schedule:

- **ADR-005 (LOC drift)**: OMP's `analyze.ts` changes upstream, or the two
  `index.ts` files diverge beyond the theme API.
- **ADR-006 (gates)**: pi runs on a repo we do not trust, or installs a
  third-party package.
- **ADR-008 (packages)**: a capability is needed that we will not vendor, or the
  ecosystem matures enough to pin confidently.
- **ADR-010 (web search)**: an ecosystem Exa package matures without the MCP
  bridge and with pass-compatible key handling, or sessions show repeated
  hand-rolled `curl` + HTML scraping (then add a `web_fetch` tool).
- **ADR-028 (one model)**: OpenRouter stops offering the model, or its
  single-key budget stops covering interactive work (then revisit routing).
- **ADR-014 (host resources)**: the harness routes `TMPDIR` itself, or
  `dev-exec.slice` admission (`devrun`) and per-repo runner caps land — then
  the prose bridge shrinks to a pointer at the mechanism.
- **ADR-015 (scratch routing)**: `omp-scratch` ships under another name or
  another invocation contract (then re-point the hook), or pi gains a native
  session-environment setting (then set it and delete the hook's scratch half).
- **Chrome (ADR-004)**: the footer's left side becomes unreadable at 80 columns.
- **Chrome (ADR-017)**: pi exposes extension enumeration to extensions (then
  fold the resource listing into the session card and enable `quietStartup`).
- **Chrome (ADR-018)**: the pi theme template must survive a machine rebuild or
  be shared with the other harness repo (then version it here and add an
  `omarchy` component to `./install`).
- **ADR-019 (image budget)**: pi ships a per-request image cap or a lossy
  `images.autoResize` mode (then set it and delete the compressor), ffmpeg
  stops being an assumption on this host (then make `compress.ts` optional at
  install), or a provider ceiling below 15 MB appears (then lower
  `DEFAULT_BUDGET_BYTES`).
- **ADR-021 (shared base)**: a harness must build without the sibling checkout
  (then pin `agent-config` as a submodule), or a primitive becomes
  harness-specific (then move it back into the harness repo).
- **ADR-022 (openrouter live)**: pi ships a direct-provider catalog fetch or a
  configurable mirror base with visible freshness (then set it and delete the
  extension, and prune the leftover `models.json` entries), or the mirror lag
  stops costing us missed model launches (then revisit the refresh cadence).
  Standing ask upstream: key-free OpenRouter should not route through a relay
  whose crawl schedule we cannot see (incident: OpenRouter model 091,
  2026-09-16 — `omp` listed `stealth/union-alpha` within an hour of launch,
  `pi` hours later).
- **OMP parity**: OMP ships a feature we use daily and pi lacks. Port one thing
  at a time, with an ADR.

## Install

```sh
./install   # requires bun
```

Unset `PI_CONFIG_COMPONENTS` means `all`. Select a subset with a space-separated
list: `config`, `guidance`, `pi-chrome`, `loc`, `web-search`, `image-budget`,
`openrouter-live`, `audio-sandbox`, `pass-env`, `skills`, `openrouter-auth`.
Installs remove old diff-review, continuation nudge, failover and accounts
packages; no model review runs automatically.

`agent-config` must be checked out beside this repo (default
`$repo_dir/../agent-config`; override with `AGENT_CONFIG_DIR`). `guidance`,
`pass-env`, `skills`, and `openrouter-auth` deploy shared launchers through it;
the installer fails closed when it is missing.

```sh
PI_CONFIG_COMPONENTS=config ./install
PI_CONFIG_COMPONENTS="pi-chrome loc" ./install
PI_CONFIG_COMPONENTS=openrouter-auth ./install  # only OpenRouter auth and the shared launcher
```

Preflight validates bun, jq for `openrouter-auth`, source presence, settings,
and the whole `agent-config` selection before any write. The `loc`,
`web-search`, and `image-budget` packages and every shared skill package are
clean-replaced so obsolete files cannot survive.
The default skill selection is engineering craft only. Retired close/preview
management and optional speech/video packages are not installed by default.
Their earlier deployed copies are removed; foreign packages remain untouched.
Restart pi after deploying.

`openrouter-auth` requires jq and overlays only `auth.json.openrouter` (mode
0600), preserving every other provider and rejecting malformed or symlinked
auth files before any write. The command is
`!openrouter-key --personal workstation/OPENROUTER_MISTY_STEP_HARNESS_WORKSTATION_RECOVERY_API_KEY`.
R90 checkouts (including Git linked worktrees) use
`workstation/OPENROUTER_R90_HARNESS_WORKSTATION_INFERENCE_API_KEY`; all other directories use the Pi
personal entry. A missing/invalid entry emits a deliberately invalid token so
Pi's ambient `OPENROUTER_API_KEY` cannot take over. Restart Pi on account
changes; verify usage from fresh sessions rather than inferring from file
presence.

## Verification

```sh
../scripts/verify pi
```

Runs the extension suites and the fresh-clone installer checks, including
settings validation during isolated installation. Scratch is run-scoped under
`~/.cache/tmp`. Installer checks exercise committed HEAD. Restart pi and
confirm the chrome, `/loc`, and `web_search` load. Extension
loading is proved by a fresh session, not by file presence. `web_search`
presence additionally requires `EXA_API_KEY` in the environment — an
interactive-shell `pi` gets it from the `~/.bashrc` wrapper (pass entry
`workstation/EXA_API_KEY`); a session started without the key degrades to no
`web_search` tool. The installed defaults are proved by the fresh-session
`get_state` readback above. `image-budget` is proved by reading one large image: the stored tool result is
a JPEG an order of magnitude smaller, and the footer shows `img-budget N
dropped` only when the request budget is actually crossed. Workspace Git hooks
are owned by [root bootstrap](../scripts/bootstrap); runtime installation does
not wire LOC hooks. Do not install hooks into `.git/hooks` here: the workspace
uses `core.hooksPath=.githooks`.

## Related repositories

- `agent-config` owns the shared
  primitives this repo deploys.
- `omp-config` is the sister harness.

## Ecosystem

Release automation is [Landmark](https://github.com/misty-step/landmark);
conventional commits become semantic versions and release notes. Pre-push runs
gitleaks and trufflehog. `origin` is `misty-step/harness`; releases are workspace-wide.

## Personal MCP servers

Pi's built-in MCP support owns personal server configuration and OAuth. Configure
Mobbin without an adapter package or credentials in Git:

```sh
pi mcp add mobbin --url https://api.mobbin.com/mcp \
  --description "Search Mobbin's UI screens and flows for design references"
pi mcp login mobbin
pi mcp list
```

The server lives in `~/.pi/agent/mcp.json`; Pi stores and refreshes its OAuth
credentials in `mcp-auth.json`. Default `codemode` exposure keeps the tool catalog
out of every prompt while making it discoverable when needed. Run `/reload` in an
existing session, then `/mcp` to inspect the connection. Installation leaves this
native runtime state untouched.

## Machine-local preferences

Portable defaults use Pi’s `system` theme. The installer overlays
`~/.config/harness/pi.json` (override: `PI_CONFIG_LOCAL_SETTINGS`) after shared
settings. On an Omarchy host put `{"theme":"omarchy-system"}` there.
Use native skill path settings or locally owned skill symlinks for OS/host-specific
packages; installers preserve unmanaged skills. Keep these local files outside
Git and credentials in native runtime storage. Missing overlays are optional;
malformed overlays fail preflight before deployment.
