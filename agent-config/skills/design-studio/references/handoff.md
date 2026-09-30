# Buildable design handoff

Use the product's existing spec format or DESIGN.md-compatible output. Include
the user job, navigation/content decisions, semantic palette/tokens, spacing and
breakpoints, typography roles/scale/licensing/availability/fallback, depth/shape,
component variants/states, icons/media sources/crops/alt text, copy for meaningful
states, motion purpose/timing/easing/triggers/reduced-motion replacement,
accessibility constraints, and component/route/file implementation mapping.
An action keeps one name through its flow. Tokens alone do not specify the product.

State what collapses/hides/reflows and where; define keyboard/focus order, hit
targets, contrast, and screen-reader behavior for custom widgets. Link lineage,
rejected options, critique-driven refinement, and each screen's subtraction
before/after (including no-cut reasons). Name the explored and untouched scope.

## Validators and rendered checks

Use the `design-md` CLI when present. Fresh Pi/OMP installs may lack that host
skill; bundled [check_design_md.py](../scripts/check_design_md.py) validates
minimal structure only, not full schema or WCAG contrast. Report reduced coverage.
Map named states to `skill://visual-state-review` and interaction acceptance.

`skill://visual-state-review` owns deterministic player-copy checks, axe-core
and the optional Impeccable detector alongside the captured-state review.

Marks are 16-first: design at 16px, observe light/dark/browser-tab backgrounds,
and ship the optical variant before acceptance. Generated mockups and actual
screenshots stay distinguishable in the evidence manifest. Capture appearance
and exercise behavior separately.