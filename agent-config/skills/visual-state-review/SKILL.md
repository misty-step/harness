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

## Subtraction evidence for designed surfaces

For each affected state, capture its before and after into distinct image files
at the same group, viewport, theme, scroll position, and render source (`kind`).
Both entries must record non-empty matching text for those fields; use the
actual source, such as `live` or `replay`. Unpaired states can omit `kind`.
Mark pair entries `phase: "before"` and `phase: "after"` in `states`. Add one
record per pair to the top-level `subtraction` array:

```json
{
  "before": "map-light-before",
  "after": "map-light-after",
  "job": "Inspect a goal and open a concept",
  "kept": ["Goal and due status", "Complete linked concept list and statuses", "Focus and pause actions"],
  "cut": ["Repeated chart labels"],
  "deferred": [],
  "retained": [
    {"action": "Open a concept from the list", "observed": "The complete status list and target concept remain reachable"}
  ]
}
```

Inventory the content kept, cut, and deferred for each named state: `kept` is a
non-empty list, while `cut` and `deferred` are explicit lists that may be empty.
If nothing can safely be cut, use `keptReason` instead of a `cut` entry. For
deferred content, supply `access` with each named action used to reveal it, and
record the same action with its observed result in `retained`. The gate matches
these action names, and refuses missing pairs, inventories, and observed tasks
with `--require-subtraction`. It cannot judge whether the content should have
been cut or whether the revealed information suffices. Walk the action and
route back on the real interface, including keyboard and assistive access;
note unavailable paths as limitations, never as proof.

## Organise and look

Keep PNG artifacts out of Git. Default run directory:

`~/.cache/visual-states/<project>/<run-id>/`

```sh
python3 path/to/scripts/gallery.py manifest.json --check
python3 path/to/scripts/gallery.py manifest.json --check --require-subtraction  # designed surfaces
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
