#!/usr/bin/env python3
# owned by misty-step/harness omp-config auditors
"""Read-only repository audits: one visible OMP auditor per active repository and audit.

  omp-audit run AUDIT [--repo OWNER/NAME]... [--concurrency N] [--dry-run] [--record-only]
  omp-audit repos
  omp-audit file --context FILE      one audit_file request as JSON on stdin (records it; files nothing)
  omp-audit refile RUN [--repo OWNER/NAME]   deliver a run's pending and stranded findings

`run` gathers each repository's evidence with code, checks it out fresh and starts one OMP auditor in
its own Herdr tab from the fixed template (auditors/template.md plus the audit's file). Auditors read;
their one write is `file`, which records each finding in the run. When an auditor ends, the launcher
delivers its findings outside the auditor's sandbox, one ticket per gap by a trusted marker: Habitat for
R90, the Glass board for Misty Step and for doctrine proposals. There is no ticket cap. A finding that
cannot be filed is stranded with its full request and fails the run loudly; `refile` delivers it later.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
import contextlib
from datetime import datetime, timedelta, timezone
import fcntl
import hashlib
import html
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

HOME = Path.home()
AUDITS = ("foundations", "principles", "simplicity")
ORGS = ("misty-step", "r90group")
ACTIVE_DAYS = 30
# Not projects: an archive mirror, a test fixture and Kaylee's journal.
EXCLUDED = frozenset({"misty-step/hermes-agent-archive", "misty-step/hermes-cloud-fixture", "misty-step/kaylee-journal"})
SHARE = Path(os.environ.get("OMP_AUDIT_HOME", HOME / ".local/share/omp-audit"))
STATE = Path(os.environ.get("OMP_AUDIT_STATE", HOME / ".local/state/omp-audit"))
# Not under ~/.cache/tmp: OMP sessions see a private copy of that tree and could not read a checkout there.
WORK = Path(os.environ.get("OMP_AUDIT_WORK", HOME / ".cache/omp-audit"))
AGENT_DIR = Path(os.environ.get("PI_CODING_AGENT_DIR", HOME / ".omp/agent"))
HABITAT = os.environ.get("OMP_AUDIT_HABITAT", str(HOME / "development/r90group/bin/habitat"))
# Subscription routes in preference order; omp-roster checks capacity and the working-engineer cap.
MODELS = (("openai-codex/gpt-6.1-sol", "high"), ("anthropic/claude-opus-5-5", "high"))
TOOLS = "read,grep,glob,audit_file"
CONCURRENCY = 6
AUDITOR_MINUTES = 120
CAPACITY_WAIT_SECONDS = 8 * 3600
HERDR = ("herdr", "--session", "default")
PORTFOLIO = ("https://mistystep.io/", "https://phaedrus.io/")
R90_SITE = "repos/r90group/web-r90/contents/public/index.html"
SENTRY_ORGS = ("misty-step", "r90")

HABITAT_MODULES = {
    "agent-usage-telemetry": "Agent Usage Telemetry (AUT)", "allie": "Allie (AL)", "Cap": "Cap (CA)",
    "habitat": "Habitat (HA)", "habitat-teams-bot": "Habitat (HA)", "infrastructure": "Infrastructure (INF)",
    "seedbed": "Seedbed (SBD)", "tangle": "Tangle (TAN)", "time-tracker": "Time Tracker (TI)", "trellis": "Trellis (TRE)",
}
PRIORITIES = ("urgent", "high", "normal", "low")
HABITAT_PRIORITY = ("p0", "p1", "p2", "p3")
MARKER_PREFIX = "foundation-gap:"
GAP = re.compile(r"[a-z0-9][a-z0-9-]{1,59}\Z")
AREA = re.compile(r"(F([1-9]|10)|P[1-5]|S)\Z")
REPO = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\Z")
WALK = re.compile(r"user-attachments|!\[|\.png|\.webm|\.mp4|story walk|walked|screenshot", re.I)
TICKET = re.compile(r"\b(MIS|HA|AUT|TRE|TI|INF|NOP|SBD|AL|TAN|CA)-\d+\b|linear\.app/|K-20\d{6}-", re.I)


class Refusal(Exception):
    """A request or environment this tool will not act on; the message is for the caller."""


def now():
    return datetime.now(timezone.utc)


def iso(moment):
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def run(argv, *, stdin=None, timeout=300, check=True):
    """Fixed argv only, never a shell string, so evidence and model text cannot become commands."""
    result = subprocess.run(argv, input=stdin, capture_output=True, text=True, timeout=timeout)
    if check and result.returncode != 0:
        lines = (result.stderr or result.stdout).strip().splitlines()
        raise Refusal(f"{argv[0]} {argv[1] if len(argv) > 1 else ''} failed (exit {result.returncode}): {lines[0][:300] if lines else 'no output'}")
    return result


def run_json(argv, **kwargs):
    return json.loads(run(argv, **kwargs).stdout or "null")


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}")
    temp.write_text(json.dumps(value, indent=1, sort_keys=True) + "\n")
    os.replace(temp, path)


# --- Which repositories -----------------------------------------------------------------------

def gh(path, *, raw=False):
    """GitHub REST through the signed-in gh; None when the resource is absent or not readable."""
    argv = ["gh", "api", path] + (["-H", "Accept: application/vnd.github.raw"] if raw else [])
    result = run(argv, check=False, timeout=120)
    if result.returncode != 0:
        if re.search(r"HTTP 40[34]|HTTP 410|HTTP 409|HTTP 451", result.stderr):
            return None
        raise Refusal(f"gh api {path} failed: {result.stderr.strip()[:300]}")
    return result.stdout if raw else json.loads(result.stdout or "null")


def gh_pages(path, pages=5):
    items = []
    for page in range(1, pages + 1):
        joiner = "&" if "?" in path else "?"
        data = gh(f"{path}{joiner}per_page=100&page={page}")
        batch = data if isinstance(data, list) else (data or {}).get("workflow_runs", [])
        items += batch
        if len(batch) < 100:
            break
    return items


def active(repositories, moment):
    """Non-archived, non-empty repositories pushed within ACTIVE_DAYS, less named non-projects."""
    since = iso(moment - timedelta(days=ACTIVE_DAYS))
    return sorted(
        (repo for repo in repositories
         if not repo.get("archived") and repo.get("size", 0) > 0 and repo["full_name"] not in EXCLUDED
         and (repo.get("pushed_at") or "") >= since),
        key=lambda repo: repo["full_name"].lower())


def active_repositories():
    return active([repo for org in ORGS for repo in gh_pages(f"orgs/{org}/repos?type=all", 3)], now())


# --- Where tickets go ------------------------------------------------------------------------------

def destination(repo):
    """("habitat", module label or None) for R90; ("board", "misty-step/<repo>") for Misty Step."""
    owner, name = repo.split("/", 1)
    if owner == "r90group":
        return "habitat", HABITAT_MODULES.get(name)
    if owner == "misty-step":
        return "board", f"misty-step/{name}"
    raise Refusal(f"no tracker route for {repo}")


def marker(audit, repo, gap):
    return f"{MARKER_PREFIX} {audit}/{repo}/{gap}"


def carries(description, mark):
    """`mark` as its own list line. Bodies may not contain the marker prefix, so only the filer's header can."""
    return any(line.strip() in (f"- {mark}", f"* {mark}") for line in (description or "").splitlines())


