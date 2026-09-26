#!/usr/bin/env python3
# owned by misty-step/harness agent-config desktop-guard
"""Managed Herdr sessions and two bounded local execution slots."""

import argparse
import fcntl
import json
import os
from pathlib import Path
import pwd
import re
import secrets
import shutil
import socket
import stat
import struct
import subprocess
import sys
import tempfile
import time


HERDR = "/usr/bin/herdr"
SYSTEMCTL = "/usr/bin/systemctl"
SYSTEMD_RUN = "/usr/bin/systemd-run"
OOMCTL = "/usr/bin/oomctl"
GIB = 1024 ** 3
SESSION = re.compile(r"[a-z][a-z0-9-]{0,47}\Z")
LIMITS = {
    "dev.slice": (52 * GIB, 8 * GIB, None),
    "dev-fleet.slice": (36 * GIB, 6 * GIB, None),
    "dev-exec.slice": (16 * GIB, 2 * GIB, None),
}
JOB_LIMITS = (8 * GIB, 1 * GIB, 6 * GIB)
CGROUP = Path("/sys/fs/cgroup")
STATUS_TIMEOUT = 4


class GuardError(Exception):
    def __init__(self, message, code=1):
        super().__init__(message)
        self.code = code


def command(argv, *, timeout=STATUS_TIMEOUT, env=None):
    try:
        result = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, env=env, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise GuardError(f"{argv[0]} unavailable or timed out") from exc
    if result.returncode:
        raise GuardError(f"{argv[0]} failed (exit {result.returncode})")
    return result.stdout


def native_env():
    # Inherited pane context must never redirect a probe or server to another session.
    return {key: value for key, value in os.environ.items() if not key.startswith("HERDR_")}


def herdr_args(session):
    return [HERDR] + ([] if session == "default" else ["--session", session])

def verified_herdr_binary():
    # The direct client subcommand is intentionally undocumented in Herdr 0.9.1.
    # Refuse unknown releases rather than risk a future auto-start behavior.
    if command([HERDR, "--version"], env=native_env()).strip() != "herdr 0.9.1":
        raise GuardError("Unreviewed Herdr version; refusing managed server/client launch")


def server_status(session):
    output = command(herdr_args(session) + ["status", "server", "--json"], env=native_env())
    try:
        data = json.loads(output)
    except (ValueError, TypeError) as exc:
        raise GuardError("Herdr returned an unrecognized server status") from exc
    if not isinstance(data, dict) or type(data.get("running")) is not bool:
        raise GuardError("Herdr returned an unrecognized server status")
    if data.get("status") != ("running" if data["running"] else "not_running"):
        raise GuardError("Herdr returned an inconsistent server status")
    if data.get("session") != (None if session == "default" else session):
        raise GuardError("Herdr status targeted a different session")
    if data["running"] and (data.get("version") != "0.9.1"
                            or data.get("compatible") is not True
                            or data.get("endpoint_compatible") is not True
                            or data.get("restart_needed") is not False
                            or data.get("server_binary_stale") is not False):
        raise GuardError("Herdr server is not the reviewed compatible 0.9.1 release")
    sock = data.get("socket")
    if not isinstance(sock, str) or not sock.startswith("/") or os.path.normpath(sock) != sock:
        raise GuardError("Herdr returned an invalid socket path")
    return data["running"], sock


def systemd_show(unit, *properties):
    fields = ("Id", "LoadState", "ActiveState", "ControlGroup") + properties
    output = command([SYSTEMCTL, "--user", "--no-pager", "show", unit, *["-p" + field for field in fields]])
    values = {}
    for line in output.splitlines():
        if "=" not in line:
            raise GuardError(f"Unrecognized systemd state for {unit}")
        key, value = line.split("=", 1)
        if key in values:
            raise GuardError(f"Duplicate systemd state for {unit}")
        values[key] = value
    if any(field not in values for field in fields) or values["Id"] != unit:
        raise GuardError(f"Incomplete systemd state for {unit}")
    return values


def finite_limit(value, ceiling, label):
    if not value.isascii() or not value.isdecimal() or int(value) > ceiling:
        raise GuardError(f"{label} is missing or exceeds its {ceiling // GIB} GiB ceiling")


def high_limit(value, ceiling, label):
    if ceiling is None:
        if value not in ("infinity", "max"):
            raise GuardError(f"{label} must remain unlimited (no aggregate reclaim throttle)")
    else:
        finite_limit(value, ceiling, label)


def slice_path(unit, root):
    if unit == "dev.slice":
        return root + "/dev.slice"
    return root + "/dev.slice/" + unit


