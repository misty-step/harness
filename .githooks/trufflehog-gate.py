#!/usr/bin/env python3
"""Reject TruffleHog findings except one pinned public release-link false positive."""

import json
import re
import subprocess
import sys
from pathlib import Path


# Split the public SHA so the exception itself cannot trigger the scanner.
PUBLIC_COMMIT = "789ae58ddd" + "0aecad3406" + "3f53304665" + "f215a9418a"
COMMIT_LINK = re.compile(r"https://github\.com/misty-step/harness/commit/" + PUBLIC_COMMIT + r"\)")


def public_commit_sha_finding(finding: object, changelog: list[str]) -> bool:
    if not isinstance(finding, dict):
        return False
    if finding.get("DetectorName") != "GitHubOauth2" or finding.get("Verified") is not False:
        return False
    metadata = finding.get("SourceMetadata")
    data = metadata.get("Data") if isinstance(metadata, dict) else None
    source = data.get("Filesystem") if isinstance(data, dict) else None
    if not isinstance(source, dict) or source.get("file") != "CHANGELOG.md":
        return False
    line = source.get("line")
    raw = finding.get("Raw")
    if type(line) is not int or not 1 <= line <= len(changelog):
        return False
    if raw != PUBLIC_COMMIT[:20]:
        return False
    return COMMIT_LINK.search(changelog[line - 1]) is not None


def main() -> int:
    try:
        result = subprocess.run(
            ["trufflehog", "filesystem", ".", "--exclude-paths=.githooks/trufflehog-exclude.txt",
             "--no-verification", "--no-update", "--fail", "--fail-on-scan-errors", "--json"],
            capture_output=True, text=True, check=False,
        )
        changelog = Path("CHANGELOG.md").read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError):
        print("trufflehog: scanner or changelog unavailable", file=sys.stderr)
        return 1
    if result.returncode == 0 and not result.stdout.strip():
        return 0
    if result.returncode != 183 or not result.stdout.strip():
        print("trufflehog: scan failed or returned unexpected output", file=sys.stderr)
        return 1
    count = 0
    for row in result.stdout.splitlines():
        try:
            finding = json.loads(row)
        except json.JSONDecodeError:
            print("trufflehog: malformed scanner result", file=sys.stderr)
            return 1
        if not public_commit_sha_finding(finding, changelog):
            print("trufflehog: finding outside public commit links", file=sys.stderr)
            return 1
        count += 1
    print(f"trufflehog: ignored {count} unverified public commit-SHA finding(s)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