def climbed(base, created, moment):
    """Priority index after weeks open: one step a week, never to urgent unless the auditor said urgent."""
    if base == 0:
        return 0
    weeks = max(0, (moment - created).days // 7)
    return max(1, base - weeks)


# --- Evidence -----------------------------------------------------------------------------------------

def page_text(markup, limit=20000):
    markup = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", markup, flags=re.S | re.I)
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", markup))).strip()[:limit]


def fetch(url, timeout=20):
    """Status and text of a public URL, or the failure in words (a dead DNS record is evidence)."""
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (omp-audit)"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return {"status": response.status, "url": response.geturl(),
                    "text": response.read(400_000).decode("utf-8", "replace")}
    except urllib.error.HTTPError as error:
        return {"status": error.code, "url": url, "text": ""}
    except Exception as error:  # DNS, TLS and timeouts are all findings, not crashes.
        return {"status": None, "url": url, "error": str(error)[:300], "text": ""}


def sentry_projects():
    token = (os.environ.get("SENTRY_AUTH_TOKEN") or "").strip()  # pass entries end with a newline
    if not token:
        return {"unknown": "SENTRY_AUTH_TOKEN was not provided to this run"}
    found = []
    for org in SENTRY_ORGS:
        def get(path):
            request = urllib.request.Request(f"https://sentry.io/api/0/{path}", headers={"Authorization": f"Bearer {token}"})
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read())
        try:
            projects = get(f"organizations/{org}/projects/?per_page=100")
            stats = get(f"organizations/{org}/stats_v2/?field=sum(quantity)&groupBy=project&category=error&interval=1d&statsPeriod=14d")
        except Exception as error:
            return {"unknown": f"Sentry {org}: {str(error)[:200]}"}
        counts = {str(group["by"]["project"]): group["totals"]["sum(quantity)"] for group in stats.get("groups", [])}
        found += [{"org": org, "slug": project["slug"], "platform": project.get("platform"),
                   "first_event": project.get("firstEvent"), "errors_14d": counts.get(str(project["id"]), 0)}
                  for project in projects]
    return {"projects": found}


def habitat_open():
    items, offset = [], 0
    for _ in range(20):
        data = run_json([HABITAT, "--json", "list", "--limit", "200", "--offset", str(offset)])
        batch = data.get("items") or data.get("data") or []
        items += [{"id": item.get("external_id"), "title": item.get("title"), "status": item.get("status"),
                   "module": item.get("module_name")} for item in batch if item.get("status") not in ("done", "closed")]
        if not data.get("has_more"):
            return items
        offset = int(data["next_offset"])
    raise Refusal("Habitat listing exceeded 20 pages")


def board_open():
    data = run_json(["glass", "item", "list"])
    return [{"id": item.get("id"), "title": item.get("title"), "project": item.get("project"), "status": item.get("status")}
            for item in (data.get("items") if isinstance(data, dict) else data) or []]


def shared_evidence():
    r90 = gh(R90_SITE, raw=True)
    pages = {url: page_text(fetch(url).get("text", "")) for url in PORTFOLIO}
    pages["R90 site (r90group/web-r90 public/index.html)"] = page_text(r90 or "")
    return {"gathered": iso(now()), "sentry": sentry_projects(), "portfolio": pages,
            "tickets": {"habitat": habitat_open(), "board": board_open()}}


def mentions(text, name):
    return re.search(rf"(?<![a-z0-9]){re.escape(name.lower())}(?![a-z0-9])", (text or "").lower()) is not None


def project_tickets(repo, shared):
    """Open tickets this repository's auditor must check before filing: its tracker scope plus any that name it."""
    kind, target = destination(repo)
    name = repo.split("/", 1)[1]
    tickets = shared["tickets"]
    named = [t for t in tickets["board"] if mentions(t["title"], name) or (t.get("project") or "").lower() == name.lower()]
    if kind == "board":
        return {"tracker": named}
    module = (target or "").rsplit(" (", 1)[0]
    own = [t for t in tickets["habitat"] if (module and t["module"] == module) or mentions(t["title"], name)]
    return {"tracker": own, "board": named}


def ci_runs(repo, days=30):
    since = (now() - timedelta(days=days)).strftime("%Y-%m-%d")
    workflows = {}
    for item in gh_pages(f"repos/{repo}/actions/runs?created=%3E%3D{since}", 5):
        entry = workflows.setdefault(item.get("path") or item.get("name"), {
            "name": item.get("name"), "runs": 0, "failures": 0, "wall_minutes": 0.0, "events": {}, "latest": None})
        entry["runs"] += 1
        entry["failures"] += item.get("conclusion") in ("failure", "timed_out", "startup_failure")
        entry["events"][item["event"]] = entry["events"].get(item["event"], 0) + 1
        entry["latest"] = entry["latest"] or {"conclusion": item.get("conclusion"), "at": item.get("created_at"), "url": item.get("html_url")}
        try:
            started = datetime.fromisoformat(item["run_started_at"].replace("Z", "+00:00"))
            updated = datetime.fromisoformat(item["updated_at"].replace("Z", "+00:00"))
            entry["wall_minutes"] = round(entry["wall_minutes"] + max(0.0, (updated - started).total_seconds() / 60), 1)
        except (KeyError, TypeError, ValueError):
            pass
    return {"since": since, "capped_at_runs": 500, "workflows": workflows}


