---
metadata:
  source: "mattpocock/skills@59db609eb1e18aaf59b63284d0e52255aff0c63c/skills/productivity/writing-for-agents; misty-step/mistystack@0ccc1a3/agent-config/skills/agent-design; Anthropic prompt-caching documentation (reference only)."
---

# Context and document boundaries

## Two loads

**Context load** is the cost of always-present instructions and pointers on every turn, including when they do not trigger. A skill description spends this load; its body and disclosed references are reached later.

**Cognitive load** is the owner's cost of knowing which documents exist and when to use them. Spend it where human judgment matters. A document without a pointer relies entirely on the human to remember it.

A context pointer names out-of-context material and the condition for reaching it. Its wording controls reachability. Start with the leading word, list distinct branches, and remove synonyms for the same branch. If a required document is missed, sharpen the pointer before inlining the document. Test that the revised pointer fires on the missed case.

## Hierarchy

Choose the lowest tier that still makes the needed material reliably reachable:

1. **In-file steps:** actions in execution order, each ending with an observable completion criterion.
2. **In-file reference:** facts consulted during the current path. Keep a concept's meaning, rules and exceptions together.
3. **Disclosed reference:** branch-specific detail in a sibling file, reached through a pointer that names its trigger.

A flat set of reference rules can be legitimate. Splitting earns its cost when a branch would otherwise carry irrelevant material, or a real handoff keeps later work from causing premature completion of the current step. A heading in the same context does not hide later steps.

An exhaustive criterion names the whole set: "Every changed interface has consumer evidence" is checkable in a way that "review complete" is not. Sharpen the bound before adding ceremony.

## Leading words and pruning

A leading word recruits a familiar concept, such as **frontier** or **red**, so the agent can think with it without rereading a definition. Use the same word in pointers and bodies. Define a coined term once in `DOMAIN.md`; prefer an established precise term when it already fits.

Keep each meaning in one authoritative location and reference it elsewhere. Commands, settings, dependency versions and file structure already have owners in the environment. Cache them in prose only when lookup is expensive or they encode a trap the source cannot explain.

Prune whole no-op instructions rather than shortening them. Whether a sentence changes behavior is model-relative: settle a disputed no-op through the old/candidate/none comparison, not opinion. A shorter instruction that loses the required behavior fails the comparison.

## Skill reachability

Skills expose name and description before activation, then body and references on demand. Keep descriptions as trigger-bearing context pointers. Choose model discovery when the agent or another skill must reach the procedure. Reserve user-only invocation for procedures the owner intentionally starts; confirm the installed OMP version's invocation behavior before relying on a metadata flag. Use `skill://<name>` for skill pointers.

## Prompt caching

Put stable instructions, tool definitions and reusable material before volatile task state. Keep tool order and stable prefix bytes unchanged when possible. Moving a timestamp or task state into that prefix can invalidate reuse from the change onward. Treat the serialized provider request, not the document layout alone, as the cache input.

Provider details differ. For example, [Anthropic's prompt-caching documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) describes a prefix ordered as tools, system and messages, with cache controls and provider-specific lifetimes. It does not establish the policy of another provider or prove an OMP session hit a cache.

When changing cache behavior, inspect the installed OMP adapter and current provider documentation. Measure request usage, cached-input fields, latency and cost over comparable runs. Record provider, model, versions and cache settings with the result. Claim a cache benefit only from measured usage; a stable-looking prompt is an inference, not a hit receipt.
