# ADR-013: Walk a configured fallback chain; declare the same-model retry budget

Accepted 2026-09-15.

The ask: when a model fails, retry (with
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
