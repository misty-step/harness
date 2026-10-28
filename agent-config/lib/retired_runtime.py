"""Retire only proved-owned executables and native user jobs; preserve private state.

Unmarked account-helper fingerprints come from c2d219c8c241dea34b1df9b97ede00155665831c.
Timers stop before files disappear. Running services are never terminated: a retry
can finish retirement after the existing invocation completes.
"""
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys


BIN_MARKERS = {
    "t3-pool": "// t3-pool: owned standalone launcher (misty-step/harness)",
    "t3-runtime-mode": "// t3-runtime-mode: owned standalone launcher (misty-step/harness)",
    "t3-agent": "# owned by misty-step/harness agent-config t3-agent",
    "t3-access-renew": "# owned by misty-step/harness agent-config t3-access-renew",
}
HASHES = {
    "t3-accounts": "c9146da74e2479c26d0c37d9ce94545d6ed0db2a24e1a9085178c9ac7142f6f1",
    "t3-accounts-room-events": "b4b16787ae8acde25af6833a9f0a320c54ebadb535643a87f769741b6a9c0d97",
    "t3-accounts-room-watch.service": "738bea3e5a9261c7c6fdbb0b5b6ab50a75e3abe8970018ae328941947fd53bfe",
    "t3-accounts-room-watch.timer": "413b554b472855277f0557d25838c2160b41f8735788b19889b155d9c54202b5",
}
GROUPS = [
    (["t3-pool"], ["t3-pool.service", "t3-pool.timer"], "# owned by misty-step/harness t3-pool"),
    (["t3-agent", "t3-access-renew"], ["t3-access-renew.service", "t3-access-renew.timer", "t3-access@.service", "t3-access@.timer"], "# owned by misty-step/harness t3-access"),
    (["t3-accounts", "t3-accounts-room-events"], ["t3-accounts-room-watch.service", "t3-accounts-room-watch.timer"], None),
    (["t3-runtime-mode"], [], None),
]
BUSY = {"active", "activating", "reloading", "deactivating"}


def regular(path, home):
    return path.is_file() and not any(p.is_symlink() for p in [path, *path.parents] if p != home and home in p.parents)


def owned(path, home, marker=None):
    if not regular(path, home):
        return False
    data = path.read_bytes()
    if marker is not None:
        lines = data.decode("utf-8", errors="replace").splitlines()
        return marker in lines[:2]
    return hashlib.sha256(data).hexdigest() == HASHES.get(path.name)


def masked(path):
    return path.is_symlink() and os.readlink(path) == "/dev/null"


