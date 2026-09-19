# Reference library

Anchors to study before inventing. For each: the principle extracted, where to use it,
its limits, URL, and date accessed. Steal principles, not pixels, branding, assets, or copy.

## Apple Human Interface Guidelines

- **Navigation and search** — principle: navigation is a hierarchy of commitment; search is
  a parallel path, not a fallback; place controls where people already look for them.
  Use: choosing between sidebar / tab / command patterns; deciding whether search is primary.
  Limits: platform-native idioms (iOS/macOS) do not translate 1:1 to web or desktop apps.
  URL: https://developer.apple.com/design/human-interface-guidelines/navigation-and-search
- **Motion** — principle: add motion purposefully; make it optional (respect reduced
  motion); keep feedback motion brief and precise; avoid animating frequent interactions;
  let people cancel/act through motion.
  Use: motion posture per surface — which moments earn motion and which stay instant.
  Limits: system components already supply much of this on Apple platforms; web needs the
  behavior hand-built and explicitly reduced-motion aware.
  URL: https://developer.apple.com/design/human-interface-guidelines/motion
- **Typography** — principle: legibility is the floor; type scale and weight carry
  hierarchy; Dynamic Type-style scaling beats fixed magic numbers.
  Use: type-scale design, body line length, hierarchy without extra chrome.
  Limits: font availability differs by platform; licensing must be checked per family.
  URL: https://developer.apple.com/design/human-interface-guidelines/typography
- **Accessibility** — principle: accessibility is a design input, not a QA afterthought;
  contrast, hit targets, focus, and motion settings are part of the composition.
  Use: constraints in every concept; validation plan in the handoff.
  Limits: platform-specific APIs are not the web's WCAG rules; use both deliberately.
  URL: https://developer.apple.com/design/human-interface-guidelines/accessibility
- Accessed: 2026-09-19.

## Linear (the product, not the marketing site)

- Principle: speed is a feature — keyboard-first operation, a command menu, dense but calm
  information design, restrained chrome, consistent dark/light parity, and motion that
  communicates state instead of decorating it.
- Use: operations/monitor surfaces; command-inspect archetypes; density decisions.
- Limits: the product is login-walled; study it from its public docs, changelog, and
  screenshots, and treat method articles as intent, not as proof of the built UI.
- URL: https://linear.app/method (public method articles; product study requires an account)
- Accessed: 2026-09-19.

## Stripe (app/docs vs marketing — keep the boundary)

- Principle: two different surfaces with different rules. Docs/app surfaces win on clarity,
  progressive disclosure, and copy that names exactly what happens; marketing surfaces earn
  boldness, motion, and one idea per section. Do not port marketing drama into product
  surfaces, or product flatness into a landing page.
- Use: deciding which rules apply when a brief mixes "marketing polish" with app function.
- Limits: brand-specific techniques (gradients, illustrations) are identity, not method;
  borrowing them makes output look like Stripe rather than like the brief.
- URLs: https://stripe.com/docs (app/docs patterns) · https://stripe.com (marketing patterns)
- Accessed: 2026-09-19.

## shadcn/ui (component semantics and accessibility)

- Principle: open-code components composed from accessible primitives; semantic behavior
  (roles, focus management, keyboard interaction) matters more than the default theme.
  Read a component's structure as a specification of behavior, then re-skin it.
- Use: component-level concepts; states and interaction rules in the handoff; a11y checks.
- Limits: the default theme is a starter, not a brand; copying it wholesale produces the
  recognizable "shadcn look" instead of a distinct direction.
- URL: https://ui.shadcn.com/docs/components
- Accessed: 2026-09-19.

## Hermes (this fleet's own UI)

- Principle: agent-native surfaces — streaming state, tool activity, and system status are
  first-class content; the interface communicates what the system is doing, not just what
  it has done. Local source is the ground truth for patterns actually in use.
- Use: any surface that shows agent/system activity; status and progress presentation.
- Limits: the desktop/TUI surfaces carry implementation constraints (terminal renderer,
  streaming) that web concepts do not share; study the intent, not the pixel limits.
- URL: https://hermes-agent.nousresearch.com/docs · local source: the installed
  `hermes-agent` checkout (UI lives in its `ui-tui/` and `web/` trees).
- Accessed: 2026-09-19.

## Beyond the anchors

The anchors above are starting points, not the whole library. Deliberately study at least
one reference **outside** this list per project to avoid homogeneous output — e.g. an
operations console (Sentry, Datadog), a creative tool (Figma, Blender), a data notebook
(Observable), or a strong editorial interactive. Record it in the concept board with the
same four fields (principle, use, limits, URL/date). If all six concepts could have been
designed from this page alone, the study was too narrow.

## Using references in critique

In comparative critique, cite the reference and the principle by name: "survives because
it applies Apple's search-as-parallel-path principle" is decision-grade; "feels Linear-y"
is not. A principle that does not fit the brief is evidence for rejecting the reference
for this project, not for bending the brief.
