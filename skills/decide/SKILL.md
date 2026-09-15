---
name: decide
description: Synthesize current context, tradeoffs, and candidate paths into an executive decision brief.
disable-model-invocation: true
argument-hint: "[optional fork, question, or decision topic]"
---

# Decide

Provide a dense, high-context executive brief for a fast technical decision.
Lead with facts, root causes, and consequences. This skill is read-only; do not
apply changes until the user selects a path.

## Style and language

Follow ASD-STE100 principles:

- Keep sentences short. Use at most 20 words for instructions and at most 25
  words for descriptions.
- Use active voice and direct verbs.
- Express one main idea per sentence.
- Define one term for each concept and use that term consistently.
- Avoid noun clusters of more than three nouns.
- Omit conversational filler, preambles, and apologies.
- Omit AI clichés: "delve", "foster", "leverage", "navigate", "tapestry",
  "testament", "crucial", "seamless", "robust".

## Gather context

Infer intent from recent conversation, tool results, and repository state.
Do not ask clarifying questions unless context is entirely missing.

Inspect primary evidence before writing:

- Uncommitted diffs, recent commits, and active branch state.
- Diagnostics, test failures, compiler output, or runtime logs.
- Relevant source files, interface boundaries, and ADR constraints.

Distinguish verified facts from inferences and assumptions.

## Structure the brief

Present findings in this order:

1. **Context and forcing function**
   State current system behavior, the trigger that forces a decision now, and
   the cost of inaction.

2. **Invariants and constraints**
   List non-negotiable boundaries: performance budgets, memory limits, type
   contracts, security rules, and architectural invariants.

3. **Candidate paths**
   Detail two or three credible, distinct options. Include status quo or revert
   when viable. For each path, state the concrete mechanism, benefits, and failure
   modes. Do not present artificial or strawman options.

4. **Tradeoff matrix**
   Compare all candidates in a Markdown table with these columns:
   - `Path`: Option name.
   - `Reversibility`: Two-way door (cheap rollback) or one-way door (hard to undo).
   - `Blast radius`: Scope of affected components.
   - `Effort`: Immediate implementation cost.
   - `Operational cost`: Ongoing maintenance, resource, or cognitive load.
   - `Primary risk`: Worst-case failure mode.

5. **Recommendation and decision boundary**
   State a clear stance: "Recommend Option X because [technical reason]."
   Provide the decision boundary: "Select Option Y instead if [condition holds]."
   Never present false neutrality.

6. **Next action**
   Supply the exact command, edit, or check that executes the recommended path
   upon approval.

Done when the user can read the brief in sixty seconds and decide without
requesting more context.
