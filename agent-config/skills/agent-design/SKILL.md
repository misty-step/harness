---
name: agent-design
description: Use when briefing another agent or building or changing an agent's prompts, skills, tools, or context loading.
---

# Agent design

Brief an agent as you would a capable coworker, with three things: what to do
(goal, why, links), how much effort to spend, and how to verify it did the right
thing. A child starts blank, so pass those, not your transcript. Skip role-play,
step lists and rules a current model already follows.

Standing context earns its place only with facts that change outcomes: taste,
tool and environment traps, security and credential rules. Skills load
name/description first, body on activation, references on demand; move rare
procedure there. Stable instructions/tools belong at the prefix, volatile task
state at the end; reordering tools or injecting early timestamps breaks prompt-cache
reuse.

Models author messages; code owns mechanics. Role prose is not a permission
boundary: enforce it in tool scope, config or credentials. Prefer native
task/session state over a second ledger. Provider APIs and measured usage, not
guesses, own caching facts.
