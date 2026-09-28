# ADR-024: Extra accounts are cloned providers with Pi-owned logins

Accepted 2026-09-28 (US-045).

Stock Pi 0.87.1 stores one credential per provider id in `auth.json` and has no
account rotation. It already signs in natively to Anthropic, OpenAI Codex and
xAI, and ADR-023 owns the OpenRouter key. Upstream declined core
multi-account support and recommends provider extensions
([#1391](https://github.com/earendil-works/pi/issues/1391),
[#7814](https://github.com/earendil-works/pi/issues/7814)).

The `accounts` extension registers each slot in `slots.ts` as a clone of a
built-in provider under its own id, starting with `openai-codex-2` to `-4`
for the four Codex accounts OMP also holds. A clone reuses the built-in login,
refresh and streaming unchanged. Pi therefore stores it under its own
`auth.json` key and gives it its own `/login` entry and locked refresh. Models
are re-tagged with the slot id because Pi resolves credentials by
`model.provider`; an untagged model would spend the base account.
The failover extension folds a slot into its base provider (`policyKey`), so
model policy and the chain stay per model: a slot can never approve a model
its base would refuse.

Pi owns these logins; it does not share OMP's `agent.db`. OAuth refresh tokens
rotate, and OMP serialises refreshes with its own leases, which Pi cannot take.
Two refreshers on one token family can revoke each other. Independent sign-ins
create independent token families on the same account; Pi's Anthropic login
and OMP's login for the same account already coexist that way. The cost is one
sign-in per account in each harness, and Pi does not see OMP's per-account
blocks. `omp token <provider> --account N` would give Pi a single refresher
without races, but it would couple every Pi request to an OMP process and its
private policy. Revisit if Pi must follow OMP's block state.

Anthropic and Google Antigravity slots are deliberately absent. Anthropic bills
subscription OAuth from third-party apps as extra usage, and making Pi count as
plan usage means presenting it as Claude Code. Google has suspended accounts
that used Antigravity OAuth from third-party tools, and Pi 0.87.1 ships no
Antigravity provider. Both are operator decisions on terms and account risk,
not configuration.

Removing the extension removes the slots; base providers and their logins keep
working as stock Pi. Slots fail closed if the base provider disappears.
