#!/usr/bin/env python3
# owned by misty-step/harness agent-config desktop-guard
"""Private, recoverable filesystem transaction for an operator-triggered cutover.

Create a fresh ``Transaction(backup)`` (the backup path must not yet exist), call
``prepare({path: bytes | None | str})``, then ``apply()``. The backup and every
target must be on the same filesystem. Bytes install a 0600 regular file, None
removes a leaf (including a directory tree), and str installs an exact symlink
target. ``check_rollback()`` only preflights; ``rollback()`` preflights again and
restores the originals. Either method works on a new ``Transaction(backup)``
after process failure. Keep the private backup for as long as rollback may be
needed. No method controls services or reloads config.
"""

import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile


_FILE_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC
_DIR_FLAGS = _FILE_FLAGS | os.O_DIRECTORY


def _absolute(path):
    result = Path(os.path.abspath(os.fspath(path)))
    if result == Path("/"):
        raise ValueError("Refusing filesystem root as transaction path")
    return result


def _mode(info):
    return stat.S_IMODE(info.st_mode)


def _lstat(path):
    try:
        return path.lstat()
    except FileNotFoundError:
        return None


def _ancestors(path):
    """Reject unsafe ancestors; return missing directories, shallow first."""
    missing = []
    for parent in reversed(path.parents):
        info = _lstat(parent)
        if info is None:
            missing.append(parent)
        elif not stat.S_ISDIR(info.st_mode):
            raise ValueError(f"Refusing symlink or non-directory ancestor: {parent}")
    return missing


def _mkdir_private(path):
    path.mkdir(mode=0o700)
    path.chmod(0o700)  # A restrictive caller umask must not strand the backup.


def _sync_dir(path):
    descriptor = os.open(path, _DIR_FLAGS)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _read_file(path):
    descriptor = os.open(path, _FILE_FLAGS)
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise ValueError(f"Not a regular file: {path}")
        with os.fdopen(descriptor, "rb", closefd=False) as stream:
            return stream.read()
    finally:
        os.close(descriptor)


