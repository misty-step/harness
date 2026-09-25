# pi-config

Pi coding-agent configuration for Phaedrus / Misty Step. This is the versioned
source of truth for how pi iterates on raw upstream pi: settings, the custom
composer chrome, the LOC status extension, the Exa web-search tool, the
image-budget extension, the model-fallback-chain extension, the OpenRouter
live-model bridge, and
the `pi()` key-injection wrapper block in `~/.bashrc`. Shared primitives — skill
packages, global guidance, and the `pass-env`, `design-check`, `foundation-check`, and `ws` launchers — come from the sibling
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
- Files this repo does not declare — auth, sessions, telemetry, herdr
  integration, Omarchy skills, generated themes — are never written.
- One owned file lives outside the agent directory: the marked `pi()` wrapper
  block in `~/.bashrc`'s user section (the only sanctioned touch of the user's
  shell rc; snippet and mark in *The launch hook* below).

To adopt a change: edit the source here, run `./install`, restart pi.

## Divergence ledger

What we add to raw pi, and how it is classified. "Aesthetic" changes only
presentation; "behavioral" changes agent capability, model input, or data flow.

| Component | Owner | Class | Installed by `./install` | Divergence |
| --- | --- | --- | --- | --- |
| `settings.json` | this repo | config | yes | Default model/thinking, editor padding, markdown, theme name, retry budget |
| `global/AGENTS.md` | this repo | behavioral | yes | Global `~/.pi/agent/AGENTS.md`: pi's intro plus shared sections spliced from `agent-config` |
| `extensions/pi-chrome.ts` | this repo | aesthetic | yes | Session card, composer rail layout, live working state, footer |
| `extensions/loc/` | this repo | behavioral (read-only) | yes | `/loc`, `/loc-trend`, LOC status row |
| `extensions/web-search/` | this repo | behavioral | yes | `web_search` tool (Exa); registers nothing without `EXA_API_KEY` |
| `extensions/failover/` | this repo | behavioral | yes | Fallback chain: run dies on a link after stock retry → session moves to the next, strictly forward (ADR-011/013) |
| `extensions/image-budget/` | this repo | behavioral | yes | Inline-image ceiling: oldest images dropped over 15 MB per request; large images shrunk with ffmpeg at ingest (ADR-019) |
| `extensions/openrouter-live/` | this repo | behavioral | yes | Live OpenRouter bridge: models the `pi.dev` mirror lacks are appended to `models.json`, additive-only, at session start (≥2 h) and `/models-live` (ADR-022) |
| `extensions/continuation-nudge/` | this repo | behavioral | yes (component `continuation-nudge`; shared modules materialized) | Bounded Jev continuation nudge at agent settle: advisory, fail-open, max 2 per prompt, `JEV_NUDGE_MODE=off` disables. Review trigger: pi gains a native anti-premature-stop or continuation control, or nudges fire on completed work |
| `agent-config` (skills, guidance, `pass-env`, `design-check`, `foundation-check`, `ws`) | external (sibling base) | behavioral | yes | Portable skill packages, shared guidance sections, and the `pass-env`, `design-check`, `foundation-check`, and `ws` launchers, clean-replaced from `agent-config` (ADR-021) |
| `~/.bashrc` (`pi()` block) | this repo (marked block only) | behavioral | by hand | Launch hook: Exa key from pass (ADR-010); run-scoped scratch `TMPDIR` via `omp-scratch` when installed (ADR-015) |
| `~/.config/omarchy/themed/pi.json.tpl` | this repo (hand-managed) | aesthetic | by hand | pi theme template override for every Omarchy theme: readable semantic ink, accent-derived thinking ramp, deeper surfaces (ADR-018) |
| `extensions/agent-usage-telemetry.ts` | external (managed) | telemetry | no | Reports usage to an external endpoint |
| `extensions/herdr-agent-state.ts` | herdr (managed) | integration | no | Reports pane agent state to herdr |
| `skills/omarchy`, `skills/diagnose-crash` | Omarchy (symlinks) | skills | no | Omarchy-owned agent skills |
| `themes/omarchy-system.json` | Omarchy (generated) | generated | no | Theme regenerated on every theme change |
| `auth.json`, `models-store.json`, `sessions/`, `trust.json`, `usage-outbox/` | pi (runtime) | runtime | no | Credentials, sessions, state |

### Global guidance

**`global/AGENTS.md` — behavioral.** Deploys `~/.pi/agent/AGENTS.md`, the file
pi concatenates into every session in every repository (ADR-012). The file is
composed at install time: pi's title and intro, then `agent-config`'s shared
sections — pokayoke, communication and verification, host resources, user stories, session close, and design routing —
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
own `.git/loc_cache`. It changes the command surface and footer output, not the
model's tools or autonomy.

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

