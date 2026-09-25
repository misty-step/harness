# ADR-010: Own a minimal Exa web-search extension; decline the ecosystem pi-exa packages; vendor the pass-env skill

Accepted 2026-09-15.

Web
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
