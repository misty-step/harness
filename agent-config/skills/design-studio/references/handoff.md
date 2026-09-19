# Handoff — what the design loop owes implementation

The loop is not done when it looks good. It is done when someone (human or agent) can build
it without guessing. Produce or update these, in the product's existing format when one
exists; otherwise use a DESIGN.md-compatible file (`design-md` skill owns the spec format
and its CLI — lint before shipping).

## Spec file (DESIGN.md or compatible)

- Overview: what this is, for whom, the job it serves — two or three sentences.
- Colors: named palette with semantic roles (not just hex lists).
- Typography: families with roles, scale, weights, line-heights, and **licensing and
  availability** (what happens if the font cannot load).
- Layout and spacing: grid, spacing scale, density rules, breakpoints.
- Elevation and shape: depth model, radii, borders — or an explicit "flat, none".
- Components: per component, its states and variants as separate entries.
- Do's and don'ts: the decisions this design makes that future work must not quietly undo.

## Beyond tokens (tokens alone do not stand in for product design)

- **Navigation and journey decisions**: the chosen content model and why; entry → core
  action → success/failure exits; where search sits; what is a page vs a panel.
- **Component states**: default, hover, focus-visible, active, disabled, loading, empty,
  error, success — for every interactive unit that has them.
- **Responsive rules**: what collapses, what hides, what reflows, at which widths; minimum
  supported viewport.
- **Iconography and media treatment**: icon family/source and stroke rules; image aspect
  ratios, crops, fallbacks, alt-text rules.
- **Motion spec**: per named moment — duration, easing, purpose, trigger, and the
  reduced-motion behavior (what replaces the animation).
- **Copy patterns**: voice rules plus concrete empty, loading, error, and success strings
  — with the rule that an action keeps one name through the whole flow.
- **Accessibility constraints**: contrast targets, focus order, keyboard model, hit
  targets, screen-reader notes for custom widgets, reduced-motion coverage.
- **Implementation mapping**: which concept pieces map to which components/routes/files;
  what is net-new vs. a modification of existing code; dependencies (fonts, icons, libs).
- **Validation plan**: the named UI states to capture (`skill://visual-state-review`),
  interaction tests to run, and the acceptance conditions a reviewer can check.

## Lineage

Keep the concept boards, critiques, rejected options, and the synthesis note next to the
spec (or linked from it). The rationale is part of the deliverable: it is what prevents the
next iteration from re-litigating settled decisions or resurrecting rejected ones by
accident.

## Scope honesty

If the loop covered a subset of the product surface, say exactly what was explored and what
was not. "Refined direction for the projects explorer; settings and onboarding untouched"
is a handoff; implying the whole product was designed is not.
