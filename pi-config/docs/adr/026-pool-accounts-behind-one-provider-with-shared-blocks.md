# ADR-026: Pool accounts behind one provider with shared blocks

Accepted 2026-09-28 (US-045). Extends ADR-024.

ADR-024 gave Pi one login per slot but no balancing: the operator picked a slot
by hand. OMP balances accounts and blocks one at its limit until reset. Pi
gets the same behavior with the smallest native mechanism: a pool is a
registered provider (`openai-pool`, `xai-pool`, `openrouter-pool`) whose
`stream` picks a member account and calls `modelRegistry.stream` on it, so each
member keeps its own login, its own locked refresh and Pi's own streaming. The
pool holds no credential and copies nothing from OMP.

Selection: the session keeps its account while it is usable, which keeps prompt
caches warm; a new session takes the least recently used unblocked account.
When a member errors on a usage or rate limit before any output, it is blocked
until the reset in the error (`~N min`, `retry after`), else 5 min for a rate
limit or 60 min for an exhausted allowance, and the same request moves to the
next member. Other errors, and errors after output began, pass through. Blocks
and last use live in `~/.pi/agent/account-pool.json`, shared by all sessions
(last writer wins; a lost update costs one extra failed request). The pool
sets the footer status to the serving account, and `/pool` lists accounts, logins and blocks.

Differences from OMP, accepted to stay near naked: blocks are learned from the
first failing request, not read from quota APIs (`ai-usage dispatch` remains
the capacity view), and there is no priority or reserve rule; every member is
equal. Pools list the catalog bundled with the installed Pi release, so models
`openrouter-live` appends to `openrouter` do not appear under the pool; select
`openrouter/…` directly for those.

API-key slots (`openrouter-2`) resolve only their own stored key, never the
ambient environment the base reads, so a slot cannot silently double-count the
base account. Default and failover chain now use `openai-pool` and `xai-pool`.
Slots stay selectable directly. Each slot still needs one `/login` by the
operator; a slot without a login is skipped.

The personal OpenRouter command key moved to a pass entry that exists
(`OPENROUTER_MISTY_STEP_HARNESS_WORKSTATION_RECOVERY_API_KEY`); the previous name
was absent from the store and every OpenRouter call returned 401.

*Amended 2026-09-29:* Pi's startup sometimes resolves the settings default
before extension providers exist and lands on Anthropic (4 of 15 fresh
sessions; 0 of 15 with the base `openai-codex` default). The failover guard
refused those sessions, which was safe but broke the default. `accounts` now
switches a session that starts on Anthropic, or on no model, to
`openai-pool/gpt-6-astra` at `session_start` (25 of 25 fresh sessions
after).
