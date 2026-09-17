---
name: agent-ergonomics
description: Synthesize grounded agent-ergonomics findings into prioritized improvements in the project's existing backlog and roadmap.
disable-model-invocation: true
---

# Agent ergonomics

Evaluate how effectively an agent or engineer can understand, modify, and verify
this project with minimal friction and resource overhead.

## Principles

1. **Single source of truth:** Repository code, tests, and versioned docs define
   technical reality. Avoid competing stores of truth or fragmented conventions.
2. **Structural guardrails over warnings:** Prefer pokayoke (types, missing
   affordances, fail-closed checks) over advisory documentation or warnings.
3. **Discoverable contracts:** Keep interfaces compact and purposeful. Ensure
   developer workflows (build, test, verify) are discoverable and deterministic.
4. **Actionable diagnostics:** Errors must explain what failed, the violated
   invariant, and how to recover.

## Output

Synthesize grounded findings into prioritized, concrete improvements integrated
directly into the project's existing roadmap or backlog. Reconcile existing work;
do not generate speculative work, duplicate tickets, or wording churn.
