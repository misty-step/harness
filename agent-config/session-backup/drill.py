#!/usr/bin/env python3
"""Restore one exact snapshot and compare Glass's canonical ledger, without live-store fallback."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


def output(*args, **kwargs):
    return subprocess.check_output(list(map(str, args)), text=True, **kwargs)


def projection(ledger):
    # Read timestamps are transient; all actual accounting and unknown reasons remain.
    return {**ledger, "agents": [
        {key: value for key, value in agent.items() if key != "read"}
        for agent in ledger["agents"]
    ]}


def drill(args):
    home = Path.home()
    target = args.target.expanduser().absolute()
    if target.exists() and (target.is_symlink() or not target.is_dir() or any(target.iterdir())):
        raise ValueError("Restore target must be a fresh empty scratch directory")
    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    live = json.loads(output("glass", "query", "item", args.item, "--json"))
    records = live["data"]["task_records"]
    if records["state"] != "ok" or not records["value"]["agents"]:
        raise ValueError("Live Glass has no readable attributed ledger for this item")
    expected = projection(records["value"])
    restored = target / "restored"
    output(args.restic, "restore", args.snapshot, "--target", restored, "--verify")
    stage = restored / str(home / ".local/state/agent-session-backup/snapshot").lstrip("/")
    manifest = json.loads((stage / "manifest.json").read_text())
    if manifest["home"] != str(home) or manifest["glass_build"] != live["build"]:
        raise ValueError("Snapshot home/Glass revision does not match the live ledger")
    source = target / "glass-source"
    output("git", "clone", "--quiet", "--shared", "--no-checkout", args.glass_source, source)
    output("git", "-C", source, "checkout", "--quiet", "--detach", manifest["glass_build"])
    helper = source / "cmd/session-backup-drill/main.go"
    helper.parent.mkdir(parents=True)
    shutil.copyfile(Path(__file__).with_name("ledger.go"), helper)
    binary = target / "derive-ledger"
    subprocess.run(["go", "build", "-p", "1", "-o", str(binary), "./cmd/session-backup-drill"],
                   cwd=source, check=True, env={**os.environ, "GOMAXPROCS": "2"})
    profile = manifest["profile"]
    sessions = manifest["sessions"]
    # Absolute session bindings remain intact. These mounts hide ALL live owner
    # inputs; the canonical reader sees only restored files at their original paths.
    restored_sessions = restored / sessions.lstrip("/")
    actual = projection(json.loads(output(
        "bwrap", "--ro-bind", "/", "/", "--unshare-net", "--die-with-parent",
        "--ro-bind", restored_sessions, sessions,
        "--bind", stage / "hermes", profile,
        "--", binary, profile + "/plugin-data/kaylee/board.db", sessions,
        profile + "/plugin-data/kaylee/ledger.json", args.item,
    )))
    if actual != expected:
        (target / "mismatch.json").write_text(json.dumps({"live": expected, "restored": actual}, indent=2) + "\n")
        raise ValueError(f"Restored ledger differs; evidence: {target / 'mismatch.json'}")
    after = json.loads(output("glass", "query", "item", args.item, "--json"))
    if after["build"] != live["build"] or projection(after["data"]["task_records"]["value"]) != expected:
        raise ValueError("Live ledger changed during the drill; no stable equality proof")
    result = {"snapshot": args.snapshot, "item": args.item, "glass_build": live["build"],
              "isolated": True, "ledger": "matched", **actual}
    (target / "ledger-proof.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--item", required=True)
    parser.add_argument("--target", required=True, type=Path)
    parser.add_argument("--glass-source", required=True, type=Path)
    parser.add_argument("--restic", default="restic")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        drill(args)
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print(f"agent-session-drill: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
