# 0014: Live evidence for account routing

- **Status:** accepted
- **Date:** 2026-10-23
- **Primitives:** `guidance`

## Context

[Upkeep issue 208](https://github.com/misty-step/upkeep/issues/208) records a Codex exhaustion observation from October 21 that Home, Heartbeat, and lanes repeated for two days. A successful call on October 23 disproved the routing assumption after a plan upgrade.

The [previous workstation guidance](https://github.com/misty-step/harness/blob/c97cda01/agent-config/guidance/workstation.md) embedded a dated availability sentence and an exhaustion reset clock beside dispatch instructions. Although it also called for live checks, that placement let a one-time reading act as routing truth. The issue documents the stale routing assumption; the source shows how temporary state entered durable instructions. Neither establishes the cause of every later routing choice.

## Decision

[Account routing guidance](../../agent-config/guidance/workstation.md) preserves the operator rule from [PR 492](https://github.com/misty-step/harness/pull/492) verbatim. Availability claims belong in neither instruction files nor handoffs, memory, or briefs. An out claim requires a sourced reading under fifteen minutes old. Until room ships, one tiny probe call on the account supplies evidence. When available, `upkeep room --json` is the normal lookup before choosing an account. Upkeep owns the observations and their freshness. Guidance owns the lookup rule and durable routing restrictions, without another roster or credential map.

Missing or stale quota stays unknown. Quota observations expire after ten minutes. When quota reads fail, the command supplies tiny native probe evidence cached for at most fifteen minutes. Only a fresh provider limit proves exhaustion. A successful probe proves that the call works, without inventing quota percentages; infrastructure and authentication failures prove neither exhaustion nor recovery.

## Consequences

Instruction and brief outage prose cannot establish current availability. The [policy probe](../../scripts/probe-agent-policy) rejects calendar- or clock-qualified availability language in owned shared guidance. Historical records retain incident dates outside that instruction source.

The room command's implementation and multi-host proof belong to issue 208. This change adds no runtime path and does not establish that the command is deployed. Live rollout remains with the parent. The interim native-probe rule preserves routing before room ships. Use the [isolated install and fresh-session verification route](../../.agents/skills/verify-harness/features/fresh-session.md), then verify deployed guidance through the same skill after authorized installation.

Revisit this decision if Upkeep changes its observation freshness or evidence contract.