**`failover/` — behavioral.** Owns the model-fallback chain (ADR-011/013).
Retry and fallback are two layers, each owned by the code that already
understands it. Stock pi owns same-model retry: a run that dies on a
transient provider error (rate limit, overloaded, 429/5xx, network) is
retried with exponential backoff — `retry.maxRetries` attempts at delays
doubling from `retry.baseDelayMs`, declared in `settings.json` as 3 attempts
at 2 s / 4 s / 8 s; quota and billing errors are deliberately never retried.
This extension owns the boundary stock pi has no concept of — switching
models: when a run that just settled died on the current link of the chain
(`agent_end` saw the error, `agent_settled` means stock recovery is
finished), the session moves to the next link via `pi.setModel` and a
notification says so. The walk is strictly forward: one link per failed run,
no flapping, no automatic return; a run that dies on the last link reports
chain exhaustion instead of looping. The walk is keyed to the session's
current model — never to a remembered position — so it cannot drift out of
sync with what the session actually runs. It never touches a model the user
chose, and never re-sends the user's prompt — a run that dies mid-turn may
already have executed tools. The chain is the `CHAIN` constant in `index.ts`
(currently `openrouter/deepseek/deepseek-v4.1-flash`
→ `openrouter/inception/mercury-2.5`; cheap and fast first, heavy backup
last); extend it there and redeploy. `decide.ts` is pure and bun-tested;
`index.ts` is the harness-facing half. Removing the directory leaves stock
retry + compaction recovery exactly intact.

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

**`continuation-nudge/` — behavioral, installed.** Owns the
anti-premature-stop nudge (US-010). On `agent_settled` it asks one byte-frozen
Choice question through the OpenRouter Decisions API (`typesafe/jev-1.13`;
OpenRouter credentials only — no TypeSafe-direct fallback) and, only on a
confident `nudge`, injects the fixed advisory message as a follow-up turn.
Advisory only: it registers nothing on tool, permission, or approval paths,
and the answer never authorizes new work. Every error, timeout, missing key,
or unusable answer fails open and ends the run like stock pi. Loops are
bounded deterministically: at most `JEV_NUDGE_MAX` nudges per user prompt
(default 2), and a previous nudge with no tool result after it is suppressed
without calling Jev. Credentials never enter classifier state; previews are
redacted and capped, and the serialized state is bounded. Status and decision
files live in the agent dir (`continuation-nudge-status.json`,
`continuation-nudge.jsonl`, rotated); `/continuation` is read-only status.
`JEV_NUDGE_MODE=off` restores stock pi. `decide.ts` is pure and bun-tested;
`index.ts` is the harness edge. `pi-config/install` deploys this directory
(component `continuation-nudge`) and materializes the real shared
`continuation.ts` and `engine.ts` over the repo shims, exactly like
`diff-review/engine.ts`, so the installed package loads self-contained.

**Shared primitives — `agent-config`.** Skill packages, guidance sections, and
the `pass-env` launcher live once in the base and deploy through its single
contract (ADR-021). pi selects all 21 portable skills (the homebrew `pokayoke`,
`user-stories`, `capture`, `foundation`, `agent-ergonomics`,
`verification-infrastructure`, `test-audit`, `story-qa`, `check-cadence`,
`decide`, `sachstand`, `authenticated-commands`, `session-close`,
`system-one`, `design-studio`, and `visual-state-review`, plus the vendored
`frontend-design`, `show-me`, `wrangler`, `herdr`, and `using-exe-dev`), the
shared guidance sections, and `pass-env`. `web-search`'s key injection is
the launcher's first pi consumer (ADR-010).