def user_root():
    uid = os.getuid()
    marker = f"/user.slice/user-{uid}.slice/user@{uid}.service"
    try:
        lines = Path("/proc/self/cgroup").read_text().splitlines()
    except OSError as exc:
        raise GuardError("Cannot inspect this process's cgroup") from exc
    paths = [line[3:] for line in lines if line.startswith("0::")]
    if len(paths) != 1 or not (paths[0] == marker or paths[0].startswith(marker + "/")):
        raise GuardError("Not running under the expected user manager")
    return marker


def cgroup_value(group, filename):
    if not group.startswith("/") or "/../" in group or group.endswith("/.."):
        raise GuardError("Invalid cgroup path")
    try:
        return (CGROUP / group.lstrip("/") / filename).read_text().strip()
    except OSError as exc:
        raise GuardError(f"Cannot inspect {filename} for {group}") from exc


def assert_group_limits(group, limits, label):
    maximum, swap, high = limits
    finite_limit(cgroup_value(group, "memory.max"), maximum, label + " memory.max")
    finite_limit(cgroup_value(group, "memory.swap.max"), swap, label + " memory.swap.max")
    high_limit(cgroup_value(group, "memory.high"), high, label + " memory.high")


def assert_oom_isolation(group):
    # A grouped ancestor turns a single job's OOM into a fleet-wide kill.
    while group != "/":
        if cgroup_value(group, "memory.oom.group") != "0":
            raise GuardError(f"Fleet ancestor has memory.oom.group enabled: {group}")
        group = group.rpartition("/")[0] or "/"


def assert_oomd_safe(fleet):
    output = command([OOMCTL, "--no-pager", "dump"])
    if output.count("Swap Monitored CGroups:") != 1 or output.count("Memory Pressure Monitored CGroups:") != 1:
        raise GuardError("Unrecognized systemd-oomd monitor inventory")
    for line in output.splitlines():
        if "Path:" not in line:
            continue
        match = re.fullmatch(r"\s*Path: (/\S+)\s*", line)
        if match is None:
            raise GuardError("Unrecognized systemd-oomd monitor path")
        monitored = match.group(1).rstrip("/") or "/"
        if fleet == monitored or fleet.startswith(monitored.rstrip("/") + "/") or monitored == "/":
            raise GuardError(f"systemd-oomd monitors the fleet through {monitored}")


def configured_slice(unit, root):
    props = systemd_show(unit, "Slice", "MemoryMax", "MemorySwapMax", "MemoryHigh")
    if props["LoadState"] != "loaded" or props["Slice"] != ("-.slice" if unit == "dev.slice" else "dev.slice"):
        raise GuardError(f"{unit} is not loaded in the expected hierarchy")
    maximum, swap, high = LIMITS[unit]
    finite_limit(props["MemoryMax"], maximum, unit + " MemoryMax")
    finite_limit(props["MemorySwapMax"], swap, unit + " MemorySwapMax")
    high_limit(props["MemoryHigh"], high, unit + " MemoryHigh")
    if props["ActiveState"] not in ("active", "inactive"):
        raise GuardError(f"{unit} is not in a usable state")
    if props["ActiveState"] == "active" and props["ControlGroup"] != slice_path(unit, root):
        raise GuardError(f"{unit} is outside the expected hierarchy")
    if props["ActiveState"] == "inactive" and props["ControlGroup"]:
        raise GuardError(f"{unit} has unexpected cgroup membership")
    return props


def ensure_slices(units, root):
    # Do not instantiate anything unless every target has finite configured bounds.
    for unit in units:
        configured_slice(unit, root)
    assert_oomd_safe(slice_path("dev-fleet.slice", root))
    for unit in units:
        props = configured_slice(unit, root)
        if props["ActiveState"] == "inactive":
            command([SYSTEMCTL, "--user", "--no-ask-password", "start", unit], timeout=8)
    for unit in units:
        props = configured_slice(unit, root)
        if props["ActiveState"] != "active" or props["ControlGroup"] != slice_path(unit, root):
            raise GuardError(f"{unit} did not enter its expected cgroup")
        assert_group_limits(props["ControlGroup"], LIMITS[unit], unit)
        assert_oom_isolation(props["ControlGroup"])
    assert_oomd_safe(slice_path("dev-fleet.slice", root))


def service_info(session, root):
    unit = f"herdr@{session}.service"
    props = systemd_show(unit, "Slice", "MainPID", "OOMPolicy")
    if props["LoadState"] != "loaded" or props["Slice"] != "dev-fleet.slice" or props["OOMPolicy"] != "continue":
        raise GuardError(f"{unit} is not the bounded managed service (OOMPolicy=continue required)")
    if props["ActiveState"] not in ("active", "inactive", "activating", "failed"):
        raise GuardError(f"{unit} is not in a usable state")
    if props["ControlGroup"] and props["ControlGroup"] != slice_path("dev-fleet.slice", root) + "/" + unit:
        raise GuardError(f"{unit} is outside dev-fleet.slice")
    return unit, props


