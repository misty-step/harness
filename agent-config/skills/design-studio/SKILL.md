---
name: design-studio
description: "Use when exploring UI/UX design before committing to code: divergent concepts, comparative critique, refinement, spec handoff."
version: 1.1.0
author: Misty Step harness
license: MIT
platforms: [linux, macos]
metadata:
  hermes:
    tags: [design, ux, ui, exploration, concepts, critique, iteration, handoff, tokens, motion, ia]
    related_skills: [sketch, claude-design, frontend-design, design-md, popular-web-designs, visual-state-review, user-stories]
---

# Design studio

Explore UI/UX before production code: structurally distinct concepts, comparative
critique, recombination, refinement, subtraction, then a buildable handoff.
Use for new/reimagined surfaces, flow changes, and component/motion work.
One-line copy/color/spacing changes can go directly to implementation.

Start from the actual user job, product evidence, and locked constraints. Concepts
differ in organization or behavior as well as visual language, not just skins.
Compare conservative, evolutionary, and radical directions; recommend with
evidence rather than numeric taste scores. Keep rejected options and reasons.

| Scope | Named concepts | Clickable candidates |
| --- | --- | --- |
| Major surface/reimagining | 6, at least 3 structurally distinct | 3 |
| Feature/flow | 3, at least 2 structurally distinct | 2 |
| Focused component/motion | 2–3, clear axis per variant | 1–2 |

One divergence round plus recombination is normally enough. Another round needs
new evidence or a named open question. Show before/after of refinement and the
final subtraction; preserve the user's task and required information.

Load focused detail:
- [references/loop.md](references/loop.md): exploration and lineage.
- [references/rubric.md](references/rubric.md): archetypes and meaningful divergence.
- [references/references.md](references/references.md): dated primary reference anchors.
- [references/media-policy.md](references/media-policy.md): image-provider evidence,
  provenance, pricing, and bundled adapter. Raster proposals are not UX proof.
- [references/handoff.md](references/handoff.md): spec, validators, and local quality checks.

Build finalists on real HTML/CSS or the product stack. `skill://frontend-design`
owns per-concept craft; `skill://visual-state-review` owns captured rendered
states. Optional host-profile skills (`sketch`, `claude-design`, `design-md`,
`popular-web-designs`) may be absent on fresh Pi/OMP installs; this package's
rubric/references and minimal validator keep the loop usable.

Ask for a consequential taste choice with visible options, tradeoffs, and a
recommendation, not a questionnaire. Exploration proposes; it does not silently
change locked intent or live products. Keep binary artifacts out of Git and distinguish
generated mockups from actual screenshots in
[templates/evidence-manifest.json](templates/evidence-manifest.json).