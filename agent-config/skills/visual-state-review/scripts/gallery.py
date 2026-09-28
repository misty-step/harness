#!/usr/bin/env python3
"""Build a visual-state review gallery from a manifest. Fail closed on gaps."""

from __future__ import annotations

import argparse
import html
import json
import os
import struct
import sys
import tempfile
import zlib
from pathlib import Path
from typing import Any
from urllib.parse import quote


IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


def load_manifest(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"gallery: invalid JSON in {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise SystemExit(f"gallery: manifest must be an object: {path}")
    if not str(data.get("title") or "").strip():
        raise SystemExit("gallery: manifest.title is required")
    states = data.get("states")
    if not isinstance(states, list) or not states:
        raise SystemExit("gallery: manifest.states must be a non-empty array")
    seen_ids: set[str] = set()
    for i, state in enumerate(states):
        if not isinstance(state, dict):
            raise SystemExit(f"gallery: states[{i}] must be an object")
        state_id = str(state.get("id") or "").strip()
        if not state_id:
            raise SystemExit(f"gallery: states[{i}].id is required")
        if state_id in seen_ids:
            raise SystemExit(f"gallery: duplicate state id {state_id}")
        seen_ids.add(state_id)
        if not str(state.get("file") or "").strip():
            raise SystemExit(f"gallery: states[{i}].file is required")
        status = str(state.get("status") or "captured").strip().lower()
        if status not in {"captured", "skipped", "missing"}:
            raise SystemExit(
                f"gallery: states[{i}].status must be captured, skipped, or missing"
            )
        if status == "skipped" and not str(state.get("reason") or "").strip():
            raise SystemExit(
                f"gallery: states[{i}] is skipped but has no reason"
            )
        if "phase" in state and (
            not isinstance(state["phase"], str)
            or state["phase"] not in {"before", "after"}
        ):
            raise SystemExit(f"gallery: states[{i}].phase must be before or after")
        state["status"] = status
    data.setdefault("summary", "")
    data.setdefault("notes", "")
    data.setdefault("capturedAt", "")
    data.setdefault("coverage", [])
    data.setdefault("limitations", [])
    data.setdefault("findings", [])
    return data


def resolve_file(manifest_path: Path, state: dict[str, Any]) -> Path:
    raw = Path(str(state["file"]))
    if raw.is_absolute():
        return raw
    return (manifest_path.parent / raw).resolve()


def inspect(
    manifest_path: Path, data: dict[str, Any], require_subtraction: bool = False
) -> list[str]:
    errors: list[str] = []
    states = data["states"]
    for state in states:
        path = resolve_file(manifest_path, state)
        exists = path.is_file()
        status = state["status"]
        if status == "skipped":
            continue
        if status == "captured" and not exists:
            errors.append(f"{state['id']}: missing file {path}")
        elif status == "missing":
            errors.append(f"{state['id']}: declared missing")
        elif exists and path.suffix.lower() not in IMAGE_SUFFIXES:
            errors.append(f"{state['id']}: not an image file {path}")

    pairs = data.get("subtraction", [])
    if not isinstance(pairs, list):
        return errors + ["subtraction: must be an array"]
    if not require_subtraction and not pairs and not any(s.get("phase") for s in states):
        return errors
    if not pairs:
        errors.append("subtraction: no before/after pairs")
    by_id = {state["id"]: state for state in states}
    before_ids: set[str] = set()
    after_ids: set[str] = set()
    for index, pair in enumerate(pairs):
        label = f"subtraction[{index}]"
        if not isinstance(pair, dict):
            errors.append(f"{label}: must be an object")
            continue
        before_id = pair.get("before")
        after_id = pair.get("after")
        before = by_id.get(before_id) if isinstance(before_id, str) else None
        after = by_id.get(after_id) if isinstance(after_id, str) else None
        if before is None or after is None or before is after:
            errors.append(f"{label}: before and after must name distinct states")
            continue
        if before_id in before_ids or after_id in after_ids:
            errors.append(f"{label}: a state cannot belong to two subtraction pairs")
        before_ids.add(before_id)
        after_ids.add(after_id)
        if before.get("phase") != "before" or after.get("phase") != "after":
            errors.append(f"{label}: states must have before and after phases")
        if before["status"] != "captured" or after["status"] != "captured":
            errors.append(f"{label}: before and after must both be captured")
        before_file = resolve_file(manifest_path, before)
        after_file = resolve_file(manifest_path, after)
        same_file = os.path.realpath(before_file) == os.path.realpath(after_file)
        if not same_file and before_file.exists() and after_file.exists():
            same_file = os.path.samefile(before_file, after_file)
        if same_file:
            errors.append(
                f"{label}: before and after must be different image files; "
                f"{before_file} and {after_file} are the same file"
            )
        for field in ("group", "size", "theme", "scroll"):
            if not before.get(field) or before[field] != after.get(field):
                errors.append(f"{label}: before and after must match {field}")
        if not filled(pair.get("job")):
            errors.append(f"{label}: primary job is required")
        kept = pair.get("kept")
        cut = pair.get("cut")
        deferred = pair.get("deferred")
        if not string_list(kept, nonempty=True):
            errors.append(f"{label}: kept must be a non-empty list of text")
        if not string_list(cut) or not string_list(deferred):
            errors.append(f"{label}: cut and deferred must be lists of text")
        elif not cut and not deferred and not filled(pair.get("keptReason")):
            errors.append(f"{label}: keptReason is required when nothing was cut or deferred")
        access = pair.get("access")
        if deferred and not string_list(access, nonempty=True):
            errors.append(f"{label}: access route is required for deferred content")
        retained = pair.get("retained")
        if not isinstance(retained, list) or not retained or any(
            not isinstance(item, dict)
            or not filled(item.get("action"))
            or not filled(item.get("observed"))
            for item in retained
        ):
            errors.append(f"{label}: retained task needs an action and observed result")
        if (
            deferred
            and string_list(access, nonempty=True)
            and isinstance(retained, list)
        ):
            observed_actions = {
                item["action"] for item in retained
                if isinstance(item, dict)
                and filled(item.get("action"))
                and filled(item.get("observed"))
            }
            for action in access:
                if action not in observed_actions:
                    errors.append(
                        f"{label}: deferred access route {action!r} needs an observed retained action"
                    )
    for state in states:
        if state.get("phase") == "after" and state["id"] not in after_ids:
            errors.append(f"{state['id']}: unpaired after state")
        if state.get("phase") == "before" and state["id"] not in before_ids:
            errors.append(f"{state['id']}: unpaired before state")
    return errors


def filled(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def string_list(value: Any, nonempty: bool = False) -> bool:
    return isinstance(value, list) and (not nonempty or bool(value)) and all(
        filled(item) for item in value
    )


def unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            out.append(value)
    return out


def option_values(states: list[dict[str, Any]], key: str) -> list[str]:
    return unique([str(state.get(key) or "").strip() for state in states])


def options_html(label: str, key: str, values: list[str]) -> str:
    if not values:
        return ""
    items = "\n".join(
        f'      <option value="{html.escape(value)}">{html.escape(value)}</option>'
        for value in values
    )
    return (
        f'    <label>{html.escape(label)}\n'
        f'      <select data-filter="{html.escape(key)}">\n'
        f'      <option value="">All {html.escape(label.lower())}</option>\n'
        f"{items}\n"
        "      </select>\n"
        "    </label>"
    )


def image_url(manifest_path: Path, state: dict[str, Any] | None) -> str | None:
    """Return a safe relative URL for a captured, existing image file, else None."""
    if state is None or state.get("status") != "captured":
        return None
    path = resolve_file(manifest_path, state)
    if not path.is_file() or path.suffix.lower() not in IMAGE_SUFFIXES:
        return None
    rel = Path(os.path.relpath(path, manifest_path.parent)).as_posix()
    # "./" plus percent-encoding keeps a name like "javascript:x.png" a relative path.
    return "./" + quote(rel, safe="/")


def card_html(manifest_path: Path, state: dict[str, Any], pair_index: int | None = None) -> str:
    tags = [
        str(state.get("kind") or ""),
        str(state.get("theme") or ""),
        str(state.get("size") or ""),
        str(state.get("scroll") or ""),
        str(state.get("phase") or ""),
        str(state.get("status") or ""),
    ]
    tag_line = " · ".join(t for t in tags if t)
    url = image_url(manifest_path, state)
    if url:
        img = (
            f'      <a class="shot" href="{html.escape(url)}" title="Open full capture">'
            f'<img src="{html.escape(url)}" alt="{html.escape(str(state["id"]))}" loading="lazy"></a>'
        )
    else:
        reason = str(state.get("reason") or "not captured")
        img = f'      <div class="missing">{html.escape(reason)}</div>'
    attrs = " ".join(
        f'data-{key}="{html.escape(str(state.get(key) or ""))}"'
        for key in ("id", "group", "size", "scroll", "theme", "kind", "phase", "status")
    )
    pair_link = (
        f'\n      <p class="tags"><a href="#pair-{pair_index + 1}">Compare pair {pair_index + 1}</a></p>'
        if pair_index is not None
        else ""
    )
    return (
        f'    <article class="card" {attrs}>\n'
        f"{img}\n"
        f'      <p class="tags">{html.escape(tag_line)}</p>\n'
        f'      <h2>{html.escape(str(state["id"]))}</h2>{pair_link}\n'
        "    </article>"
    )


def list_html(title: str, items: Any, empty: str) -> str:
    if not items:
        return f"<p>{html.escape(empty)}</p>"
    if isinstance(items, list) and items and isinstance(items[0], dict):
        rows = []
        for item in items:
            state = html.escape(str(item.get("state") or ""))
            severity = html.escape(str(item.get("severity") or ""))
            note = html.escape(str(item.get("note") or item.get("reason") or ""))
            rows.append(f"<li><strong>{state}</strong> [{severity}] {note}</li>")
        return f"<h2>{html.escape(title)}</h2><ul>\n" + "\n".join(rows) + "\n</ul>"
    bullets = "\n".join(f"<li>{html.escape(str(item))}</li>" for item in items)
    return f"<h2>{html.escape(title)}</h2><ul>\n{bullets}\n</ul>"

def pair_indexes(pairs: Any) -> dict[str, int]:
    indexes: dict[str, int] = {}
    if not isinstance(pairs, list):
        return indexes
    for index, pair in enumerate(pairs):
        if isinstance(pair, dict):
            for key in ("before", "after"):
                if isinstance(pair.get(key), str):
                    indexes.setdefault(pair[key], index)
    return indexes


def pair_figure(manifest_path: Path, state_id: Any, state: dict[str, Any] | None, phase: str) -> str:
    name = html.escape(str(state_id or ""))
    url = image_url(manifest_path, state)
    if url:
        href = html.escape(url)
        shot = f'<a href="{href}" title="Open full capture"><img src="{href}" alt="{phase}: {name}" loading="lazy"></a>'
        caption = f'{phase} · <a href="{href}">{name}</a>'
    else:
        reason = "state not in manifest" if state is None else str(state.get("reason") or "not captured")
        shot = f'<div class="missing">{html.escape(reason)}</div>'
        caption = f"{phase} · {name}"
    return f'<figure class="pair-shot">{shot}<figcaption>{caption}</figcaption></figure>'


def detail_list(name: str, values: Any) -> str:
    if not isinstance(values, list) or not values:
        return ""
    items = "".join(f"<li>{html.escape(str(value))}</li>" for value in values)
    return f"<dt>{html.escape(name)}</dt><dd><ul>{items}</ul></dd>"


def subtraction_html(manifest_path: Path, states: list[dict[str, Any]], pairs: Any) -> str:
    if not isinstance(pairs, list) or not pairs:
        return ""
    by_id = {state["id"]: state for state in states}
    sections = []
    for index, pair in enumerate(pairs):
        if not isinstance(pair, dict):
            continue
        before_id, after_id = pair.get("before"), pair.get("after")
        before = by_id.get(before_id) if isinstance(before_id, str) else None
        after = by_id.get(after_id) if isinstance(after_id, str) else None
        source = before or after or {}
        context = " · ".join(
            str(source.get(key) or "") for key in ("group", "size", "theme", "scroll") if source.get(key)
        )
        title = f"Pair {index + 1}" + (f": {context}" if context else "")
        details = []
        if filled(pair.get("job")):
            details.append(f"<dt>Job</dt><dd>{html.escape(pair['job'])}</dd>")
        for name, key in (("Kept", "kept"), ("Cut", "cut"), ("Deferred", "deferred"), ("Access", "access")):
            details.append(detail_list(name, pair.get(key)))
        if filled(pair.get("keptReason")):
            details.append(f"<dt>No safe cut</dt><dd>{html.escape(pair['keptReason'])}</dd>")
        retained = pair.get("retained")
        if isinstance(retained, list):
            rows = "".join(
                f"<li><strong>{html.escape(str(item.get('action', '')))}</strong> → "
                f"{html.escape(str(item.get('observed', '')))}</li>"
                for item in retained
                if isinstance(item, dict)
            )
            if rows:
                details.append(f"<dt>Retained</dt><dd><ul>{rows}</ul></dd>")
        sections.append(
            f'<section class="pair" id="pair-{index + 1}">'
            f"<h3>{html.escape(title)}</h3>"
            f'<p class="tags">{html.escape(str(before_id or ""))} → {html.escape(str(after_id or ""))}</p>'
            f'<div class="pair-shots">{pair_figure(manifest_path, before_id, before, "Before")}'
            f'{pair_figure(manifest_path, after_id, after, "After")}</div>'
            f"<dl>{''.join(details)}</dl></section>"
        )
    return '<section class="review"><h2>Subtraction</h2>\n' + "\n".join(sections) + "\n</section>"


def render(manifest_path: Path, data: dict[str, Any]) -> str:
    states = data["states"]
    captured = sum(1 for s in states if s["status"] == "captured")
    summary = str(data.get("summary") or "").strip() or (
        f"{captured} screenshots covering {len(states)} named states."
    )
    notes = str(data.get("notes") or "").strip()
    captured_at = str(data.get("capturedAt") or "").strip()
    filters = "\n".join(
        part
        for part in (
            options_html("groups", "group", option_values(states, "group")),
            options_html("sizes", "size", option_values(states, "size")),
            options_html("scroll", "scroll", option_values(states, "scroll")),
            options_html("phases", "phase", option_values(states, "phase")),
            options_html("themes", "theme", option_values(states, "theme")),
        )
        if part
    )
    pairs = data.get("subtraction")
    paired = pair_indexes(pairs)
    cards = "\n".join(card_html(manifest_path, state, paired.get(state["id"])) for state in states)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(str(data["title"]))}</title>
  <style>
    :root {{ color-scheme: dark; }}
    body {{ margin: 0; font: 15px/1.45 ui-sans-serif, system-ui, sans-serif;
      background: #111; color: #e8e8e8; }}
    header, nav, .toolbar, main, footer {{ padding: 1rem 1.25rem; }}
    header p, footer p, footer ul {{ max-width: 75ch; overflow-wrap: anywhere; }}
    header {{ border-bottom: 1px solid #2a2a2a; }}
    h1 {{ margin: 0 0 .4rem; font-size: 1.4rem; }}
    .meta, .tags {{ color: #9a9a9a; font-size: .85rem; }}
    a {{ color: #8ab4ff; }}
    .toolbar {{ display: flex; flex-wrap: wrap; gap: .75rem; align-items: end;
      border-bottom: 1px solid #2a2a2a; }}
    .toolbar label {{ min-width: 0; max-width: 100%; }}
    input, select {{ background: #1c1c1c; color: inherit; border: 1px solid #333;
      border-radius: 4px; padding: .35rem .5rem; max-width: 100%; }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 1rem; padding: 1.25rem; }}
    .card {{ background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px;
      overflow: hidden; }}
    .card a.shot {{ display: block; }}
    .card img, .missing {{ width: 100%; aspect-ratio: 16/10; object-fit: cover;
      object-position: top; background: #000; display: block; }}
    .missing {{ display: grid; place-items: center; color: #c97; padding: 1rem; }}
    .card h2, .card .tags {{ margin: .4rem .75rem; }}
    .card h2 {{ font-size: .95rem; }}
    .hidden {{ display: none; }}
    footer section {{ margin-top: 1rem; }}
    .pair {{ max-width: 72rem; margin: 1.5rem 0 2.5rem; }}
    .pair h3 {{ margin: 0; font-size: 1.05rem; }}
    .pair .tags {{ margin: .2rem 0 0; overflow-wrap: anywhere; }}
    .pair-shots {{ display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: .75rem; margin: .75rem 0; }}
    .pair-shot {{ margin: 0; background: #1a1a1a; border: 1px solid #2a2a2a;
      border-radius: 8px; padding: .5rem; }}
    .pair-shot img {{ display: block; width: auto; height: auto; max-width: 100%;
      max-height: 85vh; margin: 0 auto; }}
    .pair-shot .missing {{ aspect-ratio: auto; min-height: 6rem; }}
    .pair-shot figcaption {{ margin-top: .4rem; color: #9a9a9a; font-size: .85rem;
      overflow-wrap: anywhere; }}
    .pair dl {{ max-width: 75ch; margin: 0; overflow-wrap: anywhere; }}
    .pair dt {{ margin-top: .75rem; font-weight: 700; }}
    .pair dd {{ margin: .2rem 0 0; }}
    .pair dd ul {{ margin: 0; padding-left: 1.25rem; }}
    .pair dd li + li {{ margin-top: .25rem; }}
  </style>
</head>
<body>
  <header>
    <h1>{html.escape(str(data["title"]))}</h1>
    <p class="meta">{html.escape(summary)}</p>
    <p>{html.escape(notes)}</p>
    <p class="meta">{html.escape(captured_at)} · {captured} / {len(states)} captured</p>
  </header>
  <div class="toolbar" role="search" aria-label="Filter captures">
    <label>Search
      <input id="q" type="search" placeholder="Search state, group...">
    </label>
{filters}
    <span class="meta" id="count">{captured} / {len(states)} captures</span>
  </div>
  <main class="grid">
{cards}
  </main>
  <footer>
    {subtraction_html(manifest_path, states, pairs)}
    {list_html("Coverage", data.get("coverage"), "No coverage notes.")}
    {list_html("Limitations", data.get("limitations"), "No limitations recorded.")}
    {list_html("Findings", data.get("findings"), "No findings recorded.")}
  </footer>
  <script>
    const cards = [...document.querySelectorAll(".card")];
    const filters = [...document.querySelectorAll("[data-filter]")];
    const q = document.getElementById("q");
    const count = document.getElementById("count");
    function match(card) {{
      const query = (q.value || "").toLowerCase();
      if (query && !card.dataset.id.toLowerCase().includes(query)
          && !(card.dataset.group || "").toLowerCase().includes(query)) return false;
      return filters.every((el) => !el.value || card.dataset[el.dataset.filter] === el.value);
    }}
    function apply() {{
      let n = 0;
      for (const card of cards) {{
        const ok = match(card);
        card.classList.toggle("hidden", !ok);
        if (ok) n += 1;
      }}
      count.textContent = n + " / " + cards.length + " captures";
    }}
    q.addEventListener("input", apply);
    filters.forEach((el) => el.addEventListener("change", apply));
  </script>
</body>
</html>
"""


def write_png(path: Path, width: int = 1, height: int = 1) -> None:
    def chunk(tag: bytes, payload: bytes) -> bytes:
        crc = zlib.crc32(tag + payload) & 0xFFFFFFFF
        return struct.pack(">I", len(payload)) + tag + payload + struct.pack(">I", crc)

    raw = b"".join(b"\x00" + (b"\xff\x00\x00" * width) for _ in range(height))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def self_test() -> int:
    base = os.environ.get("TMPDIR") or str(Path.home() / ".cache" / "tmp")
    Path(base).mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="visual-state-review-", dir=base) as raw:
        root = Path(raw)
        png = root / "01-home.png"
        write_png(png)
        manifest_path = root / "manifest.json"
        manifest = {
            "title": "Self-test · Visual state review",
            "capturedAt": "test",
            "states": [
                {
                    "id": "01-home",
                    "file": "01-home.png",
                    "group": "home",
                    "size": "1x1",
                    "scroll": "top",
                    "theme": "dark",
                    "kind": "replay",
                    "status": "captured",
                },
                {
                    "id": "02-empty",
                    "file": "02-empty.png",
                    "group": "empty",
                    "status": "skipped",
                    "reason": "fixture has no empty route",
                },
            ],
            "coverage": ["home"],
            "limitations": ["fixture has no empty route"],
            "findings": [],
        }
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        data = load_manifest(manifest_path)
        errors = inspect(manifest_path, data)
        if errors:
            print("self-test: unexpected check errors:", *errors, sep="\n", file=sys.stderr)
            return 1
        html_out = render(manifest_path, data)
        if "01-home" not in html_out or "02-empty" not in html_out:
            print("self-test: gallery omitted a state id", file=sys.stderr)
            return 1
        broken = json.loads(manifest_path.read_text(encoding="utf-8"))
        broken["states"][1]["status"] = "captured"
        del broken["states"][1]["reason"]
        broken_path = root / "broken.json"
        broken_path.write_text(json.dumps(broken), encoding="utf-8")
        broken_data = load_manifest(broken_path)
        if not inspect(broken_path, broken_data):
            print("self-test: --check should fail on a missing captured file", file=sys.stderr)
            return 1
        print("gallery self-test OK")
        return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", nargs="?", type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--require-subtraction", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)
    if args.self_test:
        return self_test()
    if args.manifest is None:
        parser.error("manifest is required unless --self-test")
    manifest_path = args.manifest.resolve()
    if not manifest_path.is_file():
        raise SystemExit(f"gallery: manifest not found: {manifest_path}")
    data = load_manifest(manifest_path)
    errors = inspect(manifest_path, data, args.require_subtraction)
    for err in errors:
        print(err, file=sys.stderr)
    if args.check:
        if errors:
            print(
                f"gallery: {len(errors)} unverified state(s); matrix is not complete",
                file=sys.stderr,
            )
            return 1
        print("gallery: matrix complete")
        return 0
    out = args.out or (manifest_path.parent / "index.html")
    out.write_text(render(manifest_path, data), encoding="utf-8")
    print(out)
    if errors:
        print(
            f"gallery: wrote {out} with {len(errors)} unverified state(s)",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
