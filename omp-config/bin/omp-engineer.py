#!/usr/bin/env python3
# owned by misty-step/harness omp-config engineer-cage
"""Fail-closed OMP leaf containment and serialized, advisory memory inspection."""

import contextlib
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import posixpath
import pwd
import re
import secrets
import selectors
import signal
import socket
import stat
import struct
import subprocess
import sys
import termios
import time

GIB = 1024 ** 3
LEAF_BYTES = 4 * GIB
FLEET_ADVISORY_BYTES = 36 * GIB
MEMORY_FLOOR_BYTES = 20 * GIB
INSPECTION_SECONDS = 10
LOCK_SECONDS = 10
READY_SECONDS = 15
SYSTEMCTL = "/usr/bin/systemctl"
SYSTEMD_RUN = "/usr/bin/systemd-run"
OOMCTL = "/usr/bin/oomctl"
SCOPE = re.compile(r"omp-engineer-[0-9a-f]{24}\.scope\Z")
POLICY = {"leaf_bytes": LEAF_BYTES, "fleet_advisory_bytes": FLEET_ADVISORY_BYTES,
          "available_memory_floor_bytes": MEMORY_FLOOR_BYTES, "leaf_swap_bytes": 0}
HELP = """Usage:
  omp-engineer [--] OMP-ARGUMENTS...
  omp-engineer memory --json [--fixture FILE]
  omp-engineer --help
The installed `omp` entrypoint contains interactive engineers in verified
4-GiB, zero-swap, group-OOM scopes. Native one-shot/stdio modes run directly.
Memory is read-only and advisory, never a reservation or launch-capacity gate.
Fixtures are accepted only by read-only memory; fresh engineer admission inspects live state.
Exit: native status; 1 inspection/setup failure; 2 usage; 75 lock/readiness refusal.
"""


class CageError(Exception):
    def __init__(self, message, code=1):
        super().__init__(message)
        self.code = code


def natural(value, label):
    if type(value) is not int or value < 0:
        raise CageError(f"Invalid {label}")
    return value


def group_path(value):
    if not isinstance(value, str) or not value.startswith("/") or value != posixpath.normpath(value) or any(char.isspace() or ord(char) < 32 for char in value):
        raise CageError(f"Invalid cgroup path: {value!r}")
    return value


def contains(parent, child):
    return parent == "/" or child == parent or child.startswith(parent + "/")


def ancestor_paths(group):
    parts = group_path(group).strip("/").split("/")
    return ["/" + "/".join(parts[:number]) for number in range(1, len(parts) + 1)]


def controls(record, label):
    required = {"path", "memory_max", "memory_swap_max", "memory_high", "current_bytes", "oom_group", "populated"}
    if not isinstance(record, dict) or not required.issubset(record):
        raise CageError(f"Incomplete {label} controls")
    group_path(record["path"])
    for key in ("current_bytes", "oom_group"):
        natural(record.get(key), f"{label} {key}")
    if record["oom_group"] not in (0, 1) or type(record.get("populated")) is not bool:
        raise CageError(f"Invalid {label} group state")
    for key in ("memory_max", "memory_swap_max", "memory_high"):
        if record.get(key) is not None:
            natural(record[key], f"{label} {key}")


def verify_leaf(record, fleet):
    unit = record.get("unit")
    if not isinstance(unit, str) or SCOPE.fullmatch(unit) is None or record.get("path") != fleet + "/" + unit:
        raise CageError("OMP scope is outside the owned leaf hierarchy")
    controls(record, unit)
    if (record["memory_max"] != LEAF_BYTES or record["memory_swap_max"] != 0
            or record["memory_high"] is not None or record["oom_group"] != 1
            or record.get("systemd_memory_max") != LEAF_BYTES
            or record.get("systemd_memory_swap_max") != 0
            or record.get("systemd_oom_policy") != "kill"):
        raise CageError(f"{unit} is not a verified 4-GiB/zero-swap/group-OOM leaf")


