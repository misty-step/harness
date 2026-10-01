# Official Jev skill adoption

Serves [US-002 Deploy shared primitives](../USER_STORIES.md#us-002-deploy-shared-primitives).

## Source and ownership

TypeSafe publishes an official agent skill. Discovery started at
[docs.typesafe.ai](https://docs.typesafe.ai) and its
[llms.txt](https://docs.typesafe.ai/llms.txt), whose
[agent-skill page](https://docs.typesafe.ai/agent-skill.md) links to
[`typesafe-ai/skills`](https://github.com/typesafe-ai/skills).
The GitHub organization also publishes the official SDKs:
[`@typesafe-ai/sdk`](https://www.npmjs.com/package/@typesafe-ai/sdk) (0.6.0)
and [`typesafe-sdk`](https://pypi.org/project/typesafe-sdk/) (0.7.2), observed
2026-10-01. SDK packages are not the skill.

The complete upstream skill directory is vendored unmodified at
`agent-config/skills/typesafe-ai/`, revision
`65a39f393687675ce170e6094757de20370365b9`, with its MIT license.
SHA-256: `SKILL.md` =
`71ea90d7906c6554c4f4c460ef7361b2d26f59116ccdae986dc6d997b9389f52`;
`LICENSE` = `835f233f1d6ed84a9b9a351aba0689b47644a4137d6316911fc7957bde523b02`.
Both installers already select all shared skills. `system-one` now owns only
fleet wiring; its duplicated question-design reference is removed.
Shared guidance loads the official skill plus that companion for semantic judgments.

Jev is a general-purpose typed decision model, not a model router or prose
writer. Upstream owns question design and confidence semantics. Fleet calls use
[OpenRouter Decisions](https://openrouter.ai/docs/guides/community/jev), with
`typesafe/jev-1.13`; upstream direct-endpoint examples are not fleet transport.
No direct TypeSafe credential, new SDK, or registry installation is needed.

## Observed acceptance

On 2026-10-01 the normal OMP installer selected
`skill:typesafe-ai skill:system-one guidance`. A fresh, no-session OMP engineer
(`openai-codex/gpt-6.1-sol`, OMP 18.4.9) discovered and read
`skill://typesafe-ai`, `skill://system-one`, and the fleet reference, then read
the live TypeSafe and OpenRouter docs. One real batched request to
`POST https://openrouter.ai/api/alpha/decisions` returned HTTP 200 in **428 ms**:

- Resolved model: `typesafe/jev-1.13-20260917`.
- Choice owner: `harness`, confidence **1**.
- Noul requires prose for the assessment: **0.16**, no confidence field.
- Score suitability: **0.78**; numeric Score confidence asserted by the caller.
- Caller asserted all three answer types and HTTP success. The console truncated
  the long response line; its remaining confidence, request ID, and cost were
  not retained. No inference is made from missing evidence.

The author also used the official skill to judge the alert-triage proposal in
one real call: HTTP 200, **573 ms**, request
`gen-dec-1790887828-ptLikJuT9ZmTOjooJAtk`, provider `TypeSafe`, same resolved model.
Choice selected `classification` (confidence **0.99**), Noul separability **0.82**,
Score reduced agent work **1.96** (confidence **0.94**). Usage: **528 input tokens**,
**77 output tokens**, **$0.000022176**. These are smoke observations, not quality,
latency, calibration, or cost guarantees for the proposed workflows.

The repository's old OpenRouter pass reference did not resolve. `.env.pass` now
uses the existing dedicated harness Jev-evaluation entry; credential injection
and the live call succeeded. No credential was created, rotated, or revoked.

## Ranked opportunities

Proposals, not authorization to change these products. Rank favors saved agent
turns, bounded evidence, and reversible advice. Each call uses only the needed
state; evaluate representative cases before replacing an agent. Uncertainty or
service failure retains the agent path. Code owns exact lookups, eligibility,
permissions, arithmetic, writes, and side effects.

| Rank | Workflow/product | Value | Cost and boundary |
| --- | --- | --- | --- |
| 1 | Alert noise versus incident | Reserve agent investigation and authored incident narrative for real/ambiguous alerts. | One batched Choice per normalized alert set; labeled noise/incident calibration; uncertain alerts still escalate. |
| 2 | Board item routing | Choose the owning project/workstream from declared candidates without an exploratory agent turn. | One Choice over bounded item/context and candidate descriptions; keep no-match; code owns placement and authority. |
| 3 | Habitat semantic ticket duplicates (already uses Jev) | Catch equivalent requests without an investigator agent; sharpen calibration rather than add a second classifier. | Existing title/detail passes over live tickets, batches up to 100 questions; failures are unavailable, not “no duplicates”; no mutation. |
| 4 | Habitat tag merges (already uses Jev) | Suggest concept-equivalent tags without an agent comparing names. | Existing scan caps 200 candidate pairs, 25 per batch: up to eight uncached calls; review/authorized merge stays separate. |
| 5 | Substantive closure review | Check whether a linked postmortem addresses the incident and prevention claim. | One call per selected incident with fetched evidence; missing links, merge receipts, and pagination stay deterministic; advisory only. |
| 6 | Memory/skill curation | Rank stale or duplicate candidates before Kaylee spends a full review turn. | One bounded batch of Scores/Nouls over candidate snippets; false-positive audit; no model-driven deletion. |
| 7 | Completion-claim evidence matching | Flag claims unsupported by supplied receipts before deeper agent review. | One question per claim in a bounded evidence packet; code verifies SHA/CI/deployment facts; uncertain means inspect, never pass. |
| 8 | Mail action classification | Separate routine FYI from actionable messages so agent attention goes to execution and reply drafting. | One batched Choice per message shortlist; privacy/false-negative evaluation; no autonomous sending or deletion. |

Existing Habitat use is evidenced by `src/lib/work/duplicate-check.ts` and
`src/lib/tags/similar.ts` in its owning repository; this adoption does not change
them. The remaining entries are proposed decision shapes, not claims that current
Hermes master contains the older factory/alert plugins or lacks Jev already.

For sizing, the observed OpenRouter call above charged $0.042 per million input
tokens and no output fee. Use each response's `usage.cost`, not this one-call
sample, to budget actual workflows. No agent-cost savings were measured here.
