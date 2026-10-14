#!/usr/bin/env python3
# owned by misty-step/harness agent-session-backup
"""Back up legacy sessions or explicit bounded sources to the existing restic repository."""
import argparse
from contextlib import closing, contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
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
    # Legacy copytree dereferenced links. Keep that selection/layout policy,
    # including linked SQLite stores, without imposing configured-mode rejection.
    databases, directories = [], []
    for name in ("state.db", "sessions", "cron", "plugin-data/kaylee"):
        for path, kind in source_entries(profile / name, follow_links=True):
            saved = target / path.relative_to(profile)
            save_entry(path.resolve(strict=True), kind, saved)
            if kind == "directory":
                directories.append((path, saved))
            elif kind == "sqlite":
                databases.append(saved)
    for path, saved in reversed(directories):
        shutil.copystat(path, saved)
    return databases


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def relative_path(value):
    if not isinstance(value, str) or not value or "\x00" in value:
        raise ValueError("Expected a nonempty relative path")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in ("", ".", "..") for part in value.split("/")):
        raise ValueError(f"Unsafe relative path: {value}")
    return path


def no_symlinks(path):
    # Reject links, including ancestor links. Never dereference them into an
    # omitted tree. Configured sources must be stable against rename/link swaps
    # during a cut; ordinary concurrent file/SQLite writers are supported.
    for parent in reversed((path, *path.parents)):
        try:
            info = parent.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode):
            raise ValueError(f"Symlinks are not supported in configured snapshots: {parent}")


def safe_destination(path):
    # Do not resolve() away links or '..' before the destructive-boundary checks.
    path = path.expanduser().absolute()
    if ".." in path.parts or path.anchor != "/" or path == Path("/"):
        raise ValueError(f"Destination must be bounded and absolute without '..': {path}")
    no_symlinks(path)
    return path


def path_present(path):
    # exists()/is_file() suppress denied I/O on supported Python versions.
    # Only ENOENT is absence; malformed parents, EACCES and other I/O fail.
    try:
        path.lstat()
    except FileNotFoundError:
        return False
    return True


def paths_overlap(first, second):
    return first == second or first.is_relative_to(second) or second.is_relative_to(first)


def remove_owned_tree(path):
    """Remove only a vetted owned tree; never chmod/follow linked source targets."""
    path = safe_destination(path)
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW

    def remove_directory(parent_fd, name):
        fd = os.open(name, flags, dir_fd=parent_fd)
        try:
            info = os.fstat(fd)
            if info.st_uid != os.getuid():
                raise PermissionError(f"Refusing cleanup of a foreign-owned directory: {name}")
            os.fchmod(fd, stat.S_IMODE(info.st_mode) | stat.S_IRWXU)
            with os.scandir(fd) as entries:
                for entry in entries:
                    if entry.is_dir(follow_symlinks=False):
                        remove_directory(fd, entry.name)
                    else:
                        os.unlink(entry.name, dir_fd=fd)
        finally:
            os.close(fd)
        os.rmdir(name, dir_fd=parent_fd)

    parent_fd = os.open(path.parent, flags)
    try:
        remove_directory(parent_fd, path.name)
    finally:
        os.close(parent_fd)


def cleanup_after_error(path, error):
    try:
        remove_owned_tree(path)
    except Exception as cleanup_error:
        error.add_note(f"Owned snapshot cleanup failed at {path}: {cleanup_error}")


@contextmanager
def proof_directory(scratch):
    target = Path(tempfile.mkdtemp(prefix="agent-session-proof-", dir=scratch))
    try:
        yield target
    except BaseException as error:
        cleanup_after_error(target, error)
        raise
    else:
        remove_owned_tree(target)


