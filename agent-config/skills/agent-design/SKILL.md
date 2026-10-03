---
name: agent-design
description: Use only when building or changing an agent's prompts, skills, tools, or context loading.
---

# Agent design

Skills load name/description first, body on activation, references on demand.
Keep startup text to intent and non-obvious facts, not another process manual.
Stable instructions/tools belong at the prefix; volatile task state at the end.
Reordering tools or injecting early timestamps can destroy prompt-cache reuse.

Models author messages; code owns mechanics. Role prose is not a permission
boundary: enforce it in tool scope/config/credentials. Prefer native task/session
state over a second ledger. Provider APIs and measured usage, not guesses, own
caching facts.
