#!/usr/bin/env python3
# owned by misty-step/harness agent-session-backup
"""Back up OMP transcripts and consistent Kaylee history to the existing restic repository."""
import argparse
from contextlib import closing
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time

TAG = "agent-session-stores"


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def snapshot_database(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + 120

    def progress(status, remaining, total):
        if time.monotonic() > deadline:
            raise TimeoutError(f"SQLite snapshot timed out: {source}")

    with closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)) as live:
        with closing(sqlite3.connect(target)) as saved:
            live.backup(saved, pages=256, progress=progress, sleep=0.01)
            saved.execute("PRAGMA journal_mode=DELETE")
            if saved.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
                raise ValueError(f"SQLite snapshot failed quick_check: {source}")


def stage_hermes(profile, target):
    # Never copy a live SQLite main file or its sidecars. The backup API includes
    # committed WAL pages without stopping or checkpointing the writer.
    ignore = shutil.ignore_patterns("*.db", "*.db-wal", "*.db-shm", "*.db-journal")
    databases = [profile / "state.db"]
    for name in ("sessions", "cron", "plugin-data/kaylee"):
        source = profile / name
        shutil.copytree(source, target / name, ignore=ignore)
        databases.extend(sorted(source.rglob("*.db")))
    for source in databases:
        snapshot_database(source, target / source.relative_to(profile))
    return [target / source.relative_to(profile) for source in databases]


def restic(binary, *args):
    # Credentials stay in the inherited pass-env environment, never argv/logs.
    return subprocess.check_output([binary, *map(str, args)], text=True)


def backup(home, binary):
    sessions = home / ".omp/agent/sessions"
    profile = home / ".hermes/profiles/kaylee"
    if not sessions.is_dir() or not (profile / "state.db").is_file():
        raise ValueError("OMP sessions and Kaylee state.db must both exist")
    state = home / ".local/state/agent-session-backup"
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    scratch = home / ".cache/tmp"
    scratch.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (state / "backup.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        stage = state / "snapshot"
        if stage.exists():
            shutil.rmtree(stage)
        stage.mkdir(mode=0o700)
        try:
            databases = stage_hermes(profile, stage / "hermes")
            manifest = {
                "schema": 1, "home": str(home), "sessions": str(sessions),
                "profile": str(profile), "stage": str(stage),
                "glass_build": subprocess.check_output([str(home / ".local/bin/glass"), "version"], text=True).strip(),
                "databases": {str(path.relative_to(stage)): digest(path) for path in databases},
            }
            (stage / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
            output = restic(binary, "backup", "--json", "--tag", TAG,
                            "--read-concurrency", "2", sessions, stage)
            summaries = [json.loads(line) for line in output.splitlines()]
            summary = next(row for row in summaries if row.get("message_type") == "summary")
            snapshot = summary["snapshot_id"]
            if not snapshot:
                raise ValueError("restic returned no snapshot ID")
            # Prove the exact uploaded SQLite snapshots, not a local staging copy.
            with tempfile.TemporaryDirectory(prefix="agent-session-proof-", dir=scratch) as directory:
                target = Path(directory)
                restic(binary, "restore", snapshot + ":" + str(stage), "--target", target, "--verify")
                if json.loads((target / "manifest.json").read_text()) != manifest:
                    raise ValueError("Restored snapshot manifest differs")
                for relative, expected in manifest["databases"].items():
                    if digest(target / relative) != expected:
                        raise ValueError(f"Restored SQLite snapshot differs: {relative}")
            # Match Pile retention, scoped exclusively to this backup's tag/host.
            restic(binary, "forget", "--tag", TAG, "--host", os.uname().nodename,
                   "--keep-daily", "30", "--keep-monthly", "24")
            result = {"snapshot": snapshot, "sqlite_restore": "matched", "databases": len(databases),
                      "files": summary["total_files_processed"], "bytes": summary["total_bytes_processed"]}
            print(json.dumps(result), flush=True)
            (state / "last-success.json").write_text(json.dumps(result, indent=2) + "\n")
        finally:
            shutil.rmtree(stage)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, default=Path.home())
    parser.add_argument("--restic", default="restic")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        backup(args.home.expanduser().absolute(), args.restic)
    except (OSError, ValueError, sqlite3.Error, subprocess.CalledProcessError, StopIteration) as error:
        print(f"agent-session-backup: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