**The Linear CLI is a separate repo.** The client moved to
[linear-cli](https://github.com/misty-step/linear-cli) (ADR-020, amended): a
standalone host tool, installed to `~/.local/bin/linear` by its own `./install`.
pi does not own or deploy it.

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
`omarchy-theme-set-pi` from the active Omarchy theme. We version the *theme name*
in `settings.json`, never the generated file. The source of that render is our
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
| Omarchy theme integration | have | The desktop already owns theming; pi follows `omarchy-system` |
| Telemetry | present, not owned | Installed by its own tool; we do not add or version it |
| Web search | have | Research-backed `web_search` (Exa); the tool exists only when the key is in the environment (ADR-010) |
| Model fallback | have | Configured chain, strictly forward: stock retry first, then the next model per failed run, with user re-send (ADR-011/013) |
| Image budget | have | Hard 15 MB per-request image ceiling (oldest dropped first) plus ffmpeg shrink at ingest; a 30 MB provider 413 is unreachable, and a session that already holds too much history is repaired by its next request (ADR-019) |
| Approval / permission gates | **omit** | We run with full permissions by choice (pi's default is no gate). Revisit on untrusted repos |
| OS sandbox | **omit** | Work is on a trusted workstation. Revisit for third-party code |
| Subagents | **omit for now** | Pi ships no built-in delegation; OMP's executive covers heavy delegation. Revisit if pi-first workflows need it |
| Linear CLI | separate repo | The `linear` CLI is the standalone [linear-cli](https://github.com/misty-step/linear-cli); pi has no MCP and does not own or deploy it (ADR-020) |
| MCP bridge | **omit** | Prefer native tools; Linear access is the standalone `linear` CLI, not an MCP session |
| Persistent memory | **omit for now** | Source authority is the repo and OMP's guidance. Revisit deliberately |
| Notifications | **omit for now** | Terminal focus is usually present; revisit for long unattended runs |
| Plan mode | **omit for now** | Covered by prompt discipline; revisit if it earns a keybinding |
| Prompt templates / homebrew skills | have | Portable skills are shared from `agent-config` (ADR-021); pi deploys all 16, with hidden homebrew ones invoked on demand |
| Pinned third-party packages | **omit** | Owned code is vendored here. Add packages only with a named reason |

## Decision log

Each entry has an ID, status, date, and the reasoning at the time.

**ADR-001 — Version pi preferences in a dedicated repo.** *Accepted · 2026-09-14.*
Live edits to `~/.pi/agent` are unauditable. `pi-config` mirrors `omp-config`
conventions so both harnesses have a reviewed source of truth. Alternative
(edit live files) rejected: no history, no review, no rollback.

**ADR-002 — Own a declared subset with an allowlist `.gitignore`.** *Accepted ·
2026-09-14.* The repo ignores everything and re-includes named paths. This makes
accidental inclusion of secrets (auth, telemetry config) impossible by default.
Cost: every new owned file must be allowlisted.

**ADR-003 — Overlay settings, preserve runtime keys.** *Accepted · 2026-09-14.*
`bin/pi-merge-settings.ts` lets source keys win while keeping foreign live keys
such as `lastChangelogVersion`. Alternative (copy the file wholesale) rejected:
it resets runtime state and clobbers unknown keys.

**ADR-004 — Bottom rail empty; identity top-right; everything else in the
footer.** *Accepted · 2026-09-14.* We iterated from "model + reasoning crowd the
bottom rail" to a strict rule: nothing on the composer's bottom border, identity
right-aligned on the top rail, and one footer below. The footer aligns to the
editor's text column via a single padding constant so decorations line up under
the input. Classification: aesthetic.

**ADR-005 — Port the OMP LOC extension rather than adopt a third-party
package.** *Accepted · 2026-09-14.* We already trust and maintain the OMP
analyzer; porting keeps one implementation of the metric and no new dependency.
Divergence is confined to `index.ts` (theme API); `analyze.ts` was ported from
OMP's copy and has since gained a worktree-delta helper. Risk: two copies can
drift — see Review triggers.

**ADR-006 — No permission or sandbox gates.** *Accepted · 2026-09-14.* We run
pi with full permissions on a trusted workstation, matching pi's default and our
OMP posture. This is explicit, not accidental: gates are omitted, not
misconfigured. Revisit before running pi on untrusted code.

**ADR-007 — Do not version Omarchy skills, herdr integration, telemetry, or
generated themes.** *Accepted · 2026-09-14.* Each has an owner that overwrites
it; copying here would fabricate a second source of truth and break updates.

**ADR-008 — No pinned third-party pi packages, for now.** *Accepted ·
2026-09-14.* The ecosystem is large but young; owned code is vendored and
reviewed here. A package is added only with a named capability, a pinned ref,
and a review trigger.

**ADR-009 — Theme name is config; the theme file is not.** *Accepted ·
2026-09-14.* We pin `theme: "omarchy-system"` so pi follows the desktop, and
never commit the generated `omarchy-system.json`.

**ADR-010 — Own a minimal Exa web-search extension; decline the ecosystem
pi-exa packages; vendor the pass-env skill.** *Accepted · 2026-09-15.* Web
search was the highest-leverage missing capability ("super, obviously, for
research"). Two ecosystem Exa extensions were vetted and declined: the active
51-star package also bridges Exa's MCP server and reads pi's unexported
credential API (ADR-008 bars MCP and private-API dependence); the minimal one
persists its key as plaintext at `~/.pi/config/exa-api-key`, bypassing the pass
store both harnesses treat as the secret authority. Both also pull the
`exa-js` SDK for what one raw fetch does. So we own `extensions/web-search/`:
zero-dependency, one `web_search` tool, capped output, and errors that carry
the HTTP status plus raw body excerpts — the failure class the Cerebras 402
incident proved pi's default rendering loses. The key stays in pass; a `pi()`
wrapper in `~/.bashrc` (snippet under `## Owned extensions` above) runs every
interactive-shell launch under exactly that `pass-env run` invocation, so
plain `pi` always has the key and non-interactive launches stay keyless by
default. With no key the tool is unregistered (stock behavior, no dead
affordance). The `authenticated-commands` skill is vendored from omp-config
(one sentence adapted) so agents learn that credential discipline inside pi.

**ADR-011 — Default to Cerebras qwen-3.8-27b with a one-shot failover to
OpenRouter inception/mercury-2.5.** *Accepted · 2026-09-15.* The user's daily
driver becomes the Cerebras key-model pair at `high` thinking, with Mercury as
the fallback. Stock pi deliberately has no cross-model fallback — retry is
same-model backoff, and compaction retry only re-tries the same model — so a
core setting cannot express "model A, else model B" without a fork. Instead of
adopting a third-party retry package (ADR-008), we own a small
`extensions/failover/` extension over stock lifecycle events: it engages only
after pi's own recovery is finished (`agent_settled`), switches once per
session, never re-sends the user's prompt (a dead mid-turn run may have
executed tools, and silently re-running user intent duplicates side effects),
and never disturbs a model the user chose manually. The settings change is
pure configuration: `defaultProvider`/`defaultModel` → Cerebras at `high`,
plus a `high` thinking pin for the fallback so the switch carries the same
posture. Mercury 2.5's listed 260K context window (OpenRouter) sits well
above the primary's, so a context-bound run that dies on the primary has room
on the fallback.

*Amended by ADR-013 (2026-09-15):* the one-shot single fallback is now a
strictly-forward **chain** walk, and the same-model retry budget is declared
in `settings.json` (`retry.*`) instead of left to stock defaults.

*Amended 2026-09-18:* Cerebras retired (operator: too expensive); the default
is `openrouter/deepseek/deepseek-v4.1-flash` at `xhigh`, `mercury-2.5` the
failover link.

**ADR-012 — Own a global `AGENTS.md` so every pi session carries the shared
conventions.** *Accepted · 2026-09-15.* Pi loads `~/.pi/agent/AGENTS.md` into
every session in every repository — the one hook that reaches every pi agent
everywhere — but on this machine it did not exist, so a session in a
repository without its own `AGENTS.md` (such as this repo) never saw the
pokayoke convention that the README and `install` already name. The omp
harness ships the matching conventions through `omp-config`'s
`global/AGENTS.md`; this is the pi counterpart, scoped to what is universal to
the operator rather than to one harness's model routing or trackers. We own
`global/AGENTS.md` here and `./install` deploys it to
`~/.pi/agent/AGENTS.md` (ledger row, allowlisted in `.gitignore`). Alternative
(edit the live file directly) rejected: no source of truth, and the file would
drift or be silently clobbered by the next install — the same error class
ADR-001 already closed for settings.

**ADR-013 — Walk a configured fallback chain; declare the same-model retry
budget.** *Accepted · 2026-09-15.* The ask: when a model fails, retry (with
exponential backoff) a number of times, then fall back to the next model in a
configured chain. Source-verified in pi 0.85.1's bundled runtime, pi already
owns the first half: a run ending `stopReason: "error"` on a matching
transient pattern (rate limit, overloaded, 429/5xx, network, timeouts) is
retried up to `retry.maxRetries` times (default 3) at
`retry.baseDelayMs * 2^(n-1)` — 2 s / 4 s / 8 s — with
`auto_retry_start`/`auto_retry_end` events; quota, billing, and usage-limit
errors are explicitly never retried. Stacking our own retry loop in the
extension would duplicate a pi-owned mechanism (double retries, hidden backoff
state); let the code that owns the concern own the concern.

- `settings.json` now declares `retry.enabled: true`, `retry.maxRetries: 3`,
  `retry.baseDelayMs: 2000` — the budget made explicit in the repo and
  tunable in one place. `maxRetries` matches the stock default (3); the base
  delay is deliberately twice the stock 1 s (delays 2 s / 4 s / 8 s
  instead of 1 s / 2 s / 4 s), giving a Cerebras stockout 429 window a real
  chance to recover before the chain leaves.
- `extensions/failover/` now walks `CHAIN`, an ordered constant in `index.ts`
  (currently `openrouter/deepseek/deepseek-v4.1-flash` →
  `openrouter/inception/mercury-2.5`; extend by editing the list and
  redeploying). When a run that settled died on link
  *i*, the session moves to link *i+1*, warns, and waits for the user to
  re-send (ADR-011's no-resend rule stands). Strictly forward: one link per
  failed run, no flapping, no automatic return; a failure on the last link
  reports chain exhaustion and stops.
- The chain lives in extension source, not settings: it is policy this repo
  owns (versioned, reviewed, unit-tested through `decide.ts`), while
  `retry.*` stays user-visible per-run tuning in settings. The layers
  compose: pi exhausts same-model retries, then the chain crosses the model
  boundary stock pi has no concept of.
- Rejected: a retry loop in the extension (duplicate of a pi-owned
  mechanism); the chain as a `settings.json` key (pi has no fallback-chain
  setting; a foreign key is less reviewable than a named constant); automatic
  re-send after a switch (ADR-011's tool-safety reason is unchanged); and
  gating the chain advance on pi's transient-error classifier (a model
  *switch* changes provider and key, so even quota or billing failures are a
  valid reason to move — same-model retry stays classified, cross-model
  advance does not).

*Amended 2026-09-15 (same day):* session evidence (`~/.pi/agent/sessions/`)
showed the operator's second workhorse, `deepseek-v4.1-flash`, dying on
errors stock retry does not cover (Together `h2 protocol error`, provider
`finish_reason: error`, OpenRouter admission limits) with no fallback, because
it was outside the chain. The chain gains it as the middle link —
`qwen-3.8-27b` → `deepseek-v4.1-flash` → `mercury-2.5` — cheap/fast first,
heavy backup last, so both daily models get a full runway. The walk becomes
membership-based: `nextInChain(chain, currentKey)` derives the next link from
the session's *current model* (`CHAIN.indexOf`) instead of a remembered
position, so the position-drift state and its desync path are deleted and the
only way to land on an earlier link is an explicit user selection (which
resumes the walk forward from that link). The repo now owns
`deepseek-v4.1-flash`'s `xhigh` thinking pin in `settings.json` (it had been
a foreign live key — the ledger hole this closes).

**ADR-014 — Carry the host-resource rule into every pi session.** *Accepted ·
2026-09-15.* The 2026-09-09 workstation memory-exhaustion class recurred on
2026-09-15 (omp-config's postmortem; the workstation pressure report, §B1),
and the report found one of the gaps in this repo: `global/AGENTS.md`
(ADR-012) carried only pokayoke, so every pi session on this machine —
including the sessions doing the heavy local work — was never told the host's
resource discipline. Scratch landed in `/tmp` (46 GiB of RAM tmpfs), runner
fan-out ran uncapped (one two-project run observed at 16 workers × ~4 GiB),
a second fleet stacked on a live first fleet, and artifacts accumulated
without bound. Pi and OMP are two harnesses that share conventions, not
files, so the rule must be written in both global files; ADR-012 already
made `global/AGENTS.md` the hook that reaches every pi session, and this
fills its content. It is pi's own expression of the rule, not a copy of
omp-config's § Execution environments: OMP's file names an offload vehicle
(`skill://using-exe-dev`) pi does not own, so pi's file says "off-host by
default" without harness-specific pointers. The section stays five sharp
rules because the file loads into every session's context and length is a
real cost:

- Scratch and evidence go to a run-scoped `TMPDIR` under `~/.cache/tmp`
  (disk), never `/tmp` (the 46 GiB RAM tmpfs).
- Heavy execution — full suites, coverage, browser/Electron verification —
  runs off-host by default or in a bounded local scope with an explicit
  worker budget.
- Runner concurrency is capped in repo config, never left to host defaults.
- No second fleet: check for a live run before starting one; stop only the
  scope this session owns.
- Artifacts are bounded: scoped to the run that made them, not accumulated.

Per the report's §6 this is the transition bridge, not the structural fix:
the durable levers are harness-level `TMPDIR` routing, `dev-exec.slice`
admission, per-repo runner caps, and CI/CD owning the heavy checks. It is
also the standing pointer — the report's §B3 is the argument against
restating the rule across the 63 repository `AGENTS.md` files under
`~/development`; repository files add to the global rule (as the file's own
header states), never restate it.

**ADR-015 — Hang run-scoped scratch routing off the `pi()` launch hook.**
*Accepted · 2026-09-15.* Element A3-pi of the 2026-09-15 workstation pressure
report: the [scratch-routing design](../omp-config/references/scratch-routing.md) specifies the mechanism —
run-scoped `TMPDIR` under `~/.cache/tmp/runs/<run-id>`, an owner trap, and a
`flock`-keyed sweep, proven by an executed five-act POC — and its §6.2 assigns
deployment to the launcher owners. This repo owns the launcher for pi:
`~/.bashrc`'s marked `pi()` block (ADR-010). The hook now composes scratch
routing with the existing key injection, selecting the runner through an
array so the empty case stays a plain launch. Decisions recorded:

- **Injection point only.** `omp-scratch` and the run lifecycle stay in
  omp-config (§6.1). Reimplementing the owner in a dotfile would create a
  second lifecycle that drifts — the unowned hand-edit class the design
  rejects, of which the shell's shared `TMPDIR` export is the existing proof.
- **Fail-open, deliberately.** No `omp-scratch` degrades to that shared
  bridge; no pass entry degrades to plain pi. A launch must not depend on
  scratch infrastructure, and the bridge's failure mode is disk growth, not
  desktop pressure.
- **The ADR-014 prose is not shrunk yet.** Routing is not deployed until
  `bin/omp-scratch` lands; that is ADR-014's own review trigger, and
  `scratch-routing.md` §6.4 says the same.
- **The residual gap is named, not papered over.** GUI, herdr, and systemd
  launches never run this function and get no run-scoped `TMPDIR`; that needs
  a systemd user environment or an Omarchy-level default.

Deployed by hand to the marked block, per ADR-010. Verified: `bash -n` on the
source block and the live file, and the four degradation branches exercised
with stubs, asserting the exact argv and that nothing is written outside
`~/.cache/tmp`.

**ADR-016 — Provide a dedicated 'decide' skill for dense, ASD-STE100 executive decision briefs.**
*Accepted · 2026-09-15.* When an operator asks an agent to "help me make a high
quality decision here," the agent frequently defaults to conversational filler,
false balance, or open-ended clarifying questions. For frontier reasoning models
(GPT-6 Astra, Claude Fable 5), modern prompt engineering research establishes
that models reason best when given clear outcomes, permission to infer intent
and inspect local context autonomously, and tight stylistic constraints. We
provide `skills/decide/SKILL.md` with `disable-model-invocation: true`:

- **ASD-STE100 controlled language.** Sentences are limited to 20 words for
  instructions and 25 words for descriptions. Active voice and direct verbs are
  mandatory. Conversational preamble, apologies, and AI clichés ("delve",
  "foster", "leverage", "crucial", "seamless") are prohibited.
- **Autonomous context gathering.** The model infers intent and inspects primary
  artifacts (git diffs, error logs, interface boundaries, ADRs) before writing,
  rather than stalling with clarifying questions.
- **Structured decision memo.** Outputs context, forcing function, non-negotiable
  invariants, candidate paths, a Markdown tradeoff matrix (reversibility, blast
  radius, effort, operational cost, primary risk), a justified stance with
  decision boundary conditions, and the single next action.
- **On-demand invocation only.** Hidden from ambient context via
  `disable-model-invocation: true` to avoid token bloat during normal turns;
  invoked explicitly via `/skill:decide [optional topic]`.
- **Sister repo parity.** Authored identically across `pi-config` and `omp-config`.

**ADR-017 — Session card replaces the stock header; the working row names the
tool.** *Accepted · 2026-09-15.* pi's stock header spends four lines on a logo,
keybinding hints, and two prose sentences, and its working row says only that
something is running. We restyle both from `pi-chrome.ts` without touching the
rails (ADR-004):

- **Session card.** `setHeader` replaces the stock banner with the pi mark,
  version, session name, and the compact keyhints. ctrl+o still expands it to
  the full startup help, because the card implements the same `setExpanded`
  interface pi already drives for tool-output expansion. On a resumed session
  the card also shows prior tokens and cost.
- **Tool-aware working message.** `tool_execution_start` rewrites the working
  row to a present-tense verb plus a bounded target ("reading src/foo.ts",
  "running cargo test"); `tool_execution_end`, `agent_start`, and
  `agent_settled` restore pi's default.
- **Stock spinner.** (Amended · 2026-09-15.) We first replaced pi's braille
  spinner with a four-frame accent pulse via `setWorkingIndicator`. It read as
  motion competing with the working message and the theme's own thinking
  colour, and custom frames render verbatim — they bake their colour and drift
  after a mid-session theme change. Reverted: pi's stock spinner is better
  here.

We keep `quietStartup` off. The `[Context]/[Skills]/[Extensions]/[Themes]`
listing below the header is the load-proof for foreign extensions
(`agent-usage-telemetry.ts`, `herdr-agent-state.ts`), and the extension API
exposes no way to enumerate extensions, so hiding it would trade proof for
polish. Classification: aesthetic.

**ADR-018 — Tune pi's palette in the Omarchy template override, by rule not by
eye.** *Accepted · 2026-09-15.* `~/.config/omarchy/themed/pi.json.tpl` overrides
Omarchy's built-in pi template for every theme, so one edit covers both the day
(`thegreek`) and night (`tokyo-night`) themes. We keep the theme's own hues and
change only how pi's tokens map onto them:

- **Readable ink.** Headings, tool titles, extension labels, and function names
  move from raw palette slots to `accentInk` (accent mixed 50% toward
  foreground). On `thegreek` the accent as text is 2.17:1 against the
  background and `accentText` is 2.99:1 — both below the 3:1 floor — while
  `accentInk` is 4.70:1 on the light theme and 7.3:1 on the dark one. More
  colour must not cost legibility.
- **Accent-derived thinking ramp.** `thinkMid`/`thinkWarm`/`thinkHot` stop
  reusing `magenta`/`orange`, which in `thegreek` resolve to olive and made
  `high` (our default level) the muddiest state on the rail. The ramp is now
  accent → deeper accent → red, monotonic in both themes.
- **Deeper surfaces.** Panel mixes rise from 6/11/13% to 10/14/18%, so user
  messages and tool boxes read as cards instead of blending into the
  transcript.
- **Cross-harness coupling.** `sync-omp-theme` resolves this file's `vars` and
  `colors` into the OMP theme, and `omarchy-theme-set-pi` copies the rendered
  file to `~/.pi/agent/themes/omarchy-system.json`. Every value must stay a hex
  or a resolvable var name; a var that does not resolve fails the OMP sync.
- **Contrast is a gate, not a preference.** Any token that carries text clears
  3:1 on the theme background (4.5:1 preferred). The shipped values were checked
  with the same mix arithmetic the template engine uses, not by eye.

The file is hand-managed for now, like the `~/.bashrc` hook. It is not part of
`./install`. Classification: aesthetic.

**ADR-019 — Cap inline image bytes per request, and shrink large images at
ingest.** *Accepted · 2026-09-16.* A long visual-QA session in `cyoa-video`
read screenshots and contact sheets for every playtest iteration. The session
reached 34 MB on disk; the request that carried its history to
`openrouter/deepseek/deepseek-v4.1-flash` (the failover link) was refused with
HTTP 413, "Downloaded image content cannot exceed 30MB". The limit was on the
whole conversation, not on one tool result, so the session could not recover:
every later prompt re-sent the same history and failed the same way. Retry and
failover cannot help — the request is malformed, not the link.

Pi already caps image *dimensions* (`images.autoResize`, 2000 px), but it keeps
the PNG lossless: a Chromium screenshot of a story node costs 1–2.5 MB, and
forty of them are enough to break any session. Two layers, each with the
authority it can carry:

- **A per-request budget, fail-closed.** The `context` hook sees the messages
  before every LLM call; `enforceImageBudget` measures decoded image bytes and
  replaces the oldest images over 15 MB with a one-line omission placeholder.
  Decoded bytes are what the provider counts and 4/3 smaller than the base64 pi
  sends, so a 15 MB budget is conservative on both readings, and it sits well
  under the smallest ceiling we know of. Oldest first keeps the screenshots a
  live diagnosis needs. The hook's copy is request-scoped and non-destructive,
  so the budget can never corrupt the session file — and a session that is
  already broken is repaired by its next request.
- **Compression at ingestion, fail-open.** The `tool_result` hook shrinks an
  image over 600 KB before it is stored: ffmpeg, longest edge 1536 px, mjpeg
  quality 5. Measured on the `cyoa-video` artifacts: 1.6 MB → 121 KB (7.4%),
  0.83 MB → 92 KB (11.1%), both fully legible. The budget is then rarely
  reached and the session file stops growing by megabytes per screenshot. No
  ffmpeg (or any failure) leaves the image untouched and the budget holds.

Alternatives rejected: `images.blockImages` (drops vision entirely — the
project needs it); trimming whole messages (loses the transcript text with the
images); a bigger budget (the next provider's ceiling is not ours to set);
fixing it only in the `cyoa-video` playtest scripts (the failure is a property
of every pi session that reads many images, not of one repo). The extension is
behavioral: it changes what the model receives. Classification: behavioral.

**ADR-020 — A small Linear CLI instead of an MCP bridge.** *Accepted ·
2026-09-16.* Linear ships no official CLI. Its official agent surface is a
hosted MCP server (`https://mcp.linear.app/mcp`). Pi has no built-in MCP, and
this repo already omits an MCP bridge. Iron Forest's `.iron-forest/linear.py`
is a read-only eligibility gate for autonomous work — a different program's
adapter, vendored into other repos, with no mutation path. Community CLIs exist
and would still leave the workspace's authority-label hazard unencoded.

So: `bin/linear.ts`, a bun script deployed to `~/.local/bin/linear`. One
GraphQL primitive (`gql`) and thin porcelain (`ls`, `show`, `create`, `update`,
`comment`, `projects`, `labels`, `states`). Project, team, state, and label
names resolve to ids at call time, so a rename upstream is not a code change.
`--json` always prints a parseable object, including
`{"error":{"kind","message"}}` on failure. Adding any `Agent: *` label
requires `--authorize-agent-work`, because those labels enroll an issue in Iron
Forest's 300 s builder poll; removing them is always allowed. The credential
comes from the environment or `pass show workstation/LINEAR_API_KEY` and is
never printed.

`./install` refuses to replace a non-regular `~/.local/bin/linear` or a regular
file that is not this client. Classification: behavioral.

*Amended 2026-09-16:* the client moved to its own repo,
[linear-cli](https://github.com/misty-step/linear-cli). It is a host tool, not
pi configuration, and releases independently; `pi-config` no longer carries or
deploys it, and `./install` lost the `linear` component. The client's own
`./install` owns the destination.

**ADR-021 — Extract shared primitives into a base repo; keep the harnesses
thin.** *Accepted · 2026-09-16.* `decide` was byte-identical in both harness
repos, `authenticated-commands` differed by one sentence, the `pass-env`
launcher had one source and two consumers, and the pokayoke and host-resource
guidance was maintained twice — while `analyze.ts` had already drifted from the
"shared verbatim" claim in ADR-005. The "share conventions, not files" posture
had quietly stopped being true.

So the harness-neutral primitives move to
`agent-config`: the 13 portable skill
packages, three guidance sections (`pokayoke`,
`communication-and-verification`, `host-resources`), and `bin/pass-env.ts`. Each
harness declares its selection through one deploy contract; `agent-config` owns
the deploy mechanism, so neither harness reimplements it. `./install` composes
`~/.pi/agent/AGENTS.md` from pi's intro plus the selected sections at a marker
line, and validates the whole selection before any write.

What stays here: everything pi-specific — settings, extensions, the launch hook,
and pi's guidance intro. What pi gains: the shared skills it
lacked (`pokayoke`, `capture`, `foundation`, `agent-ergonomics`,
`verification-infrastructure`, and the vendored externals) and the
communication-and-verification discipline. Alternatives rejected: a git
submodule (pinning is not yet needed; the sibling path fails closed and the base
is checked out anyway), and duplicating the deploy mechanism in each harness
(the duplication this ADR removes). Revisit: if a harness must build without the
sibling checkout, pin the base as a submodule.

## Research: how pi iterates on other harnesses

Surveyed 2026-09-14 against pi's bundled docs/examples, the community
[Awesome Pi Agent](https://github.com/thevibeworks/awesome-pi-agent) list,
`omp-config`, and the OMP/pi ecosystem. Harness descriptions below are feature
summaries, not endorsements.

### What raw pi already ships

Pi is deliberately a minimal core with a deep extension API. Out of the box:

- **Built-in tools**: `read`, `bash` (or `powershell`), `edit`, `write`, `grep`,
  `find`, `ls`.
- **Context**: global `~/.pi/agent/AGENTS.md`, project `AGENTS.md`/`CLAUDE.md`
  walking up from cwd, `AGENTS.override.md`.
- **Resources**: skills, prompt templates, themes, project trust, packages
  (npm/git/local) with pinned refs.
- **Session lifecycle**: sessions, forking, tree navigation, compaction, branch
  summaries.
- **Model controls**: default provider/model, per-model thinking levels, model
  cycling, presets via `--preset` (example).
- **Extension API**: events, custom tools, UI (footer/status/editor/widgets/
  overlays), providers, commands, shortcuts, flags.

Consequence: most "missing" features in our list are *available* as extensions
but intentionally not installed.

### What OMP (oh-my-pi) adds over pi

OMP is a heavier distro (pi fork) plus a large config surface. From `omp-config`
and the ecosystem:

- Hash-anchored edits, an optimized tool harness, LSP, Python, browser control.
- Declarative `statusLine` with named segments, roles, `agentModelOverrides`,
  and five explicit retry fallback chains.
- `executive` extension: recursive, scope-owning subagents.
- `omp-grievances`, `pass-env` secrets launcher, Linear MCP directory scoping.
- Homebrew skills (`foundation`, `agent-ergonomics`, `verification-
  infrastructure`, `capture`), agent definitions, and guidance.

Our stance: keep pi lean. Port only what is independently valuable (`loc`,
compact cwd) and let OMP keep the heavy orchestration. This is the main
"include vs omit" line between the sister repos.

### What other harnesses have

| Harness | Signature features | Our reading |
| --- | --- | --- |
| **Claude Code** | `CLAUDE.md` memory, plan mode, subagents, hooks, slash commands, MCP, permission modes, skills/plugins, checkpoints | The richest opinionated surface; pi reproduces most as extensions. We adopt the *idea* of plan mode and review, not the system |
| **OpenAI Codex CLI** | `AGENTS.md`, sandbox modes (read-only / workspace-write / full), approval modes, MCP | Its safety model is the strongest argument for gates; our ADR-006 accepts the tradeoff |
| **OpenCode** | LSP integration, provider-agnostic TUI, agents, sessions | LSP is the feature we most plausibly want later |
| **Amp** | Modes, permissions, web access | Its "web access" is served in pi by `pi-web-access` |
| **IDE agents (Cursor, Windsurf)** | Inline edits, codebase index | Out of scope; pi is terminal-first |

### Popular pi extensions and our stance

From the ecosystem survey. `Adopt` = we run it or an equivalent; `Consider` =
plausible, not yet; `Decline` = deliberate no.

| Category | Extension | Stance |
| --- | --- | --- |
| UI | `pi-powerline-footer`, `status-line`, `model-status` | Adopt *concept* in `pi-chrome.ts`; no dependency |
| UI | `pi-tool-display`, `pi-response-renderer` | Consider — compact transcripts |
| Workflow | `plan-mode`, `preset`, `handoff`, `todo` | Consider plan mode; others later |
| Safety | `pi-permission-system`, `permission-gate`, `protected-paths` | Decline per ADR-006 (revisit on untrusted code) |
| Sandbox | `sandbox/`, `nono`, `gondolin`, `pi-less-yolo` | Decline now; `nono` is the likely first if we sandbox |
| Subagents | `subagent/`, `pi-subagents`, `pi-messenger`, `pi-intercom` | Decline now; OMP executive covers delegation |
| Memory | `pi-hermes-memory`, `pi-memory-workbench`, `magic-context` | Decline now; revisit with a clear source-of-truth story |
| MCP | `pi-mcp-adapter`, `mcp-to-pi-tools` | Consider if a needed tool is MCP-only |
| Providers | `pi-anthropic-auth`, `meridian`, `pi-llama-cpp`, `pi-gitlab-duo` | Consider per provider; global routing lives in OMP |
| Observability | `pi-cost-dashboard`, `pi-sub`, `pisesh` | Decline — our footer covers the daily need |
| Notifications | `pi-notify`, `pi-notify-pp`, `pi-telegram` | Consider for unattended runs |
| Review / QA | `pi-review`, `pi-diff-review`, `pi-review-loop` | Consider; OMP owns heavy review today |
| Sessions | `pisesh`, `pi-session-manager` | Decline — pi's built-ins suffice |
| Web | `pi-exa` (junnjiee), `pi-exa` (rbwsam), `pi-web-access` | Decline both pi-exa packages — see ADR-010; own `web-search/` instead |
| Setups | `HazAT/pi-config`, `abhinand5/pi-setup`, `LazyPi`, `monopi` | Reference only; we mirror `omp-config`, not another setup |

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
- **ADR-011 (failover)**: pi ships a native model-fallback setting (then
  delete the extension and set it), the fallback stops being a sensible
target, or sessions show manual `ctrl+p` switches to the primary after a
failover became sticky (then revisit the once-per-session latch).
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
- **ADR-020 (Linear CLI)**: Linear ships an official CLI, or Iron Forest grows
  a mutation path we can share — then retire `linear-cli` and point at the one
  owner.
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
list: `config`, `guidance`, `pi-chrome`, `loc`, `web-search`, `failover`,
`image-budget`, `openrouter-live`, `pass-env`, `skills`.

`agent-config` must be checked out beside this repo (default
`$repo_dir/../agent-config`; override with `AGENT_CONFIG_DIR`). `guidance`,
`pass-env`, and `skills` deploy through it; the installer fails closed when it
is missing.

```sh
PI_CONFIG_COMPONENTS=config ./install
PI_CONFIG_COMPONENTS="pi-chrome loc" ./install
```

Preflight validates bun, source presence, settings, and the whole `agent-config`
selection before any write. The `loc`, `web-search`, `failover`, and
`image-budget` packages and every shared skill package are clean-replaced so
obsolete files cannot survive. Restart pi after deploying.

## Verification

```sh
../scripts/verify pi
```

Runs the extension suites and both fresh-clone installer checks, including
settings validation during isolated installation. Scratch is run-scoped under
`~/.cache/tmp`. Installer checks exercise committed HEAD. Restart pi and
confirm the chrome, `/loc`, and `web_search` load. Extension
loading is proved by a fresh session, not by file presence. `web_search`
presence additionally requires `EXA_API_KEY` in the environment — an
interactive-shell `pi` gets it from the `~/.bashrc` wrapper (pass entry
`workstation/EXA_API_KEY`); a session started without the key degrades to no
tool. `failover` needs no configuration or key: a fresh
`openrouter/deepseek/deepseek-v4.1-flash` session is the proof that the
extension loaded (it registers nothing visible).
`image-budget` is proved by reading one large image: the stored tool result is
a JPEG an order of magnitude smaller, and the footer shows `img-budget N
dropped` only when the request budget is actually crossed. Workspace Git hooks
are owned by [root bootstrap](../scripts/bootstrap); runtime installation does
not wire LOC hooks. Do not install hooks into `.git/hooks` here: the workspace
uses `core.hooksPath=.githooks`.

## Related repositories

- `agent-config` owns the shared
  primitives this repo deploys.
- `omp-config` is the sister harness.
- [linear-cli](https://github.com/misty-step/linear-cli) is the standalone
  Linear client (ADR-020).

## Ecosystem

Release automation is [Landmark](https://github.com/misty-step/landmark);
conventional commits become semantic versions and release notes. Pre-push runs
gitleaks and trufflehog. `origin` is `misty-step/harness`; releases are workspace-wide.