def validate_config(config, check_sources=True):
    if not isinstance(config, dict) or set(config) != {"schema", "mode", "sources"}:
        raise ValueError("Config requires exactly schema, mode and sources")
    if type(config["schema"]) is not int or config["schema"] != 1:
        raise ValueError("Unsupported source config schema")
    if config["mode"] not in ("hermes-only", "with-omp"):
        raise ValueError("Config mode must be hermes-only or with-omp")
    if not isinstance(config["sources"], list) or not config["sources"]:
        raise ValueError("Config requires named sources")
    names, selections = set(), []
    for source in config["sources"]:
        if not isinstance(source, dict) or set(source) != {"id", "role", "tier", "required", "root", "include"}:
            raise ValueError("Source requires exactly id, role, tier, required, root and include")
        for key in ("id", "role"):
            if not isinstance(source[key], str) or not re.fullmatch(r"[a-z][a-z0-9_-]{0,63}", source[key]):
                raise ValueError(f"Invalid source {key}")
        if source["id"] in names:
            raise ValueError(f"Duplicate source id: {source['id']}")
        names.add(source["id"])
        if source["tier"] not in ("hot", "cold") or type(source["required"]) is not bool:
            raise ValueError("Source tier must be hot/cold and required must be boolean")
        root = source["root"]
        if not isinstance(root, str) or not root.startswith("/") or root.startswith("//") or "\x00" in root or ".." in root.split("/"):
            raise ValueError("Source root must be an absolute path without '..'")
        if str(Path(root)) != root or root == "/":
            raise ValueError("Source root must be canonical and bounded (not '/')")
        if check_sources:
            no_symlinks(Path(root))
        if not isinstance(source["include"], list) or not source["include"]:
            raise ValueError("Source include must be a nonempty list of explicit relative paths")
        for value in source["include"]:
            path = Path(root) / relative_path(value)
            if path.name.endswith(("-wal", "-shm", "-journal")):
                raise ValueError("Select the SQLite main file, not a sidecar")
            if check_sources:
                no_symlinks(path)
            for previous in selections:
                if path == previous or path.is_relative_to(previous) or previous.is_relative_to(path):
                    raise ValueError(f"Overlapping source selections: {path} and {previous}")
            selections.append(path)
    required = [source for source in config["sources"] if source["required"]]
    if not required:
        raise ValueError("At least one source must be required")
    omp = [source for source in config["sources"] if source["role"] == "omp"]
    if config["mode"] == "hermes-only" and omp:
        raise ValueError("hermes-only mode cannot select an omp role")
    if config["mode"] == "with-omp" and not any(source["required"] for source in omp):
        raise ValueError("with-omp mode requires an explicit required omp source")
    return config


def read_json(path):
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"Duplicate JSON key: {key}")
            result[key] = value
        return result
    return json.loads(path.read_text(), object_pairs_hook=unique_object)


def load_config(path):
    return validate_config(read_json(path))