def systemctl(*args):
    result = subprocess.run(["systemctl", "--user", *args], text=True, capture_output=True, timeout=60)
    if result.returncode and not (args[0] == "show" and "LoadState=not-found" in result.stdout.splitlines()):
        raise RuntimeError(f"systemctl --user {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout


def state(name):
    output = systemctl("show", name, "--property=FragmentPath", "--property=DropInPaths", "--property=ActiveState", "--property=LoadState")
    return dict(line.split("=", 1) for line in output.splitlines() if "=" in line)


def retire(home, check=False):
    home = home.resolve()
    unit_dir = home / ".config/systemd/user"
    plans = []
    for bins, names, marker in GROUPS:
        names = list(names)
        if "t3-access@.timer" in names and unit_dir.is_dir():
            names += [p.name for p in unit_dir.glob("t3-access@*.*") if p.suffix in {".timer", ".service"} and p.name not in names]
        paths = [unit_dir / name for name in names]
        # A replacement unit or drop-in has its own caller contract. Leave that
        # whole group alone rather than deleting an executable it may still use.
        foreign = any((p.exists() or p.is_symlink()) and not masked(p) and not owned(p, home, marker) for p in paths)
        foreign = foreign or any((unit_dir / (name + ".d")).exists() for name in names)
        if foreign:
            print(f"Preserving foreign runtime group: {bins[0]}")
            continue
        units = [p for p in paths if owned(p, home, marker)]
        launchers = [home / ".local/bin" / name for name in bins if owned(home / ".local/bin" / name, home, BIN_MARKERS.get(name))]
        links = []
        directories = [unit_dir, *unit_dir.glob("*.wants"), *unit_dir.glob("*.requires")]
        for directory in directories:
            if not directory.is_dir():
                continue
            if directory.is_symlink():
                continue
            for link in directory.iterdir():
                if not link.is_symlink() or link.resolve() not in units:
                    continue
                if directory != unit_dir and (link.name in names or (link.name.startswith("t3-access@") and link.suffix in {".timer", ".service"})):
                    instance = unit_dir / link.name
                    if masked(instance) or ((instance.exists() or instance.is_symlink()) and instance not in units):
                        continue
                    if (unit_dir / (link.name + ".d")).exists():
                        foreign = True
                        break
                    links.append((link, os.readlink(link)))
                else:
                    foreign = True
                    break
        if foreign:
            print(f"Preserving foreign runtime group: {bins[0]}")
            continue
        plans.append((launchers, units, links, paths, marker))
    if check:
        return
    has_units = any(units or (launchers and any(masked(p) for p in paths)) for launchers, units, _, paths, _ in plans)
    native = has_units and sys.platform == "linux"
    if native:
        if not shutil.which("systemctl"):
            raise RuntimeError("owned user jobs remain; systemctl is required to retire their schedules safely")
        systemctl("show-environment")
    timer_names = set()
    service_names = set()
    for launchers, units, links, paths, _ in plans:
        timer_names.update(p.name for p in units if p.suffix == ".timer" and "@." not in p.name)
        if units or launchers:
            timer_names.update(p.name for p in paths if p.suffix == ".timer" and "@." not in p.name and masked(p))
            service_names.update(p.name for p in paths if p.suffix == ".service" and "@." not in p.name)
        for link, _ in links:
            if link.suffix == ".timer":
                timer_names.add(link.name)
                service_names.add(link.name.removesuffix(".timer") + ".service")
        if native and any(p.name == "t3-access@.timer" for p in units):
            output = systemctl("list-units", "--all", "--plain", "--no-legend", "--full", "t3-access@*.timer", "t3-access@*.service")
            for line in output.splitlines():
                name = line.split()[0] if line.split() else ""
                if name.startswith("t3-access@") and "@." not in name:
                    (timer_names if name.endswith(".timer") else service_names).add(name)
    if native:
        unit_paths = {p.resolve() for _, units, _, _, _ in plans for p in units}
        # Check loaded fragments as well as on-disk ownership before native
        # commands: private HOME installs must never control a different HOME.
        for name in timer_names | service_names:
            info = state(name)
            fragment = info.get("FragmentPath", "")
            if info.get("DropInPaths"):
                raise RuntimeError(f"foreign loaded drop-ins for {name}; runtime files preserved")
            if fragment and Path(fragment).resolve() not in unit_paths and fragment != "/dev/null":
                raise RuntimeError(f"foreign loaded unit for {name}; runtime files preserved")
            if name in timer_names and not fragment:
                raise RuntimeError(f"cannot prove loaded timer ownership for {name}; runtime files preserved")
            if name in timer_names and masked(unit_dir / name) and info.get("ActiveState") in BUSY:
                raise RuntimeError(f"masked timer {name} is still active; runtime files preserved")
        for name in sorted(timer_names):
            if not masked(unit_dir / name):
                systemctl("stop", name)
                systemctl("disable", "--no-reload", name)
        for name in sorted(service_names):
            if state(name).get("ActiveState") in BUSY:
                raise RuntimeError(f"{name} is still running; its files are preserved; retry after it completes")
    changed_units = False
    removed_units = []
    for launchers, units, links, _, marker in plans:
        for link, target in links:
            if link.is_symlink() and os.readlink(link) == target:
                link.unlink()
                changed_units = True
        for path in units:
            if not owned(path, home, marker):
                raise RuntimeError(f"unit changed during retirement: {path}; remaining files preserved")
            removed_units.append((path, path.read_bytes(), stat.S_IMODE(path.stat().st_mode)))
            path.unlink()
            changed_units = True
    if native and changed_units:
        try:
            systemctl("daemon-reload")
        except (OSError, RuntimeError, subprocess.TimeoutExpired):
            # Keep the exact owned definitions and executables available for a
            # retry when the manager fails. Timers remain stopped and disabled.
            for path, content, mode in removed_units:
                if not path.exists() and not path.is_symlink():
                    path.write_bytes(content)
                    path.chmod(mode)
            raise
    for launchers, _, _, _, _ in plans:
        for path in launchers:
            if not owned(path, home, BIN_MARKERS.get(path.name)):
                raise RuntimeError(f"launcher changed during retirement: {path}; remaining files preserved")
            path.unlink()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        retire(args.home, args.check)
    except (OSError, RuntimeError, subprocess.TimeoutExpired) as error:
        print(f"Runtime retirement failed: {error}", file=sys.stderr)
        raise SystemExit(1)