def security(repo):
    alerts = gh(f"repos/{repo}/dependabot/alerts?state=open&per_page=100")
    secrets = gh(f"repos/{repo}/secret-scanning/alerts?state=open&per_page=100")
    severities = {}
    for alert in alerts or []:
        level = (alert.get("security_advisory") or {}).get("severity", "unknown")
        severities[level] = severities.get(level, 0) + 1
    return {"dependabot_open": severities if alerts is not None else "unreadable",
            "secret_scanning_open": len(secrets) if secrets is not None else "unreadable"}


def merged_prs(repo, days, detail):
    since = iso(now() - timedelta(days=days))
    pulls = [pull for pull in gh_pages(f"repos/{repo}/pulls?state=closed&sort=updated&direction=desc", 2)
             if pull.get("merged_at") and pull["merged_at"] >= since]
    comments = {}
    for comment in gh_pages(f"repos/{repo}/issues/comments?since={since}", 5):
        comments.setdefault(int(comment["issue_url"].rsplit("/", 1)[1]), []).append(comment.get("body") or "")
    rows = []
    for pull in pulls:
        text = f"{pull.get('title') or ''}\n{pull.get('body') or ''}"
        said = "\n".join(comments.get(pull["number"], []))
        row = {"number": pull["number"], "title": pull["title"], "url": pull["html_url"], "merged_at": pull["merged_at"],
               "walk_evidence": bool(WALK.search(text + said)), "cites_ticket": bool(TICKET.search(text))}
        if detail:
            row["body"] = (pull.get("body") or "")[:3000]
            row["comments"] = [body[:1500] for body in comments.get(pull["number"], [])[:5]]
        rows.append(row)
    return {"since": since, "merged": rows}


def hot_spots(checkout, days=90, top=25):
    log = run(["git", "-C", str(checkout), "log", f"--since={days}.days", "--name-only", "--format="], check=False).stdout
    counts = {}
    for line in filter(None, (line.strip() for line in log.splitlines())):
        counts[line] = counts.get(line, 0) + 1
    return sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))[:top]


def recent_sessions(name, limit=10):
    """Newest OMP sessions whose directory names this repository (its checkout or worktrees)."""
    root = AGENT_DIR / "sessions"
    if not root.is_dir():
        return []
    token = f"-{name}"
    found = [path for folder in root.iterdir() if folder.is_dir() and (folder.name.endswith(token) or f"{token}-" in folder.name)
             and not folder.name.startswith("-.cache-omp-audit") for path in folder.glob("*.jsonl")]
    return [str(path) for path in sorted(found, key=lambda path: path.stat().st_mtime, reverse=True)[:limit]]


def complexity_receipt(repo):
    folder = HOME / ".local/state/complexity" / repo
    receipts = sorted(folder.glob("*.json")) if folder.is_dir() else []
    return json.loads(receipts[-1].read_text()) if receipts else None


def repo_evidence(audit, meta, checkout, shared):
    repo = meta["full_name"]
    homepage = meta.get("homepage") or ""
    live = fetch(homepage if homepage.startswith("http") else f"https://{homepage}") if homepage else None
    name = repo.split("/", 1)[1]
    evidence = {
        "repository": {key: meta.get(key) for key in ("full_name", "description", "homepage", "topics", "private", "fork",
                                                         "default_branch", "pushed_at", "html_url", "language")},
        "licence": (meta.get("license") or {}).get("spdx_id"),
        "commit": run(["git", "-C", str(checkout), "rev-parse", "HEAD"]).stdout.strip(),
        "homepage_check": {key: live.get(key) for key in ("status", "url", "error")} if live else None,
        "homepage_text": page_text(live.get("text", ""), 6000) if live else None,
        "ci": ci_runs(repo),
        "releases": [{"tag": item.get("tag_name"), "published": item.get("published_at")} for item in gh(f"repos/{repo}/releases?per_page=5") or []],
        "deployments_30d": [{"environment": item.get("environment"), "at": item.get("created_at")}
                            for item in gh(f"repos/{repo}/deployments?per_page=50") or []
                            if (item.get("created_at") or "") >= iso(now() - timedelta(days=30))],
        "security": security(repo),
        "sentry": shared["sentry"] if "unknown" in shared["sentry"] else
        [project for project in shared["sentry"]["projects"]
         if project["slug"] == name.lower() or project["slug"].startswith(f"{name.lower()}-") or name.lower().startswith(f"{project['slug']}-")],
        "tickets": project_tickets(repo, shared),
        "tracker": dict(zip(("kind", "scope"), destination(repo))),
    }
    if audit == "principles":
        evidence["merged_prs"] = merged_prs(repo, 7, True)
    else:
        evidence["merged_prs"] = merged_prs(repo, 14, False)
    if audit == "simplicity":
        evidence["hot_spots_90d"] = hot_spots(checkout)
        evidence["recent_sessions"] = recent_sessions(name)
        evidence["complexity_receipt"] = complexity_receipt(repo)
    return evidence


# --- One run --------------------------------------------------------------------------------------------

def safe(repo):
    return repo.replace("/", "__")


def auditor_name(run_id, audit, repo):
    """A Herdr agent name (lowercase start, [a-z0-9_-], at most 32 characters), readable and unique per repository
    and run: the hash covers the full repository identity, so same-named repositories never share an auditor."""
    owner, name = repo.lower().split("/", 1)
    slug = re.sub(r"[^a-z0-9]+", "-", name).strip("-")[:15].strip("-") or "repo"
    suffix = hashlib.sha256(f"{run_id}|{repo}".encode()).hexdigest()[:7]
    return f"audit-{audit[0]}{owner[0]}-{slug}-{suffix}"