def config_digest(config):
    canonical = {**config, "sources": sorted(config["sources"], key=lambda source: source["id"])}
    return hashlib.sha256(json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def is_database(path):
    if path.suffix in (".db", ".sqlite3"):
        return True
    with path.open("rb") as stream:
        return stream.read(16) == b"SQLite format 3\x00"


def source_entries(path, live=True, follow_links=False, ancestors=frozenset()):
    if not follow_links:
        no_symlinks(path)
    info = path.stat() if follow_links else path.lstat()
    if stat.S_ISDIR(info.st_mode):
        identity = (info.st_dev, info.st_ino)
        if identity in ancestors:
            raise ValueError(f"Source directory link cycle: {path}")
        yield path, "directory"
        for child in sorted(path.iterdir()):
            if not follow_links:
                no_symlinks(child)
            if child.name.endswith(("-wal", "-shm", "-journal")):
                if not live:
                    raise ValueError(f"Unexpected restored SQLite sidecar: {child}")
                if not child.is_file():
                    raise ValueError(f"Unsupported SQLite sidecar type: {child}")
                main = child.with_name(child.name.rsplit("-", 1)[0])
                if not follow_links:
                    no_symlinks(main)
                if not main.is_file() or not is_database(main):
                    raise ValueError(f"Orphan/non-SQLite sidecar cannot be omitted: {child}")
                # The online backup API, not a raw copy, owns these bytes.
                continue
            yield from source_entries(child, live=live, follow_links=follow_links, ancestors=ancestors | {identity})
    elif stat.S_ISREG(info.st_mode):
        yield path, "sqlite" if is_database(path) else "file"
    else:
        raise ValueError(f"Unsupported source file type: {path}")


def save_entry(path, kind, saved):
    saved.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if kind == "directory":
        saved.mkdir(exist_ok=True, mode=0o700)
    elif kind == "sqlite":
        snapshot_database(path, saved)
        shutil.copystat(path, saved)
    else:
        # Leaf swaps cannot redirect reads. Directory/link renames during a cut
        # are outside the stable-source contract; ordinary writers are allowed.
        with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), "rb") as live:
            before = os.fstat(live.fileno())
            with saved.open("xb") as output:
                shutil.copyfileobj(live, output)
            after = os.fstat(live.fileno())
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise ValueError(f"Source file changed during copy: {path}")
        saved.chmod(stat.S_IMODE(before.st_mode))
        os.utime(saved, ns=(before.st_atime_ns, before.st_mtime_ns))


