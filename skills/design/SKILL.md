---
name: design
description: "Use for every UI or visual task: build, fix, redesign, polish, visual artifact, review, or motion."
metadata:
  owner: phaedrus
  prevents: "Design defaults drifting and state-specific defects escaping review: design-studio loaded only 4 times in the usage audit; Foundations article 10 requires a finished face."
  source: "Foundations article 10 and way-of-working#design; misty-step/mistystack@0ccc1a3/agent-config/skills/{design-studio,visual-state-review}; emilkowalski/skills@2d228630ba1446365f614a108cb8252f1feda202; pbakaus/impeccable@5adaee704634e9031ec8943721c4ffa1a3c22221; see sources.md"
  sunset: 2026-11-27
---

# Design

Misty Step rewrite of the sources disclosed in [sources.md](sources.md).

## Defaults

Neutral, professional, plain words. Standard product design at Linear, Vercel
and GitHub quality; no decorative theme or metaphor unless authorized product
intent requires it. Support light and dark; default to the system setting.

[Foundations article 10](https://foundations.mistystep.io/#10) is the bar:
primary information and action first; every element serves the task or required
information. No gratuitous text, eyebrow labels, or secondary label repeating
the primary. Fix hierarchy and layout before adding copy; cut taglines and
helper text where structure can do their job. Keep accessible units and disclose
provenance, uncertainty and calculation details when needed to interpret a result.

Use the product's own materials and existing design system as references.
Do not use Mobbin.

## Method

1. **Frame.** Read the story, existing surface and design conventions. Name the
   user's task, the behavior to preserve and the outside check that will prove
   the result. Review-only work produces findings; polish preserves identity;
   redesign replaces visual structure without silently changing product facts.
   Done: the target surface and affected states are named.
2. **Debate.** During brainstorming or design thinking, test competing structures
   through relevant expert lenses: Torvalds (unnecessary complexity), Musk
   (requirements and subtraction), Carmack (directness and cost), Ousterhout
   (complexity hidden behind a small interface). Change the lenses to fit the
   work. These are analytical methods, not personas, impersonations or attributed
   quotations. Record the decisive tradeoff, not a staged conversation.
   Done: one direction chosen on user benefit and constraints.
3. **Build or inspect.** Reuse tokens and components. Alternatives differ in
   hierarchy or behavior, not merely color. For motion implementation, naming,
   review, performance or opportunity-finding, read [motion.md](motion.md).
   For artifacts, inspect at their actual viewing size; a generated mockup is a
   direction, not evidence of working UI. Any paid generation needs authorization;
   keep private data out of external prompts and generated media out of Git.
   Done: the requested change or review covers the whole affected path.
4. **Prove.** Follow [review.md](review.md): drive the real surface with OMP's
   browser tool, capture and inspect every named affected state, and test existing
   behavior for regressions. Record **UX**, **DX** and **AX** outcomes separately;
   pass only when all three improve together and existing behavior still works.
   Label each claim **measured**, **inferred** or **guess** beside its evidence;
   an inaccessible or unexercised state remains unverified.

[Sources and cut decisions](sources.md) disclose the rewritten upstream material.
