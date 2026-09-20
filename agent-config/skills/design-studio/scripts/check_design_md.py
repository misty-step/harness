#!/usr/bin/env python3
"""Minimal structural fallback validator for DESIGN.md-style spec files.

Use this when the full design-md CLI (`npx @google/design.md lint`) or the host
profile's design-md skill is unavailable — e.g. a fresh Pi/OMP consumer install
of design-studio that only carries `agent-config/skills/*`. It checks STRUCTURE
ONLY:

  - a leading YAML frontmatter block delimited by '---' lines
  - required token groups: version, name, colors, typography
  - canonical body sections: Overview, Colors, Typography, Components
  - {group.token} references in the frontmatter resolve to a defined token path

It does NOT validate the full DESIGN.md schema and does NOT compute WCAG
contrast. Record that reduced coverage whenever this fallback stands in for the
design-md CLI in a handoff.

Usage:
  python3 check_design_md.py DESIGN.md     # exit 0 clean; 1 findings; 2 usage
  python3 check_design_md.py --self-test
"""
from __future__ import annotations

import re
import sys

REQUIRED_GROUPS = ("version", "name", "colors", "typography")
CANONICAL_SECTIONS = ("Overview", "Colors", "Typography", "Components")


def token_paths(frontmatter: str) -> set:
    """Dotted token paths from a line-oriented scan of the frontmatter."""
    paths = set()
    stack: list[tuple[int, str]] = []
    for line in frontmatter.splitlines():
        m = re.match(r"^([ \t]*)([A-Za-z0-9_.-]+):(?:\s+(.*))?$", line)
        if not m:
            continue
        indent = len(m.group(1).replace("\t", "  "))
        key = m.group(2)
        while stack and stack[-1][0] >= indent:
            stack.pop()
        stack.append((indent, key))
        paths.add(".".join([k for _, k in stack]))
    return paths


def check(text: str) -> list:
    """Return structural findings for a DESIGN.md-like document; empty is clean."""
    problems: list[str] = []
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    if not m:
        return ["missing or malformed YAML frontmatter (expected a leading '---' block)"]
    front, body = m.group(1), m.group(2)
    paths = token_paths(front)
    top = {p for p in paths if "." not in p}
    for group in REQUIRED_GROUPS:
        if group not in top:
            problems.append(f"frontmatter missing required group: {group}")
    for section in CANONICAL_SECTIONS:
        if not re.search(rf"^##\s+{section}\b", body, re.M):
            problems.append(f"body missing canonical section: ## {section}")
    for ref in sorted(set(re.findall(r"\{([A-Za-z0-9_.-]+)\}", front))):
        if ref in paths or any(p.startswith(ref + ".") for p in paths):
            continue
        problems.append(f"reference {{{ref}}} does not resolve to a defined token path")
    return problems


def _self_test() -> int:
    good = """---
version: alpha
name: Fixture
colors:
  primary: "#111111"
typography:
  body:
    fontFamily: system-ui
    fontSize: 14px
components:
  button:
    backgroundColor: "{colors.primary}"
---

## Overview

X

## Colors

X

## Typography

X

## Components

X
"""
    failures: list[str] = []
    found = check(good)
    if found:
        failures.append(f"valid fixture flagged: {found}")
    cases = {
        "missing frontmatter": "# nope\n",
        "missing colors group": good.replace('colors:\n  primary: "#111111"\n', ""),
        "missing canonical section": good.replace("## Components", "## Nope"),
        "unresolved reference": good.replace("{colors.primary}", "{colors.ghost}"),
    }
    for name, case in cases.items():
        if not check(case):
            failures.append(f"{name} not detected")
    if failures:
        for failure in failures:
            print(f"FAIL {failure}", file=sys.stderr)
        return 1
    print("check_design_md self-test OK")
    return 0


def main() -> int:
    args = sys.argv[1:]
    if args == ["--self-test"]:
        return _self_test()
    if len(args) != 1:
        print("usage: check_design_md.py DESIGN.md | --self-test", file=sys.stderr)
        return 2
    try:
        with open(args[0], encoding="utf-8") as fh:
            text = fh.read()
    except OSError as exc:
        print(f"FAIL cannot read {args[0]}: {exc}", file=sys.stderr)
        return 2
    problems = check(text)
    if problems:
        for problem in problems:
            print(f"FAIL {problem}", file=sys.stderr)
        return 1
    print("check_design_md OK (minimal structural checks only; full lint requires "
          f"the design-md CLI): {args[0]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())