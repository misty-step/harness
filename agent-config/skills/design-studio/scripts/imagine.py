#!/usr/bin/env python3
"""Bounded image-generation adapter for design-studio (xAI Imagine path).

This is ONE adapter among several possible ones — not a quality default. Provider
selection is provider-neutral: see references/media-policy.md. It requires a Python
that can import the Hermes credential resolver for an AUTHORIZED profile:

    HERMES_HOME=<profile> <hermes-agent>/venv/bin/python imagine.py ...

Never prints credentials. Writes <id>.png + <id>.provenance.json per job.

Usage:
  python3 imagine.py --jobs jobs.json --out DIR [--max-images 12]
                     [--budget-usd 3.0 --price-per-image 0.07] [--dry-run]
  python3 imagine.py --prompt "..." --out DIR [--id name] [--model M]
                     [--aspect 16:9] [--resolution 1k]

jobs.json: [{"id": "...", "prompt": "...", "model": "...", "aspect": "16:9",
             "resolution": "1k"}, ...]

Exit codes: 0 ok; 2 access/environment error; 3 budget refusal; 4 partial failure.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import sys
import time

DEFAULT_MODEL = "grok-imagine-image-2.0"
DEFAULT_ASPECT = "16:9"
DEFAULT_RESOLUTION = "1k"
MAX_RETRIES = 2


def resolve_env():
    """Locate the Hermes install and resolve authorized xAI credentials (never printed)."""
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.environ.get("HERMES_AGENT_DIR", ""),
        os.path.expanduser("~/.hermes/hermes-agent"),
    ]
    # Walk up from this script's location in case it lives inside a checkout.
    probe = here
    for _ in range(6):
        probe = os.path.dirname(probe)
        if os.path.isdir(os.path.join(probe, "tools")):
            candidates.append(probe)
    for base in candidates:
        if base and os.path.isfile(os.path.join(base, "tools", "xai_http.py")):
            sys.path.insert(0, base)
            break
    try:
        from tools.xai_http import resolve_xai_http_credentials, hermes_xai_user_agent
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({
            "error": "no_hermes_resolver",
            "detail": str(exc)[:200],
            "hint": "Run with the Hermes venv python and HERMES_HOME set to an authorized "
                    "profile, e.g. HERMES_HOME=~/.hermes/profiles/<name> <hermes>/venv/bin/python",
        }))
        raise SystemExit(2)
    creds = resolve_xai_http_credentials()
    if not creds.get("api_key"):
        print(json.dumps({"error": "no_credentials", "hint": "Profile has no authorized xAI credential."}))
        raise SystemExit(2)
    return creds, hermes_xai_user_agent


def generate_one(session, creds, agent, job, out_dir):
    import requests
    base = str(creds.get("base_url") or "https://api.x.ai/v1").rstrip("/")
    model = job.get("model") or os.environ.get("XAI_IMAGE_MODEL") or DEFAULT_MODEL
    aspect = job.get("aspect") or DEFAULT_ASPECT
    resolution = job.get("resolution") or DEFAULT_RESOLUTION
    payload = {"model": model, "prompt": job["prompt"], "aspect_ratio": aspect, "resolution": resolution}
    last_error = ""
    for attempt in range(MAX_RETRIES + 1):
        t0 = time.time()
        try:
            r = session.post(f"{base}/images/generations",
                             headers={"Authorization": f"Bearer {creds['api_key']}",
                                      "User-Agent": agent(), "Content-Type": "application/json"},
                             json=payload, timeout=180)
            latency = round(time.time() - t0, 1)
            if r.status_code >= 500 and attempt < MAX_RETRIES:
                last_error = f"http {r.status_code}"; time.sleep(2 + attempt * 2); continue
            r.raise_for_status()
            data = r.json()
            item = (data.get("data") or [{}])[0]
            if item.get("b64_json"):
                raw = base64.b64decode(item["b64_json"])
            elif item.get("url"):
                raw = session.get(item["url"], timeout=180).content
            else:
                last_error = "no image in response"
                if attempt < MAX_RETRIES: continue
                raise RuntimeError(last_error)
            png = os.path.join(out_dir, f"{job['id']}.png")
            with open(png, "wb") as fh:
                fh.write(raw)
            prov = {
                "kind": "generated-concept-image", "id": job["id"], "provider": "xai",
                "model": model, "prompt": job["prompt"], "aspect_ratio": aspect,
                "resolution": resolution, "latency_s": latency, "bytes": len(raw),
                "sha256": hashlib.sha256(raw).hexdigest(), "attempt": attempt,
                "cost": {"amount_usd": None, "basis": "unknown",
                         "note": "provider does not return per-image charges"},
            }
            with open(os.path.join(out_dir, f"{job['id']}.provenance.json"), "w") as fh:
                json.dump(prov, fh, indent=1)
            return {"id": job["id"], "ok": True, "path": png, "latency_s": latency, "bytes": len(raw)}
        except Exception as exc:  # noqa: BLE001
            last_error = f"{type(exc).__name__}: {str(exc)[:200]}"
            if attempt < MAX_RETRIES:
                time.sleep(2 + attempt * 2)
    return {"id": job["id"], "ok": False, "error": last_error}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs")
    ap.add_argument("--prompt")
    ap.add_argument("--id", default="image")
    ap.add_argument("--out", required=True)
    ap.add_argument("--model")
    ap.add_argument("--aspect", default=DEFAULT_ASPECT)
    ap.add_argument("--resolution", default=DEFAULT_RESOLUTION)
    ap.add_argument("--max-images", type=int, default=12)
    ap.add_argument("--budget-usd", type=float)
    ap.add_argument("--price-per-image", type=float)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if args.jobs:
        with open(args.jobs) as fh:
            jobs = json.load(fh)
    elif args.prompt:
        jobs = [{"id": args.id, "prompt": args.prompt, "model": args.model,
                 "aspect": args.aspect, "resolution": args.resolution}]
    else:
        ap.error("provide --jobs or --prompt")

    if len(jobs) > args.max_images:
        print(json.dumps({"error": "max_images_exceeded", "jobs": len(jobs), "cap": args.max_images}))
        return 3
    if args.budget_usd is not None and args.price_per_image is not None:
        est = len(jobs) * args.price_per_image
        if est > args.budget_usd:
            print(json.dumps({"error": "budget_exceeded", "estimate_usd": round(est, 2),
                              "cap_usd": args.budget_usd,
                              "note": "estimate uses --price-per-image; raise the cap explicitly to proceed"}))
            return 3

    os.makedirs(args.out, exist_ok=True)
    if args.dry_run:
        print(json.dumps({"dry_run": True, "jobs": [j["id"] for j in jobs]}))
        return 0

    creds, agent = resolve_env()
    import requests
    session = requests.Session()
    results = [generate_one(session, creds, agent, job, args.out) for job in jobs]
    summary = {"results": results, "ok": sum(1 for r in results if r["ok"]),
               "failed": sum(1 for r in results if not r["ok"])}
    print(json.dumps(summary, indent=1))
    return 0 if summary["failed"] == 0 else 4


if __name__ == "__main__":
    raise SystemExit(main())
