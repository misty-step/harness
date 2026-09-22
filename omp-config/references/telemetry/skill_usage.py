#!/usr/bin/env python3
"""Skill invocation telemetry across archived OMP sessions — Misty Step only.

Counts real invocations, not string mentions:
  - operator invocations: custom skill-prompt events ("invoked the X skill")
  - agent loads: read tool calls targeting skill://<name>

Boundary: Misty Step/R90 separation is binding (org AGENTS.md). This tool
never reads R90 archives. The scan set derives from `~/Development/misty-step`
itself: one session dir per org-root child repo (`-Development-misty-step-<name>`)
plus the root (`-Development-misty-step`). Ambiguous dirs (`.herdr-*`,
worktree-named, anything outside the derived set) are never scanned — Herdr
sessions are included only when their repo resolves to an org-child name via
the same mapping, and otherwise stay unread.

Usage:
  python3 references/telemetry/skill_usage.py [repo-name]

With no argument, scans every Misty Step-derived session dir. With an argument
(e.g. `scry`), narrows to that repo — the argument must still resolve inside
the derived set; R90 paths are unreachable by construction.

Caveats: counts are lower bounds — event formats evolved across harness
versions, and subagent sessions may archive outside these dirs entirely.
"""
import collections
import glob
import json
import os
import re
import sys

ORG_ROOT = os.path.expanduser("~/Development/misty-step")
BASE = os.path.expanduser("~/.omp/agent/sessions/")


def misty_step_session_dirs():
    """Derive the scan set from the org root; refuse anything unverifiable."""
    try:
        repos = os.listdir(ORG_ROOT)
    except OSError as e:
        sys.exit(f"cannot read org root {ORG_ROOT}: {e}")
    wanted = {"-Development-misty-step"}
    for repo in repos:
        if not repo.startswith("."):
            wanted.add(f"-Development-misty-step-{repo}")
    found = [d for d in os.listdir(BASE) if d in wanted and os.path.isdir(BASE + d)]
    if not found:
        sys.exit("no Misty Step session dirs found; refusing to widen the scan")
    return sorted(found)


def find_skill_prompts(ev):
    def walk(o):
        if isinstance(o, dict):
            if "skill-prompt" in o.values():
                yield o
            for v in o.values():
                yield from walk(v)
        elif isinstance(o, list):
            for v in o:
                yield from walk(v)
    yield from walk(ev)


def main():
    flt = sys.argv[1] if len(sys.argv) > 1 else ""
    dirs = misty_step_session_dirs()
    if flt:
        dirs = [d for d in dirs if d.endswith(flt) or d == f"-Development-misty-step-{flt}"]
        if not dirs:
            sys.exit(f"'{flt}' resolves to no Misty Step session dir; not scanning outside the org")
    op = collections.Counter()
    op_sessions = set()
    agt = collections.Counter()
    agt_spread = collections.defaultdict(set)
    scanned = 0
    for proj in dirs:
        for fp in sorted(glob.glob(BASE + proj + "/*.jsonl")):
            scanned += 1
            sess = fp.split("/")[-1][:16]
            try:
                fh = open(fp)
            except OSError:
                continue
            with fh:
                for line in fh:
                    if '"skill-prompt"' not in line and '"tool_execution_start"' not in line:
                        continue
                    try:
                        ev = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if ev.get("customType") == "tool_execution_start":
                        data = ev.get("data", {})
                        if data.get("toolName") == "read":
                            p = (data.get("args") or {}).get("path") or ""
                            if p.startswith("skill://"):
                                skill = p[len("skill://"):].split("/")[0].split(":")[0]
                                agt[skill] += 1
                                agt_spread[skill].add(proj)
                        continue
                    for hit in find_skill_prompts(ev):
                        content = hit.get("content") or hit.get("text") or ""
                        m = re.search(r'invoked the "([^"]+)" skill', content)
                        if m:
                            op[m.group(1)] += 1
                            op_sessions.add((m.group(1), proj, sess))
    label = flt or "all Misty Step repos"
    print(f"scanned {scanned} transcripts ({label})\n")
    print("OPERATOR invocations:")
    for name, c in op.most_common(30):
        s = len({(p, x) for (k, p, x) in op_sessions if k == name})
        print(f"  {c:4d} ev / {s:3d} sessions  {name}")
    print("\nAGENT skill:// reads:")
    for name, c in agt.most_common(30):
        print(f"  {c:4d} ev / {len(agt_spread[name]):2d} projects  {name}")


if __name__ == "__main__":
    main()