def peer_credentials(path):
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            connection.settimeout(0.75)
            connection.connect(path)
            peer = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
    except (OSError, TimeoutError) as exc:
        raise GuardError("Cannot authenticate the Herdr server socket") from exc
    return struct.unpack("3i", peer)


def process_group(pid):
    try:
        lines = Path(f"/proc/{pid}/cgroup").read_text().splitlines()
    except OSError as exc:
        raise GuardError("Cannot inspect Herdr server placement") from exc
    paths = [line[3:] for line in lines if line.startswith("0::")]
    if len(paths) != 1:
        raise GuardError("Unrecognized Herdr server cgroup")
    return paths[0]


def managed_server(session, root, status):
    running, sock = status
    if not running:
        raise GuardError("Herdr server is not running")
    unit, props = service_info(session, root)
    group = slice_path("dev-fleet.slice", root) + "/" + unit
    try:
        main_pid = int(props["MainPID"])
    except ValueError as exc:
        raise GuardError("Invalid Herdr service MainPID") from exc
    if props["ActiveState"] != "active" or main_pid <= 0 or props["ControlGroup"] != group:
        raise GuardError("Refusing a server outside the managed Herdr service")
    peer_pid, peer_uid, _ = peer_credentials(sock)
    if peer_uid != os.getuid() or peer_pid != main_pid or process_group(main_pid) != group:
        raise GuardError("Refusing a Herdr socket not owned by the managed service MainPID")
    if cgroup_value(group, "memory.oom.group") != "0":
        raise GuardError("Herdr service has memory.oom.group enabled")


def verify_running(session, root, status):
    managed_server(session, root, status)
    ensure_slices(("dev.slice", "dev-fleet.slice", "dev-exec.slice"), root)
    # Re-authenticate after checking bounds: the server can change meanwhile.
    managed_server(session, root, server_status(session))


def start(session):
    root = user_root()
    status = server_status(session)
    if status[0]:
        # Identity preflight comes before ANY systemd start, including a cold slice.
        verify_running(session, root, status)
        return
    unit, _ = service_info(session, root)
    ensure_slices(("dev.slice", "dev-fleet.slice", "dev-exec.slice"), root)
    command([SYSTEMCTL, "--user", "--no-ask-password", "start", unit], timeout=10)
    deadline = time.monotonic() + 12
    while True:
        status = server_status(session)
        if status[0]:
            verify_running(session, root, status)
            return
        if time.monotonic() >= deadline:
            raise GuardError("Managed Herdr service started without an authenticated socket")
        time.sleep(0.15)


def serve(session):
    root = user_root()
    unit, props = service_info(session, root)
    group = slice_path("dev-fleet.slice", root) + "/" + unit
    if props["ControlGroup"] != group or props["MainPID"] != str(os.getpid()) or process_group(os.getpid()) != group:
        raise GuardError("Refusing Herdr server execution outside its managed user service")
    ensure_slices(("dev.slice", "dev-fleet.slice", "dev-exec.slice"), root)
    if cgroup_value(group, "memory.oom.group") != "0":
        raise GuardError("Herdr service has memory.oom.group enabled")
    if server_status(session)[0]:
        raise GuardError("Refusing to start a second Herdr server")
    argv = herdr_args(session) + ["server"]
    os.execve(HERDR, argv, native_env())


def runtime_lock_dir():
    path = Path(f"/run/user/{os.getuid()}")
    try:
        info = path.stat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise GuardError("Real XDG runtime directory has unsafe permissions")
        lock_dir = path / "desktop-guard"
        lock_dir.mkdir(mode=0o700, exist_ok=True)
        info = lock_dir.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise GuardError("Desktop guard lock directory has unsafe permissions")
    except OSError as exc:
        raise GuardError("Cannot access the real XDG runtime directory") from exc
    return lock_dir


def lock_slot(path):
    try:
        fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            os.close(fd)
            raise GuardError("Desktop guard slot lock has unsafe permissions")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            os.close(fd)
            return None
        except OSError:
            os.close(fd)
            raise
        return fd
    except OSError as exc:
        raise GuardError("Cannot acquire desktop guard slot lock") from exc


def scope_group(unit, root):
    return slice_path("dev-exec.slice", root) + "/" + unit


def scope_is_busy(unit, root):
    props = systemd_show(unit)
    if props["ActiveState"] != "inactive" or props["ControlGroup"]:
        if props["ControlGroup"] and props["ControlGroup"] != scope_group(unit, root):
            raise GuardError(f"Scope {unit} exists outside dev-exec.slice")
        return True
    # A loaded but inactive/failed transient scope can still block name reuse.
    return props["LoadState"] != "not-found"


def scope_has_members(unit):
    props = systemd_show(unit)
    return bool(props["ControlGroup"]) or props["ActiveState"] not in ("inactive", "failed")


