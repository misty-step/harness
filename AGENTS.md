# pi-config

Edit harness sources here. Run `./install` to deploy owned components to
`$PI_CODING_AGENT_DIR`; keep live deployed files out of manual edits. The
installer overlays source-owned settings keys without deleting foreign live
keys, and clean-replaces owned extension packages.

## What this repo owns

- `settings.json` — global pi preferences.
- `extensions/pi-chrome.ts` — composer chrome.
- `extensions/loc/` — LOC status extension.
- `extensions/web-search/` — Exa web-search extension (registers `web_search`
  only when `EXA_API_KEY` is in the environment).
- `skills/authenticated-commands/` — pass-env credential-discipline skill
  (vendored from omp-config).

Everything else under `~/.pi/agent` is foreign and must not be overwritten:
`auth.json`, sessions, `models-store.json`, `usage-outbox/`, telemetry
(`agent-usage-telemetry.ts`), the herdr-managed `herdr-agent-state.ts`, the
Omarchy-owned `omarchy` / `diagnose-crash` skill symlinks, and the generated
`themes/omarchy-system.json`. Deploy only what this repo declares.

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
- `bun test extensions/` for the analyzer and search renderer.
- `bun bin/pi-merge-settings.ts --source settings.json --dest /tmp/pi-settings.json --check`
  for configuration validity.
- Extension loading is proved by a fresh pi session, not by file presence.

## Shipping

Use conventional commits. [Landmark](https://github.com/misty-step/landmark)
turns them into releases. Pre-push runs gitleaks and trufflehog; do not bypass
it for convenience.
