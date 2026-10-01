# The design loop

Scale concept/candidate counts to the scope table in [SKILL.md](../SKILL.md).
The loop ends with a defensible, buildable direction, not a pile of images.

## Ground and diverge

Read stories, live behavior, existing components/tokens, constraints, and prior
explorations. Name the job, audience, locked requirements, and uncertainties.
Study relevant real products through [references.md](references.md), extracting
principles and their limits rather than copying their pixels.

Map distinct navigation/content models and the primary journey's success/failure
exits before skinning them. Name each concept and its surface archetype, stance,
and structural/behavioral divergence. Use generated software mockups only where
they buy useful breadth; diagrams plus a compact composition can suffice.
Record boards with [templates/concept-board.md](../templates/concept-board.md).

## Critique and recombine

Compare concepts against the user's job: what each optimizes, sacrifices, wins
for, and fails on. Identify surviving structure and graftable pieces; a model
vote or taste score is not a recommendation. [rubric.md](rubric.md) supplies axes.

Build a synthesis, not merely a winning label. Record where navigation, density,
type, and motion decisions came from and why rejected directions lost.

## Build, refine, subtract

Make finalists usable in HTML/CSS or the product stack, with realistic labeled
content, primary interaction, meaningful state transition, keyboard access,
responsive layout, and reduced-motion behavior. Use per-concept
`skill://frontend-design` craft; keep one bold move and supporting elements quiet.

Revise against critique and preserve the before/after. Further exploration earns
its place only with new evidence or a named decision. For each refined screen,
list visible elements; keep task/status/safety/accessibility information and cut
the rest. Show subtraction before/after, including how moved information remains
reachable. A safe no-cut result needs a reason.

## Handoff and QA

Write the spec, semantic tokens, states, motion, copy, accessibility constraints,
implementation mapping, and validation plan via [handoff.md](handoff.md).
Tokens alone are not product design.

Use `skill://visual-state-review` for named states: desktop/mobile widths,
keyboard/focus, contrast, overflow, empty/error/loading, and reduced motion where
applicable. Generated images remain proposals, not interaction evidence.
Keep concept lineage, rejection reasons, findings, and honest limits with the
spec so the next iteration can understand the decision.