def system_prompt(audit):
    return f"{(SHARE / 'template.md').read_text().rstrip()}\n\n{(SHARE / f'{audit}.md').read_text().rstrip()}\n"


def launch_argv(roster_args, checkout, system_file):
    """The auditor's OMP argv: roster model route, read-only tools, the filer extension and the fixed template."""
    return [*roster_args, "--cwd", str(checkout), "--no-skills", "--tools", TOOLS, "-e", str(SHARE / "audit-tool.ts"),
            "--append-system-prompt", str(system_file), "--max-time", f"{AUDITOR_MINUTES}m"]


def brief(audit, repo, checkout, record, shared_path, evidence):
    vendor = SHARE / "vendor/mattpocock-skills"
    lines = [
        f"# {audit.capitalize()} audit: {repo}",
        "",
        f"Checkout: `{checkout}` at `{evidence['commit']}` (default branch `{evidence['repository']['default_branch']}`).",
        f"Evidence for this repository: `{record / 'bundle.json'}`.",
        f"Shared evidence (portfolio pages, Sentry): `{shared_path}`.",
        f"Constitution: `{AGENT_DIR / 'skills/foundation/constitution.md'}`; existing catalog: "
        f"`{AGENT_DIR / 'skills/foundation/foundation-standard-v1.md'}`.",
        f"Tickets route to {evidence['tracker']['kind']} ({evidence['tracker']['scope'] or 'no project'}); "
        f"the open ones to check before filing are in the bundle under `tickets`.",
    ]
    if audit == "simplicity":
        lines += ["", "Vendored references:",
                  f"- `{vendor / 'codebase-design/SKILL.md'}` and `{vendor / 'codebase-design/DEEPENING.md'}`",
                  f"- `{vendor / 'improve-codebase-architecture/SKILL.md'}` (explore questions only)",
                  f"- `{vendor / 'retro/SKILL.md'}` (navigation, information access, no-ops, tool economy)"]
    return "\n".join(lines) + "\n"


def roster_args(lock, deadline):
    """omp-roster's model route and capacity check; waits while the working-engineer cap is full."""
    while True:
        exhausted = 0
        for model, effort in MODELS:
            result = run(["omp-roster", "launch", "--model", model, "--thinking", effort, "--json"], check=False, timeout=120)
            if result.returncode == 0:
                return json.loads(result.stdout)["args"]
            if result.returncode == 3:
                exhausted += 1
                continue
            if result.returncode != 5:
                raise Refusal(f"omp-roster failed (exit {result.returncode}): {result.stderr.strip()[:300]}")
            break
        if exhausted == len(MODELS):
            raise Refusal("every auditor model route is exhausted")
        if time.monotonic() > deadline:
            raise Refusal("the working-engineer cap stayed full past the capacity wait")
        lock.release()
        try:
            time.sleep(60)
        finally:
            lock.acquire()


def herdr(*argv, timeout=120, check=True):
    result = run([*HERDR, *argv], timeout=timeout, check=check)
    return json.loads(result.stdout) if result.stdout.strip().startswith("{") else {"text": result.stdout, "code": result.returncode}


def session_file(checkout, started):
    folder = AGENT_DIR / "sessions" / ("-" + str(checkout.relative_to(HOME)).replace("/", "-"))
    files = [path for path in folder.glob("*.jsonl") if path.stat().st_mtime >= started] if folder.is_dir() else []
    return str(max(files, key=lambda path: path.stat().st_mtime)) if files else None


class Run:
    def __init__(self, audit, dry_run, record_only=False):
        self.audit, self.dry_run, self.record_only = audit, dry_run, record_only
        self.started = now()
        self.id = f"{self.started.strftime('%Y%m%dT%H%M%SZ')}-{audit}"
        self.state = STATE / "runs" / self.id
        self.work = WORK / self.id
        self.outputs = self.state / "outputs.jsonl"
        self.log_path = self.state / "run.log"
        self.lock = threading.Lock()
        self.launch_lock = threading.Lock()
        self.repos = {}
        self.workspace = None
        self.finished = None
        self.state.mkdir(parents=True, exist_ok=True)
        self.outputs.touch()

    def log(self, message):
        line = f"{iso(now())} {message}"
        with self.lock, self.log_path.open("a") as handle:
            handle.write(line + "\n")
        print(line, flush=True)

    def record(self, repo, **fields):
        with self.lock:
            self.repos.setdefault(repo, {}).update(fields)
            self.save()

    def save(self):
        write_json(self.state / "manifest.json", {
            "run": self.id, "audit": self.audit, "dry_run": self.dry_run, "record_only": self.record_only, "started": iso(self.started),
            "template_sha256": hashlib.sha256(system_prompt(self.audit).encode()).hexdigest(),
            "finished": self.finished, "workspace": self.workspace, "repositories": self.repos,
            "outputs": outcome_counts(self.outputs)})


def previous_run(audit, repo, before):
    """The last run of this audit that actually audited the repository: (run id, commit), or (None, None)."""
    runs = sorted((STATE / "runs").glob(f"*-{audit}"), reverse=True) if (STATE / "runs").is_dir() else []
    for folder in runs:
        if folder.name >= before:
            continue
        try:
            manifest = json.loads((folder / "manifest.json").read_text())
            entry = manifest["repositories"].get(repo) or {}
        except (OSError, ValueError, KeyError):
            continue
        if entry.get("status") == "finished" and not manifest.get("record_only"):
            return folder.name, entry.get("commit")
    return None, None


def clone(repo, checkout):
    if checkout.exists():
        shutil.rmtree(checkout)
    checkout.parent.mkdir(parents=True, exist_ok=True)
    since = (now() - timedelta(days=90)).strftime("%Y-%m-%d")
    shallow = run(["gh", "repo", "clone", repo, str(checkout), "--", "--quiet", "--single-branch", f"--shallow-since={since}"],
                  check=False, timeout=1800)
    if shallow.returncode != 0:  # No commits in the window: the newest snapshot is enough.
        shutil.rmtree(checkout, ignore_errors=True)
        run(["gh", "repo", "clone", repo, str(checkout), "--", "--quiet", "--single-branch", "--depth=1"], timeout=1800)


