# Model and effort routing: decision brief

Research observed 2026-09-27. Source candidate:
`c097da8b113ebe14a509619c8b0fa4812c124c46`; installed OMP: `18.3.1`.
Branch: `phaedrus/model-effort-routing-review`.

**Status: research input to HARNESS RETHINK, not an accepted policy or rollout.**
Keep US-014 effective until Phaedrus explicitly approves a policy change and
paired task-quality evidence supports promotion. The original request prohibited
edits, installs, account changes, restarts, OpenRouter spend and a broad eval.
The subsequent wrap-up request authorizes committing and pushing this brief and
its [resume note](model-effort-routing-resume.md), not changing runtime routing.

## 1. Context and forcing function

The observed OMP account has exhausted its **general weekly Anthropic bucket**,
not its sampled five-hour bucket. The latest cached snapshot inspected, at
2026-09-27 00:28:28 UTC, reports:

| Bucket | Used | Status | Reset |
| --- | ---: | --- | --- |
| General five-hour | 0% | OK | Not reported in this snapshot |
| General seven-day | 100% | Exhausted | September 29, approximately 20:00 UTC |
| Fable-specific seven-day | 14% | OK | Same weekly reset |

In `[2026-09-26T00:04:43.340Z, 2026-09-27T00:04:43.340Z)`, 24 five-hour
snapshots peaked at 40%; 24 general-weekly snapshots included five exhausted
readings; 23 Fable-weekly snapshots peaked at 14%. One Anthropic account key was
represented. These are cached samples, not continuous monitoring or evidence
covering every account. Spare model-specific capacity is not spare general
capacity. Whether Phaedrus was looking at the model-specific bucket is unknown.
Anthropic documents independent [five-hour and weekly limits][claude-limits].

Source-owned settings match deployed configuration and native `omp config get`:
Opus medium orchestrates; Sol workers use max; Luna scouts/mechanical/advisor
roles use max; Astra planning/review uses high, security review max; Grok sits
late in recovery chains, followed by paid OpenRouter. Visual roles fail closed
on Opus. Native `tiny` prepends the local model. The extra deployed `web` role
and chain are preserved foreign/native settings, not source drift.

