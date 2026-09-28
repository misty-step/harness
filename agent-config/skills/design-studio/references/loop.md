# The design loop

The operational sequence behind `design-studio`. Each step names its artifact and its
exit condition. Scale the counts per the table in SKILL.md; never skip critique,
recombination, or rendered QA.

## 1. Intake — what job, for whom, what exists

Collect from user stories, the live product, screenshots, repo components/tokens, analytics,
constraints, and prior explorations. Write a one-paragraph brief plus a plain list of locked
requirements, explicitly labeled.

- Exit: primary user job, audience, constraints, and the surface archetype candidates are named.
- Missing fidelity-critical context: ask focused questions (see SKILL.md "Principal touchpoints").
- Never guess locked requirements. If the brief is silent, record your assumption.

## 2. Reference study — steal principles, not pixels

Pick 2-4 anchors relevant to the job from the reference library
([references.md](references.md)) and study them against the brief. For each: what principle it
demonstrates, where that principle applies here, where it does not, and its limits.

- Exit: each concept direction can cite at least one principle instead of "it looks nice".

## 3. IA and journey maps — structure before skin

For each of the 1-3 most plausible directions: map navigation/content model and the primary
journey (entry → core action → success/failure exits). Text and diagrams only — no images.

- Exit: at least one structurally distinct IA per finalist direction; differences are nameable.

## 4. Divergent boards — six concepts, cheap and named

Generate the full concept set (default 6 for major work). Each concept: a name, a one-line
stance, its surface archetype, and how it diverges (multiple rubric dimensions, including
structure or behavior). Cheap breadth lives here:

- A generated software-interface mockup per concept where useful (see media-policy) — it may
  propose IA, layout, typography, and exact labels; the rendered build must verify them.
- Or a structural diagram plus a compact visual composition when image generation is not useful.
- Concept notes go in [templates/concept-board.md](../templates/concept-board.md).

- Exit: the set spans conservative → evolutionary → radical, with optional labeled wildcard;
  no two concepts are the same structure with different paint.

## 5. Comparative critique — what each idea costs

Critique every concept against the primary user job, not against taste alone. For each:
what it optimizes, what it sacrifices, which user it wins for, and what would have to be
true for it to win. Use the critique format in [rubric.md](rubric.md). No numeric
"taste scores"; no model-vote winner.

- Exit: a ranked shortlist with named survivors, and a list of good pieces worth keeping.

## 6. Recombine — synthesis beats selection

Build the synthesis: keep the structure that best serves the job, graft the strongest
pieces (navigation idea, density approach, typography move, motion moment) from the others.
Record what came from where in the lineage section of each concept README.

- Exit: one synthesized direction, with lineage, ready to build for real.

## 7. Clickable finalists — real HTML, real behavior

Build the finalists as real artifacts: single-file HTML/CSS or the product's actual stack,
realistic labeled sample content, working interactions (primary action, one state
transition, hover affordances), keyboard reachable, responsive, reduced-motion respected.

- Exit: each finalist can be opened and used; broken states fixed before showing anyone.

## 8. Refine — iterate against critique

Take the strongest finalist through a real revision pass driven by the critique (not a
restyle). Preserve the pre-revision version for the before/after record.

- Before/after is required evidence: what the critique said, what changed, what it fixed.
- Further rounds: only with new evidence or a named open decision.

## 9. Subtract — the content must earn its place

For each affected named state, write the primary user job and inventory the visible
messages, rows, controls, and repeated facts. Decide **keep / cut / defer** for each:
keep what the task needs now, cut repeated or unneeded material, and defer only
secondary information behind a named, accessible action. A visually shorter screen
is not better if the task becomes slower or a required status, warning, or concept
disappears. When nothing can safely be cut, record why rather than invent a cut.

Compare the actual rendered state before and after at the same viewport, theme, and
scroll position. Walk the primary action and the route to deferred information,
including keyboard and assistive access. Record what was removed, what stayed
reachable, and what the interaction did. `skill://visual-state-review` owns the
paired captures and `gallery.py --check --require-subtraction` checks that this
evidence is present; it cannot judge the quality of the decision.

- Exit: every affected state has a keep/cut/defer decision, paired captures, and
  observed retained-task evidence. A missing or inaccessible required fact blocks
  handoff, even if the word count fell.

## 10. Decision capture — the spec

Write or update the handoff artifacts: DESIGN.md-compatible spec, semantic tokens,
states, motion, copy patterns, a11y constraints, implementation mapping, validation
plan, and the subtraction decisions. See [handoff.md](handoff.md). Tokens alone do
not stand in for product design.

## 11. Rendered QA — every named state

Run `skill://visual-state-review`: enumerate states, capture each, look at each. Desktop and
mobile widths. Focus/keyboard pass, contrast, overflow, empty/error/loading where the surface
has them, reduced-motion behavior. Generated images are never QA evidence.

## 12. Feedback — close the loop

Record findings, limitations, and what a next round would test. Update the lineage. Hand off
to implementation with the spec; keep the exploration artifacts (they are the rationale).

## Lineage and rejection records

Every concept README keeps: stance, dimensions of divergence, critique verdict, and — if
rejected — the reason. Rejected options are deliverables of the process. Never delete them
to make the outcome look inevitable.