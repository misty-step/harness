# ADR-025: Pi uses only OpenAI, Grok and OpenRouter

Accepted 2026-09-28 (US-014, US-045).

Anthropic refuses Pi's subscription OAuth with a 400: third-party apps draw
only from paid extra usage, which is off. OMP on the same accounts works
(`ai-usage dispatch` shows `pi/anthropic/*` BLOCKED). Rather than pay Anthropic
API tokens, Pi stops using Anthropic.

`settings.json` defaults to `openai-codex/gpt-6-astra` at medium. The failover
chain is Astra, Sol, Luna, then `xai/grok-4.7`. The failover guard approves
the GPT-6 trio on the Codex logins, any `xai` model, and any `openrouter`
model except Anthropic's (`anthropic/…` or `~anthropic/…`), which OpenRouter
bills as paid API tokens. Everything else, including every `anthropic/*`
selection, is refused before inference. The installer no longer requires an
Anthropic login. This supersedes the Anthropic and Opus-only clauses of
ADR-011/013's 2026-09-28 amendments; Grok is a Pi builder fallback by operator
decision, while OMP's chains are unchanged.

A later slice restores Anthropic to Pi only through OMP's subscription OAuth
mechanism, at the operator's decision.
