---
name: visual-state-review
description: Capture and review every named UI state as screenshots.
disable-model-invocation: true
argument-hint: "[optional app, route, or run dir]"
---

# Visual state review

The class of error: shipping frontend work after one happy-path screenshot,
or none. A CSS test is not visual proof. A missing state is unverified.

The mechanism is a **named-state matrix**. Write the state list first. Capture
every state. Organise the shots. Look at them. [scripts/gallery.py](scripts/gallery.py)
`--check` fails closed when a declared captured state has no image.

This authors the matrix and the review. It does not authorize a pixel-diff CI
product, a new browser stack, or committing PNGs to Git.

## Enumerate, then capture

Name the states that exist, not the ones that look good. Start from routes,
stories, and the change under test. Include idle, loading, empty, error,
success, compact and fullscreen or equivalent layout modes, both themes when
the product has them, and labeled scroll positions when content overflows.
Record skipped states with a reason. Silent omission is a hole.

Write `manifest.json` from [templates/manifest.json](templates/manifest.json)
before the first screenshot. Then put the UI into each state and capture it
with whatever renderer the product already has (Playwright, Chromium, a
desktop bridge, a QML replay). Do not invent a second capture stack when one
exists. Large matrices belong on an approved exe.dev VM per host-resources
guidance, not unbounded on the workstation.

Replay and screenshots verify appearance. They do not prove backend operations
occurred. Say so in `notes` and `limitations`.

## Organise and look

Keep PNG artifacts out of Git. Default run directory:

`~/.cache/visual-states/<project>/<run-id>/`

```sh
python3 path/to/scripts/gallery.py manifest.json --check
python3 path/to/scripts/gallery.py manifest.json --out index.html
```

Open `index.html` (`file://` is enough). A human and an agent both look at the
pictures. Pixel-identical is not visual-OK: clipped type, inverted contrast,
overlay, empty panels, and wrong state still fail. Record findings on the
manifest and re-capture after a fix. `--check` exit 0 is necessary and not
sufficient.

## Residual class

States you never named never appear. Do not compensate with a single extra
screenshot of "the app". Expand the matrix, then capture.