def audit_one(context, meta, shared_path, shared, deadline):
    """Gather, check out and audit one repository. Its record (bundle, brief, context) stays with the run's state;
    only the checkout is scratch. OMP sessions cannot see ~/.cache/tmp, so the checkout lives under WORK."""
    repo = meta["full_name"]
    record = context.state / safe(repo)
    checkout = context.work / safe(repo)
    context.record(repo, status="gathering", started=iso(now()))
    clone(repo, checkout)
    evidence = repo_evidence(context.audit, meta, checkout, shared)
    context.record(repo, commit=evidence["commit"])
    filer_context = {"run": context.id, "audit": context.audit, "repo": repo, "commit": evidence["commit"],
                     "outputs": str(context.outputs), "record_only": context.record_only or context.dry_run}
    last_run, last_commit = previous_run(context.audit, repo, context.id)
    unchanged = context.audit in ("principles", "simplicity") and last_commit == evidence["commit"]
    if unchanged:
        carried = carry_forward(filer_context, last_run) if last_run else 0
        context.record(repo, carried=carried, finished=iso(now()), reason="no commits since its last run")
        settle(context, repo, "skipped")
        return
    write_json(record / "bundle.json", evidence)
    (record / "brief.md").write_text(brief(context.audit, repo, checkout, record, shared_path, evidence))
    write_json(record / "context.json", filer_context)
    if context.dry_run:
        context.record(repo, status="gathered", finished=iso(now()))
        return
    name = auditor_name(context.id, context.audit, repo)
    prompt = (f"Begin the {context.audit} audit of {repo}. Read {record / 'brief.md'} first, then {record / 'bundle.json'}, "
              "then the repository. File every gap with audit_file, then finish with your summary.")
    tab_id = None
    started = time.time()
    try:
        with context.launch_lock:  # One launch at a time keeps the working-engineer count honest.
            args = roster_args(context.launch_lock, deadline)
            tab = herdr("tab", "create", "--workspace", context.workspace, "--cwd", str(checkout), "--label", repo,
                        "--env", f"OMP_AUDIT_CONTEXT={record / 'context.json'}", "--env", f"OMP_AUDIT_FILER={Path(__file__).resolve()}",
                        "--no-focus")["result"]
            tab_id, pane = tab["tab"]["tab_id"], tab["root_pane"]["pane_id"]
            context.record(repo, status="running", agent=name, tab=tab_id)
            herdr("agent", "start", name, "--kind", "omp", "--pane", pane, "--timeout", "120000", "--",
                  *launch_argv(args, checkout, context.state / "system.md"), timeout=180)
            herdr("agent", "prompt", name, prompt, "--wait", "--until", "working", "--until", "blocked", "--timeout", "60000", timeout=90)
        herdr("agent", "wait", name, "--timeout", str(AUDITOR_MINUTES * 60_000), timeout=AUDITOR_MINUTES * 60 + 120, check=False)
        state = (herdr("agent", "get", name, check=False).get("result") or {}).get("agent", {}).get("agent_status")
        status = "finished" if state in ("idle", "done") else f"stopped ({state or 'gone'})"
    finally:
        context.record(repo, session=session_file(checkout, started), finished=iso(now()))
        if tab_id:
            herdr("tab", "close", tab_id, check=False)
    settle(context, repo, status)


def settle(context, repo, status):
    """Deliver the repository's findings outside the auditor's sandbox. Any finding that cannot be filed is kept
    with its full request, and fails the repository, so the run fails and its alert fires."""
    if not context.record_only and not context.dry_run:
        context.record(repo, delivered=deliver_run(context.outputs, repo))
    stranded = stranded_count(context.outputs, repo)
    if stranded:
        status = f"failed ({stranded} findings stranded)"
        context.log(f"{repo}: {stranded} findings could not be filed; kept for `omp-audit refile {context.id}`")
    context.record(repo, status=status)


def run_command(audit, only, concurrency, dry_run, record_only=False):
    context = Run(audit, dry_run, record_only)
    context.log(f"{audit} audit {context.id} starting{' (dry run)' if dry_run else ''}")
    repositories = active_repositories()
    if only:
        wanted = set(only)
        repositories = [meta for meta in repositories if meta["full_name"] in wanted]
        missing = wanted - {meta["full_name"] for meta in repositories}
        if missing:
            raise Refusal(f"not active repositories: {', '.join(sorted(missing))}")
    shared = shared_evidence()
    shared_path = context.state / "shared.json"
    write_json(shared_path, shared)
    (context.state / "system.md").write_text(system_prompt(audit))
    context.log(f"{len(repositories)} active repositories: {', '.join(meta['full_name'] for meta in repositories)}")
    if not dry_run:
        created = herdr("workspace", "create", "--cwd", str(context.state), "--label", f"Audit: {audit} {context.started:%Y-%m-%d}", "--no-focus")["result"]
        context.workspace = created["workspace"]["workspace_id"]
        herdr("pane", "run", created["root_pane"]["pane_id"], f"tail -n +1 -F {context.log_path}")
    context.save()
    deadline = time.monotonic() + CAPACITY_WAIT_SECONDS

    def one(meta):
        try:
            audit_one(context, meta, shared_path, shared, deadline)
            context.log(f"{meta['full_name']}: {context.repos[meta['full_name']].get('status')}")
        except Exception as error:  # One repository's failure is recorded; the others continue.
            context.record(meta["full_name"], status="failed", error=str(error)[:500], finished=iso(now()))
            context.log(f"{meta['full_name']}: failed: {str(error)[:300]}")

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        list(pool.map(one, repositories))
    context.finished = iso(now())
    with context.lock:
        context.save()
    # A stopped, blocked or vanished auditor is an incomplete audit: fail the unit so its alert fires.
    failed = [repo for repo, entry in context.repos.items() if entry.get("status") not in ("finished", "skipped", "gathered")]
    context.log(f"{audit} audit {context.id} finished: {len(context.repos) - len(failed)} complete, "
                f"{len(failed)} incomplete ({', '.join(failed) or 'none'}); outputs {context.outputs}")
    if context.workspace:
        herdr("workspace", "close", context.workspace, check=False)
    shutil.rmtree(context.work, ignore_errors=True)  # Checkouts are scratch; the run's record stays in STATE.
    return 1 if failed else 0