def stage_configured(config, target):
    """Produce schema 2 in a new exclusive directory; no restic or live activation."""
    validate_config(config)
    target = safe_destination(target)
    selections = [Path(source["root"]) / value for source in config["sources"] for value in source["include"]]
    if any(paths_overlap(target, path) for path in selections):
        raise ValueError("Staging target overlaps a source selection")
    target.mkdir(mode=0o700)  # Refuse every existing target, including an empty one.
    manifest = {
        "schema": 2, "source_host": os.uname().nodename, "mode": config["mode"],
        "cut_started": utc_now(), "config_sha256": config_digest(config),
        "sources": {}, "files": {}, "databases": {},
    }
    try:
        for source in config["sources"]:
            started = utc_now()
            root = Path(source["root"])
            missing = [value for value in source["include"] if not path_present(root / value)]
            if missing and source["required"]:
                raise ValueError(f"Required source {source['id']} is missing: {', '.join(missing)}")
            record = {key: source[key] for key in ("root", "role", "tier", "required", "include")}
            record.update(missing=missing, status="missing" if len(missing) == len(source["include"])
                          else "partial" if missing else "complete", cut_started=started)
            destination = target / "sources" / source["id"]
            destination.mkdir(parents=True, mode=0o700)
            directories = []
            for value in source["include"]:
                if value in missing:
                    continue
                for path, kind in source_entries(root / value):
                    cut_started = utc_now()
                    saved = destination / path.relative_to(root)
                    save_entry(path, kind, saved)
                    if kind == "directory":
                        directories.append((path, saved))
                        continue
                    relative = saved.relative_to(target).as_posix()
                    info = saved.stat()
                    entry = {"kind": kind, "sha256": digest(saved), "size": info.st_size,
                             "mode": stat.S_IMODE(info.st_mode), "mtime_ns": info.st_mtime_ns,
                             "cut_started": cut_started, "cut_finished": utc_now()}
                    manifest["files"][relative] = entry
                    if kind == "sqlite":
                        manifest["databases"][relative] = entry["sha256"]
            for path, saved in reversed(directories):
                shutil.copystat(path, saved)
            record["cut_finished"] = utc_now()
            manifest["sources"][source["id"]] = record
        # Include directories (also synthetic parents) so empty memories and
        # unexpected remote additions are verified, not silently lost.
        for path in sorted(target.rglob("*")):
            if path.is_dir():
                info = path.stat()
                manifest["files"][path.relative_to(target).as_posix()] = {
                    "kind": "directory", "mode": stat.S_IMODE(info.st_mode), "mtime_ns": info.st_mtime_ns,
                }
        manifest["cut_finished"] = utc_now()
        manifest["oldest_required_cut"] = min(
            record["cut_started"] for record in manifest["sources"].values() if record["required"])
        # Written once, before upload. Verification receipts live outside this
        # immutable snapshot; neither upload nor restore mutates its manifest.
        (target / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        return manifest
    except BaseException as error:
        cleanup_after_error(target, error)
        raise


def cut_interval(record):
    start, finish = (datetime.fromisoformat(record[key]) for key in ("cut_started", "cut_finished"))
    if any(value.utcoffset() != timezone.utc.utcoffset(value) for value in (start, finish)) or finish < start:
        raise ValueError("Invalid UTC cut interval")
    if start.isoformat() != record["cut_started"] or finish.isoformat() != record["cut_finished"]:
        raise ValueError("Cut timestamps must use canonical UTC ISO-8601")
    return start, finish


def verify_configured(target, expected=None):
    """Verify a restored schema-2 tree, without source-host dependencies."""
    no_symlinks(target)
    no_symlinks(target / "manifest.json")
    manifest = read_json(target / "manifest.json")
    if expected is not None and manifest != expected:
        raise ValueError("Restored snapshot manifest differs")
    if not isinstance(manifest, dict) or type(manifest.get("schema")) is not int or manifest["schema"] != 2:
        raise ValueError("Expected snapshot manifest schema 2")
    if not all(isinstance(manifest.get(key), dict) for key in ("sources", "files", "databases")):
        raise ValueError("Snapshot sources/files/databases must be objects")
    if not all(isinstance(record, dict) for key in ("sources", "files") for record in manifest[key].values()):
        raise ValueError("Snapshot source/file entries must be objects")
    config = {"schema": 1, "mode": manifest["mode"], "sources": [
        {"id": name, **{key: record[key] for key in ("root", "role", "tier", "required", "include")}}
        for name, record in manifest["sources"].items()
    ]}
    # Do not consult source roots on a replacement host. Structural config
    # validation is separate from its filesystem checks below.
    validate_config(config, check_sources=False)
    if config_digest(config) != manifest["config_sha256"]:
        raise ValueError("Snapshot config digest differs")
    snapshot_start, snapshot_finish = cut_interval(manifest)
    if not isinstance(manifest["source_host"], str) or not manifest["source_host"]:
        raise ValueError("Missing snapshot source host")
    cuts = []
    selected = []
    for name, record in manifest["sources"].items():
        if manifest["files"].get("sources/" + name, {}).get("kind") != "directory":
            raise ValueError("Source snapshot directory is missing")
        start, finish = cut_interval(record)
        if not snapshot_start <= start <= finish <= snapshot_finish:
            raise ValueError("Source cut lies outside snapshot interval")
        missing = record["missing"]
        if not isinstance(missing, list) or len(set(missing)) != len(missing) or not set(missing) <= set(record["include"]):
            raise ValueError("Invalid source missing inventory")
        status = "missing" if len(missing) == len(record["include"]) else "partial" if missing else "complete"
        if status != record["status"]:
            raise ValueError("Source status differs from missing inventory")
        for value in record["include"]:
            relative = "sources/" + name + "/" + value
            if value not in missing:
                if relative not in manifest["files"]:
                    raise ValueError(f"Selected snapshot path is missing: {relative}")
                selected.append(PurePosixPath(relative))
            elif relative in manifest["files"]:
                raise ValueError("Missing source path unexpectedly present")
        if record["required"]:
            if record["status"] != "complete" or record["missing"]:
                raise ValueError("Required snapshot source is incomplete")
            cuts.append(record["cut_started"])
    if min(cuts) != manifest["oldest_required_cut"]:
        raise ValueError("Oldest required cut differs")
    actual = set()
    for path, kind in source_entries(target, live=False):
        if path == target or path == target / "manifest.json":
            continue
        relative = path.relative_to(target).as_posix()
        actual.add(relative)
        if relative not in manifest["files"]:
            raise ValueError(f"Unexpected restored path: {relative}")
        entry = manifest["files"][relative]
        relative_path(relative)
        parts = PurePosixPath(relative)
        synthetic = relative == "sources" or relative in {"sources/" + name for name in manifest["sources"]}
        if synthetic and kind != "directory":
            raise ValueError("Source snapshot containers must be directories")
        if not synthetic and not any(parts == chosen or parts.is_relative_to(chosen) or
                                     (kind == "directory" and chosen.is_relative_to(parts)) for chosen in selected):
            raise ValueError(f"Restored path is outside configured selections: {relative}")
        if kind != entry["kind"] or stat.S_IMODE(path.stat().st_mode) != entry["mode"]:
            raise ValueError(f"Restored path type/mode differs: {relative}")
        if kind != "directory":
            start, finish = cut_interval(entry)
            source_start, source_finish = cut_interval(manifest["sources"][parts.parts[1]])
            if not source_start <= start <= finish <= source_finish:
                raise ValueError("File cut lies outside source interval")
            if path.stat().st_size != entry["size"] or digest(path) != entry["sha256"]:
                raise ValueError(f"Restored file differs: {relative}")
            if kind == "sqlite":
                with closing(sqlite3.connect(path.as_uri() + "?mode=ro&immutable=1", uri=True)) as saved:
                    if saved.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
                        raise ValueError(f"Restored SQLite quick_check failed: {relative}")
    for value in manifest["files"]:
        relative_path(value)
    if actual != set(manifest["files"]):
        raise ValueError("Restored inventory differs")
    databases = {path: entry["sha256"] for path, entry in manifest["files"].items() if entry["kind"] == "sqlite"}
    if databases != manifest["databases"]:
        raise ValueError("Restored database inventory differs")
    return manifest


def restic(binary, *args):
    # Credentials stay in the inherited pass-env environment, never argv/logs.
    return subprocess.check_output([binary, *map(str, args)], text=True)


def backup(home, binary, config=None):
    home = safe_destination(home)
    sessions = home / ".omp/agent/sessions"
    profile = home / ".hermes/profiles/kaylee"
    if config is None and (not sessions.is_dir() or not (profile / "state.db").is_file()):
        raise ValueError("OMP sessions and Kaylee state.db must both exist")
    state = home / ".local/state/agent-session-backup"
    scratch = home / ".cache/tmp"
    stage = state / "snapshot"
    for path in (state, scratch, stage, state / "backup.lock", state / "last-success.json"):
        safe_destination(path)
    if config is not None:
        validate_config(config)
        selections = [Path(source["root"]) / value for source in config["sources"] for value in source["include"]]
    else:
        # Legacy links remain supported, but cannot point into bytes this run
        # writes/removes. Inspect real targets before even creating the lock.
        selections = [sessions.resolve(strict=True)]
        for name in ("state.db", "sessions", "cron", "plugin-data/kaylee"):
            selections.extend(path.resolve(strict=True) for path, kind in
                              source_entries(profile / name, follow_links=True))
    if any(paths_overlap(selected, reserved) for selected in selections for reserved in (state, scratch)):
        raise ValueError("Source overlaps backup state/scratch")
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    scratch.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (state / "backup.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if path_present(stage):
            remove_owned_tree(stage)
        stage_owned = False
        try:
            if config is None:
                stage.mkdir(mode=0o700)
                stage_owned = True
                databases = stage_hermes(profile, stage / "hermes")
                manifest = {
                    "schema": 1, "home": str(home), "sessions": str(sessions),
                    "profile": str(profile), "stage": str(stage),
                    "glass_build": subprocess.check_output([str(home / ".local/bin/glass"), "version"], text=True).strip(),
                    "databases": {str(path.relative_to(stage)): digest(path) for path in databases},
                }
                (stage / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
                inputs = (sessions, stage)
            else:
                manifest = stage_configured(config, stage)
                stage_owned = True
                inputs = (stage,)
            manifest_sha256 = digest(stage / "manifest.json")
            output = restic(binary, "backup", "--json", "--tag", TAG,
                            "--read-concurrency", "2", *inputs)
            summaries = [json.loads(line) for line in output.splitlines()]
            summary = next(row for row in summaries if row.get("message_type") == "summary")
            snapshot = summary["snapshot_id"]
            if not snapshot:
                raise ValueError("restic returned no snapshot ID")
            # Prove the exact uploaded SQLite snapshots, not a local staging copy.
            with proof_directory(scratch) as target:
                restic(binary, "restore", snapshot + ":" + str(stage), "--target", target, "--verify")
                no_symlinks(target / "manifest.json")
                if digest(target / "manifest.json") != manifest_sha256:
                    raise ValueError("Restored snapshot manifest bytes differ")
                if config is not None:
                    verify_configured(target, expected=manifest)
                else:
                    if json.loads((target / "manifest.json").read_text()) != manifest:
                        raise ValueError("Restored snapshot manifest differs")
                    for relative, expected in manifest["databases"].items():
                        if digest(target / relative) != expected:
                            raise ValueError(f"Restored SQLite snapshot differs: {relative}")
            # Settle owned-stage cleanup before retention or any success receipt.
            remove_owned_tree(stage)
            stage_owned = False
            # Match Pile retention, scoped exclusively to this backup's tag/host.
            restic(binary, "forget", "--tag", TAG, "--host", os.uname().nodename,
                   "--keep-daily", "30", "--keep-monthly", "24")
            result = {"snapshot": snapshot, "sqlite_restore": "matched", "databases": len(manifest["databases"]),
                      "files": summary["total_files_processed"], "bytes": summary["total_bytes_processed"]}
            if config is not None:
                result.update(scope_restore="matched", oldest_required_cut=manifest["oldest_required_cut"],
                              source_host=manifest["source_host"], verified_at=utc_now(),
                              manifest_sha256=manifest_sha256, stage=str(stage))
            (state / "last-success.json").write_text(json.dumps(result, indent=2) + "\n")
            print(json.dumps(result), flush=True)
        except BaseException as error:
            if stage_owned:
                cleanup_after_error(stage, error)
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, default=Path.home())
    parser.add_argument("--restic", default="restic")
    parser.add_argument("--config", type=Path, help="Explicit schema-1 source config (otherwise legacy scope)")
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--stage-only", type=Path, help="Stage configured sources into a NEW directory; no restic")
    action.add_argument("--verify-stage", type=Path, help="Verify a restored schema-2 tree; no source/remote access")
    args = parser.parse_args()
    if args.stage_only and not args.config:
        parser.error("--stage-only requires --config")
    if args.verify_stage and args.config:
        parser.error("--verify-stage reads its own manifest, not --config")
    os.umask(0o077)
    try:
        if args.verify_stage:
            manifest = verify_configured(args.verify_stage.expanduser().absolute())
            print(json.dumps({"scope_restore": "matched", "databases": len(manifest["databases"]),
                              "oldest_required_cut": manifest["oldest_required_cut"]}), flush=True)
        else:
            config = load_config(args.config) if args.config else None
            if args.stage_only:
                target = args.stage_only.expanduser().absolute()
                manifest = stage_configured(config, target)
                verify_configured(target, expected=manifest)
                print(json.dumps({"stage": str(target), "manifest_sha256": digest(target / "manifest.json"),
                                  "oldest_required_cut": manifest["oldest_required_cut"]}), flush=True)
            else:
                backup(args.home.expanduser().absolute(), args.restic, config=config)
    except (OSError, ValueError, TypeError, KeyError, sqlite3.Error, subprocess.CalledProcessError, StopIteration) as error:
        print(f"agent-session-backup: {error}", file=sys.stderr)
        for note in getattr(error, "__notes__", ()):
            print(note, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
