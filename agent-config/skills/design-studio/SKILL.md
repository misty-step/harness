---
name: design-studio
description: "Use when designing, building or reshaping UI: visual taste, interface copy, generated mockups and DESIGN.md."
author: Misty Step harness
license: MIT
---

# Design studio

Draw distinctiveness from the subject's own materials, vernacular and audience;
the brief's explicit direction always wins. On a free axis, skip the
generated-UI defaults catalogued by
[Anthropic's frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design):
cream ≈#F4F1EA with serif display and terracotta ≈#D97757 (Claude's own
accent); near-black with one acid-green or vermilion accent; hairline
broadsheet columns at zero radius; identical rounded cards with one radius,
rgba(0,0,0,.1) shadows and gradient washes; big-number heroes; tracked ALL-CAPS
eyebrows, `A · B · C` meta, `WORD — fragment` labels, #111 for black, mono
micro-labels, `→` on links; one accented word per headline; 01/02/03 on
non-sequences; fade-up on every section and hover motion on every card.

Spend boldness on one element, keep the rest quiet, then remove one accessory.
Alternatives differ in structure or behavior; a recolor is not a concept. Copy
uses the user's words (notifications, not webhook config); an action keeps its
name through the flow (Publish, then Published); errors say what happened and
how to fix it, without apology. Draw brand marks at 16px first, check light,
dark and browser-tab backgrounds, and ship the optical small variant.

`npx @google/design.md lint` validates DESIGN.md; the bundled fallback
`scripts/check_design_md.py` checks structure only, not schema or WCAG contrast.
Inspect rendered states with `skill://visual-state-review`.

## Generated mockups

Raster mockups buy cheap breadth in layout, hierarchy, type and visual
language; they never prove UX, accessibility or behavior. Rebuild promising
pieces in the real stack and check labels, cloned rows, invented data and
contrast. Prompts leave the machine: no secrets, private product data, real
people's likenesses or brand logos. Keep generated media outside Git.

Dated evidence (2026-09-19, 34 samples, 11 models): `openai/gpt-5.4-image-2`
(≈$0.14/image) and GPT-image-2 via Codex led, Grok Imagine 2.0 was strong,
`google/gemini-3-pro-image` best kept exact strings and edits, and
`bytedance-seed/seedream-5-0-pro` corrupted required labels. Re-check IDs and
prices before use. `scripts/imagine.py` generates xAI mockups under a price cap
(usage in its docstring); `scripts/contact_sheet.py` lays a run out side by side.