# --- Filing -------------------------------------------------------------------------------------------------

def validate(request):
    if not isinstance(request, dict):
        raise Refusal("the request must be a JSON object")
    action = request.get("action")
    if action not in ("file", "adopt", "propose"):
        raise Refusal("action must be file, adopt or propose")
    if not GAP.match(str(request.get("gap", ""))):
        raise Refusal("gap must be kebab-case, 2-60 characters")
    if not AREA.match(str(request.get("area", ""))):
        raise Refusal("area must be F1-F10, P1-P5 or S")
    title, body = str(request.get("title", "")), str(request.get("body", ""))
    if not 8 <= len(title) <= 120 or "\n" in title:
        raise Refusal("title must be one line of 8-120 characters")
    if not 20 <= len(body) <= 6000:
        raise Refusal("body must be 20-6000 characters")
    if MARKER_PREFIX in body or MARKER_PREFIX in title:
        raise Refusal(f"the body may not carry '{MARKER_PREFIX}'; the filer writes the marker")
    if request.get("priority") not in PRIORITIES:
        raise Refusal("priority must be urgent, high, normal or low")
    if action == "adopt" and not re.match(r"[A-Za-z0-9][A-Za-z0-9._-]{1,59}\Z", str(request.get("ticket", ""))):
        raise Refusal("adopt needs the existing ticket id")
    return request


def ticket_body(context, request, mark, regression_of=()):
    header = [f"- {mark}", f"- audit: {context['audit']} run {context['run']} at {context['repo']}@{context['commit'][:12]}",
              f"- area: {request['area']}; priority: {request['priority']}"]
    if regression_of:
        header.append(f"- regression of: {', '.join(regression_of)}")
    return "\n".join(header) + "\n\n" + request["body"].strip() + "\n"


def habitat_marked(mark):
    found = []
    for status in ([], ["--status", "closed"]):
        offset = 0
        for _ in range(20):
            data = run_json([HABITAT, "--json", "list", "--search", mark, *status, "--limit", "200", "--offset", str(offset)])
            for item in data.get("items") or data.get("data") or []:
                if not carries(item.get("description"), mark):
                    continue
                priority = item.get("priority")
                found.append({"id": item["external_id"], "url": None,
                              "state": "done" if item.get("status") == "done" else "declined" if item.get("status") == "closed" else "open",
                              "priority": HABITAT_PRIORITY.index(priority) if priority in HABITAT_PRIORITY else None,
                              "created": item.get("created_at")})
            if not data.get("has_more"):
                break
            offset = int(data["next_offset"])
        else:
            raise Refusal(f"Habitat search for '{mark}' exceeded 20 pages")
    return list({item["id"]: item for item in found}.values())


def board_state(item):
    status = item.get("status")
    return {"id": item["id"], "url": None, "board": True, "priority": None, "created": item.get("created_at"),
            "state": "done" if status == "done" else "declined" if status == "dropped" else "open"}


def board_marked(mark):
    items = run_json(["glass", "item", "list", "--include-done"])
    return [board_state(item) for item in (items.get("items") if isinstance(items, dict) else items) or []
            if carries(item.get("notes"), mark)]


def marked(kind, mark):
    """Every ticket that carries the marker."""
    return habitat_marked(mark) if kind == "habitat" else board_marked(mark)


def habitat_module_id(label):
    filters = run_json([HABITAT, "--json", "filters"])
    return next((module.get("value") for module in (filters.get("data") or filters).get("modules") or [] if module.get("label") == label), None)


def board_add(context, request, notes, scope, status, note):
    """One Glass board item. Board items carry no priority; the desk grooms them, and urgent ones start as next.
    Notes hold 2000 characters: a longer finding keeps its marker header and points at its whole record."""
    if len(notes) > 2000:
        tail = f"\n\n[cut to fit; the whole finding is in {context['outputs']}]"
        notes = notes[:2000 - len(tail)] + tail
    why = request["body"].strip().split("\n\n", 1)[0][:600]
    receipt = run_json(["glass", "item", "add", "--title", request["title"][:160], "--kind", "task", "--status", status,
                        "--scope", scope, "--why", why, "--why-attribution", "quoted", "--why-source", "omp-audit auditor",
                        "--relaying", "none", "--notes", notes, "--note", note, "--caller", "omp-audit", "--json"])
    if not isinstance(receipt, dict) or not receipt.get("id"):
        raise Refusal("the board did not return the new item's id")
    return receipt["id"]


def create(kind, scope, request, body, context, mark):
    rank = PRIORITIES.index(request["priority"])
    if kind == "board":
        status = "next" if request["priority"] == "urgent" else "later"
        return board_add(context, request, body, scope, status, f"Opened by the {context['audit']} audit"), None
    argv = [HABITAT, "--json", "create", "--type", "task", "--title", request["title"], "--description", body,
            "--priority", HABITAT_PRIORITY[rank], "--tags", f"audit,{context['audit']}",
            "--idempotency-key", "audit-" + hashlib.sha256(f"{mark}|{context['run']}".encode()).hexdigest()[:40]]
    module = habitat_module_id(scope) if scope else None
    if module:
        argv += ["--module-id", module]
    item = run_json(argv)
    ticket = item.get("external_id") or (item.get("data") or {}).get("external_id")
    if not ticket:
        raise Refusal("Habitat did not return the new item's id")
    return ticket, None


def recur(ticket, request, context, moment):
    """An open ticket already owns this gap: a Habitat ticket's priority climbs with age. Board items carry no
    priority; the desk grooms them."""
    if ticket.get("board"):
        return None
    base = PRIORITIES.index(request["priority"])
    created = datetime.fromisoformat(str(ticket["created"]).replace("Z", "+00:00")) if ticket.get("created") else moment
    target = climbed(base, created, moment)
    raised = ticket.get("priority") is None or target < ticket["priority"]
    if raised:  # Habitat refuses an update without the item's current revision.
        item = run_json([HABITAT, "--json", "get", ticket["id"]])
        revision = (item.get("data") or item)["revision"]
        run([HABITAT, "--json", "update", ticket["id"], "--priority", HABITAT_PRIORITY[target], "--expected-revision", str(revision)])
    return PRIORITIES[target] if raised else None


