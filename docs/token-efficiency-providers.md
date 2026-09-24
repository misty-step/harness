# Provider cache semantics and prices for configured routes

**Observed 2026-09-24.** Read-only investigation. No credentials were read and no authenticated provider/usage API calls were made. All prices below are USD per million tokens (MTok); cached input means cache-read tokens. Provider list prices, local catalog estimates, and realized spend are kept separate.

## Configured routes

- **OMP roles:** `openai-codex/gpt-6-sol` is default/plan/task; `openai-codex/gpt-6-astra` is slow/extreme/security-reviewer; `openai-codex/gpt-6-luna` is advisor/smol/tiny/commit. `anthropic/claude-opus-5-5` is reviewer/vision.
- **OMP fallbacks:** advisor: Grok 4.7 xhigh → Google Antigravity Gemini 3.8 Flash high → OpenRouter DeepSeek V4.1 Flash max (primary Luna max); default: GPT-6 Luna → `xai-oauth/grok-4.7` → Claude Opus 5.5 → `openrouter/deepseek/deepseek-v4.1-flash`; vision: Grok 4.7 → Luna → DeepSeek V4.1 Flash; smol/tiny/commit: Grok 4.7 → Claude Opus 5.5 → DeepSeek V4.1 Flash. (All thinking levels are in `omp-config/config.yml`.)
- **Pi:** default `openrouter/deepseek/deepseek-v4.1-flash`; `pi-config/extensions/failover/index.ts` chains it to `openrouter/inception/mercury-2.5`. The extension switches once after stock recovery and tells the user to resend; it does not automatically replay a failed turn. `settings.json` sets retries to 3.
- `omp-config/models.yml` only configures local Ollama discovery. Cloud pricing/model definitions are external runtime catalogs. Pi's OpenRouter model store entries use `openai-completions` at `https://openrouter.ai/api/v1`; their catalog compatibility flags say `supportsDeveloperRole: false` and `sendSessionAffinityHeaders: true`.

## Price facts

The first tuple in each row is **uncached input / cached input / output / cache write**. `—` means no separately documented price, not zero. OpenAI's API prices are short-context unless noted; its long-context rates apply once input exceeds 272k tokens. “Catalog” is the observed local per-MTok estimate, not a bill.

| Configured route / exact model | Provider-published API rates | Local runtime catalog estimate | Billing/price caveat |
|---|---|---|---|
| `openai-codex/gpt-6-sol` | OpenAI direct API: **$2 / $0.20 / $10 / $2.50**; >272k: **$4 / $0.40 / $15 / $5** | OMP `openai-codex` row: **$2 / $0.20 / $10 / $0** | OpenAI's exact `gpt-6-sol` public API model page/pricing exposes all four prices. The configured provider is instead `openai-codex-responses` at `chatgpt.com/backend-api`; do not apply direct API metering to the Codex subscription route. |
| `openai-codex/gpt-6-luna` | OpenAI direct API: **$0.10 / $0.01 / $0.50 / $0.125**; >272k: **$0.20 / $0.02 / $0.75 / $0.25** | OMP `openai-codex` row: **$0.10 / $0.01 / $0.50 / $0** | Same direct-API vs Codex-subscription distinction. |
| `openai-codex/gpt-6-astra` | OpenAI direct API: **$10 / $1 / $50 / $12.50**; >272k: **$20 / $2 / $75 / $25** | OMP `openai-codex` row: **$10 / $1 / $50 / $0** | Same distinction. GPT-6 models are exact matches in OpenAI's public model/pricing docs; subscription spend is not tokenized by this table. |
| `xai-oauth/grok-4.7` | xAI API: <200k prompt **$2 / $0.50 / $6 / —**; ≥200k **$4 / $1 / $12 / —** | OMP `xai-oauth` row: **$2 / $0.50 / $6 / $0** | xAI documents cached input and output rates, but does not itemize a cache-write rate in its pricing table. The exact runtime provider is `xai-oauth` (Responses-compatible API at `api.x.ai/v1`); public API list rates do not establish OAuth/subscription spend. |
| `anthropic/claude-opus-5-5` | Anthropic API: **$4 / $0.20 / $20 / $5 (5m) or $8 (1h)** | OMP `anthropic` row: **$4 / $0.20 / $20 / $5** | Exact model appears in Anthropic's pricing and cache tables. The runtime catalog has one cache-write price, so it does not represent the 1h tier. |
| `openrouter/deepseek/deepseek-v4.1-flash` | OpenRouter exact model page's HTML metadata observed: **$0.04 input / $1.00 output**. OpenRouter's DeepSeek cache guidance says read = **0.1× input** and write = **1× input**; applied to that page snapshot this is **$0.004 read / $0.04 write**. | Pi `models-store.json`: **$0.15 / $0.003 / $0.60 / $0** | **Conflicting evidence:** the exact model-page metadata and the pi catalog disagree on input/output; the pi read price is not 0.1× its catalog input, and its `cacheWrite: 0` contradicts OpenRouter's documented DeepSeek write rule. OpenRouter serves multiple endpoints for this model, and the local mirror can be stale; the exact active upstream endpoint/price cannot be resolved from static configuration. Do not choose or average these rates. |
| `openrouter/inception/mercury-2.5` | OpenRouter model listing: **$0.04 / $0.004 / $0.15 / —** | Pi `models-store.json`: **$0.04 / $0.004 / $0.15 / $0** | Input/output and cache-read values agree. The model page/pricing evidence does not expose a cache-write charge or TTL; catalog zero is not proof that writes are free. |