def verify_hierarchy(snapshot):
    uid = natural(snapshot.get("uid"), "uid")
    root = group_path(snapshot.get("user_root"))
    if re.fullmatch(r"/user\.slice/user-([0-9]+)\.slice/user@\1\.service", root) is None or root != f"/user.slice/user-{uid}.slice/user@{uid}.service":
        raise CageError("Unrecognized user-manager hierarchy")
    fleet_path = root + "/omp.slice"
    fleet = snapshot.get("fleet")
    if not isinstance(fleet, dict) or fleet.get("path") != fleet_path or fleet.get("slice") != "-.slice":
        raise CageError("omp.slice is not a standalone user-manager root sibling")
    controls(fleet, "omp.slice")
    if fleet["memory_swap_max"] != 0 or fleet["memory_high"] is not None or fleet["oom_group"] != 0:
        raise CageError("omp.slice requires zero swap, unlimited memory.high and ungrouped OOM")
    ancestors = snapshot.get("ancestors")
    expected = ancestor_paths(root)
    if not isinstance(ancestors, list) or any(not isinstance(item, dict) for item in ancestors) or [item.get("path") for item in ancestors] != expected:
        raise CageError("Incomplete actual cgroup ancestor inventory")
    for item in ancestors:
        controls(item, item["path"])
        if item["oom_group"] != 0:
            raise CageError(f"Cage ancestor has memory.oom.group enabled: {item['path']}")
    monitored = snapshot.get("monitored")
    if not isinstance(monitored, list):
        raise CageError("Missing live systemd-oomd monitor inventory")
    for path in monitored:
        group_path(path)
        if contains(path, fleet_path):
            raise CageError(f"systemd-oomd monitors the cage through {path}")
    return root, fleet_path, fleet, ancestors


def admission(snapshot, *, source="live"):
    """Pure preflight. Input contains measurements, never policy overrides."""
    if not isinstance(snapshot, dict) or snapshot.get("schema_version") != 1:
        raise CageError("Unrecognized memory measurement schema")
    _, fleet_path, fleet, ancestors = verify_hierarchy(snapshot)
    available = snapshot.get("available_bytes")
    if available is not None:
        available = natural(available, "available memory")
    scopes = snapshot.get("scopes")
    if not isinstance(scopes, list):
        raise CageError("Incomplete OMP scope inventory")
    seen = set()
    for item in scopes:
        if not isinstance(item, dict):
            raise CageError("Invalid OMP scope inventory")
        verify_leaf(item, fleet_path)
        if item["unit"] in seen:
            raise CageError("Duplicate OMP scope identity")
        seen.add(item["unit"])
        for path in snapshot["monitored"]:
            if contains(path, item["path"]):
                raise CageError(f"systemd-oomd monitors an OMP leaf through {path}")
    live = [item for item in scopes if item["populated"]]
    current_group = group_path(snapshot.get("current_group"))
    nested = current_group in {item["path"] for item in live}
    if contains(fleet_path, current_group) and not nested:
        raise CageError("Current process occupies an unverified cage")
    bounds = [item for item in (fleet, *ancestors) if item["memory_max"] is not None]
    warnings = []
    if not nested:
        if available is None:
            warnings.append("available-memory guidance is unavailable; launch continues")
        elif available < MEMORY_FLOOR_BYTES:
            warnings.append(f"available memory {available} is below the {MEMORY_FLOOR_BYTES}-byte (20-GiB) guideline; launch continues")
        if fleet["current_bytes"] > FLEET_ADVISORY_BYTES:
            warnings.append(f"measured fleet memory {fleet['current_bytes']} exceeds the {FLEET_ADVISORY_BYTES}-byte guideline; launch continues")
        for item in bounds:
            if item["memory_max"] - item["current_bytes"] < MEMORY_FLOOR_BYTES:
                warnings.append(f"effective cgroup {item['path']} lacks {MEMORY_FLOOR_BYTES} bytes of memory headroom")
    return {"schema_version": 1, "ok": True, "source": source, "reservation": False,
            "activated": True,
            "captured_at": snapshot.get("captured_at"), "admitted": True, "warnings": warnings,
            "policy": dict(POLICY), "reuses_cage": nested,
            "capacity": {"available_bytes": available, "required_available_bytes": MEMORY_FLOOR_BYTES,
                         "required_ancestor_headroom_bytes": MEMORY_FLOOR_BYTES,
                         "fleet_current_bytes": fleet["current_bytes"],
                         "effective_memory_max_bytes": min((item["memory_max"] for item in bounds), default=None),
                         "caged_count": len(live)},
            "scopes": live,
            "ancestors": ancestors, "monitored": snapshot["monitored"],
            "coverage": "Interactive engineers have verified per-leaf bounds. Descendant containment excludes external daemons and deliberate same-user cgroup escape."}


def runtime_path():
    return Path(f"/run/user/{os.getuid()}/omp-engineer")


def private_directory(path):
    try:
        parent = path.parent.lstat()
        if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.getuid() or parent.st_mode & 0o077:
            raise CageError("Real user runtime directory is not private and owned")
        path.mkdir(mode=0o700, exist_ok=True)
        info = path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise CageError("OMP admission directory is not private and owned")
    except OSError as exc:
        raise CageError("Cannot access the real user runtime directory") from exc


