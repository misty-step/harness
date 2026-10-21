#!/usr/bin/env python3
"""Owned Claude guidance upgrade. All instruction bytes are written to AGENTS.md."""
import os
from pathlib import Path
import stat
import sys
import tempfile

OWNED = b"<!-- owned by misty-step/harness claude-config -->"


def present(path):
    return os.path.lexists(path)


def owned(path):
    return (present(path) and stat.S_ISREG(path.lstat().st_mode)
            and path.read_bytes().split(b"\n", 1)[0] == OWNED)


def validate(canonical, legacy, backup):
    if present(canonical) and not owned(canonical):
        raise ValueError(f"Refusing foreign canonical instructions: {canonical}")
    if present(legacy):
        if legacy.is_symlink():
            if os.readlink(legacy) != os.path.relpath(canonical, legacy.parent) or not owned(canonical):
                raise ValueError(f"Refusing unowned legacy alias: {legacy}")
        elif not owned(legacy):
            raise ValueError(f"Refusing foreign legacy instructions: {legacy}")
        else:
            if backup.parent.is_symlink() or (present(backup.parent) and not backup.parent.is_dir()):
                raise ValueError(f"Refusing foreign backup directory: {backup.parent}")
            if present(backup) and (not owned(backup) or backup.read_bytes() != legacy.read_bytes()):
                raise ValueError(f"Refusing conflicting migration backup: {backup}")


def preserve(path, content):
    """Publish complete bytes without replacing an existing path."""
    fd, name = tempfile.mkstemp(prefix=".AGENTS-", dir=path.parent)
    staged = Path(name)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(staged, path)
    finally:
        staged.unlink(missing_ok=True)


def migrate(canonical, legacy, backup):
    validate(canonical, legacy, backup)
    canonical.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if present(legacy) and not legacy.is_symlink():
        # Keep the entire previous file, including operator additions, before replacing it.
        backup.parent.mkdir(mode=0o700, exist_ok=True)
        if not present(backup):
            preserve(backup, legacy.read_bytes())
        if not present(canonical):
            preserve(canonical, backup.read_bytes())
    if present(legacy):
        legacy.unlink()



if __name__ == "__main__":
    try:
        mode, directory = sys.argv[1:]
        base = Path(directory)
        args = (base / "AGENTS.md", base / "CLAUDE.md", base / ".harness-instruction-migration" / "AGENTS.md")
        if mode == "check":
            validate(*args)
        elif mode == "migrate":
            migrate(*args)
        else:
            raise ValueError("expected check or migrate")
    except (ValueError, OSError) as error:
        sys.exit(str(error))
