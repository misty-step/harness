---
name: grill
description: "When shaping an initiative, stress-testing a decision, reconciling a backlog, defining domain terms, or turning settled intent into stories and tickets."
metadata:
  owner: phaedrus
  prevents: "Builders inventing owner intent or shrinking initiative value; inferred use: grill-me 11 and grilling 2 session families in the 90-day scan on 2026-10-28."
  source: "Daybook projects/mistystack.md decisions 16-18; mattpocock/skills@59db609eb1e18aaf59b63284d0e52255aff0c63c/skills/{productivity/{grill-me,grilling},engineering/{grill-with-docs,to-spec,to-tickets,domain-modeling}}; misty-step/mistystack@0ccc1a3/agent-config/{chief/AGENTS.md,skills/user-stories}; local Misty shape, groom, brief; Foundations way-of-working Scope; cursor/plugins@c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/skills/in-your-own-words"
  sunset: "2026-11-27"
---

# Grill

1. **Ground.** Survey inside first: `SPEC.md`, `DOMAIN.md`, stories, backlog, captures, decisions, past and parked work. Then survey outside: primary sources, existing tools, examples and power-user practice. Reuse or adopt before proposing a build. Resolve factual questions with the `research` skill; dispatch a subagent through your harness's mechanism for independent reading legwork. Restate in your own words the user's goal and problem before proposing. Done when the observed problem, consumer and evidence are named, and existing owners or conflicting records are visible.

2. **Frontier.** Map the decisions and their prerequisites. Ask the current frontier in rounds: number each question, show concrete options and tradeoffs, and give a recommended answer. Word each question so **yes accepts the recommendation**. Wait for the owner's answers before asking dependent questions. Facts are the agent's job; consequential intent choices are the owner's. A pending investigation delays only the questions that depend on it. Carry settled answers forward. Done when no material choice is silently assumed.

3. **Terms.** During each round, test overloaded terms and relationships against concrete scenarios and current code. Surface contradictions rather than choosing a meaning silently. Write each settled term immediately into `DOMAIN.md`, its one home; keep implementation decisions in the spec. Read [records.md](records.md#domain-terms) when defining terms or recording a consequential decision. Done when the same concept has the same name across the spec, stories and tickets.

4. **Deepen.** Before finalizing the spec, keep the outcome fixed and ask: What would a top practitioner do here? What is the rawest material they would start from? Which methods and instruments would they use? What check outside the agent would show the result is right? Resolve factual parts through source or a probe, and put changed intent back on the frontier. Prefer deletion, direct use and the smallest design. Done when the method is deeper, not the scope bigger, and the outside check is concrete.

5. **Record intent.** Preserve the owner's words, accepted decisions and checkable **done-when** conditions in the initiative's native tracker. Write the full valuable outcome in `SPEC.md`, including the intended user or business benefit, proportionate evidence from actual use, and the condition to continue, revise or stop. Link observable acceptance behavior to that outcome. Resolve conflicts explicitly with the owner. Synthesize already-settled intent without another interview. Read [records.md](records.md#spec-and-stories) for the spec and stable `US-###` EARS story format in `SPEC.md` or the existing `USER_STORIES.md`. Done when the owner confirms the intent and a builder can proceed without inventing a material decision.

6. **Slice and publish.** Split the whole outcome into independently useful, atomically shippable vertical slices; keep existing users working. Publish them in the project's native tracker, reusing existing items and native blocking relationships. Each ticket carries the briefing contract owned by the `misty` skill; load it rather than copying the contract here. Apply its **Oracle gate** before dispatch: a ticket without an Oracle returns to shaping. For backlog reconciliation or publication, read [records.md](records.md#tickets-and-reconciliation). Done when every slice has acceptance behavior, a story link, direct blockers and a complete brief, and the tracker readback matches the decisions.

Every authored PR carries `Story: US-###` for each story it changes, or `Story: none` when it changes no story. Generator-only release PRs are the exception. Use the `writing` skill for the PR body and the report; the `misty` skill owns claim precision.
