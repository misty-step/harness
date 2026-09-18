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
    for i, state in enumerate(states):
        if not isinstance(state, dict):
            raise SystemExit(f"gallery: states[{i}] must be an object")
        if not str(state.get("id") or "").strip():
            raise SystemExit(f"gallery: states[{i}].id is required")
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


def inspect(manifest_path: Path, data: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    for state in data["states"]:
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
    return errors


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


def card_html(manifest_path: Path, state: dict[str, Any]) -> str:
    rel = os.path.relpath(resolve_file(manifest_path, state), manifest_path.parent)
    tags = [
        str(state.get("kind") or ""),
        str(state.get("theme") or ""),
        str(state.get("size") or ""),
        str(state.get("scroll") or ""),
        str(state.get("status") or ""),
    ]
    tag_line = " · ".join(t for t in tags if t)
    img = ""
    if state["status"] == "captured" and resolve_file(manifest_path, state).is_file():
        img = (
            f'      <img src="{html.escape(rel)}" '
            f'alt="{html.escape(str(state["id"]))}">'
        )
    else:
        reason = str(state.get("reason") or "not captured")
        img = f'      <div class="missing">{html.escape(reason)}</div>'
    attrs = " ".join(
        f'data-{key}="{html.escape(str(state.get(key) or ""))}"'
        for key in ("id", "group", "size", "scroll", "theme", "kind", "status")
    )
    return (
        f'    <article class="card" {attrs}>\n'
        f"{img}\n"
        f'      <p class="tags">{html.escape(tag_line)}</p>\n'
        f'      <h2>{html.escape(str(state["id"]))}</h2>\n'
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
            options_html("themes", "theme", option_values(states, "theme")),
        )
        if part
    )
    cards = "\n".join(card_html(manifest_path, state) for state in states)
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
    header {{ border-bottom: 1px solid #2a2a2a; }}
    h1 {{ margin: 0 0 .4rem; font-size: 1.4rem; }}
    .meta, .tags {{ color: #9a9a9a; font-size: .85rem; }}
    a {{ color: #8ab4ff; }}
    .toolbar {{ display: flex; flex-wrap: wrap; gap: .75rem; align-items: end;
      border-bottom: 1px solid #2a2a2a; }}
    input, select {{ background: #1c1c1c; color: inherit; border: 1px solid #333;
      border-radius: 4px; padding: .35rem .5rem; }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 1rem; padding: 1.25rem; }}
    .card {{ background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px;
      overflow: hidden; }}
    .card img, .missing {{ width: 100%; aspect-ratio: 16/10; object-fit: cover;
      background: #000; display: block; }}
    .missing {{ display: grid; place-items: center; color: #c97; padding: 1rem; }}
    .card h2, .card .tags {{ margin: .4rem .75rem; }}
    .card h2 {{ font-size: .95rem; }}
    .hidden {{ display: none; }}
    footer section {{ margin-top: 1rem; }}
  </style>
</head>
<body>
  <header>
    <h1>{html.escape(str(data["title"]))}</h1>
    <p class="meta">{html.escape(summary)}</p>
    <p>{html.escape(notes)}</p>
    <p class="meta">{html.escape(captured_at)} · {captured} / {len(states)} captured</p>
  </header>
  <div class="toolbar">
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
    with tempfile.TemporaryDirectory(prefix="visual-state-review-") as raw:
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
    errors = inspect(manifest_path, data)
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