Existing sessions retain selections. A new default does not retune an existing
parent or remap workers. Task dispatch chooses agents, not a per-item arbitrary
model; `task.agentModelOverrides` precedes agent frontmatter. A main session
started with a model alias still follows its session's default recovery chain.
See [current routing documentation](../omp-config/README.md#model-routing-us-014)
and [source config](../omp-config/config.yml).

### Representative usage, not a quality experiment

The existing offline analyzer was run with a manifest passed through stdin,
using three explicitly selected trees: creative/launch work, infrastructure
release-quality work, and harness research. At approximately 00:30 UTC on
September 27, it read **46 files** and counted **8,304 recorded responses**:

| Provider/model | Recorded responses | Share of 6,747 non-auxiliary responses |
| --- | ---: | ---: |
| Anthropic Opus 5.5 | 2,297 | 34.0% |
| Codex Sol | 2,346 | 34.8% |
| Codex Luna | 1,100 | 16.3% |
| Codex Astra | 712 | 10.6% |
| xAI OAuth Grok 4.7 | 286 | 4.2% |
| Antigravity Gemini | 6 | 0.1% |
| OpenRouter JEV, auxiliary | 1,557 | Excluded from this denominator |

All three task outcomes are **unknown**. Recorded catalog value was
**$578.388808**, not an invoice, realized subscription spend or cost per
successful task. The analyzer flagged 58 error/aborted response records; these
are not 58 failed tasks or 58 confirmed rate-limit errors. No model requests
were made by the offline analyzer.

A separate metadata-only pass over the same active trees found Sol session
effort uniformly max, roughly three-quarters of Opus responses at max, Luna
mostly in advisors, and Grok in advisors and parent recovery but not workers.
Advisor effort was often unrecorded. Active files changed between passes, so
these are adjacent snapshots, not one frozen export. Session effort records are
not wire captures. The inspected assistant timestamps span approximately
September 25 14:23 UTC through September 27 00:31 UTC; this is a convenience
sample, not a complete fleet-day population.

**What follows:** Luna is not idle in this sample; Grok has no regular worker
assignment here. **What does not follow:** max was unnecessary, lower effort
would preserve quality, or these tasks caused weekly exhaustion. Lowering Sol
max would change Codex consumption, not directly replenish Anthropic quota.

### Hermes and cash are separate evidence

Kaylee's Hermes logs contain genuine Anthropic HTTP 429 `rate_limit_error`
responses, including a recorded 600-second retry. The messages do not identify
a five-hour or weekly bucket, and account identity was not correlated with
OMP. Do not attribute these errors to the OMP-observed subscription.

For the recent 24-hour window above, Kaylee's session table reported 16 sessions,
412 API calls and $27.614029 estimated cost, with actual cost NULL. Its separate
per-model table reported 505 calls, so these counters do not provide a reconciled
request ledger or cash total. The root Hermes database was not the relevant
profile database. Kaylee's config changed concurrently during the audit to
include Grok before Sol; that belongs to the Hermes fallback owner.

The earlier [September 24 accounting](token-efficiency.md) remains separate:
five roots, all outcomes unknown, $157.3163 catalog-valued. Its historical routing
and [provider appendix](token-efficiency-providers.md) must not override current
config: today's advisor chain places Gemini before Grok. No invoice or settled
subscription-overage ledger was established in either audit.

## 2. Invariants and verified support

- Phaedrus's proposed constraint: **Grok always xhigh; Luna always xhigh or max**.
  Current US-014 still mandates Sol/Luna max and Grok-last; revising it requires
  operator approval, not a documentation correction.
- Native catalog plus version-matched adapter source support low, medium, high,
  xhigh and max for Opus 5.5 and all three GPT-6 models. Codex serializes supported
  levels as `reasoning.effort`; Anthropic uses `output_config.effort`.
- Grok 4.7 supports **xhigh, not a distinct max tier**. Its specific OMP mapping
  preserves xhigh; the broader older-Grok mapping must not be applied to it.
  Native CLI lists minimal/low/medium/high/xhigh, with minimal mapped to low.
  No new inference payload capture was performed. See [xAI reasoning][xai-effort],
  [Anthropic effort][claude-effort], and [OpenAI Sol][sol], [Luna][luna], [Astra][astra].
- A direct authenticated GET to the native xAI OAuth billing endpoint returned
  HTTP 200 and response-reported weekly utilization of 14%; the unified monthly
  endpoint also returned HTTP 200. No refresh, login, inference or account
  mutation occurred. The printed monthly evidence did not establish allocation,
  overage spend or fully validated available allowance. This proves authenticated
  billing access, not inference reliability or task-quality parity. Historical
  sample metadata separately contains 286 Grok responses without error/abort.
- Preserve independent verification, Opus-only visual judgment, credentials,
  foreign settings and existing sessions. Enabled credential rows do not prove
  distinct usable subscriptions. Public API prices are not OAuth cash charges.
- OMP policy stays here; Kaylee's engineer owns Hermes fallback; the System 1
  engineer owns JEV/helper routing. Neither other checkout was modified. Removing
  OMP model fallback to OpenRouter would not disable separately billed helpers.

## 3. Candidate paths

**A — Hold current policy.** Preserve US-014, max Sol workers and Grok-last
recovery. No behavior change or unproven quality tradeoff, but preserves current
quota exposure and automatic paid recovery.

**B — Evaluate task/risk routing through native roles.** Keep Opus medium
orchestration, test lower effort on specified execution, and give Grok a bounded
mechanical-work assignment. Candidate mapping, not authorization:

| Work | Candidate route |
| --- | --- |
| Read-only scoping, extraction, advisor | Luna max |
| Mechanical edits, VCS, repetitive operations | Grok 4.7 xhigh via sonic/commit |
| Specified implementation | Sol medium; low for trivial bounded work, high for uncertain brownfield work |
| Straightforward text/spec work | Opus low/medium |
| Bounded analysis | Astra low/medium; planning and independent review high |
| Hidden-edge/security work | High/xhigh; max for explicitly critical autonomous work |
| Visual/design judgment | Opus high or above, fail closed |

Effort exceptions beyond fixed roles need explicit native selection; this brief
does not invent per-item subagent model controls. HARNESS RETHINK owns that design.

**C — Cross-harness quota scheduler.** Coordinate provider/account budgets and
concurrency across OMP and Hermes. This could improve allocation if cross-harness
contention is established, but adds shared state, stale-quota decisions and an
operational owner. Do not build it from the current sample alone.

## 4. Tradeoff matrix

| Path | Reversibility | Blast radius | Effort | Operational cost | Primary risk |
| --- | --- | --- | --- | --- | --- |
| A: Hold policy | Two-way door | None initially | None | Existing quota pressure/recovery | Exhaustion and paid spillover remain |
| B: Gated native routing | Two-way door | OMP roles, guidance, story contract | Small patch after paired validation | Low; explicit assignments | Unproven quality or rework regression |
| C: Quota scheduler | Two-way, costly rollback | OMP, Hermes, account scheduling | Substantial | High; shared state and ownership | Misattribution, stale limits or stalled work |

## 5. Recommendation and decision boundary

**Recommend evaluating B while holding A effective.** Promotion needs both
Phaedrus's explicit policy override and paired task-quality evidence. This
supersedes any reading of the initial conversational recommendation as approval
to lower effort immediately. HARNESS RETHINK may supersede B entirely.

The [effort article][effort-article] supports a hypothesis: specified builds can
work well at low effort; independent verification and hidden edges justify high;
max can consume more time/tokens and make more assumptions. It does not prove
quality parity on this workload or rank Grok/Luna against Sol.

Candidate fallback policy: prefer another eligible subscription provider on
account exhaustion; do not count Sol-to-Luna as independent account capacity.
Honor the exhausted bucket's reset: a five-hour reset cannot clear a weekly cap.
An unidentified 429 stays unidentified. Preserve reviewer capability and visual
restrictions rather than silently degrading. Propose explicit, budgeted approval
for cash recovery rather than automatic OpenRouter spillover; helper billing
requires a separate agreement with its owner.

Select A without evaluation if stability outweighs the potential benefit.
Consider C only if native handling and measured B results still leave material
cross-harness contention.

**Smallest optional bake-off:** two fixed tasks, one mechanical change and one
small hidden-edge bug, across Sol max, Sol medium, Luna max and Grok xhigh: eight
bounded attempts. Same acceptance checks, blind Astra-high review, whole-tree
latency/tokens/rework; subscription-only with paid helpers disabled. Include
failed attempts and do not infer success from final messages. This consumes
subscription quota and needs separate approval. No bake-off was run.

## 6. Next action upon approval

First let HARNESS RETHINK choose whether this hypothesis survives radical
simplification and its subagent-control design. Do not deploy this branch.
If Phaedrus authorizes the bounded evaluation, run it before promoting role changes.

If evidence then supports B and Phaedrus approves the policy override, the minimal
source patch would change `omp-config/config.yml` as follows:

- `modelRoles.task`: `openai-codex/gpt-6-sol:max` to `openai-codex/gpt-6-sol:medium`.
- `modelRoles.commit`: `openai-codex/gpt-6-luna:max` to `xai-oauth/grok-4.7:xhigh`.
- `task.agentModelOverrides.sonic`: `@smol` to `@commit`.
- Revise role-specific fallback chains under the separately approved cash policy.

Update US-014, source guidance and routing docs in the same change. Verify native
resolution, effective effort and quota/outage behavior before a separately
approved deployment. No such policy/configuration changes were made here.

[claude-limits]: https://support.claude.com/en/articles/11049741-what-is-the-max-plan
[effort-article]: https://claude.dev/blog/spending-your-effort/
[claude-effort]: https://platform.claude.com/docs/en/build-with-claude/effort
[xai-effort]: https://docs.x.ai/developers/model-capabilities/text/reasoning
[sol]: https://developers.openai.com/api/docs/models/gpt-6-sol
[luna]: https://developers.openai.com/api/docs/models/gpt-6-luna
[astra]: https://developers.openai.com/api/docs/models/gpt-6-astra
