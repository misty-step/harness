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

Serious iterative design **before** production code. Explore several genuinely different
directions, critique them against the user's real job, recombine the good pieces, refine one
direction, and hand off a spec that engineers and agents can build against.

This is the umbrella skill. The references carry the detail; this file is the map and the
rules that keep exploration honest.

## When to use

- A new product surface, a reimagining, or a feature with real UI/UX surface
- Focused component, motion, or design-system work
- Iteration on an existing system: redesign, restructure, restyle, flow change

Don't use for: one-line copy/color/spacing fixes (just do them); token-file authoring alone
(`design-md`); a quick two-variant gut check with no durable output (`sketch` is fine);
diagrams (`excalidraw` / `architecture-diagram`).

## Defaults by task size

| Task size | Named concepts | Clickable candidates | Stop rule |
| --- | --- | --- | --- |
| Major (new product, reimagining) | 6, at least 3 structurally distinct | 3 | 1 refined recommendation + synthesis of good pieces |
| Feature / flow | 3, at least 2 structurally distinct | 2 | 1 refined |
| Focused fix (component, motion) | 2-3 variants, one clear axis each | 1-2 | 1 refined |
| Trivial | none — implement directly | 0 | — |

Bounded rounds: default is **one divergence round + one recombination pass**, then critique
decides whether another round is justified. Another round needs new evidence or a named
open decision — not vibes. Record what a further round would test before starting it.

## The loop

```
intake → reference study → IA + journey maps → divergent boards → comparative critique
→ recombine → clickable finalists → refine → decision capture → handoff → rendered QA → feedback
```

Do not skip critique, recombination, or rendered QA. A pile of initial images is not a loop.
Full procedure, artifacts, and scale-down rules: [references/loop.md](references/loop.md).

## Divergence rubric

Concepts must differ in **multiple dimensions including structure or behavior** — never six
skins on one dashboard. Dimensions: primary user job, navigation/content model, layout,
hierarchy and density, typography, palette/material, components, interaction/motion.
Cover conservative, evolutionary, and radical possibilities; an out-of-family wildcard is
optional and should be labeled. Form: [references/rubric.md](references/rubric.md).

## Ground in real references

Study real products before inventing: Apple HIG (navigation, typography, accessibility,
motion), Linear's product (not just marketing), Stripe's app/docs vs its marketing site,
shadcn component semantics and accessibility, the Hermes UI itself. Each reference note
states the extracted principle, where to use it, its limits, URL, and date.
Library: [references/references.md](references/references.md).

## Media policy

- **Generated images are software-interface mockups first** (see provider policy): early IA,
  layout, typography, component and content-hierarchy proposals, visual language, and
  iterative edit exploration — including exact labels and copy when the evaluation target
  needs them. Radical variants must still be recognizable, useful software; moodboards and
  styleframes are optional supporting artifacts, not the target.
- A raster mockup is a **visual proposal**. It may propose text, layout, and hierarchy;
  rendered HTML/CSS on the actual stack must verify them. Generated images are never proof
  of UX, accessibility, or behavior — screenshots of raster mockups are not interaction
  evidence.
- **Text and diagrams**: IA, journeys, content models, rubrics.
- **Real HTML/CSS or the product's actual stack**: layout, exact copy, behavior, motion,
  and states.
- Cost: default **$3.00 exploratory cap** per substantial round unless the operator sets
  one. The bundled adapter enforces the cap against caller-supplied price evidence and
  fails closed when price is unknown. Record provider, model, settings, prompt, artifact
  hash, and latency; label estimates as estimates and reserves as reserves.
- Workflow, evaluated backend evidence, and provider discovery:
  [references/media-policy.md](references/media-policy.md); batch helper:
  [scripts/imagine.py](scripts/imagine.py).

## Per-concept craft

Commit each concept to **one** surface archetype before choosing tokens (monitor, operate,
compare, configure, decide/learn, explore, command/inspect). This is what enforces structural
divergence. For the build of each concept, keep the two-pass craft rules from the
`frontend-design` skill: plan, review the plan against the brief, build, critique your own
work. Keep the anti-slop discipline: one bold element, everything else quiet.

## Composition with sibling skills

- `sketch` — small compares; this skill subsumes it when alternatives must be durable.
- `claude-design` — single-artifact craft and taste rules; run it per concept, not as the
  whole process.
- `popular-web-designs` — visual vocabulary; take principles, not branding or copy.
- `design-md` — the formal token spec file and its CLI; use it for the handoff leg.
- `visual-state-review` — the rendered-QA leg; use it for every named UI state.
- `user-stories` — intake source; the primary user job comes from stories, not guesses.

Sibling skills live in host profiles, not in this package. A fresh Pi/OMP consumer install
carries only `agent-config/skills/*`, so some siblings may be absent; the loop must degrade
cleanly: run sketch/claude-design/popular-web-designs steps from this package's own rubric,
craft rules, and reference library, and for the spec leg use the design-md CLI when it is
available — otherwise run the bundled minimal validator `scripts/check_design_md.py` and
record the reduced coverage (structure only; no schema or contrast checks).

## Handoff

Produce (or update) a DESIGN.md-compatible spec plus: semantic tokens, component states,
navigation and journey decisions, responsive rules, typography with licensing/availability,
icon and media treatment, motion timings/easing/purpose with reduced-motion behavior,
copy/empty/error/loading/success patterns, accessibility constraints, implementation mapping,
and a validation plan. Tokens do not stand in for product design. Lint the spec with the
design-md CLI when available; otherwise run `scripts/check_design_md.py` and say so in the
handoff (minimal structural fallback).
Format and checklist: [references/handoff.md](references/handoff.md).

## Evidence and QA

Every named UI state is captured and looked at — `skill://visual-state-review` is the
procedure. Generated concept images and real browser screenshots must be distinguishable in
the evidence manifest: [templates/evidence-manifest.json](templates/evidence-manifest.json).
No claim of functional proof from a screenshot alone.

## Principal touchpoints

Ask the principal only at a **consequential taste fork**, with visible options (2-4) and
decision-grade context: what each option optimizes, what it sacrifices, who it wins for,
and a recommendation. Do not run a questionnaire when intent is already sufficient.
Exploration may challenge current design assumptions in its artifacts; it never silently
changes a live product or a locked requirement.

## Boundaries

- Preserve rejected options and reasons (lineage) — do not delete divergence.
- No fake objective taste scores; no automatic winner from a classifier or model vote.
- No secrets, credential files, or sensitive product data in prompts or artifacts.
- Do not commit screenshots or binary outputs into repositories.
- Respect product-specific design systems; this practice sets method, not a global style.