def propose(context, request, mark):
    """A doctrine proposal keeps the gap rules, on the board: open is seen again, dropped stays dropped, done regresses."""
    found = owner_states("board", context, mark)
    if found["open"]:
        return {"outcome": "recurrence", "ticket": found["open"][0]["id"]}
    if found["declined"]:
        return {"outcome": "declined", "ticket": found["declined"][0]["id"]}
    regression_of = [ticket["id"] for ticket in found["done"]]
    notes = ticket_body(context, request, mark, regression_of)
    item = board_add(context, request, notes, "misty-step/harness", "later", f"Doctrine proposal from the {context['audit']} audit")
    return {"outcome": "proposed", "ticket": item, "regression_of": regression_of or None}


# Outcomes whose ticket owns the gap in later runs, including a declined one that must never be refiled.
OWNING = ("created", "recurrence", "adopted", "carried", "declined", "closed-since", "proposed")
REQUEST_FIELDS = ("action", "area", "gap", "priority", "title", "body", "ticket")


def read_records(outputs):
    return [json.loads(line) for line in Path(outputs).read_text().splitlines() if line.strip()] if Path(outputs).exists() else []


def prior_records(runs, *, marker_=None, audit=None, repo=None, run=None):
    """Earlier runs' outputs: the gap-to-ticket history, including tickets an auditor adopted rather than filed."""
    records = []
    for path in sorted(Path(runs).glob("*/outputs.jsonl")) if Path(runs).is_dir() else []:
        if run and path.parent.name != run:
            continue
        records += [item for item in read_records(path)
                    if (marker_ is None or item.get("marker") == marker_) and (audit is None or item.get("audit") == audit)
                    and (repo is None or item.get("repo") == repo)]
    return records


BOARD_ITEM = re.compile(r"K-\d{8}-[a-z0-9-]+\Z")


def ticket_state(ticket):
    """One known ticket's state, so an adopted or earlier ticket keeps owning its gap after it closes.
    A board that cannot answer is an error, never a missing ticket, so it cannot cause a twin."""
    if BOARD_ITEM.match(ticket):
        result = run(["glass", "item", "show", ticket], check=False)
        if result.returncode != 0 and "no item matches" not in result.stdout + result.stderr:
            raise Refusal(f"glass item show {ticket} failed (exit {result.returncode}): {(result.stderr or result.stdout).strip()[:300]}")
        item = (json.loads(result.stdout or "null") or {}).get("item") if result.returncode == 0 else None
        return board_state(item) if item else None
    item = run_json([HABITAT, "--json", "get", ticket], check=False)
    item = (item or {}).get("data") or item
    if not item or not item.get("external_id"):
        return None
    priority = item.get("priority")
    return {"id": item["external_id"], "url": None,
            "state": "done" if item.get("status") == "done" else "declined" if item.get("status") == "closed" else "open",
            "priority": HABITAT_PRIORITY.index(priority) if priority in HABITAT_PRIORITY else None, "created": item.get("created_at")}


def owners(kind, mark, runs):
    """Tickets that carry the marker, plus tickets earlier runs filed or adopted for this gap."""
    found = marked(kind, mark)
    seen = {ticket["id"] for ticket in found}
    for item in prior_records(runs, marker_=mark):
        ticket = item.get("ticket") if item.get("outcome") in OWNING else None
        if ticket and ticket not in seen and not item.get("record_only"):
            seen.add(ticket)
            state = ticket_state(ticket)
            if state:
                found.append(state)
    return found


def owner_states(kind, context, mark):
    """The gap's owners by state: open, declined (cancelled, dropped, closed) and done."""
    found = owners(kind, mark, Path(context["outputs"]).parent.parent)
    return {state: [ticket for ticket in found if ticket["state"] == state] for state in ("open", "declined", "done")}


def file_gap(context, request, mark, moment, done=()):
    """Open owner: recurrence. Declined: no write. Done (found, or `done` already seen): a regression gets a new one."""
    kind, scope = destination(context["repo"])
    found = owner_states(kind, context, mark)
    if found["open"]:
        owner = found["open"][0]
        return {"outcome": "recurrence", "ticket": owner["id"], "url": owner.get("url"), "raised_to": recur(owner, request, context, moment)}
    if found["declined"]:
        return {"outcome": "declined", "ticket": found["declined"][0]["id"]}
    regression_of = list(dict.fromkeys([ticket["id"] for ticket in found["done"]] + list(done)))
    ticket, url = create(kind, scope, request, ticket_body(context, request, mark, regression_of), context, mark)
    return {"outcome": "created", "ticket": ticket, "url": url, "tracker": kind, "regression_of": regression_of or None}


def adopt(context, request, mark, moment):
    """An existing open ticket owns this gap: it is seen again and climbs. A missing or done one gets the finding filed."""
    state = ticket_state(request["ticket"])
    if state and state["state"] == "open":
        return {"outcome": "adopted", "ticket": state["id"], "url": state.get("url"), "raised_to": recur(state, request, context, moment)}
    if state and state["state"] == "declined":
        return {"outcome": "declined", "ticket": state["id"]}
    done = [state["id"]] if state and state["state"] == "done" else []
    return {**file_gap(context, request, mark, moment, done), "adoption_refused": request["ticket"]}


def carry(context, request, mark, moment):
    current_ = owner_states(destination(context["repo"])[0], context, mark)["open"]
    if not current_:
        return {"outcome": "closed-since", "ticket": request.get("ticket")}
    return {"outcome": "carried", "ticket": current_[0]["id"], "url": current_[0].get("url"),
            "raised_to": recur(current_[0], request, context, moment)}


