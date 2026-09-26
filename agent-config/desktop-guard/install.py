#!/usr/bin/env python3
# owned by misty-step/harness agent-config desktop-guard
"""Opt-in, stage-only desktop guard installation. No live service or binding is changed."""
import argparse
import ast
import json
import os
from pathlib import Path
import stat
import sys
import tempfile


OWNER = "owned by misty-step/harness agent-config desktop-guard"
ROOT = Path(__file__).resolve().parent
UNITS = ("dev.slice", "dev-fleet.slice", "dev-exec.slice", "herdr@.service")


def read_owned(path: Path, header: str, line: int = 1) -> bytes:
    if not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError(f"Not a regular source: {path}")
    data = path.read_bytes()
    if not data or data.splitlines()[line - 1 : line] != [header.encode()]:
        raise ValueError(f"Missing precise ownership header: {path}")
    return data


def source_files(home: Path) -> dict[Path, tuple[bytes, str, int, int]]:
    """Destination -> (contents, owner line, line number, permission mode)."""
    staged = home / ".local/share/desktop-guard/staged"
    runtime_path = ROOT / "desktop-guard.py"
    runtime = read_owned(runtime_path, f"# {OWNER}", 2)
    try:
        ast.parse(runtime, filename=str(runtime_path))
    except SyntaxError as error:
        raise ValueError(f"Invalid desktop guard runtime: {error}") from error
    files = {
        home / ".local/bin/desktop-guard": (runtime, f"# {OWNER}", 2, 0o700),
        staged / "hypr/herdr.lua":
            (read_owned(ROOT / "hypr/herdr.lua", f"-- {OWNER}"), f"-- {OWNER}", 1, 0o600),
    }
    for name in UNITS:
        files[staged / "systemd/user" / name] = (
            read_owned(ROOT / "units" / name, f"# {OWNER}"), f"# {OWNER}", 1, 0o600
        )
    manifest = {
        "owner": OWNER,
        "schema": 1,
        "cli": {"launcher": ".local/bin/desktop-guard"},
        "units": {name: {"staged": f"systemd/user/{name}", "target": f".config/systemd/user/{name}"}
                  for name in UNITS},
        "binding": {"staged": "hypr/herdr.lua", "load_from": ".config/hypr/bindings.local.lua"},
    }
    files[staged / "manifest.json"] = (
        (json.dumps(manifest, indent=2) + "\n").encode(), OWNER, 0, 0o600
    )
    return files


def assert_ancestors(home: Path, destination: Path) -> None:
    current = home
    if not stat.S_ISDIR(current.lstat().st_mode):
        raise ValueError(f"Home must be an existing, real directory: {home}")
    for part in destination.relative_to(home).parts[:-1]:
        current /= part
        try:
            mode = current.lstat().st_mode
        except FileNotFoundError:
            continue
        if not stat.S_ISDIR(mode):
            raise ValueError(f"Refusing non-directory or symlink ancestor: {current}")


def check_target(path: Path, header: str, line: int) -> None:
    try:
        mode = path.lstat().st_mode
    except FileNotFoundError:
        return
    if not stat.S_ISREG(mode):
        raise ValueError(f"Refusing non-regular or symlink destination: {path}")
    if line == 0:
        try:
            owned = json.loads(path.read_text()).get("owner") == OWNER
        except (ValueError, AttributeError):
            owned = False
    else:
        with path.open("rb") as stream:
            owned = [stream.readline().rstrip(b"\r\n") for _ in range(line)][-1] == header.encode()
    if not owned:
        raise ValueError(f"Refusing foreign destination: {path}")


def atomic_write(destination: Path, data: bytes, mode: int) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if destination.exists() and destination.read_bytes() == data and stat.S_IMODE(destination.stat().st_mode) == mode:
        return
    name = None
    try:
        with tempfile.NamedTemporaryFile(prefix=f".{destination.name}.", dir=destination.parent, delete=False) as stream:
            name = stream.name
            os.fchmod(stream.fileno(), mode)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, destination)
    finally:
        if name and os.path.exists(name):
            os.unlink(name)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("stage",))
    parser.add_argument("--home", type=Path, default=Path.home())
    parser.add_argument("--check", action="store_true", help="validate sources and all destinations without writing")
    args = parser.parse_args(argv)
    try:
        home = args.home.expanduser().absolute()
        files = source_files(home)
        for destination, (_, header, line, _) in files.items():
            assert_ancestors(home, destination)
            check_target(destination, header, line)
        if not args.check:
            for destination, (data, _, _, mode) in files.items():
                atomic_write(destination, data, mode)
    except (OSError, ValueError) as error:
        print(f"desktop-guard: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
