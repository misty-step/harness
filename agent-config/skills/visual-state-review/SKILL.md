---
name: visual-state-review
description: Capture and inspect named UI states with the existing manifest/gallery tools.
disable-model-invocation: true
argument-hint: "[app, route, or run dir]"
---

# Visual state review

Write the affected state list before capturing: routes/stories, loading, empty,
error, success, layout widths/modes, themes, and labeled scroll positions where
they exist. Record skipped states and why; a missing state is unverified.
Use [templates/manifest.json](templates/manifest.json) and the product's existing
renderer. Default artifacts: `~/.cache/visual-states/<project>/<run-id>/`, outside Git.

```sh
python3 path/to/scripts/gallery.py manifest.json --check
python3 path/to/scripts/gallery.py manifest.json --out index.html
```

The bundled [gallery.py](scripts/gallery.py) checks captured-state image presence.
Open `index.html` and look: clipped type, contrast, overlays, empty panels,
overflow, and wrong state can fail even pixel-identical shots. Record findings
in the manifest and recapture fixes. Exit 0 is not a visual verdict.

For changed player/design surfaces, including direct copy/color/size fixes, run
`bun ~/.local/bin/design-check <surface-paths>` (from the harness source:
`bun agent-config/bin/design-check.ts <surface-paths>`). It finds dash characters,
engineering vocabulary and placeholders; route findings by file/line.
Run axe-core on captured states and `npx impeccable detect <file>` when its
supported Hermes skill is installed. Screenshots do not clear copy checks.

Screenshots prove appearance, not backend operations. Keep those limits in
`notes`/`limitations`; `skill://story-qa` proves user outcomes. Large matrices
follow `skill://engineering-operations/workstation.md`. Unnamed states remain
invisible to the gallery: repair the matrix rather than adding one generic shot.