@contextlib.contextmanager
def filer_lock(outputs):
    """One lock for every run's filing, so overlapping runs cannot file a twin."""
    with open(Path(outputs).parent.parent / "filer.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def append_record(context, request, mark, outcome):
    record = {"at": iso(now()), "run": context["run"], "audit": context["audit"], "repo": context["repo"],
              "commit": context["commit"], "marker": mark, "record_only": bool(context.get("record_only")),
              **{key: request.get(key) for key in REQUEST_FIELDS if request.get(key) is not None}, **outcome}
    with Path(context["outputs"]).open("a") as handle:
        handle.write(json.dumps(record, sort_keys=True) + "\n")
    return record


def deliver(context, request, mark):
    """File one recorded finding outside the auditor. A tracker failure strands it, request and all, for `refile`."""
    with filer_lock(context["outputs"]):
        try:
            action = {"file": file_gap, "adopt": adopt, "carry": carry}.get(request["action"])
            outcome = propose(context, request, mark) if request["action"] == "propose" else action(context, request, mark, now())
        except (Refusal, subprocess.SubprocessError, OSError, ValueError, KeyError) as error:
            outcome = {"outcome": "stranded", "error": str(error)[:500]}
        return append_record(context, request, mark, outcome)


def current(outputs):
    """Each gap's current record in a run, the last one written for its marker, read under the filer lock
    so a concurrent append is never read half-written."""
    with filer_lock(outputs):
        records = read_records(outputs)
    return {(item.get("repo"), item.get("marker")): item for item in records}


def stranded_count(outputs, repo=None):
    return sum(1 for (owner, _), item in current(outputs).items()
               if item.get("outcome") == "stranded" and repo in (None, owner))


def outcome_counts(outputs):
    gaps = list(current(outputs).values())  # One entry per gap: pending, then filed or stranded.
    return {"total": len(gaps), "by_outcome": {key: sum(1 for item in gaps if item.get("outcome") == key)
                                               for key in sorted({item.get("outcome") for item in gaps})}}


def deliver_run(outputs, repo=None):
    """Deliver a run's pending and stranded findings (all repositories, or one). Returns the counts by outcome."""
    counts = {}
    for (owner, mark), item in current(outputs).items():
        if repo not in (None, owner) or item.get("outcome") not in ("pending", "stranded") or item.get("record_only"):
            continue
        context = {key: item[key] for key in ("run", "audit", "repo", "commit")} | {"outputs": str(outputs)}
        outcome = deliver(context, item, mark)["outcome"]
        counts[outcome] = counts.get(outcome, 0) + 1
    return counts


def carry_forward(context, previous_run):
    """An unchanged repository is not re-audited, but its open gaps are still seen and keep climbing."""
    runs = Path(context["outputs"]).parent.parent
    owned = {}
    for item in prior_records(runs, audit=context["audit"], repo=context["repo"], run=previous_run):
        if item.get("outcome") in OWNING and item.get("ticket") and not item.get("record_only") and item.get("action") != "propose":
            owned[item["marker"]] = item
    carried = 0
    for mark, item in owned.items():
        if context.get("record_only"):
            continue
        record = deliver(context, {**{key: item.get(key) for key in REQUEST_FIELDS}, "action": "carry"}, mark)
        carried += record["outcome"] == "carried"
    return carried


def file_command(context_path, stdin):
    """The audit_file tool, inside the auditor's sandbox: validate and record the finding, never touch a tracker.
    The launcher delivers it after the audit, where the trackers and the board are reachable."""
    context = json.loads(Path(context_path).read_text())
    request = validate(json.loads(stdin.read()))
    mark = marker(context["audit"], context["repo"], request["gap"])
    with filer_lock(context["outputs"]):
        earlier = next((item for item in read_records(context["outputs"]) if item.get("marker") == mark), None)
        if earlier:
            print(f"Already recorded in this run: {earlier.get('gap')} ({earlier.get('outcome')})")
            return 0
        append_record(context, request, mark, {"outcome": "pending"})
    print(f"Recorded {request['gap']}; it is filed when this audit ends, deduplicated and routed by the launcher.")
    return 0


def refile_command(run_id, repo=None):
    """Deliver a run's pending and stranded findings without auditing again; fail while any stays stranded."""
    outputs = STATE / "runs" / run_id / "outputs.jsonl"
    if not outputs.exists():
        raise Refusal(f"no outputs for run {run_id} under {STATE / 'runs'}")
    counts = deliver_run(outputs, repo)
    stranded = stranded_count(outputs, repo)
    manifest = outputs.parent / "manifest.json"
    if manifest.exists():  # Keep the run's summary describing each gap's current outcome.
        write_json(manifest, {**json.loads(manifest.read_text()), "outputs": outcome_counts(outputs)})
    print(json.dumps({"run": run_id, "delivered": counts, "still_stranded": stranded}, sort_keys=True))
    return 1 if stranded else 0


def main(argv=None):
    parser = argparse.ArgumentParser(prog="omp-audit", description=__doc__.split("\n\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)
    start = commands.add_parser("run", help="audit every active repository")
    start.add_argument("audit", choices=AUDITS)
    start.add_argument("--repo", action="append", default=[], help="limit to OWNER/NAME (repeatable)")
    start.add_argument("--concurrency", type=int, default=CONCURRENCY)
    start.add_argument("--dry-run", action="store_true", help="gather evidence and briefs; launch and file nothing")
    start.add_argument("--record-only", action="store_true", help="launch auditors but only record what they would file")
    commands.add_parser("repos", help="list the active repositories")
    filing = commands.add_parser("file", help="the audit_file tool's filer (request JSON on stdin)")
    filing.add_argument("--context", required=True)
    refile = commands.add_parser("refile", help="deliver a run's pending and stranded findings")
    refile.add_argument("run", help="the run id, a directory name under the runs state")
    refile.add_argument("--repo", help="limit to OWNER/NAME")
    options = parser.parse_args(argv)
    try:
        if options.command == "repos":
            for meta in active_repositories():
                print(meta["full_name"])
            return 0
        if options.command == "file":
            return file_command(options.context, sys.stdin)
        if options.command == "refile":
            return refile_command(options.run, options.repo)
        if not 1 <= options.concurrency <= 12:
            raise Refusal("--concurrency must be 1-12")
        for repo in options.repo:
            if not REPO.match(repo):
                raise Refusal(f"not OWNER/NAME: {repo}")
        return run_command(options.audit, options.repo, options.concurrency, options.dry_run, options.record_only)
    except Refusal as error:
        print(f"omp-audit: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