@contextlib.contextmanager
def admission_lock(path, *, clock=time.monotonic, sleep=time.sleep):
    try:
        fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            os.close(fd)
            raise CageError("Unsafe OMP admission lock")
    except OSError as exc:
        raise CageError("Cannot open OMP admission lock") from exc
    try:
        deadline = clock() + LOCK_SECONDS
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if clock() >= deadline:
                    raise CageError("OMP admission is busy; retry after the current handoff", 75)
                sleep(0.05)
        yield
    finally:
        os.close(fd)


def publish_memory_warnings(result):
    warnings = result["warnings"]
    if not warnings:
        return
    for warning in warnings:
        print("omp-engineer: warning: " + warning, file=sys.stderr)
    # Glass owns the item; reuse its open record rather than caching another authority.
    title = "OMP launches continue despite memory guidance"
    scope = "misty-step/harness"
    why = {"text": "the memory cage should be more of a guideline than a hard rule. Advisory. Otherwise it's too constraining.",
           "attribution": "quoted", "source": "Phaedrus"}
    try:
        listing = subprocess.run(["glass", "item", "list", "--lock-wait", "100ms"],
                                 stdin=subprocess.DEVNULL, capture_output=True, timeout=1, check=False)
        if listing.returncode:
            raise OSError(listing.stderr.decode(errors="replace").strip())
        data = json.loads(listing.stdout)
        if not isinstance(data, dict) or not isinstance(data.get("items"), list):
            raise ValueError("Unrecognized Glass item list")
        existing = next((item["id"] for item in data["items"]
                         if isinstance(item, dict) and isinstance(item.get("id"), str) and item["id"]
                         and item.get("title") == title and item.get("scope") == scope
                         and item.get("kind") == "task" and item.get("why") == why
                         and item.get("status") not in ("done", "dropped")), None)
        if existing:
            command = ["glass", "item", "update", existing]
        else:
            command = ["glass", "item", "add", "--scope", scope, "--kind", "task", "--status", "later",
                       "--title", title,
                       "--description", "Memory guidance is advisory; engineers continue to launch while their independent four-GiB containment and oomd exclusion remain verified.",
                       "--why", why["text"], "--why-attribution", why["attribution"], "--why-source", why["source"]]
        receipt = subprocess.run(
            [*command, "--relaying", "none", "--notes", "\n".join(warnings),
             "--note", "Memory advisory warning observed; launch continues. Latest observed measurements are in the item notes.",
             "--json", "--lock-wait", "100ms"],
            stdin=subprocess.DEVNULL, capture_output=True, timeout=1, check=False)
        if receipt.returncode:
            print("omp-engineer: Glass warning publication failed: " + receipt.stderr.decode(errors="replace").strip(), file=sys.stderr)
        else:
            print("omp-engineer: memory warning published in Glass", file=sys.stderr)
    except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
        print("omp-engineer: Glass warning publication failed: " + str(exc), file=sys.stderr)


def launch_transaction(lock, inspect, register):
    # Registration returns only after cgroupfs + process membership verification.
    # Fresh inspection and verified registration share the lock, never abstract slots.
    with lock:
        snapshot = inspect()
        result = admission(snapshot)
        publish_memory_warnings(result)
        return register(result)


