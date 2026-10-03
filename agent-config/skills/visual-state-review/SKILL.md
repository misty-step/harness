---
name: visual-state-review
description: Inspect every affected rendered UI state and its user-facing copy.
disable-model-invocation: true
argument-hint: "[app or route]"
---

# Visual state review

A single happy-path screenshot misses state-specific defects. Render and look
at every state the change touches: routes, loading, empty, error, success,
widths, themes and scroll positions. Look for clipped type, contrast, overlays,
empty panels, overflow and the wrong state. Keep captures outside Git. For many
captures, `scripts/gallery.py` lays a [manifest](templates/manifest.json) out
side by side; its exit code only proves the files exist.

For changed user-facing copy run `bun ~/.local/bin/design-check <paths>`: it
flags dashes, engineering vocabulary and placeholders by file and line; mark an
intended line with a `design-check: ignore` comment. Run axe-core on rendered
states. Use `npx impeccable detect <file>` only where a pinned Impeccable is
already installed; do not let npx fetch it. Screenshots prove appearance, not
backend effects.
