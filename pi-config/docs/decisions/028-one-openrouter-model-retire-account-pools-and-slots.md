# ADR-028: One OpenRouter model; retire account pools and slots

- **Status:** accepted
- **Date:** 2026-10-24
- **Primitives:** `pi-config`, `pi-extensions`

## Context

Pi carried three layers of custom model routing: pooled providers
(`openai-pool`, `xai-pool`, `openrouter-pool`), extra account slots
(`openai-2`…`-4`, `openai-codex-2`…`-4`, `xai-2`, `openrouter-2`), and a
forward-only failover chain built on those pool models (ADR-011, ADR-024,
ADR-026, ADR-027). The machinery existed to stretch subscription capacity
across accounts. The operator now wants one cheap OpenRouter model as the
default everywhere and no bespoke pooling to maintain.

## Decision

Every fresh Pi session defaults to OpenRouter
`deepseek/deepseek-v4.1-flash-1017` at max. Retire the failover extension and
the accounts extension with their pool/slot providers, shared block state and
effort pins. Stock Pi owns same-model retry and compaction. Switching models is
an explicit user choice, and the OpenRouter key remains the only Pi credential
this repo owns.

## Consequences

Pi loses automatic model switching, multi-account rotation and the route guard
that refused Anthropic and Cursor selections; those protections were properties
of the removed extensions. Installations clean-replace the retired packages and
drop pooled effort pins from the live settings, while preserving foreign
provider pins. Historical records 011 and 024–027 stay as history. Revisit if
OpenRouter stops serving the model, or if one key's budget stops covering
interactive work; re-proposing pooling requires a new accepted record.
