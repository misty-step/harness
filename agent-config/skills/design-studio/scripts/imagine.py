#!/usr/bin/env python3
"""Bounded image-generation adapter for design-studio (xAI Imagine path).

This is ONE adapter among several possible ones — not a quality default. Provider
selection is provider-neutral: see references/media-policy.md. It requires a Python
that can import the Hermes credential resolver for an AUTHORIZED profile:

    HERMES_HOME=<profile> <hermes-agent>/venv/bin/python imagine.py ...

Never prints credentials. Writes <id>.png + <id>.provenance.json per job.

Budget: the cap (default $3.00; override with --budget-usd or
DESIGN_STUDIO_BUDGET_USD) is ALWAYS enforced against caller-supplied price
evidence (--price-per-image, or a per-job "price_usd"). If any job has no price
evidence, the adapter fails closed (exit 3) instead of running unbounded;
--budget-usd 0 refuses any non-zero estimate.

Output safety: job ids must be safe file basenames (letters, digits, ".", "_",
"-"; no path separators, no "..", non-empty). Invalid ids are refused before
any network call or write, and artifact paths are re-checked against the output
directory at write time.

Usage:
  python3 imagine.py --jobs jobs.json --out DIR [--max-images 12]
                     [--budget-usd 3.0 --price-per-image 0.07] [--dry-run]
  python3 imagine.py --prompt "..." --out DIR [--id name] [--model M]
                     [--aspect 16:9] [--resolution 1k]
  python3 imagine.py --self-test

jobs.json: [{"id": "...", "prompt": "...", "model": "...", "aspect": "16:9",
             "resolution": "1k", "price_usd": 0.07}, ...]

Exit codes: 0 ok; 2 access/environment or invalid input; 3 budget refusal;
4 partial failure.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import sys
import time

DEFAULT_MODEL = "grok-imagine-image-2.0"
DEFAULT_ASPECT = "16:9"
DEFAULT_RESOLUTION = "1k"
MAX_RETRIES = 2
DEFAULT_BUDGET_USD = 3.00
SAFE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
IMAGE_MAGIC = (
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"\xff\xd8\xff", "jpeg"),
    (b"GIF87a", "gif"),
    (b"GIF89a", "gif"),
)


def validate_job_id(job_id) -> str:
    """Return an empty string when the id is a safe basename, else the reason."""
    if not isinstance(job_id, str) or not job_id:
        return "missing or empty"
    if ".." in job_id:
        return "contains '..'"
    if not SAFE_ID_RE.match(job_id):
        return "unsafe characters (allowed: A-Z a-z 0-9 . _ -)"
    if os.path.basename(job_id) != job_id or os.path.dirname(job_id):
        return "path separators"
    return ""


def artifact_path(out_dir: str, job_id: str, suffix: str) -> str:
    """Resolve <out_dir>/<id><suffix>, refusing anything that escapes out_dir."""
    reason = validate_job_id(job_id)
    if reason:
        raise ValueError(f"unsafe job id {job_id!r}: {reason}")
    root = os.path.realpath(out_dir)
    path = os.path.join(root, job_id + suffix)
    if os.path.dirname(path) != root:
        raise ValueError(f"job id escapes the output directory: {job_id!r}")
    return path


def validate_image_bytes(raw: bytes) -> str:
    """Return the detected image format, or raise when the payload is not an image."""
    if not raw or len(raw) < 12:
        raise ValueError("empty or truncated payload")
    for magic, fmt in IMAGE_MAGIC:
        if raw.startswith(magic):
            return fmt
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "webp"
    head = bytes(raw[:64]).lstrip().lower()
    if head.startswith((b"<", b"{")):
        raise ValueError("payload is not an image (looks like an error page or JSON)")
    raise ValueError("payload is not a recognized image format")


def fetch_image_bytes(session, url: str, timeout: int = 180) -> bytes:
    """Download an image URL with status, content-type, and payload validation."""
    r = session.get(url, timeout=timeout)
    r.raise_for_status()
    raw = r.content or b""
    ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
    if ctype and not ctype.startswith("image/"):
        raise ValueError(f"unexpected content type {ctype!r}")
    validate_image_bytes(raw)
    return raw


def estimate_batch_usd(jobs, price_per_image=None):
    """Sum caller-supplied price evidence; report jobs with no price evidence."""
    total = 0.0
    missing = []
    for job in jobs:
        price = price_per_image if price_per_image is not None else job.get("price_usd")
        if isinstance(price, (int, float)) and not isinstance(price, bool) and price >= 0:
            total += float(price)
        else:
            missing.append(job.get("id") or "<unnamed>")
    return round(total, 4), missing


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
    import requests  # noqa: F401  (kept for parity with callers that inject a session)
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
                validate_image_bytes(raw)
            elif item.get("url"):
                raw = fetch_image_bytes(session, item["url"], timeout=180)
            else:
                last_error = "no image in response"
                if attempt < MAX_RETRIES: continue
                raise RuntimeError(last_error)
            png = artifact_path(out_dir, job["id"], ".png")
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
            with open(artifact_path(out_dir, job["id"], ".provenance.json"), "w") as fh:
                json.dump(prov, fh, indent=1)
            return {"id": job["id"], "ok": True, "path": png, "latency_s": latency, "bytes": len(raw)}
        except Exception as exc:  # noqa: BLE001
            last_error = f"{type(exc).__name__}: {str(exc)[:200]}"
            if attempt < MAX_RETRIES:
                time.sleep(2 + attempt * 2)
    return {"id": job["id"], "ok": False, "error": last_error}


def self_test() -> int:
    """Credential-free checks of the guards: ids, paths, payloads, prices."""
    import tempfile

    failures: list[str] = []

    def check(name: str, ok: bool) -> None:
        if not ok:
            failures.append(name)

    for bad in ("../escape", "/abs/evil", "a/b", "", ".hidden", "a..b", "x/../../y"):
        check(f"reject id {bad!r}", validate_job_id(bad) != "")
    for good in ("c1-console", "t1-mai-image-2.5", "image_01", "A.b-c_d"):
        check(f"accept id {good!r}", validate_job_id(good) == "")

    with tempfile.TemporaryDirectory() as tmp:
        root = os.path.realpath(tmp)
        p = artifact_path(tmp, "ok-id", ".png")
        check("artifact path stays inside out dir", os.path.dirname(p) == root)
        for bad in ("../escape", "/abs", "a/b", ""):
            try:
                artifact_path(tmp, bad, ".png")
                check(f"path escape rejected for {bad!r}", False)
            except ValueError:
                check(f"path escape rejected for {bad!r}", True)

    check("png detected", validate_image_bytes(b"\x89PNG\r\n\x1a\n" + b"0" * 16) == "png")
    check("jpeg detected", validate_image_bytes(b"\xff\xd8\xff\xe0" + b"0" * 16) == "jpeg")
    for bad in (b"", b"<html><body>expired</body></html>", b'{ "error": true }', b"noise" * 4):
        try:
            validate_image_bytes(bad)
            check(f"payload rejected {bad[:16]!r}", False)
        except ValueError:
            check(f"payload rejected {bad[:16]!r}", True)

    class Resp:
        def __init__(self, status=200, body=b"", headers=None):
            self.status_code = status
            self._body = body
            self.headers = headers or {}

        def raise_for_status(self):
            if self.status_code >= 400:
                raise RuntimeError(f"http {self.status_code}")

        @property
        def content(self):
            return self._body

    class Session:
        def __init__(self, resp):
            self.resp = resp

        def get(self, url, timeout=180):
            return self.resp

    ok_png = b"\x89PNG\r\n\x1a\n" + b"0" * 64
    check("fetch returns a valid payload",
          fetch_image_bytes(Session(Resp(200, ok_png, {"Content-Type": "image/png"})), "u") == ok_png)
    for name, resp in (
        ("http 404", Resp(404, b"<html>gone</html>", {"Content-Type": "text/html"})),
        ("html body", Resp(200, b"<html>expired</html>", {"Content-Type": "text/html"})),
        ("png body, html type", Resp(200, ok_png, {"Content-Type": "text/html"})),
        ("empty body", Resp(200, b"", {"Content-Type": "image/png"})),
    ):
        try:
            fetch_image_bytes(Session(resp), "u")
            check(f"fetch rejects {name}", False)
        except Exception:  # noqa: BLE001
            check(f"fetch rejects {name}", True)

    est, missing = estimate_batch_usd([{"id": "a", "price_usd": 0.05}, {"id": "b"}])
    check("estimate sums per-job prices", est == 0.05)
    check("estimate flags missing price", missing == ["b"])
    est2, missing2 = estimate_batch_usd([{"id": "a"}, {"id": "b"}], price_per_image=0.1)
    check("global price overrides", est2 == 0.2 and missing2 == [])

    if failures:
        for failure in failures:
            print(f"FAIL {failure}", file=sys.stderr)
        return 1
    print("imagine self-test OK")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs")
    ap.add_argument("--prompt")
    ap.add_argument("--id", default="image")
    ap.add_argument("--out")
    ap.add_argument("--model")
    ap.add_argument("--aspect", default=DEFAULT_ASPECT)
    ap.add_argument("--resolution", default=DEFAULT_RESOLUTION)
    ap.add_argument("--max-images", type=int, default=12)
    ap.add_argument("--budget-usd", type=float)
    ap.add_argument("--price-per-image", type=float)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()

    if args.self_test:
        return self_test()
    if not args.out:
        ap.error("--out is required (unless --self-test)")

    if args.jobs:
        with open(args.jobs) as fh:
            jobs = json.load(fh)
    elif args.prompt:
        jobs = [{"id": args.id, "prompt": args.prompt, "model": args.model,
                 "aspect": args.aspect, "resolution": args.resolution}]
    else:
        ap.error("provide --jobs or --prompt")

    rejected = [{"id": job.get("id"), "reason": validate_job_id(job.get("id"))} for job in jobs]
    rejected = [entry for entry in rejected if entry["reason"]]
    if rejected:
        print(json.dumps({
            "error": "invalid_job_id", "rejected": rejected[:10],
            "hint": "ids must be a safe file basename: letters/digits/._- only, "
                    "no path separators, no '..', non-empty",
        }))
        return 2

    if len(jobs) > args.max_images:
        print(json.dumps({"error": "max_images_exceeded", "jobs": len(jobs), "cap": args.max_images}))
        return 3

    budget = args.budget_usd
    if budget is None:
        raw_budget = os.environ.get("DESIGN_STUDIO_BUDGET_USD")
        if raw_budget not in (None, ""):
            try:
                budget = float(raw_budget)
            except ValueError:
                print(json.dumps({"error": "invalid_budget",
                                  "hint": "DESIGN_STUDIO_BUDGET_USD must be a number"}))
                return 2
        else:
            budget = DEFAULT_BUDGET_USD
    if budget < 0:
        print(json.dumps({"error": "invalid_budget", "hint": "budget must be >= 0"}))
        return 2

    estimate, missing_price = estimate_batch_usd(jobs, args.price_per_image)
    if missing_price:
        print(json.dumps({
            "error": "price_unknown", "jobs_missing_price": missing_price[:10],
            "hint": "supply --price-per-image (or per-job price_usd) so the budget cap "
                    "is enforceable; the adapter fails closed without price evidence",
        }))
        return 3
    if estimate > budget:
        print(json.dumps({"error": "budget_exceeded", "estimate_usd": estimate,
                          "cap_usd": budget,
                          "note": "estimate uses caller-supplied price evidence; "
                                  "raise the cap explicitly to proceed"}))
        return 3

    os.makedirs(args.out, exist_ok=True)
    if args.dry_run:
        print(json.dumps({"dry_run": True, "jobs": [job["id"] for job in jobs],
                          "estimate_usd": estimate, "cap_usd": budget}))
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