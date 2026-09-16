# pi-config

Edit harness sources here. Run `./install` to deploy owned components to
`$PI_CODING_AGENT_DIR`; keep live deployed files out of manual edits. The
installer overlays source-owned settings keys without deleting foreign live
keys, clean-replaces owned extension packages, and deploys shared primitives
through the sibling [agent-config](https://github.com/misty-step/agent-config).

## What this repo owns

- `settings.json` — global pi preferences (theme, paddings, default model, thinking, retry budget).
- `global/AGENTS.md` — pi's global session-guidance intro. `./install` composes
  it with shared sections from `agent-config` and deploys the result to
  `~/.pi/agent/AGENTS.md`.
- `extensions/pi-chrome.ts` — composer chrome.
- `extensions/loc/` — LOC status extension.
- `extensions/web-search/` — Exa web-search extension (registers `web_search`
  only when `EXA_API_KEY` is in the environment).
- `extensions/failover/` — fallback chain: a run that dies on a link after
  stock retry + compaction recovery moves the session to the next link,
  strictly forward; chain lives in the extension source (ADR-011/013).
- `extensions/openrouter-live/` — live OpenRouter bridge: appended to
  `models.json` (additive-only, fail-closed) the models the `pi.dev` mirror
  lacks, so model launches land on the provider's schedule, not the
  mirror's (ADR-022).
- `~/.bashrc` (marked block only; snippet in the README) — `pi()` wrapper that
  injects the Exa key from pass for interactive-shell launches (ADR-010).

Everything else under `~/.pi/agent` is foreign and must not be overwritten:
`auth.json`, sessions, `models-store.json`, `usage-outbox/`, telemetry
(`agent-usage-telemetry.ts`), the herdr-managed `herdr-agent-state.ts`, the
Omarchy-owned `omarchy` / `diagnose-crash` skill symlinks, and the generated
`themes/omarchy-system.json`. Deploy only what this repo declares.

## Shared primitives

Skill packages, global-guidance sections, and the `pass-env` launcher are owned
by [agent-config](https://github.com/misty-step/agent-config), checked out as
the sibling `../agent-config` (override with `AGENT_CONFIG_DIR`). This repo
declares its selection in `install`; it does not carry those files. Add a
harness-neutral primitive there, not here.

The Linear CLI is a separate host tool, [linear-cli](https://github.com/misty-step/linear-cli);
this repo neither owns nor deploys it (ADR-020, amended).

## Conventions

- Keep the divergence ledger in `README.md` honest. When you add, remove, or
  reclassify an extension or setting, update the ledger and add or amend an ADR.
  A change absent from the ledger is not finished.
- Prefer small, single-purpose extensions over one large one. `pi-chrome.ts`
  owns the rails; `loc/` owns codebase metrics.
- Keep the composer's bottom border empty. Identity is right-aligned on the top
  rail; everything else belongs in the footer.
- Align rails to the editor's text column via a single padding constant.
- Nerd-font glyphs and semantic color are welcome; keep them legible and
  left-to-right in reading order.
- Extensions must degrade to stock behavior when removed.

## Verification

- `sh -n install` for the deploy script.
- `bun test extensions/` for the extensions' pure logic.
- `bun bin/pi-merge-settings.ts --source settings.json --dest /tmp/pi-settings.json --check`
  for configuration validity.
- `(cd "${AGENT_CONFIG_DIR:-../agent-config}" && sh -n install && bun test bin/)`
  for the shared primitives this repo deploys.
- Extension loading is proved by a fresh pi session, not by file presence.

## Shipping

Use conventional commits. [Landmark](https://github.com/misty-step/landmark)
turns them into releases. Pre-push runs gitleaks and trufflehog; do not bypass
it for convenience.
