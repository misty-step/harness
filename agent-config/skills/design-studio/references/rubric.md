# Divergence rubric and critique format

The rules that stop "six skins on one dashboard". Use it when assigning concepts, when
critiquing them, and when deciding what to recombine.

## Dimensions

Assign each concept a deliberate position on every dimension. A concept must differ from
its siblings in **multiple** dimensions, and at least one difference must be structural
(organization, navigation, or content model) or behavioral (interaction, motion), not
paint. Six concepts that all differ only in palette or typography are one concept.

| # | Dimension | Example spread |
| --- | --- | --- |
| 1 | Primary user job | scan status vs. drill into one object vs. decide what's next |
| 2 | Navigation / content model | table-first, timeline-first, spatial map, search-first, document |
| 3 | Layout | single column, master-detail, canvas, split panes, stream |
| 4 | Hierarchy and density | dense/compact vs. airy/editorial vs. progressive disclosure |
| 5 | Typography | one family + scale vs. dual-role display/body vs. data-mono accents |
| 6 | Palette / material | flat surfaces vs. layered elevation vs. line-art vs. tonal blocks |
| 7 | Components | table rows vs. cards vs. clusters vs. threads; how the unit is shaped |
| 8 | Interaction / motion | keyboard-first vs. pointer-first; one orchestrated reveal vs. none |
| 9 | Content organization | by object vs. by time vs. by person vs. by phase |

## Range coverage

The full set must span:

- **Conservative** — the evolution of what exists; lowest migration cost.
- **Evolutionary** — keeps the product's center of gravity, restructures a major axis.
- **Radical** — a different organization or interaction model; may not be buildable as-is.
- **Wildcard (optional, labeled)** — deliberately out-of-family; exists to break the frame.

Coverage is required; wildcards are not. Never ship a set of six conservatives.

## Assignment discipline

- Name each concept before building it (names go in the board README).
- Write its surface archetype (monitor, operate, compare, configure, decide/learn,
  explore, command/inspect) before any tokens — this is what enforces structure.
- Write its divergence claim in one sentence: "differs from X by doing Y at the Z layer".
- If two concepts' claims are both cosmetic, fix the assignment, not the paint.

## Comparative critique format

Critique each concept against the **primary user job**, in this shape:

```markdown
### <concept name> — <verdict: survives / merges / rejected>
- Optimizes: what it is best at, honestly.
- Sacrifices: what it gives up to get there.
- Wins for: which user or situation this serves best.
- Fails when: the condition under which it stops working.
- Keep: the piece(s) worth grafting into the synthesis (name them).
```

Rules:

- No numeric taste scores, no model-vote winners, no fake objectivity.
- A rejection needs a reason stated against the job, not against personal preference.
- Record the critique in the concept's README; it is part of the lineage.
- The recommendation must name its evidence: critique findings, reference principles,
  constraint satisfaction — not "felt cleaner".

## Synthesis

After critique, build the recombination:

```markdown
## Synthesis — <name>
- Spine: <which concept's structure survives, and why>
- Grafts: <piece> from <concept> — <what it fixes>
- Dropped: <piece> — <why>
```

The synthesis is a new artifact built for real (step 6 of the loop), not a sentence.

## Small tasks

Focused fixes still use the rubric but at reduced counts: 2-3 variants, one clear axis
each (e.g. density, hierarchy, or motion posture), a one-line critique each, one refined
result. Never inflate a small fix into a six-concept program, and never dress a recolor
as exploration.
