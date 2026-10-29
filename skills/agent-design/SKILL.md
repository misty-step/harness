---
name: agent-design
description: "When crafting an agent's prompts, skills, AGENTS.md instructions, tools or context loading; misty owns the briefing contract."
metadata:
  owner: phaedrus
  prevents: "Q10 (Daybook decision 16): persona prose and duplicated guidance instead of exact instructions; inferred 90-day use on 2026-10-28: agent-design 5 and writing-for-agents 3 session families."
  source: "Daybook projects/mistystack.md decisions 6, 16-18; misty-step/mistystack@0ccc1a3/agent-config/skills/agent-design; mattpocock/skills@59db609eb1e18aaf59b63284d0e52255aff0c63c/skills/productivity/writing-for-agents; Foundations way-of-working Agent instructions; Nico Bailon skill-diet principle (reference)."
  sunset: "2026-11-27"
---

# Agent design

1. **Craft.** Misty's briefing contract owns what a dispatch must carry. Shape that material for a child that starts blank: raw inputs and the outside check, not the parent transcript. This skill owns prompt, skill and context craft, not a second dispatch contract. Done when the child can use the supplied material independently.

2. **Place.** Repository and host instructions live in regular `AGENTS.md` files, including fixtures. When consolidating, read both instruction files through existing symlinks, reconcile into `AGENTS.md`, then remove the obsolete `CLAUDE.md` file or symlink. Keep the resulting instructions OMP-only. Stable local facts and hard guardrails belong in standing context; task state belongs in the task. Done when each fact has one home and every required document has a trigger-bearing pointer.

3. **Structure.** Front-load a pointer's leading word and name each distinct trigger branch. Inline what every path needs; disclose branch-specific material behind a pointer. Put ordered actions before lookup material and co-locate a concept's rules with its definition. Give each step a checkable, exhaustive completion criterion. Read [context.md](context.md) when choosing document boundaries, invocation or cache layout. Done when each path reaches the material it needs without loading unrelated branches.

4. **Prune.** Use a precise leading word instead of repeating a definition. State the target positively; pair a hard prohibition with the positive action. Cut persona, role-play, no-ops, stale tool facts and copies of facts discoverable from one command or file. Keep tool permissions in tool scope, configuration and credentials; prose is not a security boundary. Prefer native task state to a second ledger. Done when each remaining instruction changes an observed outcome or carries a needed local fact.

5. **Compare.** Apply the `principle-skill-diet` skill through [eval.md](../misty/playbooks/eval.md); fewer tokens alone is not success. Follow the core's claim rule. Done when the evidence supports the retained guidance, with untested behavior named as unproven.
