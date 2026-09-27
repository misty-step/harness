# Resume: model and effort routing research

Handoff to **HARNESS RETHINK**, requested by Kaylee for Phaedrus on 2026-09-27.
Branch: `phaedrus/model-effort-routing-review`.
Read the [qualified decision brief](model-effort-routing-review.md) first.

## State and authority

- Research candidate: `c097da8b113ebe14a509619c8b0fa4812c124c46`; native OMP 18.3.1.
- This branch adds only the brief and this note. No routing, story intent,
  installer, account, subscription or live runtime setting was changed.
- US-014 remains effective. B is a gated hypothesis, not a rollout decision:
  paired quality evidence plus Phaedrus's explicit policy override are required.
- HARNESS RETHINK owns the broader simplification and subagent model-control
  design. This branch is evidence input, not a competing implementation.
- Kaylee's Hermes fallback and the System 1 prototype remain their engineers'
  scope. No other checkout was edited and no owner agreement is implied.
- No bake-off, live deployment, token refresh, login or restart was performed.
  The only authenticated provider probe was read-only xAI billing access.

## Findings worth carrying forward

1. OMP's sampled general Anthropic weekly bucket was exhausted while five-hour
   and Fable-weekly buckets had room. This does not attribute Hermes's generic
   429s to that account or prove the earlier suspected five-hour bottleneck.
2. Source-owned routing and live/native config agree. Existing sessions can
   retain max or manually selected models despite an Opus-medium default.
3. Sol was uniformly max in the convenience sample; Luna mostly served advisors;
   Grok had no worker responses. Unknown task outcomes prohibit quality/savings
   or causal quota conclusions. Lowering Sol cannot directly refill Anthropic.
4. Grok 4.7 has an xhigh ceiling; Luna genuinely supports max. An authenticated
   xAI billing GET returned 200, but monthly allocation/overage and fresh
   inference reliability remain unverified.
5. Automatic paid fallback and separately billed JEV/helpers are distinct spend
   paths. Native role edits alone cannot guarantee zero cash use.

## Reproduction pointers without private content

Native read-only commands used:

```sh
omp --version
omp config get modelRoles --json
omp config get task.agentModelOverrides --json
omp config get retry.fallbackChains --json
omp models find xai-oauth/grok-4.7 --json
omp models find openai-codex/gpt-6-luna --json
omp models find anthropic/claude-opus-5-5 --json
```

Offline accounting used `bun omp-config/bin/omp-task-usage.ts --sessions DIR
--manifest /dev/stdin`, with a version-1 manifest containing the following three
roots relative to the operator's OMP `agent/sessions` directory. Each task had
`outcome: "unknown"`; descendants were included by the existing analyzer.

```text
-Videos-launch-slate/2026-09-26T20-25-16-795Z_01a0df64-befb-730a-8a09-905167508c1d.jsonl
-.herdr-worktrees-infrastructure-phaedrus-nopalito-improvement-loop/2026-09-26T19-56-21-803Z_01a0df4a-45ab-7553-bb2b-c4769f66df74.jsonl
-.herdr-worktrees-harness-phaedrus-system1-harness-prototype/2026-09-25T14-23-10-798Z_01a0d8f2-dfce-73a3-9e6f-60e9ba6816b7.jsonl
```

The files were live, not frozen: a rerun need not reproduce exact totals. Read
only aggregates/metadata; do not publish prompts, tool contents, credentials or
account identifiers. No raw transcripts or provider responses are in Git.

Quota evidence came from OMP `agent.db:usage_history`, grouped by `limit_id`,
not the shared display label `7 Day`. Hermes evidence came from Kaylee's profile
`state.db` and tightly targeted error-log markers, not the root Hermes database.
Current source config outranks historical September 24 routing descriptions.

Provider source inspected was the OMP v18.3.1 catalog and adapters, including
`packages/ai/src/usage/xai-oauth.ts` and
`packages/ai/src/registry/oauth/xai-oauth.ts`. Do not use the normal auth pipeline
for a strict no-refresh probe; never print credential fields or raw headers.

## Remaining decisions and closure

Phaedrus has not approved changed routing, cash-recovery policy or the optional
eight-attempt experiment. HARNESS RETHINK should decide whether to retain, revise
or discard the proposed tiers before asking for that authority.

The closure check before publication reported no leases owned by this session;
foreign/orphaned resources were left untouched. The checkout is not itself an
owned lease. After this branch and both documents are pushed and a final
clean/ignored-state check succeeds, the worktree can be removed without losing
this handoff. Do not remove another engineer's worktree or drop their leases.