def scratch_dir():
    home = Path(pwd.getpwuid(os.getuid()).pw_dir)
    base = home / ".cache" / "tmp"
    try:
        base.mkdir(mode=0o700, parents=True, exist_ok=True)
        info = base.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
            raise GuardError("~/.cache/tmp must be an owned directory, not a symlink")
        return Path(tempfile.mkdtemp(prefix="desktop-guard-", dir=base))
    except OSError as exc:
        raise GuardError("Cannot create disk-backed run scratch under ~/.cache/tmp") from exc


def run_job(argv):
    root = user_root()
    ensure_slices(("dev.slice", "dev-fleet.slice", "dev-exec.slice"), root)
    lock_dir = runtime_lock_dir()
    for number in (1, 2):
        unit = f"dev-job-{number}.scope"
        fd = lock_slot(lock_dir / f"job-{number}.lock")
        if fd is None:
            continue
        try:
            if scope_is_busy(unit, root):
                continue
            ensure_slices(("dev.slice", "dev-fleet.slice", "dev-exec.slice"), root)
            scratch = scratch_dir()
            try:
                maximum, swap, high = JOB_LIMITS
                args = [SYSTEMD_RUN, "--user", "--scope", "--collect", "--quiet", "--no-ask-password",
                        "--expand-environment=no", "--same-dir", "--unit=" + unit,
                        "--description=Desktop guard local job " + str(number),
                        "--slice=dev-exec.slice", "--property=MemoryAccounting=yes",
                        "--property=MemoryHigh=" + str(high), "--property=MemoryMax=" + str(maximum),
                        "--property=MemorySwapMax=" + str(swap), "--property=OOMPolicy=kill", "--", *argv]
                environment = os.environ.copy()
                environment["TMPDIR"] = str(scratch)
                try:
                    result = subprocess.run(args, env=environment, check=False).returncode
                    return 128 - result if result < 0 else result
                except OSError as exc:
                    raise GuardError("Cannot launch bounded transient scope") from exc
            finally:
                # systemd may finish scope deactivation just after the command
                # exits. Never remove TMPDIR while descendants remain in it.
                deadline = time.monotonic() + 1
                while True:
                    try:
                        occupied = scope_has_members(unit)
                    except GuardError:
                        occupied = True  # Retain scratch when termination is unknown.
                    if not occupied or time.monotonic() >= deadline:
                        break
                    time.sleep(0.05)
                if not occupied:
                    shutil.rmtree(scratch)
        finally:
            os.close(fd)
    raise GuardError("Both bounded desktop job slots are occupied", 75)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("serve", "start", "attach", "check"):
        sub = commands.add_parser(name)
        sub.add_argument("--session", default="default", help="native default or named Herdr session")
    job = commands.add_parser("run", help="run a command in one of two bounded scopes")
    job.add_argument("argv", nargs=argparse.REMAINDER, metavar="-- COMMAND...")
    args = parser.parse_args()
    try:
        if args.command == "run":
            if len(sys.argv) < 4 or sys.argv[2] != "--":
                parser.error("run requires -- COMMAND...")
            return run_job(sys.argv[3:])
        if SESSION.fullmatch(args.session) is None:
            parser.error("session must match [a-z][a-z0-9-]{0,47}")
        verified_herdr_binary()
        if args.command == "serve":
            serve(args.session)
        elif args.command == "start":
            start(args.session)
        elif args.command == "check":
            root = user_root()
            verify_running(args.session, root, server_status(args.session))
            print(f"Herdr session {args.session}: managed, bounded, and not covered by systemd-oomd")
        else:
            start(args.session)
            # Native client-only mode never auto-spawns. BindsTo ends its Local
            # reconnect supervisor if this specific managed service goes away.
            unit = f"herdr@{args.session}.service"
            client_unit = f"desktop-guard-client-{os.getpid()}-{secrets.token_hex(6)}.scope"
            command_line = [SYSTEMD_RUN, "--user", "--scope", "--collect", "--quiet", "--no-ask-password",
                            "--expand-environment=no", "--same-dir", "--unit=" + client_unit,
                            "--description=Desktop guard Herdr client", "--slice=app.slice",
                            "--property=MemoryAccounting=yes", "--property=MemoryMax=" + str(GIB // 2),
                            "--property=MemorySwapMax=0", "--property=OOMPolicy=kill",
                            "--property=BindsTo=" + unit, "--property=After=" + unit,
                            "--", *herdr_args(args.session), "client"]
            os.execve(SYSTEMD_RUN, command_line, native_env())
        return 0
    except GuardError as exc:
        print(f"desktop-guard: {exc}", file=sys.stderr)
        return exc.code
    except OSError as exc:
        print(f"desktop-guard: execution failed: {exc.strerror}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
