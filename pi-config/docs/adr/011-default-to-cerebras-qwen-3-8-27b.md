# ADR-011: Default to Cerebras qwen-3.8-27b with a one-shot failover to OpenRouter inception/mercury-2.5

Accepted 2026-09-15.

The user's daily
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

*Amended 2026-09-25:* the operator's model policy extends to pi: Opus 5.5
preferred, GPT-6 Sol and Luna at max, Grok last, no frontier model through
OpenRouter. Pi reaches Opus and GPT-6 only through its own `/login` for
`anthropic` and `openai-codex` (OMP tokens are never copied). `./install`
merges `settings.subscription.json` (default Opus 5.5 medium) only when
`pi auth check` reports both ready; otherwise the DeepSeek default stays and
the installer prints the login instruction. The chain gains the subscription
links ahead of the paid ones; Grok is omitted because pi reaches it only with
a paid API key.

*Amended 2026-09-28:* lower-spend subscription routing replaces both the Opus
startup default and the unauthenticated DeepSeek/Mercury route. `settings.json`
now selects Sonnet 5.5 medium unconditionally, followed by Sol xhigh and Luna
max on terminal model failure. The separate subscription overlay is removed;
missing Pi-native Anthropic or Codex logins produce an installer instruction,
not a paid default. Explicit Opus selection uses high thinking and has no
cross-model recovery, preserving visual work on Opus. Grok is excluded from
builder recovery. Pi 0.87.1 has no native Antigravity provider, so OMP's Gemini
Flash subscription tail cannot be mirrored here without inventing a provider
or switching to paid inference; Pi's chain ends at Luna. OMP credentials remain
separate and are never copied into Pi.
The failover extension also closes Pi's native unauthenticated-default escape:
an input handler consumes prompts on unapproved model selections, and a
provider-request handler aborts extension-originated turns before transport.
Thrown extension errors are not a guard because Pi catches them. The guard
does not delete credentials or model catalog entries; it restricts agent turns.
