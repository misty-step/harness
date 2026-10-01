#!/usr/bin/env python3
# owned by misty-step/harness omp-config engineer-cage
"""Fail-closed OMP leaf containment and measured, serialized fleet admission."""

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
FLEET_BYTES = 36 * GIB
MEMORY_FLOOR_BYTES = 20 * GIB
HEAVY_BYTES = 16 * GIB
HEAVY_SWAP_BYTES = 2 * GIB
INSPECTION_SECONDS = 10
LOCK_SECONDS = 10
READY_SECONDS = 15
SYSTEMCTL = "/usr/bin/systemctl"
SYSTEMD_RUN = "/usr/bin/systemd-run"
OOMCTL = "/usr/bin/oomctl"
SCOPE = re.compile(r"omp-engineer-[0-9a-f]{24}\.scope\Z")
POLICY = {"leaf_bytes": LEAF_BYTES, "fleet_bytes": FLEET_BYTES,
          "available_memory_floor_bytes": MEMORY_FLOOR_BYTES, "heavy_capacity_bytes": HEAVY_BYTES,
          "leaf_swap_bytes": 0}
HELP = """Usage:
  omp-engineer [--] OMP-ARGUMENTS...
  omp-engineer memory --json [--fixture FILE]
  omp-engineer --help
The installed `omp` entrypoint passes every argument to native OMP in a verified
4-GiB, zero-swap, group-OOM scope. Memory is read-only preflight, never a reservation.
Fixtures are accepted only by read-only memory; launch always inspects live state.
Exit: native status; 1 inspection/setup failure; 2 usage; 75 admission/readiness refusal.
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


def finite(value, maximum, label):
    if value is None or natural(value, label) > maximum:
        raise CageError(f"{label} is not bounded at or below {maximum} bytes")


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
    root = group_path(snapshot.get("user_root"))
    if re.fullmatch(r"/user\.slice/user-([0-9]+)\.slice/user@\1\.service", root) is None or root != f"/user.slice/user-{snapshot.get('uid')}.slice/user@{snapshot.get('uid')}.service":
        raise CageError("Unrecognized user-manager hierarchy")
    fleet_path = root + "/omp.slice"
    fleet = snapshot.get("fleet")
    if not isinstance(fleet, dict) or fleet.get("path") != fleet_path or fleet.get("slice") != "-.slice":
        raise CageError("omp.slice is not a standalone user-manager root sibling")
    controls(fleet, "omp.slice")
    finite(fleet.get("memory_max"), FLEET_BYTES, "omp.slice memory.max")
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


def process_charge(snapshot, fleet_path, live_scopes):
    """Count processes once, retaining mixed legacy groups after roots disappear."""
    processes = snapshot.get("processes")
    legacy = snapshot.get("legacy_groups")
    uid = natural(snapshot.get("uid"), "uid")
    if not isinstance(processes, list) or not isinstance(legacy, list):
        raise CageError("Incomplete process or retained legacy-group inventory")
    by_pid = {}
    for item in processes:
        if not isinstance(item, dict):
            raise CageError("Invalid process inventory")
        for key in ("pid", "ppid", "uid", "starttime", "rss_bytes"):
            natural(item.get(key), f"process {key}")
        if not item["pid"] or item["pid"] in by_pid:
            raise CageError("Duplicate or invalid process identity")
        group_path(item.get("cgroup"))
        if type(item.get("native_omp")) is not bool or type(item.get("exited", False)) is not bool:
            raise CageError("Missing native OMP process identity")
        by_pid[item["pid"]] = item
    scope_groups = {item["path"] for item in live_scopes}
    def caged(item):
        if contains(fleet_path, item["cgroup"]):
            if item["cgroup"] not in scope_groups:
                raise CageError("A process occupies an unverified OMP cgroup")
            return True
        return False
    native = {pid for pid, item in by_pid.items() if item["uid"] == uid and item["native_omp"] and not item.get("exited", False) and not caged(item)}
    for path in legacy:
        group_path(path)
        if contains(fleet_path, path):
            raise CageError("Retained legacy identity overlaps the cage")
    legacy = sorted(set(legacy) | {by_pid[pid]["cgroup"] for pid in native})
    def chain(pid):
        seen = set()
        while pid in by_pid:
            if pid in seen:
                raise CageError("Cyclic process ancestry")
            seen.add(pid)
            yield pid
            pid = by_pid[pid]["ppid"]
    roots = sorted(pid for pid in native if not any(parent in native for parent in list(chain(pid))[1:]))
    descendants = {pid for pid in by_pid if any(parent in roots for parent in chain(pid))}
    selected = {pid for pid, item in by_pid.items()
                if not item.get("exited", False) and not caged(item) and (pid in descendants or any(contains(path, item["cgroup"]) for path in legacy))}
    for pid in selected:
        item = by_pid[pid]
        if item["uid"] != uid:
            raise CageError(f"Cannot account foreign-uid descendant {pid}")
        natural(item.get("pss_bytes"), f"process {pid} PSS")
        if item["pss_bytes"] > item["rss_bytes"]:
            raise CageError(f"Inconsistent resident accounting for process {pid}")
    uncaged = []
    for pid in roots:
        members = sorted(child for child in selected if pid in chain(child))
        item = by_pid[pid]
        uncaged.append({"pid": pid, "starttime": item["starttime"], "comm": item.get("comm", "omp"),
                        "exe": item.get("exe", ""), "cgroup": item["cgroup"], "pids": members,
                        "rss_bytes": sum(by_pid[child]["rss_bytes"] for child in members),
                        "pss_bytes": sum(by_pid[child]["pss_bytes"] for child in members),
                        "bounded": False})
    return {"groups": legacy, "uncaged": uncaged, "pids": sorted(selected),
            "unattributed_pids": sorted(selected - descendants),
            "rss_bytes": sum(by_pid[pid]["rss_bytes"] for pid in selected),
            "pss_bytes": sum(by_pid[pid]["pss_bytes"] for pid in selected)}


def admission(snapshot, *, source="live"):
    """Pure preflight. Input contains measurements, never policy overrides."""
    if not isinstance(snapshot, dict) or snapshot.get("schema_version") != 1:
        raise CageError("Unrecognized memory measurement schema")
    root, fleet_path, fleet, ancestors = verify_hierarchy(snapshot)
    available = natural(snapshot.get("available_bytes"), "available memory")
    scopes = snapshot.get("scopes")
    heavy = snapshot.get("heavy")
    if not isinstance(scopes, list) or not isinstance(heavy, dict):
        raise CageError("Incomplete cage or heavy-job inventory")
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
    heavy_current = natural(heavy.get("current_bytes"), "heavy-job memory")
    jobs = heavy.get("jobs")
    if not isinstance(jobs, list) or heavy_current > HEAVY_BYTES:
        raise CageError("Heavy jobs exceed the approved 16-GiB capacity")
    if heavy_current or jobs or heavy.get("populated"):
        controls(heavy, "heavy-job aggregate")
        if heavy.get("path") != root + "/dev.slice/dev-exec.slice":
            raise CageError("Heavy-job aggregate is outside the inspected hierarchy")
        finite(heavy.get("memory_max"), HEAVY_BYTES, "heavy-job aggregate memory.max")
        finite(heavy.get("memory_swap_max"), HEAVY_SWAP_BYTES, "heavy-job aggregate memory.swap.max")
        maxima = 0
        job_paths = set()
        for job in jobs:
            controls(job, "heavy job")
            path = group_path(job.get("path"))
            if path in job_paths or not contains(heavy["path"], path) or path == heavy["path"]:
                raise CageError("Invalid or duplicate heavy-job identity")
            job_paths.add(path)
            finite(job.get("memory_max"), HEAVY_BYTES, "heavy job memory.max")
            finite(job.get("memory_swap_max"), HEAVY_SWAP_BYTES, "heavy job memory.swap.max")
            maxima += job["memory_max"]
        if maxima > HEAVY_BYTES or not jobs:
            raise CageError("Active heavy jobs do not have compatible inspected leaf bounds")
    charge = process_charge(snapshot, fleet_path, live)
    current_group = group_path(snapshot.get("current_group"))
    nested = current_group in {item["path"] for item in live}
    if contains(fleet_path, current_group) and not nested:
        raise CageError("Current process occupies an unverified cage")
    new_bytes = 0 if nested else LEAF_BYTES
    reserved = len(live) * LEAF_BYTES
    unused = sum(max(0, LEAF_BYTES - item["current_bytes"]) for item in live)
    heavy_unused = HEAVY_BYTES - heavy_current
    required = MEMORY_FLOOR_BYTES
    ancestor_required = max(required, unused + new_bytes)
    aggregate = reserved + charge["rss_bytes"] + new_bytes
    ceiling = min(FLEET_BYTES, fleet["memory_max"])
    reasons = []
    if not nested:
        if aggregate > ceiling:
            reasons.append(f"aggregate fleet demand {aggregate} exceeds {ceiling} bytes")
        if available < required:
            reasons.append(f"available memory {available} is below the {required}-byte (20-GiB) scale-up floor")
        if fleet["memory_max"] - fleet["current_bytes"] < unused + new_bytes:
            reasons.append("omp.slice lacks headroom for its full live reservations")
        for item in ancestors:
            if item["memory_max"] is not None and item["memory_max"] - item["current_bytes"] < ancestor_required:
                reasons.append(f"effective ancestor {item['path']} lacks {ancestor_required} bytes of memory headroom")
    bounds = [fleet["memory_max"], *[item["memory_max"] for item in ancestors if item["memory_max"] is not None]]
    return {"schema_version": 1, "ok": True, "source": source, "reservation": False,
            "captured_at": snapshot.get("captured_at"), "admitted": not reasons, "reasons": reasons,
            "policy": dict(POLICY), "reuses_cage": nested,
            "capacity": {"available_bytes": available, "required_available_bytes": required,
                         "required_ancestor_headroom_bytes": ancestor_required,
                         "fleet_demand_bytes": aggregate, "fleet_ceiling_bytes": ceiling,
                         "effective_memory_max_bytes": min(bounds), "caged_count": len(live),
                         "caged_reserved_bytes": reserved, "caged_unused_bytes": unused,
                         "uncaged_count": len(charge["uncaged"]), "uncaged_rss_bytes": charge["rss_bytes"],
                         "uncaged_pss_bytes": charge["pss_bytes"], "legacy_process_count": len(charge["pids"]),
                         "heavy_current_bytes": heavy_current, "heavy_unused_bytes": heavy_unused,
                         "new_reservation_bytes": new_bytes},
            "scopes": live, "uncaged": charge["uncaged"], "legacy_groups": charge["groups"],
            "legacy_unattributed_pids": charge["unattributed_pids"], "heavy_jobs": jobs,
            "ancestors": ancestors, "monitored": snapshot["monitored"],
            "coverage": "Uncaged engineers and retained mixed legacy groups are measured, not bounded; their future growth remains unbounded until natural exit. Descendant containment excludes external daemons and deliberate same-user cgroup escape."}


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


def launch_transaction(lock, inspect, register, retain=lambda snapshot: None):
    # Registration returns only after cgroupfs + process membership verification.
    # The scope's populated lifetime, not this lock or launcher PID, owns capacity.
    with lock:
        snapshot = inspect()
        result = admission(snapshot)
        retain(snapshot)
        if not result["admitted"]:
            raise CageError("memory admission refused: " + "; ".join(result["reasons"]), 75)
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
                raise CageError("Unreserved processes occupy omp.slice directly")
            try:
                children = {path.name for path in directory.iterdir() if path.is_dir()}
            except OSError as exc:
                raise CageError("Cannot inspect actual OMP leaf inventory") from exc
            if children != {item["unit"] for item in records}:
                raise CageError("Actual OMP leaf inventory disagrees with systemd registration")
        return records

    def heavy(self):
        path = self.root + "/dev.slice/dev-exec.slice"
        directory = self.cgroup / path.lstrip("/")
        empty = {"path": path, "current_bytes": 0, "jobs": []}
        if not directory.exists():
            return empty
        record = self.group_controls(path)
        if not record["populated"]:
            return empty  # Obsolete, unused configured ceilings are not reservations.
        props = self.show("dev-exec.slice", "MemoryMax", "MemorySwapMax")
        if props["LoadState"] != "loaded" or props["ControlGroup"] != path:
            raise CageError("Active heavy-job aggregate has uninspectable placement")
        for key, prop in (("memory_max", "MemoryMax"), ("memory_swap_max", "MemorySwapMax")):
            if record[key] != self.limit(props[prop], prop):
                raise CageError("Heavy-job configured and actual aggregate bounds disagree")
        if self.read(directory / "cgroup.procs"):
            raise CageError("Heavy jobs occupy the aggregate without inspected leaf boundaries")
        try:
            children = [child for child in directory.iterdir() if child.is_dir()]
        except OSError as exc:
            raise CageError("Cannot enumerate active heavy jobs") from exc
        jobs = []
        for child in children:
            job = self.group_controls(path + "/" + child.name)
            if job["populated"]:
                if not child.name.endswith((".scope", ".service")):
                    raise CageError("Unrecognized active heavy-job leaf")
                job["unit"] = child.name
                jobs.append(job)
        record["jobs"] = jobs
        return record

    def legacy_groups(self):
        path = runtime_path() / "legacy.json"
        try:
            info = path.lstat()
        except FileNotFoundError:
            return []
        if not stat.S_ISREG(info.st_mode) or info.st_uid != self.uid or info.st_mode & 0o077:
            raise CageError("Unsafe retained legacy-group state")
        try:
            groups = json.loads(self.read(path))
        except ValueError as exc:
            raise CageError("Unreadable retained legacy-group state") from exc
        if not isinstance(groups, list):
            raise CageError("Invalid retained legacy-group state")
        return [group_path(group) for group in groups]

    def processes(self, legacy, scopes):
        by_pid = {}
        try:
            entries = list(self.proc.iterdir())
        except OSError as exc:
            raise CageError("Cannot enumerate process memory") from exc
        for entry in entries:
            if not entry.name.isdecimal() or int(entry.name) == os.getpid():
                continue
            self.remaining()
            try:
                text = (entry / "stat").read_text()
                left, rest = text.rsplit(") ", 1)
                parts = rest.split()
                uid = entry.stat().st_uid
                item = {"pid": int(entry.name), "ppid": int(parts[1]), "uid": uid,
                        "comm": left.split("(", 1)[1], "starttime": int(parts[19]),
                        "rss_bytes": max(0, int(parts[21])) * os.sysconf("SC_PAGE_SIZE"),
                        "native_omp": False, "cgroup": "/", "exe": ""}
                if uid == self.uid:
                    item["cgroup"] = self.process_group(item["pid"])
                    # The supported native ELF is named omp (including the
                    # retained update target). Identify that root before asking
                    # ptrace-protected executable metadata from unrelated daemons.
                    item["native_omp"] = item["comm"] == "omp"
                    if item["native_omp"]:
                        try:
                            item["exe"] = os.readlink(entry / "exe")
                        except FileNotFoundError:
                            if parts[0] != "Z":
                                continue
                        except PermissionError as exc:
                            raise CageError(f"Cannot identify native OMP executable {entry.name}") from exc
                by_pid[item["pid"]] = item
            except (FileNotFoundError, ProcessLookupError):
                continue  # A vanished process no longer consumes resident memory.
            except (OSError, ValueError, IndexError) as exc:
                raise CageError(f"Cannot inspect process identity {entry.name}") from exc
        native = {pid for pid, item in by_pid.items() if item["native_omp"] and not contains(self.root + "/omp.slice", item["cgroup"])}
        groups = set(legacy) | {by_pid[pid]["cgroup"] for pid in native}
        selected = {pid for pid, item in by_pid.items() if any(contains(group, item["cgroup"]) for group in groups)}
        changed = True
        while changed:
            extra = {pid for pid, item in by_pid.items() if item["ppid"] in selected}
            changed = not extra.issubset(selected)
            selected |= extra
        caged = {item["path"] for item in scopes if item["populated"]}
        for pid in selected:
            item = by_pid[pid]
            if item["cgroup"] in caged:
                continue
            if item["uid"] != self.uid:
                raise CageError(f"Cannot measure foreign-uid legacy descendant {pid}")
            try:
                raw = (self.proc / str(pid) / "smaps_rollup").read_text()
                pss = [line.split() for line in raw.splitlines() if line.startswith("Pss:")]
                if len(pss) != 1 or len(pss[0]) != 3 or pss[0][2] != "kB" or not pss[0][1].isdecimal():
                    raise CageError(f"Cannot measure legacy process {pid} PSS")
                again = (self.proc / str(pid) / "stat").read_text().rsplit(") ", 1)[1].split()
                if int(again[19]) != item["starttime"]:
                    raise CageError(f"Process identity changed during memory inspection: {pid}")
                item["pss_bytes"] = int(pss[0][1]) * 1024
                item["rss_bytes"] = max(item["rss_bytes"], item["pss_bytes"], max(0, int(again[21])) * os.sysconf("SC_PAGE_SIZE"))
            except (FileNotFoundError, ProcessLookupError):
                # Retain the ancestry identity so surviving children do not disappear.
                item["rss_bytes"] = item["pss_bytes"] = 0
                item["native_omp"] = False
                item["exited"] = True
            except (OSError, ValueError, IndexError) as exc:
                raise CageError(f"Cannot inspect legacy descendant memory {pid}") from exc
        # A removed cgroup can still contain live orphaned tasks. Process
        # membership, not the disappearance of cgroup.events, ends this charge.
        groups = {group for group in groups if any(
            item["uid"] == self.uid and not item.get("exited", False)
            and contains(group, item["cgroup"]) for item in by_pid.values())}
        return list(by_pid.values()), sorted(groups)

    def snapshot(self):
        current = self.current_group()
        fleet = self.fleet()
        scopes = self.scopes(fleet)
        legacy = self.legacy_groups()
        processes, legacy = self.processes(legacy, scopes)
        available = [line.split() for line in self.read("/proc/meminfo").splitlines() if line.startswith("MemAvailable:")]
        if len(available) != 1 or len(available[0]) != 3 or available[0][2] != "kB" or not available[0][1].isdecimal():
            raise CageError("Cannot inspect actual available physical memory")
        return {"schema_version": 1, "uid": self.uid, "user_root": self.root,
                "current_group": current, "available_bytes": int(available[0][1]) * 1024,
                "fleet": fleet, "scopes": scopes, "processes": processes, "legacy_groups": legacy,
                "heavy": self.heavy(), "ancestors": [self.group_controls(path) for path in ancestor_paths(self.root)],
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


def retain_legacy(snapshot):
    path = runtime_path() / "legacy.json"
    temporary = path.with_name("legacy-" + secrets.token_hex(8) + ".tmp")
    try:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC, 0o600)
        with os.fdopen(fd, "w") as handle:
            json.dump(snapshot["legacy_groups"], handle)
            handle.write("\n")
        os.replace(temporary, path)
    except OSError as exc:
        raise CageError("Cannot retain legacy descendant identities") from exc
    finally:
        temporary.unlink(missing_ok=True)


def native_environment(argv, inherited, native):
    # Native 18.4.9 resolves its mutable update target through PATH, not its own
    # executable. Only a mutating update may resolve `omp` to the ELF directory.
    # A global prefix would let nested/resumed engineers bypass the launch owner.
    if not argv or argv[0] != "update" or any(flag in ("--check", "-c") for flag in argv[1:]):
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


def launch(argv):
    native = native_path()
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
                                        lambda: Host().snapshot(), lambda result: start_scope(argv, runtime), retain_legacy)
        with forward_signals(child, lambda: pid):
            result = exit_status(child.wait())
    if result == 137:
        terminal.killed()
    return result


def memory(argv):
    if argv == ["--json"]:
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
    # `memory` and `--help`, follows the real launch transaction.
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