class Host:
    def __init__(self, seconds=INSPECTION_SECONDS):
        self.deadline = time.monotonic() + seconds
        self.uid = os.getuid()
        self.root = f"/user.slice/user-{self.uid}.slice/user@{self.uid}.service"
        self.cgroup = Path("/sys/fs/cgroup")
        self.proc = Path("/proc")

    def remaining(self):
        value = self.deadline - time.monotonic()
        if value <= 0:
            raise CageError("Memory inspection exceeded its bounded readiness window", 75)
        return value

    def read(self, path):
        self.remaining()
        try:
            return Path(path).read_text().strip()
        except OSError as exc:
            raise CageError(f"Cannot inspect {path}") from exc

    def capture(self, argv):
        try:
            result = subprocess.run(argv, capture_output=True, text=True, timeout=min(4, self.remaining()), check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise CageError(f"{argv[0]} is unavailable or timed out") from exc
        if result.returncode:
            raise CageError(f"{argv[0]} inspection failed (exit {result.returncode})")
        return result.stdout

    def show(self, unit, *extra):
        fields = ("Id", "LoadState", "ActiveState", "ControlGroup", *extra)
        output = self.capture([SYSTEMCTL, "--user", "--no-pager", "show", unit, *["-p" + key for key in fields]])
        values = {}
        for line in output.splitlines():
            if "=" not in line:
                raise CageError(f"Unrecognized systemd state for {unit}")
            key, value = line.split("=", 1)
            if key in values:
                raise CageError(f"Duplicate systemd state for {unit}")
            values[key] = value
        if any(key not in values for key in fields) or values["Id"] != unit:
            raise CageError(f"Incomplete systemd state for {unit}")
        return values

    def group_file(self, group, filename):
        return self.cgroup / group_path(group).lstrip("/") / filename

    def group_controls(self, group):
        record = {"path": group_path(group)}
        for file, key in (("memory.max", "memory_max"), ("memory.swap.max", "memory_swap_max"),
                          ("memory.high", "memory_high"), ("memory.current", "current_bytes"),
                          ("memory.oom.group", "oom_group")):
            raw = self.read(self.group_file(group, file))
            record[key] = self.limit(raw, file, unlimited=key in ("memory_max", "memory_swap_max", "memory_high"))
        events = {}
        for line in self.read(self.group_file(group, "cgroup.events")).splitlines():
            parts = line.split()
            if len(parts) != 2 or parts[0] in events or parts[1] not in ("0", "1"):
                raise CageError("Unrecognized cgroup lifetime state")
            events[parts[0]] = parts[1]
        if "populated" not in events:
            raise CageError("Missing cgroup populated lifetime state")
        record["populated"] = events["populated"] == "1"
        controls(record, group)
        return record

    @staticmethod
    def limit(raw, label, *, unlimited=True):
        if unlimited and raw in ("max", "infinity"):
            return None
        if not raw.isascii() or not raw.isdecimal():
            raise CageError(f"Unrecognized {label}")
        return int(raw)

    def process_group(self, pid):
        self.remaining()
        try:
            raw = (self.proc / str(pid) / "cgroup").read_text()
        except (FileNotFoundError, ProcessLookupError):
            raise
        except OSError as exc:
            raise CageError(f"Cannot inspect process {pid} cgroup") from exc
        paths = [line[3:] for line in raw.splitlines() if line.startswith("0::")]
        if len(paths) != 1:
            raise CageError("Unrecognized unified process cgroup")
        # cgroupfs appends this kernel annotation when a task remains attached
        # to a dying group. It is not part of the group's canonical identity.
        return group_path(paths[0].removesuffix(" (deleted)"))

    def current_group(self):
        group = self.process_group(os.getpid())
        if not contains(self.root, group):
            raise CageError("OMP launcher is outside the real user-manager hierarchy")
        return group

    def monitors(self):
        output = self.capture([OOMCTL, "--no-pager", "dump"])
        if output.count("Swap Monitored CGroups:") != 1 or output.count("Memory Pressure Monitored CGroups:") != 1:
            raise CageError("Unrecognized live systemd-oomd monitor inventory")
        paths = []
        for line in output.splitlines():
            if "Path:" not in line:
                continue
            match = re.fullmatch(r"\s*Path: (/\S+)\s*", line)
            if match is None:
                raise CageError("Unrecognized live systemd-oomd monitor path")
            paths.append(group_path(match[1].rstrip("/") or "/"))
        return paths

    def fleet(self):
        path = self.root + "/omp.slice"
        props = self.show("omp.slice", "Slice", "MemoryMax", "MemorySwapMax", "MemoryHigh")
        if props["LoadState"] != "loaded" or props["ActiveState"] not in ("active", "inactive"):
            raise CageError("omp.slice is not installed in a usable state; select engineer-cage activation")
        if props["ActiveState"] == "active":
            if props["ControlGroup"] != path:
                raise CageError("omp.slice has unexpected actual cgroup placement")
            record = self.group_controls(path)
            for key, prop in (("memory_max", "MemoryMax"), ("memory_swap_max", "MemorySwapMax"), ("memory_high", "MemoryHigh")):
                if record[key] != self.limit(props[prop], prop):
                    raise CageError("omp.slice configured and actual bounds disagree")
        else:
            if props["ControlGroup"] or (self.cgroup / path.lstrip("/")).exists():
                raise CageError("Inactive omp.slice has unexpected registered cgroup state")
            record = {"path": path, "current_bytes": 0, "oom_group": 0, "populated": False,
                      "memory_max": self.limit(props["MemoryMax"], "MemoryMax"),
                      "memory_swap_max": self.limit(props["MemorySwapMax"], "MemorySwapMax"),
                      "memory_high": self.limit(props["MemoryHigh"], "MemoryHigh")}
        record["slice"] = props["Slice"]
        return record

    def scope(self, unit):
        props = self.show(unit, "Slice", "MemoryMax", "MemorySwapMax", "OOMPolicy")
        group = props["ControlGroup"]
        if props["LoadState"] != "loaded" or props["Slice"] != "omp.slice" or not group:
            raise CageError(f"{unit} is not a registered standalone OMP leaf")
        record = self.group_controls(group)
        record.update(unit=unit, systemd_memory_max=self.limit(props["MemoryMax"], "MemoryMax"),
                      systemd_memory_swap_max=self.limit(props["MemorySwapMax"], "MemorySwapMax"),
                      systemd_oom_policy=props["OOMPolicy"])
        verify_leaf(record, self.root + "/omp.slice")
        return record

    def scopes(self, fleet):
        raw = self.capture([SYSTEMCTL, "--user", "--no-pager", "--all", "--type=scope", "--output=json", "list-units", "omp-engineer-*.scope"])
        try:
            units = json.loads(raw)
        except ValueError as exc:
            raise CageError("Cannot parse live OMP scope inventory") from exc
        if not isinstance(units, list):
            raise CageError("Unrecognized live OMP scope inventory")
        records = []
        names = set()
        for item in units:
            unit = item.get("unit") if isinstance(item, dict) else None
            if not isinstance(unit, str) or SCOPE.fullmatch(unit) is None or unit in names:
                raise CageError("Unrecognized or duplicate live OMP scope identity")
            names.add(unit)
            props = self.show(unit)
            if not props["ControlGroup"] and props["ActiveState"] in ("inactive", "failed"):
                continue
            records.append(self.scope(unit))
        directory = self.cgroup / fleet["path"].lstrip("/")
        if directory.exists():
            if self.read(directory / "cgroup.procs"):
                raise CageError("Unverified processes occupy omp.slice directly")
            try:
                children = {path.name for path in directory.iterdir() if path.is_dir()}
            except OSError as exc:
                raise CageError("Cannot inspect actual OMP leaf inventory") from exc
            if children != {item["unit"] for item in records}:
                raise CageError("Actual OMP leaf inventory disagrees with systemd registration")
        return records

    def snapshot(self):
        current = self.current_group()
        fleet = self.fleet()
        scopes = self.scopes(fleet)
        available_bytes = None
        try:
            available = [line.split() for line in self.read(self.proc / "meminfo").splitlines() if line.startswith("MemAvailable:")]
            if len(available) == 1 and len(available[0]) == 3 and available[0][2] == "kB" and available[0][1].isdecimal():
                available_bytes = int(available[0][1]) * 1024
        except CageError:
            pass  # Capacity guidance is optional; containment inspection is not.
        return {"schema_version": 1, "uid": self.uid, "user_root": self.root,
                "current_group": current, "available_bytes": available_bytes,
                "fleet": fleet, "scopes": scopes,
                "ancestors": [self.group_controls(path) for path in ancestor_paths(self.root)],
                "monitored": self.monitors(), "captured_at": datetime.now(timezone.utc).isoformat()}

    def verify_registered(self, unit, pid):
        record = self.scope(unit)
        if not record["populated"] or self.process_group(pid) != record["path"]:
            raise CageError("Native handoff is not a populated verified leaf member")
        members = self.read(self.group_file(record["path"], "cgroup.procs")).splitlines()
        if str(pid) not in members:
            raise CageError("Native handoff is missing from actual leaf cgroup.procs")
        snapshot = {"uid": self.uid, "user_root": self.root, "fleet": self.fleet(),
                    "ancestors": [self.group_controls(path) for path in ancestor_paths(self.root)],
                    "monitored": self.monitors()}
        verify_hierarchy(snapshot)
        for path in snapshot["monitored"]:
            if contains(path, record["path"]):
                raise CageError("Live systemd-oomd monitoring includes the native handoff")
        return record


def native_environment(argv, inherited, native):
    # Native 18.4.9 resolves its mutable update target through PATH, not its own
    # executable. Only a mutating update may resolve `omp` to the ELF directory.
    # A global prefix would let nested/resumed engineers bypass the launch owner.
    command = native_command_index(argv)
    if command is None or argv[command] != "update" or any(flag in ("--check", "-c") for flag in argv[command + 1:]):
        return inherited
    environment = dict(inherited)
    prior = inherited.get("PATH", "")
    environment["PATH"] = str(native.parent) + (os.pathsep + prior if prior else "")
    return environment


def native_path():
    path = Path(pwd.getpwuid(os.getuid()).pw_dir) / ".local/lib/omp-engineer/omp"
    try:
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o022 or not info.st_mode & stat.S_IXUSR:
            raise CageError("Fixed native OMP is not a safe owned executable")
        with path.open("rb") as handle:
            if handle.read(4) != b"\x7fELF":
                raise CageError("Fixed native OMP is not the native ELF executable")
    except OSError as exc:
        raise CageError("Native OMP is not installed at ~/.local/lib/omp-engineer/omp") from exc
    return path


class Terminal:
    RESET = b"\x1b[?2004l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1049l\x1b[?25h\x1b[0m"

    def __init__(self):
        self.saved = None
        try:
            if os.isatty(0) and os.tcgetpgrp(0) == os.getpgrp():
                self.saved = termios.tcgetattr(0)
        except OSError:
            pass

    @staticmethod
    def sane(saved):
        value = [*saved[:6], list(saved[6])]
        value[0] = (value[0] | termios.BRKINT | termios.ICRNL | termios.IXON) & ~(termios.IGNBRK | termios.IGNCR | termios.INLCR | termios.IXOFF)
        value[1] |= termios.OPOST | termios.ONLCR
        value[2] |= termios.CREAD
        value[3] |= termios.ISIG | termios.ICANON | termios.IEXTEN | termios.ECHO | termios.ECHOE | termios.ECHOK
        value[3] &= ~termios.ECHONL
        value[6][termios.VMIN] = 1
        value[6][termios.VTIME] = 0
        return value

    def recover_if_polluted(self):
        if self.saved is not None and self.saved[3] & (termios.ICANON | termios.ECHO | termios.ISIG) != (termios.ICANON | termios.ECHO | termios.ISIG):
            self.killed()
            self.saved = self.sane(self.saved)

    def killed(self):
        if self.saved is None:
            return
        try:
            if os.tcgetpgrp(0) != os.getpgrp():
                return  # Never reset a terminal now owned by another foreground job.
            termios.tcflush(0, termios.TCIFLUSH)
            termios.tcsetattr(0, termios.TCSANOW, self.sane(self.saved))
            if os.isatty(2) and os.ttyname(2) == os.ttyname(0):
                os.write(2, self.RESET)
            termios.tcflush(0, termios.TCIFLUSH)
        except OSError:
            pass


@contextlib.contextmanager
def forward_signals(child, native_pid=lambda: None):
    previous = {}
    def forward(number, frame):
        pid = native_pid() or child.pid
        try:
            os.kill(pid, number)
        except ProcessLookupError:
            pass
    try:
        for number in (signal.SIGTERM, signal.SIGHUP):
            previous[number] = signal.signal(number, forward)
        # Terminal-generated signals reach the native process group directly.
        # A Python handler (not SIG_IGN) leaves the exec'd child's defaults intact.
        for number in (signal.SIGINT, signal.SIGQUIT):
            previous[number] = signal.signal(number, lambda number, frame: None)
        yield
    finally:
        for number, handler in previous.items():
            signal.signal(number, handler)


def exit_status(code):
    return 128 - code if code < 0 else code


def receive_line(connection):
    value = bytearray()
    while len(value) < 16:
        chunk = connection.recv(1)
        if not chunk:
            raise CageError("Native handoff closed before admission", 75)
        value.extend(chunk)
        if chunk == b"\n":
            return bytes(value)
    raise CageError("Invalid native handoff response")


def enter_scope(unit, address, argv):
    if SCOPE.fullmatch(unit) is None or Path(address).parent != runtime_path() or not re.fullmatch(r"launch-[0-9a-f]{24}\.sock", Path(address).name):
        raise CageError("Invalid private native-handoff endpoint")
    host = Host(READY_SECONDS)
    host.verify_registered(unit, os.getpid())
    native = native_path()
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(host.remaining())
        connection.connect(address)
        _, uid, _ = struct.unpack("3i", connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i")))
        if uid != os.getuid():
            raise CageError("Native handoff peer is not the current user")
        connection.sendall(b"READY\n")
        if receive_line(connection) != b"EXEC\n":
            raise CageError("Native handoff was not admitted", 75)
    host.verify_registered(unit, os.getpid())
    os.execve(native, [str(native), *argv], native_environment(argv, os.environ, native))


def start_scope(argv, runtime):
    unit = "omp-engineer-" + secrets.token_hex(12) + ".scope"
    address = runtime / ("launch-" + secrets.token_hex(12) + ".sock")
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    child = None
    try:
        server.bind(str(address))
        server.listen(1)
        args = [SYSTEMD_RUN, "--user", "--scope", "--collect", "--quiet", "--no-ask-password",
                "--expand-environment=no", "--same-dir", "--unit=" + unit, "--slice=omp.slice",
                "--description=Bounded OMP engineer", "--property=MemoryAccounting=yes",
                "--property=MemoryHigh=infinity", "--property=MemoryMax=" + str(LEAF_BYTES),
                "--property=MemorySwapMax=0", "--property=OOMPolicy=kill", "--",
                sys.executable, str(Path(__file__).resolve()), "--_enter-scope", unit, str(address), *argv]
        child = subprocess.Popen(args)
        deadline = time.monotonic() + READY_SECONDS
        with selectors.DefaultSelector() as selector:
            selector.register(server, selectors.EVENT_READ)
            while True:
                if child.poll() is not None:
                    raise CageError(f"Bounded OMP scope exited before verified native handoff (exit {exit_status(child.returncode)})", 75)
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise CageError("Bounded OMP scope did not become ready", 75)
                if selector.select(min(0.1, remaining)):
                    break
        connection, _ = server.accept()
        with connection:
            connection.settimeout(max(0.01, deadline - time.monotonic()))
            pid, uid, _ = struct.unpack("3i", connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i")))
            if uid != os.getuid() or receive_line(connection) != b"READY\n":
                raise CageError("Unauthenticated native handoff")
            Host(max(0.01, deadline - time.monotonic())).verify_registered(unit, pid)
            connection.sendall(b"EXEC\n")
        return child, pid
    except BaseException:
        if child is not None:
            # No native command received EXEC until after full registration. Stop
            # only this unique unit; never a shared slice, Herdr or another scope.
            try:
                subprocess.run([SYSTEMCTL, "--user", "--no-ask-password", "stop", unit],
                               capture_output=True, timeout=4, check=False)
            except (OSError, subprocess.TimeoutExpired):
                pass
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()
        raise
    finally:
        server.close()
        address.unlink(missing_ok=True)


def native_arguments(argv):
    # Native 18.4.9 flag-tables.ts: one owner for value boundaries in both
    # engineer classification and the update target's narrowly scoped PATH.
    values = {"--cwd", "--config", "--add-dir", "--mode", "--fork", "--provider", "--model",
              "--smol", "--slow", "--plan", "--prewalk-into", "--plan-yolo-into",
              "--max-time", "--service-tier", "--api-key", "--system-prompt",
              "--system-prompt-template", "--append-system-prompt", "--provider-session-id",
              "--prompt-cache-key", "--session-dir", "--models", "--tools", "--thinking",
              "--hook", "--extension", "-e", "--trusted-extension", "--plugin-dir",
              "--skills", "--approval-mode", "--profile", "--alias", "--export"}
    optional = {"--resume", "-r", "--session"}
    booleans = {"--help", "--version", "--allow-home", "--continue", "--from-claude",
                "--from-codex", "--no-session", "--no-tools", "--no-lsp", "--no-pty",
                "--hide-thinking", "--advisor", "--external-thinking", "--prewalk",
                "--no-prewalk", "--plan-yolo", "--print", "--print-thoughts",
                "--no-extensions", "--no-skills", "--no-rules", "--no-title", "--no-ui",
                "--auto-approve", "--yolo"}
    index = 0
    while index < len(argv):
        arg = argv[index]
        yield index, arg
        if arg == "--":
            return
        flag, equals, _ = arg.partition("=") if arg.startswith("--") else (arg, "", "")
        if arg.startswith("-") and not equals and index + 1 < len(argv):
            following = argv[index + 1]
            if flag in values or (
                    not following.startswith("-") and (
                        (flag in optional and following != "") or (flag.startswith("--") and flag not in booleans))):
                index += 1
        index += 1


def native_command_index(argv):
    # Registered roots/aliases, plus the installed 18.4.9 help surface.
    commands = {"launch", "help", "acp", "agents", "auth-broker", "auth-gateway", "bench", "browser-relay",
                "cleanse", "clip", "collab", "commit", "completions", "__complete", "compress", "config",
                "dry-balance", "find", "gallery", "gc", "git", "grep", "grievances",
                "if-bench", "images", "img", "install", "join", "login", "models", "play", "plugin",
                "plugins", "predict", "ps", "read", "render", "say", "search", "q", "web-search",
                "setup", "share", "shell", "skill", "skills", "ssh", "stats", "stream",
                "tiny-models", "token", "toks", "ttsr", "update", "usage", "worktree", "wt"}
    for index, arg in native_arguments(argv):
        if arg == "--":
            return None
        if not arg.startswith("-"):
            return index if arg in commands else None
    return None


def engineer_invocation(argv):
    command = native_command_index(argv)
    if command is not None and argv[command] != "launch":
        return False
    for _, arg in native_arguments(argv):
        if arg == "--":
            break
        flag = arg.split("=", 1)[0] if arg.startswith("--") else arg
        if flag in ("-p", "--print", "-h", "--help", "-v", "--version", "--export", "--alias", "--mode"):
            return False
    return os.isatty(0)


def launch(argv):
    native = native_path()
    if not engineer_invocation(argv):
        os.execve(native, [str(native), *argv], native_environment(argv, os.environ, native))
    terminal = Terminal()
    terminal.recover_if_polluted()
    host = Host()
    group = host.current_group()
    fleet = host.root + "/omp.slice"
    if contains(fleet, group):
        unit = group.rsplit("/", 1)[-1]
        if group != fleet + "/" + unit or SCOPE.fullmatch(unit) is None:
            raise CageError("Refusing nested OMP in an unverified cgroup")
        host.verify_registered(unit, os.getpid())
        child = subprocess.Popen([str(native), *argv], env=native_environment(argv, os.environ, native))
        with forward_signals(child):
            result = exit_status(child.wait())
    else:
        runtime = runtime_path()
        private_directory(runtime)
        child, pid = launch_transaction(admission_lock(runtime / "admission.lock"),
                                        lambda: Host().snapshot(), lambda result: start_scope(argv, runtime))
        with forward_signals(child, lambda: pid):
            result = exit_status(child.wait())
    if result == 137:
        terminal.killed()
    return result


def cage_activation_present(home):
    # Staging must not impose cage prerequisites on unactivated roster callers.
    # Partial activation still requires enforcement, never an uncaged fallback.
    entry = home / ".local/bin/omp"
    for path in (home / ".local/lib/omp-engineer/omp",
                 home / ".config/systemd/user/omp.slice", entry):
        try:
            info = path.lstat()
        except FileNotFoundError:
            continue
        except OSError as exc:
            raise CageError("Cannot inspect OMP cage activation") from exc
        if path != entry or stat.S_ISLNK(info.st_mode) and os.readlink(path) == "omp-engineer":
            return True
    return False


def memory(argv):
    if argv == ["--json"]:
        if not cage_activation_present(Path(pwd.getpwuid(os.getuid()).pw_dir)):
            print(json.dumps({"schema_version": 1, "ok": True, "source": "live",
                              "activated": False, "admitted": True, "reservation": False,
                              "warnings": [], "policy": POLICY, "capacity": None,
                              "coverage": "Engineer cage is not activated; memory enforcement is inactive. Staged roster launches retain their uncaged behavior."}, indent=2))
            return 0
        snapshot = Host().snapshot()
        source = "live"
    elif len(argv) == 3 and argv[0] == "--json" and argv[1] == "--fixture":
        try:
            snapshot = json.loads(Path(argv[2]).read_text())
        except (OSError, ValueError) as exc:
            raise CageError("Cannot read memory measurement fixture") from exc
        source = "fixture"
    else:
        raise CageError(HELP, 2)
    print(json.dumps(admission(snapshot, source=source), indent=2))
    return 0


def main(argv):
    # The omp alias has no launcher-option bypass: every native argument, even
    # `memory` and `--help`, follows native-mode dispatch.
    if Path(sys.argv[0]).name != "omp":
        if argv in (["--help"], ["-h"]):
            print(HELP, end="")
            return 0
        if argv and argv[0] == "memory":
            return memory(argv[1:])
        if len(argv) >= 3 and argv[0] == "--_enter-scope":
            return enter_scope(argv[1], argv[2], argv[3:])
        if argv and argv[0] == "--":
            argv = argv[1:]
    return launch(argv)


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except (CageError, OSError, socket.timeout) as exc:
        if Path(sys.argv[0]).name != "omp" and sys.argv[1:2] == ["memory"]:
            print(json.dumps({"schema_version": 1, "ok": False, "admitted": False,
                              "reservation": False, "policy": POLICY, "error": str(exc)}, indent=2))
        else:
            print(f"omp-engineer: {exc}", file=sys.stderr)
        sys.exit(exc.code if isinstance(exc, CageError) else 1)
