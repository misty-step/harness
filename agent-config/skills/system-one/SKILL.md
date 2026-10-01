---
name: system-one
description: Use TypeSafe Jev for typed semantic decisions, not prose generation.
version: 0.2.0
license: MIT
---

# System One

Jev supplies typed probabilities. Code owns deterministic rules, arithmetic,
control flow, credentials, and side effects. Use it for a semantic judgment
that code cannot express, or to replace classify-and-parse generation; candidate
messages, trees, and plans are authored elsewhere.

Live API source: https://docs.typesafe.ai/llms.txt. Follow only relevant primitive
and cookbook pages (append `.md` to doc paths); unreachable docs are a missing
prerequisite, not a reason to invent request fields.

Name the software outcome and what stays deterministic. Before writing criteria,
read [references/questions.md](references/questions.md). Give each independent
judgment one question, batch independent questions against the same state, and
keep complete meaning in `instructions` rather than IDs. Put questions together;
weights and thresholds belong in code.

Reuse deployed wiring; [references/fleet.md](references/fleet.md) holds auth,
model, and harness/Hermes differences. Choice/Score confidence is distribution
uncertainty, not workflow correctness; Noul has no confidence field. Low
confidence needs an explicit fallback, not a pretend middle score.

Exercise a live decision on real state and its timeout/low-confidence path,
record elapsed time, and tune thresholds against our cases. Retain a usable
default when Jev is down; a Hermes advisory judgment never becomes a tool veto.
Report the docs used and observed answers (`id`, type, value, confidence where
present), without secrets in state.