def _save_file(path, data):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "wb") as stream:
        os.fchmod(stream.fileno(), 0o600)
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def _node(parent_fd, name, copy):
    info = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
    if stat.S_ISLNK(info.st_mode):
        target = os.readlink(name, dir_fd=parent_fd)
        if copy is not None:
            os.symlink(target, copy)
        return {"kind": "link", "target": target}
    if stat.S_ISREG(info.st_mode):
        descriptor = os.open(name, _FILE_FLAGS, dir_fd=parent_fd)
        try:
            checked = os.fstat(descriptor)
            if not stat.S_ISREG(checked.st_mode):
                raise ValueError(f"Changed file while reading: {name}")
            digest = hashlib.sha256()
            output = None
            try:
                if copy is not None:
                    output = os.open(copy, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                    os.fchmod(output, 0o600)
                while data := os.read(descriptor, 1024 * 1024):
                    digest.update(data)
                    if output is not None:
                        with memoryview(data) as view:
                            while view:
                                count = os.write(output, view)
                                view = view[count:]
                if output is not None:
                    os.fsync(output)
            finally:
                if output is not None:
                    os.close(output)
            if os.fstat(descriptor).st_size != checked.st_size:
                raise ValueError(f"Changed file while reading: {name}")
            return {"kind": "file", "mode": _mode(checked), "sha256": digest.hexdigest()}
        finally:
            os.close(descriptor)
    if stat.S_ISDIR(info.st_mode):
        descriptor = os.open(name, _DIR_FLAGS, dir_fd=parent_fd)
        try:
            checked = os.fstat(descriptor)
            if copy is not None:
                _mkdir_private(copy)
            entries = {
                child: _node(descriptor, child, copy / child if copy is not None else None)
                for child in sorted(os.listdir(descriptor))
            }
            if copy is not None:
                _sync_dir(copy)
            return {"kind": "dir", "mode": _mode(checked), "entries": entries}
        finally:
            os.close(descriptor)
    raise ValueError(f"Refusing special filesystem node: {name}")


def _state(path, copy=None):
    if _ancestors(path):
        return {"kind": "absent"}
    descriptor = os.open(path.parent, _DIR_FLAGS)
    try:
        try:
            os.stat(path.name, dir_fd=descriptor, follow_symlinks=False)
        except FileNotFoundError:
            return {"kind": "absent"}
        return _node(descriptor, path.name, copy)
    finally:
        os.close(descriptor)


def _contents(state):
    """The snapshot files are private 0600/0700 copies; modes live in the manifest."""
    if state["kind"] == "dir":
        return {"kind": "dir", "entries": {k: _contents(v) for k, v in state["entries"].items()}}
    if state["kind"] == "file":
        return {"kind": "file", "sha256": state["sha256"]}
    return state


def _json_write(path, value):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(prefix=".transaction-", dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            os.fchmod(stream.fileno(), 0o600)
            stream.write((json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode())
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        temporary = None
        _sync_dir(path.parent)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _atomic_file(path, data, mode, expected, staging):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(prefix=f".{path.name}.", dir=staging, delete=False) as stream:
            temporary = Path(stream.name)
            os.fchmod(stream.fileno(), mode)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        if _state(path) != expected:
            raise ValueError(f"Target changed before replacement: {path}")
        os.replace(temporary, path)
        temporary = None
        _sync_dir(path.parent)
        _sync_dir(staging)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _atomic_link(path, target, expected, staging):
    # Stage only in private backup: process death must not leave foreign live children.
    with tempfile.TemporaryDirectory(prefix=f".{path.name}.", dir=staging) as temporary:
        link = Path(temporary) / "link"
        os.symlink(target, link)
        if _state(path) != expected:
            raise ValueError(f"Target changed before replacement: {path}")
        os.replace(link, path)
        _sync_dir(path.parent)
    _sync_dir(staging)


def _clone(saved, destination, state):
    kind = state["kind"]
    if kind == "dir":
        _mkdir_private(destination)
        for name, child in state["entries"].items():
            _clone(saved / name, destination / name, child)
        destination.chmod(state["mode"])
        _sync_dir(destination)
    elif kind == "file":
        _save_file(destination, _read_file(saved))
        destination.chmod(state["mode"])
    elif kind == "link":
        os.symlink(state["target"], destination)
    else:
        raise ValueError(f"Cannot restore {kind}")


def _remove_private(path):
    info = _lstat(path)
    if info is None:
        return
    if stat.S_ISDIR(info.st_mode):
        path.chmod(0o700)
        for child in path.iterdir():
            _remove_private(child)
        path.rmdir()
    elif stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
        path.unlink()
    else:
        raise ValueError(f"Refusing special recovery staging node: {path}")


class Transaction:
    def __init__(self, backup: Path):
        self.backup = _absolute(backup)

    def _copy(self, folder, index):
        return self.backup / folder / f"{index:04d}"

    def _load(self):
        if _ancestors(self.backup) or not stat.S_ISDIR(self.backup.lstat().st_mode):
            raise ValueError(f"Missing or unsafe transaction backup: {self.backup}")
        manifest = json.loads(_read_file(self.backup / "manifest.json"))
        journal = json.loads(_read_file(self.backup / "journal.json"))
        if (manifest.get("version") != 1 or
                len(journal["paths"]) != len(manifest["paths"]) or
                len(journal["parents"]) != len(manifest["parents"]) or
                any(status not in ("pending", "changing", "applied")
                    for status in journal["paths"] + journal["parents"])):
            raise ValueError(f"Invalid transaction manifest or journal: {self.backup}")
        return manifest, journal

    def _verify_copies(self, manifest):
        for index, record in enumerate(manifest["paths"]):
            original = _state(self._copy("originals", index))
            planned = _state(self._copy("planned", index))
            if (_contents(original) != _contents(record["original"]) or
                    _contents(planned) != _contents(record["planned"])):
                raise ValueError(f"Corrupt transaction copy for {record['path']}")
        staging = self.backup / "staging"
        if _ancestors(staging) or not stat.S_ISDIR(staging.lstat().st_mode):
            raise ValueError(f"Unsafe transaction staging directory: {staging}")

    def prepare(self, changes: dict[Path, bytes | None | str]) -> None:
        """Snapshot every original and planned replacement before any target mutation."""
        if not changes:
            raise ValueError("Empty transaction")
        targets = {_absolute(path): replacement for path, replacement in changes.items()}
        ordered = sorted(targets, key=str)
        if len(targets) != len(changes):
            raise ValueError("Duplicate normalized transaction path")
        for path in ordered:
            if (self.backup == path or self.backup.is_relative_to(path) or
                    path.is_relative_to(self.backup)):
                raise ValueError(f"Backup overlaps transaction path: {path}")
            if any(path.is_relative_to(other) for other in ordered if other != path):
                raise ValueError(f"Overlapping transaction paths: {path}")
            if not isinstance(targets[path], (bytes, str, type(None))):
                raise TypeError(f"Invalid replacement for {path}")
        missing = set()
        existing = {}
        for path in ordered:
            ancestors = _ancestors(path)
            missing.update(ancestors)
            for parent in reversed(path.parents):
                if parent not in missing:
                    info = parent.lstat()
                    existing[str(parent)] = {"mode": _mode(info), "device": info.st_dev,
                                              "inode": info.st_ino}
            info = _lstat(path) if not ancestors else None
            if info and stat.S_ISDIR(info.st_mode) and targets[path] is not None:
                raise ValueError(f"Directory replacement must be absence: {path}")
            if info and not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode) or
                             stat.S_ISLNK(info.st_mode)):
                raise ValueError(f"Refusing special filesystem node: {path}")
        if _ancestors(self.backup) or _lstat(self.backup) is not None:
            raise ValueError(f"Backup must be a new path with real existing parents: {self.backup}")
        _mkdir_private(self.backup)
        _sync_dir(self.backup.parent)
        for folder in ("originals", "planned", "retired", "restoring", "staging"):
            _mkdir_private(self.backup / folder)
        records = []
        for index, path in enumerate(ordered):
            original = _state(path, self._copy("originals", index))
            if original["kind"] != "absent" and _state(path) != original:
                raise ValueError(f"Changed during snapshot: {path}")
            replacement = targets[path]
            if isinstance(replacement, bytes):
                _save_file(self._copy("planned", index), replacement)
                planned = {"kind": "file", "mode": 0o600,
                           "sha256": hashlib.sha256(replacement).hexdigest()}
            elif isinstance(replacement, str):
                os.symlink(replacement, self._copy("planned", index))
                planned = {"kind": "link", "target": replacement}
            else:
                planned = {"kind": "absent"}
            records.append({"path": str(path), "original": original, "planned": planned})
        device = self.backup.stat().st_dev
        for path in ordered:
            nearest = next(parent for parent in path.parents if str(parent) in existing)
            if existing[str(nearest)]["device"] != device:
                raise ValueError(f"Target and backup must share a filesystem: {path}")
        for folder in ("originals", "planned", "retired", "restoring", "staging"):
            _sync_dir(self.backup / folder)
        _json_write(self.backup / "journal.json", {
            "paths": ["pending"] * len(records), "parents": ["pending"] * len(missing)})
        _json_write(self.backup / "manifest.json", {
            "version": 1, "paths": records,
            "existing_parents": existing,
            "parents": [str(parent) for parent in sorted(missing, key=lambda p: (len(p.parts), str(p)))]})

    def _existing_conflicts(self, manifest):
        conflicts = []
        for name, expected in manifest["existing_parents"].items():
            info = _lstat(Path(name))
            if (info is None or not stat.S_ISDIR(info.st_mode) or
                    {"mode": _mode(info), "device": info.st_dev, "inode": info.st_ino} != expected):
                conflicts.append(name)
        return conflicts

    def _advance(self, journal, category, index, status):
        journal[category][index] = status
        _json_write(self.backup / "journal.json", journal)

    def apply(self) -> None:
        """Install prepared changes; refuse any path changed since the snapshot."""
        manifest, journal = self._load()
        self._verify_copies(manifest)
        if any(status != "pending" for status in journal["parents"] + journal["paths"]):
            raise ValueError("Apply already started; recover with rollback")
        conflicts = self._existing_conflicts(manifest)
        for name in manifest["parents"]:
            if _state(Path(name))["kind"] != "absent":
                conflicts.append(name)
        for record in manifest["paths"]:
            path = Path(record["path"])
            if _state(path) != record["original"]:
                conflicts.append(str(path))
        if conflicts:
            raise ValueError("Targets changed before apply: " + ", ".join(conflicts))
        for index, name in enumerate(manifest["parents"]):
            parent = Path(name)
            if journal["parents"][index] != "pending" or _state(parent)["kind"] != "absent":
                raise ValueError(f"Parent changed before apply: {parent}")
            self._advance(journal, "parents", index, "changing")
            if _state(parent)["kind"] != "absent":
                raise ValueError(f"Parent changed before creation: {parent}")
            _mkdir_private(parent)
            _sync_dir(parent.parent)
            self._advance(journal, "parents", index, "applied")
        for index, record in enumerate(manifest["paths"]):
            path = Path(record["path"])
            if (journal["paths"][index] != "pending" or self._existing_conflicts(manifest) or
                    _state(path) != record["original"]):
                raise ValueError(f"Target changed before apply: {path}")
            if record["planned"] == record["original"]:
                continue
            self._advance(journal, "paths", index, "changing")
            if self._existing_conflicts(manifest) or _state(path) != record["original"]:
                raise ValueError(f"Target changed before write: {path}")
            planned = record["planned"]
            if planned["kind"] == "file":
                _atomic_file(path, _read_file(self._copy("planned", index)), 0o600,
                             record["original"], self.backup / "staging")
            elif planned["kind"] == "link":
                _atomic_link(path, planned["target"], record["original"], self.backup / "staging")
            elif record["original"]["kind"] == "dir":
                if _state(path) != record["original"]:
                    raise ValueError(f"Target changed before directory removal: {path}")
                os.rename(path, self._copy("retired", index))
                _sync_dir(path.parent)
                _sync_dir(self.backup / "retired")
            elif record["original"]["kind"] != "absent":
                path.unlink()
                _sync_dir(path.parent)
            if _state(path) != planned:
                raise ValueError(f"Target failed to reach planned state: {path}")
            self._advance(journal, "paths", index, "applied")

    def _preflight(self, manifest, journal):
        self._verify_copies(manifest)
        conflicts = self._existing_conflicts(manifest)
        for index, record in enumerate(manifest["paths"]):
            path = Path(record["path"])
            try:
                current = _state(path)
                status = journal["paths"][index]
                allowed = (current == record["original"] or
                           (status != "pending" and current == record["planned"]))
                if not allowed:
                    conflicts.append(str(path))
                if record["original"]["kind"] == "dir" and record["planned"]["kind"] == "absent":
                    retired = _state(self._copy("retired", index))
                    if (retired["kind"] != "absent" and
                            (retired != record["original"] or status == "pending")):
                        conflicts.append(str(self._copy("retired", index)))
                    if status == "applied" and retired["kind"] == "absent":
                        conflicts.append(str(self._copy("retired", index)))
            except (OSError, ValueError) as error:
                conflicts.append(f"{path} ({error})")
        for index, name in enumerate(manifest["parents"]):
            parent = Path(name)
            try:
                if _ancestors(parent):
                    current = None
                else:
                    current = _lstat(parent)
                status = journal["parents"][index]
                if current is None:
                    continue
                if status == "pending" or not stat.S_ISDIR(current.st_mode) or _mode(current) != 0o700:
                    conflicts.append(str(parent))
                    continue
                expected = {Path(record["path"]).relative_to(parent).parts[0]
                            for record in manifest["paths"] if Path(record["path"]).is_relative_to(parent)}
                expected.update(Path(child).relative_to(parent).parts[0]
                                for child in manifest["parents"] if child != name and Path(child).is_relative_to(parent))
                descriptor = os.open(parent, _DIR_FLAGS)
                try:
                    if not set(os.listdir(descriptor)).issubset(expected):
                        conflicts.append(str(parent))
                finally:
                    os.close(descriptor)
            except (OSError, ValueError) as error:
                conflicts.append(f"{parent} ({error})")
        if conflicts:
            raise ValueError("Transaction conflicts; no rollback writes: " + ", ".join(conflicts))

    def check_rollback(self) -> None:
        """Read-only, all-path conflict check for an operator's stop-before-restore gate."""
        manifest, journal = self._load()
        self._preflight(manifest, journal)

    def assert_rolled_back(self) -> None:
        """Read-only: no target holds this transaction's installed state or created parent.

        Later foreign edits are not transaction state; a fresh prepare snapshots them.
        """
        manifest, _ = self._load()
        remaining = [record["path"] for record in manifest["paths"]
                     if record["planned"] != record["original"]
                     and _contents(_state(Path(record["path"]))) == _contents(record["planned"])]
        remaining += [name for name in manifest["parents"] if _lstat(Path(name)) is not None]
        if remaining:
            raise ValueError("Transaction state remains: " + ", ".join(remaining))

    def rollback(self) -> None:
        """Preflight every path first; restore originals without following links."""
        manifest, journal = self._load()
        self._preflight(manifest, journal)
        for index in reversed(range(len(manifest["paths"]))):
            record = manifest["paths"][index]
            path = Path(record["path"])
            original = record["original"]
            current = _state(path)
            if current == original:
                continue
            # Also reject a new edit made after the all-path preflight.
            if not (journal["paths"][index] != "pending" and current == record["planned"]):
                raise ValueError(f"Target changed during rollback: {path}")
            if original["kind"] == "absent":
                path.unlink()
                _sync_dir(path.parent)
            elif original["kind"] == "file":
                _atomic_file(path, _read_file(self._copy("originals", index)),
                             original["mode"], current, self.backup / "staging")
            elif original["kind"] == "link":
                _atomic_link(path, original["target"], current, self.backup / "staging")
            elif original["kind"] == "dir":
                staging = self._copy("restoring", index)
                _remove_private(staging)
                _clone(self._copy("originals", index), staging, original)
                if _state(path) != current:
                    raise ValueError(f"Target changed before directory restore: {path}")
                os.rename(staging, path)
                _sync_dir(path.parent)
                _sync_dir(self.backup / "restoring")
        for name in reversed(manifest["parents"]):
            parent = Path(name)
            if _lstat(parent) is not None:
                parent.rmdir()  # Foreign children cannot be deleted.
                _sync_dir(parent.parent)
