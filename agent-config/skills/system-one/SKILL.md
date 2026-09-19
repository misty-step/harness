---
name: system-one
description: Use TypeSafe Jev (System One) for typed decisions.
version: 0.2.0
license: MIT
---

# System One

Jev returns typed probabilities. It does not generate text, trees, or plans.
Code owns control flow, arithmetic, credentials, and side effects.

Live TypeSafe docs are the API source of truth. Do not copy endpoint shapes
from memory. Start at https://docs.typesafe.ai/llms.txt and read only the
pages this task needs (append `.md` to docs paths).

## When to Use

- A feature needs a semantic judgment code cannot express (route, rank, verify, select).
- An LLM classify-and-parse step can become a typed decision.
- Brainstorming where Jev could replace slow generation.
- Changing OpenRouter or TypeSafe Jev calls in this fleet.
- Wiring compaction advice or a post-run child verdict; the shared judge and
  `jev-verdict` are described in [references/fleet.md](references/fleet.md).

Don't use for: writing prose; counting, dates, or money math; Hermes tool
permission gates; generating UI trees or patches.

## Procedure

1. **Name the judgment, not the HTTP call.** What will software show, select,
   change, or hand off? Keep known rules in code.
   Done when: one sentence for the job, plus what stays deterministic.

2. **Read current docs for this task.** Fetch the docs index, then the
   primitive and cookbook pages that match. If docs are unreachable, say so
   and do not invent request fields.
   Done when: the pages you will follow are named.

3. **Write questions.** One snap judgment per question. Pick Choice, Score, or
   Noul by the answer shape. Put complete meaning in `instructions` (IDs are
   for code only). Include an escape option on Choice. Ask every independent
   question in one request, including speculative ones. A second request is
   only when the first answer is required to fetch evidence or build options.
   Read [references/questions.md](references/questions.md) before writing
   criteria. Keep questions in one file; keep weights and thresholds in code
   beside them.
   Done when: that file exists and every question is independently answerable
   from the state.

4. **Call through existing wiring.** Do not paste a new fetch client.
   Auth, model pin, Hermes vs harness policy:
   [references/fleet.md](references/fleet.md).
   Done when: the call uses OpenRouter or the deployed engine.

5. **Compose answers in code.** Thresholds and weights are yours. Low
   confidence is "I don't know", not a medium score. Noul has no confidence
   field. Unused speculative answers stay unused.
   Done when: every branch has an explicit fallback if the call fails or
   confidence is low.

6. **Verify on real state.** One live call, elapsed time recorded, timeout
   path exercised without a blank screen or a blocked Hermes tool. Tune
   thresholds on our data, not cookbook defaults.
   Done when: success path and fail-open path both ran.

## Pitfalls

- Asking Jev to generate, plan, or emit a tree. Select from candidates code already built.
- One question per HTTP call. Batch.
- Snapshotting API fields from this skill. Docs win.
- Treating Jev as a Hermes `pre_tool_call` veto. Advisory only there.
- Copying TypeSafe cookbook thresholds into production.

## Verification

A default path exists if Jev is down. Answers are logged with id, type, value,
and confidence when present. Docs pages used are named in the change.
