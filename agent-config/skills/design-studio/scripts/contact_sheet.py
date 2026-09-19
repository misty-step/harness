#!/usr/bin/env python3
"""Build an HTML contact sheet from generated images + their provenance sidecars.

Usage: python3 contact_sheet.py DIR [--out DIR/sheet.html] [--title "..."]

Reads <id>.png + <id>.provenance.json pairs in DIR (non-recursive), writes a grid with
image, id, model, prompt (truncated), latency. Generated images are mood evidence only —
the sheet footer says so.
"""
from __future__ import annotations

import argparse
import html
import json
import os


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("dir")
    ap.add_argument("--out")
    ap.add_argument("--title", default="Contact sheet — generated concept images")
    args = ap.parse_args()
    out = args.out or os.path.join(args.dir, "sheet.html")
    cards = []
    for name in sorted(os.listdir(args.dir)):
        if not name.endswith(".provenance.json"):
            continue
        prov_path = os.path.join(args.dir, name)
        try:
            prov = json.load(open(prov_path))
        except Exception:  # noqa: BLE001
            continue
        img = prov.get("id", name.replace(".provenance.json", ""))
        png = img + ".png"
        if not os.path.exists(os.path.join(args.dir, png)):
            continue
        prompt = (prov.get("prompt") or "")[:220]
        cards.append(f"""
  <figure>
    <img src="{html.escape(png)}" alt="{html.escape(img)}">
    <figcaption>
      <strong>{html.escape(img)}</strong> · {html.escape(str(prov.get('model', '?')))}
      · {html.escape(str(prov.get('latency_s', '?')))}s
      <div class="prompt">{html.escape(prompt)}</div>
    </figcaption>
  </figure>""")
    doc = f"""<!doctype html>
<meta charset="utf-8"><title>{html.escape(args.title)}</title>
<style>
  body {{ font: 14px/1.5 system-ui, sans-serif; margin: 24px; background: #101214; color: #e8e8e8; }}
  .grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }}
  figure {{ margin: 0; background: #181b1f; border: 1px solid #2a2e33; border-radius: 8px; overflow: hidden; }}
  img {{ width: 100%; display: block; }}
  figcaption {{ padding: 8px 10px; font-size: 12px; }}
  .prompt {{ color: #9aa3ad; margin-top: 4px; }}
  footer {{ margin-top: 24px; color: #9aa3ad; font-size: 12px; }}
</style>
<h1 style="font-size:18px">{html.escape(args.title)}</h1>
<div class="grid">{''.join(cards)}</div>
<footer>Generated images are mood/composition evidence only — not UX, accessibility,
or behavior proof. {len(cards)} artifacts.</footer>
"""
    with open(out, "w") as fh:
        fh.write(doc)
    print(json.dumps({"sheet": out, "artifacts": len(cards)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