Sources for OpenAI: [API pricing](https://developers.openai.com/api/docs/pricing), [GPT-6 Sol](https://developers.openai.com/api/docs/models/gpt-6-sol), [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra). For Anthropic: [model/cache pricing](https://platform.claude.com/docs/en/about-claude/pricing), [prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching). For xAI: [pricing](https://docs.x.ai/developers/pricing), [prompt caching](https://docs.x.ai/developers/advanced-api-usage/prompt-caching), [cache usage and pricing](https://docs.x.ai/developers/advanced-api-usage/prompt-caching/usage-and-pricing). For OpenRouter: [DeepSeek V4.1 Flash](https://openrouter.ai/deepseek/deepseek-v4.1-flash), [Mercury 2.5](https://openrouter.ai/inception/mercury-2.5), [prompt caching/routing](https://openrouter.ai/docs/guides/best-practices/prompt-caching), [public pricing fields](https://openrouter.ai/docs/client-sdks/typescript/models/publicpricing).

## Cache behavior and stable request layout

### OpenAI GPT-6 (public Responses API docs)

- Automatic prompt caching is on by default for supported models. GPT-5.6-and-later minimum cacheable prefix is 1,024 visible input tokens; GPT-6 has a 30-minute cache lifetime. Stable matching is over the fully rendered prefix, including developer instructions, tool definitions/order, conversation history, and relevant settings. Keep stable instructions and tool schemas first and unchanged, append turns, and put dynamic/task-specific material later. Changing model/tools or rewriting prior prefix content breaks reuse from that point.
- GPT-6 direct API cache writes cost 1.25× uncached input and reads are priced by model (shown above); reasoning tokens are output tokens for billing. The ≥272k price tier is separate from cache TTL.
- For Responses continuity, preserve and replay the full prior `output` array, including encrypted reasoning items and assistant `phase`; on supported models `reasoning.context: "all_turns"` can carry reasoning into later turns. To change effort without rewriting the cached prefix, append a `configuration_update` item rather than changing top-level effort. See [reasoning](https://developers.openai.com/api/docs/guides/reasoning) and [conversation state](https://developers.openai.com/api/docs/guides/conversation-state).
- **Route caveat:** the docs describe OpenAI's public API. The configured OMP model-cache rows identify `openai-codex-responses` at `https://chatgpt.com/backend-api`, not the public `openai` API. Public docs establish model/cache semantics and API list prices, not that the Codex subscription endpoint exposes identical cache accounting or bills per token.

### Anthropic Claude Opus 5.5 (Messages API)

- Automatic caching is available through top-level `cache_control`; explicit breakpoints put `cache_control` on content blocks. Cache covers the full ordered prefix `tools`, then `system`, then `messages`, through the selected breakpoint. Preserve that layout and put changing content after the reusable prefix.
- Default TTL is 5 minutes and refresh-on-hit costs no extra write; `ttl: "1h"` is available at higher write price. Exact minimum for Opus 5.5 is **512 tokens**. Cache reads/writes are separately reported in usage.

### xAI Grok 4.7 (Responses-compatible route)

- xAI automatically caches consecutive requests whose starting messages are identical. Keep the opening messages stable; xAI recommends the `x-grok-conv-id` header (and documents `prompt_cache_key`) to improve hit rate. Responses usage reports `input_tokens_details.cached_tokens`.
- The public pricing page has short/long input, cached input, and output rates, but no separate write price/TTL/minimum for this exact model. OMP's catalog `cacheWrite: 0` is only a display estimate.

### OpenRouter DeepSeek Flash / Mercury 2.5 (Chat Completions)

- Both pi catalog entries use ordered `messages[]` and support session-affinity headers; the catalog says these models do not support the `developer` role. Keep opening system/user content and tool declarations stable; avoid changing roles/order for a reusable prefix.
- OpenRouter's caching doc describes automatic DeepSeek caching; it recommends same-session routing, and supports `session_id` (body) or `x-session-id` (header, up to 256 characters). A sticky session expires after 10 minutes of inactivity. Cache writes/reads can be observed through usage `cache_write_tokens`, `cached_tokens`, and `cache_discount`.
- That document does not provide a Mercury-specific cache TTL/minimum or write price. It gives DeepSeek's general cache pricing rule, but it conflicts with the observed static catalog for this exact model as detailed above. `pi-config/extensions/openrouter-live/live.ts` only appends missing models, never updates an existing model entry; its price mapper turns absent price fields into zero. Thus a catalog zero may mean “not supplied,” not “free,” and its additive-only behavior cannot correct stale prices for already-known configured routes.

## Ownership and recommended next actions

1. **Keep configuration and billing authority distinct.** `omp-config/config.yml` owns OMP roles/fallback chains; `omp-config/models.yml` is only local Ollama. Pi's `settings.json` owns default model/thinking settings; `extensions/failover/index.ts` owns its chain; `extensions/openrouter-live/` owns additive catalog discovery, not live billing. Do not edit provider prices into config or treat model catalog costs as actual task spend.
2. **Safe, semantics-preserving runtime opportunity:** where the provider/API supports it, retain a stable leading instruction/tool prefix and append dynamic task content; use a stable session identifier for xAI/OpenRouter where supported. For Anthropic caching, only use documented `cache_control` on the Messages adapter and observe TTL/minimum. For Responses reasoning, preserve all prior output items. This belongs in the actual request-generation clients, not these route/config files.
3. **Measure actual spend before ranking changes:** per completed task, retain provider/model/upstream endpoint and usage categories (uncached input, cache reads, writes, output/reasoning, reported USD). For OpenRouter record selected upstream and response cost/cache usage. For OpenAI Codex and xAI OAuth subscriptions use account-plan/overage billing or usage limits, not invented per-token costs. No invoices or provider usage ledgers were read here, so realized subscription spend is **unavailable**.
4. **Keep further model, routing, effort, history reduction, and delegation changes proposal-only/off by default** until paired task-quality evaluation supports promotion. The operator subsequently approved the advisor-specific chain above; this pricing investigation does not establish its quality parity.

## Exact-model evidence gaps

- OpenAI public API pricing and caching are exact for GPT-6 Sol/Luna/Astra, but the deployed OMP route is the distinct Codex Responses subscription backend. Its actual subscription allocation/cache billing is not evidenced here.
- xAI docs expose Grok 4.7 input/cache-read/output rates by context tier, but not cache-write price, TTL, or minimum. The OAuth route's realized billing is unknown.
- Anthropic exposes exact Opus 5.5 base/cache prices, TTLs, and a 512-token minimum; runtime catalog only carries the 5m write value.
- OpenRouter's exact DeepSeek page and pi's existing cached model entry disagree on listed prices, and the DeepSeek generic cache formula disagrees with catalog cache fields. A provider-specific current quote for the upstream actually selected is unresolved; no API request was made.
- Mercury's exact input/output and cache-read values are documented/cataloged, but exact-model cache-write price and TTL/minimum are not exposed in the inspected docs. Runtime zero is not a documented free write.
- No realized per-task provider invoices, subscription allocations, or cache usage ledger were examined. Catalog rates are estimates, not realized spend.

**Observed local evidence:** `omp-config/config.yml`, `omp-config/models.yml`, `pi-config/settings.json`, `pi-config/extensions/failover/index.ts`, `pi-config/extensions/openrouter-live/{index.ts,live.ts}`, OMP runtime model cache (`~/.omp/agent/models.db`), and pi runtime catalog (`~/.pi/agent/models-store.json`). No prompts, transcripts, credentials, or provider account records are part of this report.
