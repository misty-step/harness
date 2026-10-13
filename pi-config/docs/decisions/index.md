# pi-config decisions

A steering veto list. Open it before proposing a new primitive, surface, or
storage home. Write a record after deciding *not* to build something the next
agent will otherwise re-propose. Do not write one per PR. Start from
[0000-template.md](0000-template.md); cross-component decisions live in the
[harness index](../../../docs/decisions/index.md) (decision 0012).

## Steering

None yet. Each historical record still states its own revisit condition; the
[README](../../README.md#review-triggers) collects them.

## Historical

Former ADRs, unchanged; their numbers stay reserved.

- [001](historical/001-version-pi-preferences-in-a-dedicated-repo.md): version pi preferences in a dedicated repo.
- [002](historical/002-own-a-declared-subset-with-an-allowlist.md): own a declared subset with an allowlist `.gitignore`.
- [003](historical/003-overlay-settings-preserve-runtime-keys.md): overlay settings, preserve runtime keys.
- [004](historical/004-bottom-rail-empty-identity-top-right-everything.md): bottom rail empty; identity top-right; everything else in the footer.
- [005](historical/005-port-the-omp-loc-extension-rather-than.md): port the OMP LOC extension rather than adopt a third-party package.
- [006](historical/006-no-permission-or-sandbox-gates.md): no permission or sandbox gates.
- [007](historical/007-do-not-version-omarchy-skills-herdr-integration.md): do not version Omarchy skills, herdr integration, telemetry, or generated themes.
- [008](historical/008-no-pinned-third-party-pi-packages-for.md): no pinned third-party pi packages, for now.
- [009](historical/009-theme-name-is-config-the-theme-file.md): theme name is config; the theme file is not.
- [010](historical/010-own-a-minimal-exa-web-search-extension.md): own a minimal Exa web-search extension.
- [011](historical/011-default-to-cerebras-qwen-3-8-27b.md): default to Cerebras qwen-3.8-27b with a one-shot failover.
- [012](historical/012-own-a-global-agents-md-so-every.md): own a global `AGENTS.md` so every pi session carries the shared conventions.
- [013](historical/013-walk-a-configured-fallback-chain-declare-the.md): walk a configured fallback chain; declare the same-model retry budget.
- [014](historical/014-carry-the-host-resource-rule-into-every.md): carry the host-resource rule into every pi session.
- [015](historical/015-hang-run-scoped-scratch-routing-off-the.md): hang run-scoped scratch routing off the `pi()` launch hook.
- [016](historical/016-provide-a-dedicated-decide-skill-for-dense.md): provide a dedicated 'decide' skill (retired).
- [017](historical/017-session-card-replaces-the-stock-header-the.md): session card replaces the stock header; the working row names the tool.
- [018](historical/018-tune-pis-palette-in-the-omarchy-template.md): tune pi's palette in the Omarchy template override.
- [019](historical/019-cap-inline-image-bytes-per-request-and.md): cap inline image bytes per request, and shrink large images at ingest.
- [021](historical/021-extract-shared-primitives-into-a-base-repo.md): extract shared primitives into a base repo; keep the harnesses thin.
- [022](historical/022-bridge-pis-model-catalog-to-the-live.md): bridge pi's model catalog to the live OpenRouter list.
- [023](historical/023-resolve-openrouter-account-by-launch-directory.md): resolve OpenRouter account by launch directory.
- [024](historical/024-extra-accounts-are-cloned-providers-with-pi-owned-logins.md): extra accounts are cloned providers with Pi-owned logins.
- [025](historical/025-pi-uses-only-openai-grok-and-openrouter.md): Pi uses only OpenAI, Grok and OpenRouter.
- [026](historical/026-pool-accounts-behind-one-provider-with-shared-blocks.md): pool accounts behind one provider with shared blocks.
- [027](historical/027-anthropic-for-pi-only-through-the-omp-gateway.md): Anthropic for Pi only through OMP's gateway, and slot sign-ins.
