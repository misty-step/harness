# Reference anchors

Recorded 2026-09-19. Study principles, applications, and limits, not borrowed
branding/pixels. Add a relevant outside anchor per project to avoid homogeneous
output; record its URL/date and how it serves this brief.

## Apple HIG

- [Navigation/search](https://developer.apple.com/design/human-interface-guidelines/navigation-and-search):
  hierarchy of commitment plus search as a parallel path. Useful for sidebar,
  tab, and command choices; native iOS/macOS patterns do not transfer directly.
- [Motion](https://developer.apple.com/design/human-interface-guidelines/motion):
  brief purposeful feedback, cancellation, and reduced motion. Web must supply
  behavior Apple components may already provide.
- [Typography](https://developer.apple.com/design/human-interface-guidelines/typography):
  legibility, scale/weight hierarchy, adjustable sizing. Check platform font
  availability and licensing rather than copying fixed sizes.
- [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility):
  contrast, targets, focus, and motion are composition inputs. Native APIs do
  not replace web WCAG requirements.

## Linear

[Method](https://linear.app/method) illustrates keyboard-first speed, command
menus, calm density, dark/light parity, and stateful motion for operations and
inspection. The product is login-walled; public method/changelog/screenshots
describe intent, not proof of the live UI.

## Stripe

[Docs](https://stripe.com/docs) favor clarity, disclosure, and explicit action
copy; [marketing](https://stripe.com) favors boldness and one idea per section.
Use that distinction when the brief mixes product function and marketing polish.
Gradients/illustrations are brand identity, not transferable method.

## shadcn/ui

[Components](https://ui.shadcn.com/docs/components) expose accessible primitives,
roles, focus, and keyboard behavior. Read semantics as a behavior specification
then re-skin for the brief. The starter theme is not a distinctive brand.

## Hermes

[Docs](https://hermes-agent.nousresearch.com/docs) and the installed `hermes-agent`
checkout (`ui-tui/`, `web/`) inform streaming state, tool activity, and system
status as first-class content. Local source owns actual fleet patterns; terminal
and streaming constraints do not transfer directly to web.

Cite a concrete principle and constraint in critique, not “feels Linear-y”.
Reject an inapplicable reference rather than bending the user's job to fit it.
