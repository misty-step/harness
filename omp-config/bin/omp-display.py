#!/usr/bin/env python3
# owned by misty-step/harness omp-config engineer-display
"""Private engineer display/process/network namespace; no host desktop broker."""

import fcntl
import json
import os
from pathlib import Path
import pwd
import selectors
import re
import secrets
import signal
import socket
import stat
import struct
import subprocess
import sys
import tempfile
import threading
import time

BWRAP = "/usr/bin/bwrap"
SLIRP = "/usr/bin/slirp4netns"
MARKER = "isolated-v1"
CONTROL_SIGNALS = (signal.SIGINT, signal.SIGTERM, signal.SIGHUP, signal.SIGQUIT)
DESKTOP_KEYS = {
    "DISPLAY", "WAYLAND_DISPLAY", "WAYLAND_SOCKET", "HYPRLAND_INSTANCE_SIGNATURE",
    "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS", "DBUS_SESSION_BUS_PID",
    "DBUS_SESSION_BUS_WINDOWID", "AT_SPI_BUS_ADDRESS", "SESSION_MANAGER",
    "DESKTOP_STARTUP_ID", "XDG_ACTIVATION_TOKEN", "SWAYSOCK", "I3SOCK",
    "KDE_FULL_SESSION", "GNOME_DESKTOP_SESSION_ID", "GDK_BACKEND", "QT_QPA_PLATFORM",
    "OMP_BROWSER_CDP_URL", "CHROME_REMOTE_DEBUGGING_ADDRESS", "SSH_AUTH_SOCK",
    "XDG_SESSION_TYPE", "XDG_CURRENT_DESKTOP", "XDG_SESSION_DESKTOP",
    "GBM_BACKEND", "__GLX_VENDOR_LIBRARY_NAME", "__EGL_VENDOR_LIBRARY_FILENAMES",
    "__EGL_VENDOR_LIBRARY_DIRS", "GLX_VENDOR_LIBRARY_NAME",
}
READ_METHODS = frozenset({
    "ping", "agent.list", "agent.get", "agent.read", "agent.explain",
    "workspace.list", "workspace.get", "tab.list", "tab.get", "pane.list",
    "pane.current", "pane.get", "pane.layout", "pane.neighbor", "pane.edges",
    "pane.read", "worktree.list", "integration.list", "plugin.list",
})
REPORT_METHODS = frozenset({"pane.report_agent", "pane.report_agent_session"})
MAX_REQUEST = 64 * 1024


class DisplayError(Exception):
    pass


def clean_environment(inherited):
    return {key: value for key, value in inherited.items()
            if key not in DESKTOP_KEYS and not key.startswith(("HYPRLAND_", "WAYLAND_", "DBUS_"))}


def isolated():
    """The marker is not authority: check kernel namespace provenance too."""
    try:
        if os.geteuid() == 0 or os.environ.get("OMP_ENGINEER_DISPLAY") != MARKER:
            return False
        current = os.readlink("/proc/self/ns/mnt")
        if os.environ.get("OMP_ENGINEER_DISPLAY_NS") != current:
            return False
        init_status = Path("/proc/1/status").read_text().splitlines()
        uid = next(line.split()[1:3] for line in init_status if line.startswith("Uid:"))
        if uid != [str(os.getuid()), str(os.geteuid())]:
            return False
        return all(os.readlink(f"/proc/1/ns/{name}") == os.readlink(f"/proc/self/ns/{name}")
                   for name in ("mnt", "pid", "net"))
    except (OSError, StopIteration):
        return False


def allowed_request(request, pane):
    if not isinstance(request, dict) or set(request) != {"id", "method", "params"}:
        return False
    if not isinstance(request["id"], str) or not isinstance(request["method"], str) or not isinstance(request["params"], dict):
        return False
    method, params = request["method"], request["params"]
    if method in READ_METHODS:
        return True
    return (method in REPORT_METHODS and bool(pane) and params.get("pane_id") == pane
            and params.get("source") == "herdr:omp" and params.get("agent") == "omp")


class HerdrBridge:
    """Only reads and this pane's lifecycle reports cross to the host server."""

    def __init__(self, destination, upstream, pane):
        self.upstream, self.pane = upstream, pane
        self.server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.server.bind(str(destination))
        self.server.listen(8)
        self.server.settimeout(0.2)
        self.stopped = threading.Event()
        self.thread = threading.Thread(target=self.serve, daemon=True)
        self.thread.start()

    def serve(self):
        while not self.stopped.is_set():
            try:
                connection, _ = self.server.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            # No unbounded thread/connection queue from a misbehaving client.
            with connection:
                connection.settimeout(2)
                request_id = None
                try:
                    peer = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
                    if struct.unpack("3i", peer)[1] != os.getuid():
                        raise DisplayError("Wrong Herdr bridge peer")
                    raw = self.line(connection)
                    request = json.loads(raw)
                    request_id = request.get("id") if isinstance(request, dict) else None
                    if not allowed_request(request, self.pane):
                        raise DisplayError("Engineer display boundary denies host command/input authority")
                    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as upstream:
                        upstream.settimeout(2)
                        upstream.connect(str(self.upstream))
                        # Re-encode exactly one parsed request, never trailing input.
                        upstream.sendall(json.dumps(request).encode() + b"\n")
                        response = self.line(upstream, limit=8 * 1024 * 1024)
                        connection.sendall(response + b"\n")
                except (OSError, ValueError, DisplayError) as exc:
                    try:
                        connection.sendall(json.dumps({"id": request_id, "error": {
                            "code": "engineer_display_denied", "message": str(exc)}}).encode() + b"\n")
                    except OSError:
                        pass

    @staticmethod
    def line(connection, limit=MAX_REQUEST, *, deadline=None):
        data = bytearray()
        while len(data) <= limit:
            if deadline is not None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise socket.timeout("Bridge message deadline exceeded")
                connection.settimeout(remaining)
            block = connection.recv(min(65536, limit + 1 - len(data)))
            if not block:
                raise DisplayError("Incomplete Herdr bridge message")
            data.extend(block)
            if b"\n" in block:
                return bytes(data).split(b"\n", 1)[0]
        raise DisplayError("Herdr bridge message exceeds its bound")

    def close(self):
        self.stopped.set()
        self.server.close()
        self.thread.join(timeout=3)




class GpgBridge(HerdrBridge):
    """Cached decrypt/sign only; every agent connection forbids pinentry."""

    COMMANDS = frozenset({b"RESET", b"GETINFO", b"HAVEKEY", b"KEYINFO",
                          b"SETKEY", b"SETKEYDESC", b"READKEY", b"SIGKEY", b"SETHASH", b"PKDECRYPT", b"PKSIGN",
                          b"GET_PASSPHRASE", b"BYE"})
    GETINFO = frozenset({b"version", b"pid", b"socket_name", b"scd_running",
                         b"s2k_count", b"cmd_has_option", b"restricted"})
    DENIED = b"ERR 67109115 Engineer display boundary forbids this agent command\n"

    @staticmethod
    def agent_reply(reader):
        reply = bytearray()
        while len(reply) <= MAX_REQUEST:
            line = reader.readline(MAX_REQUEST + 1)
            if not line or len(line) > MAX_REQUEST:
                raise DisplayError("Invalid GPG agent response")
            reply.extend(line)
            if line.startswith((b"OK", b"ERR", b"INQUIRE ")):
                return bytes(reply), line
        raise DisplayError("GPG agent response exceeds its bound")

    def serve(self):
        while not self.stopped.is_set():
            try:
                connection, _ = self.server.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            with connection:
                connection.settimeout(2)
                try:
                    peer = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
                    if struct.unpack("3i", peer)[1] != os.getuid():
                        raise DisplayError("Wrong GPG bridge peer")
                    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as upstream:
                        upstream.settimeout(2)
                        upstream.connect(str(self.upstream))
                        with upstream.makefile("rb") as agent, connection.makefile("rb") as client:
                            greeting, _ = self.agent_reply(agent)
                            upstream.sendall(b"OPTION pinentry-mode=error\n")
                            _, result = self.agent_reply(agent)
                            if not result.startswith(b"OK"):
                                raise DisplayError("GPG agent cannot disable pinentry")
                            connection.sendall(greeting)
                            inquiry = False
                            while not self.stopped.is_set():
                                line = client.readline(MAX_REQUEST + 1)
                                if not line:
                                    break
                                if len(line) > MAX_REQUEST or not line.endswith(b"\n"):
                                    raise DisplayError("Invalid GPG client message")
                                command = line.split(b" ", 1)[0].strip()
                                if not inquiry and command == b"OPTION":
                                    # Host display/TTY/environment options never cross,
                                    # and callers cannot weaken the pinned error mode.
                                    connection.sendall(b"OK\n")
                                    continue
                                if inquiry:
                                    if command not in (b"D", b"END", b"CAN"):
                                        connection.sendall(self.DENIED)
                                        break
                                elif command not in self.COMMANDS:
                                    connection.sendall(self.DENIED)
                                    continue
                                if command == b"GETINFO":
                                    words = line.split()
                                    if len(words) < 2 or words[1] not in self.GETINFO:
                                        connection.sendall(self.DENIED)
                                        continue
                                upstream.sendall(line)
                                if inquiry and command == b"D":
                                    continue
                                reply, terminal = self.agent_reply(agent)
                                inquiry = terminal.startswith(b"INQUIRE ")
                                if command == b"RESET" and terminal.startswith(b"OK"):
                                    upstream.sendall(b"OPTION pinentry-mode=error\n")
                                    _, result = self.agent_reply(agent)
                                    if not result.startswith(b"OK"):
                                        raise DisplayError("GPG agent reset lost pinentry protection")
                                connection.sendall(reply)
                                if command == b"BYE":
                                    break
                except (OSError, DisplayError):
                    try:
                        connection.sendall(self.DENIED)
                    except OSError:
                        pass


SCOPE = re.compile(r"omp-engineer-[0-9a-f]{24}\.scope\Z")
HELPER_BYTES = 4 * 1024 ** 3


def capture(argv, *, deadline=None, pass_fds=()):
    remaining = 4 if deadline is None else min(4, deadline - time.monotonic())
    if remaining <= 0:
        raise DisplayError("Browser handoff deadline expired")
    result = subprocess.run(argv, capture_output=True, text=True, timeout=remaining,
                            pass_fds=pass_fds, check=False)
    if result.returncode:
        raise DisplayError(f"{argv[0]} inspection failed (exit {result.returncode})")
    return result.stdout


def unit_state(unit, *, deadline=None):
    fields = ("Id", "LoadState", "ActiveState", "ControlGroup", "InvocationID", "Slice",
              "MemoryMax", "MemoryHigh", "MemorySwapMax", "OOMPolicy")
    output = capture(["/usr/bin/systemctl", "--user", "--no-pager", "show", unit,
                      *["-p" + key for key in fields]], deadline=deadline)
    values = {}
    for line in output.splitlines():
        key, separator, value = line.partition("=")
        if not separator or key in values:
            raise DisplayError("Unrecognized manager unit state")
        values[key] = value
    if any(key not in values for key in fields) or values["Id"] != unit:
        raise DisplayError("Incomplete manager unit state")
    return values


def process_group(pid):
    paths = [line[3:] for line in Path(f"/proc/{pid}/cgroup").read_text().splitlines()
             if line.startswith("0::")]
    if len(paths) != 1:
        raise DisplayError("Unrecognized unified process membership")
    return paths[0]


def member(pid, group):
    members = (Path("/sys/fs/cgroup") / group.lstrip("/") / "cgroup.procs").read_text().splitlines()
    if process_group(pid) != group or str(pid) not in members:
        raise DisplayError("Browser handoff is not an actual registered leaf member")


def pidfd_alive(descriptor):
    with selectors.DefaultSelector() as selector:
        selector.register(descriptor, selectors.EVENT_READ)
        if selector.select(0):
            raise DisplayError("Browser handoff root or peer has exited")


def verify_helper_controls(props, controls):
    if (props["MemoryMax"] != str(HELPER_BYTES) or props["MemorySwapMax"] != "0"
            or props["MemoryHigh"] != "infinity" or props["OOMPolicy"] != "kill"
            or controls != {"memory.max": str(HELPER_BYTES), "memory.swap.max": "0",
                            "memory.high": "max", "memory.oom.group": "1"}):
        raise DisplayError("Chromium helper lacks its finite zero-swap/group-OOM controls")


class BrowserOwner:
    """Pin the actual uncapped controller root and unit incarnation, not an env name."""

    def __init__(self):
        self.pid = os.getpid()
        self.descriptor = os.pidfd_open(self.pid)
        try:
            self.group = process_group(self.pid)
            self.fleet = f"/user.slice/user-{os.getuid()}.slice/user@{os.getuid()}.service/omp.slice"
            self.unit = self.group.rsplit("/", 1)[-1]
            if SCOPE.fullmatch(self.unit) is None or self.group != self.fleet + "/" + self.unit:
                raise DisplayError("Chromium isolation requires a registered uncapped owner leaf")
            self.properties = unit_state(self.unit)
            self.invocation = self.properties["InvocationID"]
            self.namespaces = {name: os.readlink(f"/proc/{self.pid}/ns/{name}")
                               for name in ("pid", "mnt", "net")}
            self.verify()
        except BaseException:
            self.close()
            raise

    def verify(self, *, deadline=None):
        pidfd_alive(self.descriptor)
        props = unit_state(self.unit, deadline=deadline)
        if (props != self.properties or props["LoadState"] != "loaded" or props["ActiveState"] != "active"
                or props["ControlGroup"] != self.group or props["Slice"] != "omp.slice"
                or re.fullmatch(r"[0-9a-f]{32}", self.invocation) is None):
            raise DisplayError("Chromium owner unit incarnation changed or is not registered")
        member(self.pid, self.group)
        directory = Path("/sys/fs/cgroup") / self.group.lstrip("/")
        for file, expected in (("memory.max", "max"), ("memory.high", "max"),
                               ("memory.swap.max", "max"), ("memory.oom.group", "0")):
            if (directory / file).read_text().strip() != expected:
                raise DisplayError("Chromium owner must remain uncapped and ungrouped")
        if any(props[key] != "infinity" for key in ("MemoryMax", "MemoryHigh", "MemorySwapMax")):
            raise DisplayError("Chromium owner manager controls are not uncapped")
        if any(os.readlink(f"/proc/{self.pid}/ns/{name}") != value for name, value in self.namespaces.items()):
            raise DisplayError("Chromium controller root namespace changed")

    def verify_helper(self, unit, pid, descriptor, *, deadline):
        self.verify(deadline=deadline)
        pidfd_alive(descriptor)
        props = unit_state(unit, deadline=deadline)
        group = self.fleet + "/" + unit
        if (unit == self.unit or SCOPE.fullmatch(unit) is None or props["LoadState"] != "loaded"
                or props["ActiveState"] != "active" or props["ControlGroup"] != group
                or props["Slice"] != "omp.slice" or re.fullmatch(r"[0-9a-f]{32}", props["InvocationID"]) is None):
            raise DisplayError("Chromium helper is not a registered distinct sibling incarnation")
        directory = Path("/sys/fs/cgroup") / group.lstrip("/")
        controls = {file: (directory / file).read_text().strip()
                    for file in ("memory.max", "memory.swap.max", "memory.high", "memory.oom.group")}
        verify_helper_controls(props, controls)
        member(pid, group)
        # Inspect only this helper's actual ancestors. No fleet inventory, capacity
        # admission or mutation of owner/shared properties belongs at this seam.
        for ancestor in list(directory.parents)[:-1]:
            if ancestor == Path("/sys/fs/cgroup"):
                break
            for file in ("memory.max", "memory.swap.max", "memory.high"):
                raw = (ancestor / file).read_text().strip()
                if raw != "max" and re.fullmatch(r"[0-9]+", raw) is None:
                    raise DisplayError("Unrecognized helper ancestor controls")
            if (ancestor / "memory.oom.group").read_text().strip() != "0":
                raise DisplayError("Chromium helper ancestor enables group OOM")
        output = capture(["/usr/bin/oomctl", "--no-pager", "dump"], deadline=deadline)
        if output.count("Swap Monitored CGroups:") != 1 or output.count("Memory Pressure Monitored CGroups:") != 1:
            raise DisplayError("Unrecognized live systemd-oomd inventory")
        for line in output.splitlines():
            if "Path:" not in line:
                continue
            match = re.fullmatch(r"\s*Path: (/\S+)\s*", line)
            if match is None:
                raise DisplayError("Unrecognized systemd-oomd path")
            path = match[1].rstrip("/")
            if path and path != os.path.normpath(path):
                raise DisplayError("Unrecognized systemd-oomd cgroup identity")
            if not path or group == path or group.startswith(path + "/"):
                raise DisplayError("systemd-oomd monitors the Chromium helper hierarchy")
        if unit_state(unit, deadline=deadline) != props:
            raise DisplayError("Chromium helper incarnation changed during verification")
        pidfd_alive(descriptor)
        member(pid, group)

    def close(self):
        os.close(self.descriptor)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


class BrowserBridge(HerdrBridge):
    """Reviewed immutable-pidfd handoff; registration is not permission to exec."""

    def __init__(self, destination, helper):
        self.destination = destination
        self.helper = helper
        self.namespace_pid = self.namespace_fd = self.namespaces = None
        self.helper_fd = os.open(helper, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
        try:
            self.helper_info = os.fstat(self.helper_fd)
            if (not stat.S_ISREG(self.helper_info.st_mode) or self.helper_info.st_uid != os.getuid()
                    or self.helper_info.st_mode & 0o022 or not self.helper_info.st_mode & stat.S_IXUSR):
                raise DisplayError("Chromium shim is not a safe owned executable")
            self.owner = BrowserOwner()
            try:
                super().__init__(destination, None, None)
                os.chmod(destination, 0o600)
            except BaseException:
                self.owner.close()
                raise
        except BaseException:
            os.close(self.helper_fd)
            raise

    def pin_namespace(self, pid):
        descriptor = os.pidfd_open(pid)
        try:
            self.owner.verify()
            member(pid, self.owner.group)
            namespaces = {name: os.readlink(f"/proc/{pid}/ns/{name}") for name in ("pid", "mnt", "net")}
            if any(value == self.owner.namespaces[name] for name, value in namespaces.items()):
                raise DisplayError("Browser handoff requires private kernel namespaces")
            pidfd_alive(descriptor)
            self.namespace_pid, self.namespace_fd, self.namespaces = pid, descriptor, namespaces
        except BaseException:
            os.close(descriptor)
            raise

    def verify_namespace(self):
        if self.namespace_fd is None or self.namespaces is None:
            raise DisplayError("Browser namespace root is not pinned")
        pidfd_alive(self.namespace_fd)
        member(self.namespace_pid, self.owner.group)
        if any(os.readlink(f"/proc/{self.namespace_pid}/ns/{name}") != value
               for name, value in self.namespaces.items()):
            raise DisplayError("Browser namespace root changed")

    def serve(self):
        while not self.stopped.is_set():
            try:
                connection, _ = self.server.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            descriptor = None
            owned = admitted = False
            with connection:
                deadline = time.monotonic() + 15
                connection.settimeout(15)
                try:
                    pid, uid, _ = struct.unpack("3i", connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
                    if uid != os.getuid():
                        raise DisplayError("Unauthenticated browser handoff")
                    descriptor = struct.unpack("i", connection.getsockopt(socket.SOL_SOCKET, 77, 4))[0]  # SO_PEERPIDFD
                    pidfd_alive(descriptor)
                    self.owner.verify(deadline=deadline)
                    self.verify_namespace()
                    assert self.namespaces is not None
                    if any(os.readlink(f"/proc/{pid}/ns/{name}") != value for name, value in self.namespaces.items()):
                        raise DisplayError("Browser handoff is outside this private namespace")
                    executable = os.stat(f"/proc/{pid}/exe")
                    if (executable.st_dev, executable.st_ino) != (self.helper_info.st_dev, self.helper_info.st_ino):
                        raise DisplayError("Browser handoff is not the pinned launch shim")
                    member(pid, self.owner.group)
                    owned = True
                    if self.line(connection, limit=16, deadline=deadline) != b"CHROMIUM":
                        raise DisplayError("Invalid browser handoff request")
                    unit = "omp-engineer-" + secrets.token_hex(12) + ".scope"
                    capture([f"/proc/self/fd/{self.helper_fd}", "--register", str(descriptor), unit,
                             self.owner.unit, str(HELPER_BYTES)], deadline=deadline,
                            pass_fds=(descriptor, self.helper_fd))
                    while True:
                        props = unit_state(unit, deadline=deadline)
                        if props["ActiveState"] == "active":
                            break
                        if props["ActiveState"] == "failed" or props["LoadState"] != "loaded":
                            raise DisplayError("Browser helper registration did not become active")
                        if time.monotonic() >= deadline:
                            raise DisplayError("Browser helper registration deadline expired")
                        time.sleep(0.05)
                    self.owner.verify_helper(unit, pid, descriptor, deadline=deadline)
                    self.verify_namespace()
                    connection.settimeout(max(0.001, deadline - time.monotonic()))
                    connection.sendall(f"EXEC {unit} {HELPER_BYTES}\n".encode())
                    admitted = True
                except (OSError, ValueError, DisplayError, subprocess.TimeoutExpired) as exc:
                    try:
                        connection.sendall(b"ERR browser isolation admission failed\n")
                    except OSError:
                        pass
                    print(f"omp-display: browser isolation: {exc}", file=sys.stderr)
                finally:
                    if descriptor is not None:
                        if owned and not admitted:
                            try:
                                signal.pidfd_send_signal(descriptor, signal.SIGKILL)
                            except ProcessLookupError:
                                pass
                        os.close(descriptor)

    def close(self):
        super().close()
        if self.thread.is_alive():
            self.thread.join(timeout=16)
        if self.namespace_fd is not None:
            os.close(self.namespace_fd)
        self.owner.close()
        os.close(self.helper_fd)
        self.destination.unlink(missing_ok=True)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def disk_scratch(path):
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise DisplayError("Display scratch must be private and owned")
    filesystem = capture(["/usr/bin/findmnt", "--noheadings", "--output", "FSTYPE", "--target", str(path)]).strip()
    if (re.fullmatch(r"[a-zA-Z0-9_.-]+", filesystem) is None
            or filesystem in ("tmpfs", "ramfs", "devtmpfs", "hugetlbfs")):
        raise DisplayError("Display scratch requires disk-backed storage")


def mounts(home, dns, private_tmp, bridge=None, upstream=None, gpg=None, browser=None, *, private_run):
    uid = os.getuid()
    runtime = Path(f"/run/user/{uid}")
    args = ["--ro-bind", "/", "/", "--bind", str(home), str(home),
            "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/run",
            "--dir", str(runtime), "--chmod", "0700", str(runtime),
            "--bind", str(private_tmp), "/tmp", "--bind", str(private_tmp), "/var/tmp",
            "--bind", str(private_run), str(home / ".omp/run"),
            "--bind", str(private_tmp), str(home / ".cache/tmp"),
            "--ro-bind", str(dns), str(Path("/etc/resolv.conf").resolve())]
    # Host executables, service/desktop settings and shell startup stay host-owned.
    for path in (home / ".config", home / ".local/bin", home / ".local/lib",
                 *[home / name for name in (".bashrc", ".bash_profile", ".bash_logout",
                                            ".profile", ".zshrc", ".zprofile",
                                            ".gnupg/gpg-agent.conf")]):
        if path.exists():
            args.extend(["--ro-bind", str(path), str(path)])
    # Do not let tools reuse out-of-namespace command/browser supervisors.
    for path in (home / ".omp/ssh-control", home / ".config/herdr",
                 home / ".config/browser-harness/runtime", home / ".hermes"):
        if path.exists():
            args.extend(["--tmpfs", str(path)])
    # Cached pass/GPG decryption and silent audio. The native PipeWire graph
    # includes host screen-share video, not just audio.
    for path in (runtime / "pulse", runtime / "gnupg/S.keyboxd"):
        if path.exists():
            args.extend(["--ro-bind", str(path), str(path)])
    if gpg is not None:
        args.extend(["--ro-bind", str(gpg), str(runtime / "gnupg/S.gpg-agent")])
    if bridge is not None:
        args.extend(["--ro-bind", str(bridge), str(upstream)])
    if browser is not None:
        args.extend(["--ro-bind", str(browser), str(runtime / "omp-browser-helper.sock")])
    return args


def stop(child):
    if child is None or child.poll() is not None:
        return
    child.terminate()
    try:
        child.wait(timeout=3)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait()


def ready_byte(fd, children, seconds=15):
    deadline = time.monotonic() + seconds
    with selectors.DefaultSelector() as selector:
        selector.register(fd, selectors.EVENT_READ)
        while time.monotonic() < deadline:
            for child in children:
                if child.poll() is not None:
                    raise DisplayError(f"Display namespace setup exited ({child.returncode})")
            if selector.select(min(0.1, max(0, deadline - time.monotonic()))):
                value = os.read(fd, 1)
                if value != b"1":
                    raise DisplayError("Display namespace did not report readiness")
                return
    raise DisplayError("Display namespace readiness timed out")


def setup_status(fd, child):
    deadline = time.monotonic() + 15
    data = bytearray()
    with selectors.DefaultSelector() as selector:
        selector.register(fd, selectors.EVENT_READ)
        while time.monotonic() < deadline:
            if not selector.select(timeout=0.1):
                if child.poll() is not None:
                    raise DisplayError("Bubblewrap exited before namespace setup")
                continue
            block = os.read(fd, 4096)
            if not block:
                return json.loads(data)
            data.extend(block)
            if len(data) > 4096:
                raise DisplayError("Invalid bubblewrap setup status")
    raise DisplayError("Bubblewrap namespace setup timed out")


def namespace(command):
    if not command:
        raise DisplayError("A command is required")
    if Path("/proc/sys/dev/tty/legacy_tiocsti").read_text().strip() != "0":
        raise DisplayError("Legacy TIOCSTI must be disabled before sharing an engineer terminal")
    if isolated():
        os.execvpe(command[0], command, clean_environment(os.environ))
    for binary in (BWRAP, SLIRP):
        if not os.access(binary, os.X_OK):
            raise DisplayError(f"{binary} is required; refusing a host-display fallback")
    home = Path(pwd.getpwuid(os.getuid()).pw_dir)
    scratch = home / ".cache/tmp"
    scratch.mkdir(mode=0o700, parents=True, exist_ok=True)
    disk_scratch(scratch)
    child = network = bridge = gpg_bridge = browser_bridge = None
    fds = []
    with tempfile.TemporaryDirectory(prefix="omp-display-", dir=scratch) as directory:
        base = Path(directory)
        # Keep scratch on the existing disk filesystem.
        private_tmp = base / "engineer-tmp"
        private_tmp.mkdir(mode=0o700)
        private_run = base / "engineer-run"
        private_run.mkdir(mode=0o700)
        dns = base / "resolv.conf"
        dns.write_text("nameserver 10.0.2.3\n")
        upstream = os.environ.get("HERDR_SOCKET_PATH")
        if upstream:
            upstream = Path(upstream)
            info = upstream.lstat()
            if not upstream.is_absolute() or not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid():
                raise DisplayError("Herdr requires an owned absolute server socket")
            endpoint = base / "herdr.sock"
            bridge = HerdrBridge(endpoint, upstream, os.environ.get("HERDR_PANE_ID"))
        else:
            endpoint = None
        try:
            gpg_upstream = Path(f"/run/user/{os.getuid()}/gnupg/S.gpg-agent")
            gpg_endpoint = None
            if gpg_upstream.exists():
                gpg_endpoint = base / "gpg.sock"
                gpg_bridge = GpgBridge(gpg_endpoint, gpg_upstream, None)
            browser_endpoint = None
            environment = clean_environment(os.environ)
            isolation = environment.get("OMP_ENGINEER_BROWSER_ISOLATION")
            if isolation is not None:
                if isolation != "chromium-v1":
                    raise DisplayError("Unsupported Chromium isolation contract")
                helper = Path(__file__).resolve().with_name("omp-browser-helper")
                browser_endpoint = base / "browser.sock"
                browser_bridge = BrowserBridge(browser_endpoint, helper)
                environment["OMP_CHROMIUM_EXECUTABLE"] = environment.get("PUPPETEER_EXECUTABLE_PATH") or "/usr/bin/chromium"
                environment["PUPPETEER_EXECUTABLE_PATH"] = str(helper)
            info_read, info_write = os.pipe()
            gate_read, gate_write = os.pipe()
            ready_read, ready_write = os.pipe()
            exit_read, exit_write = os.pipe()
            fds.extend((info_read, info_write, gate_read, gate_write,
                        ready_read, ready_write, exit_read, exit_write))
            # The caller's Python may live under ~/.hermes, which mounts() hides.
            # Bootstrap inside the fence with the system interpreter instead.
            args = [BWRAP, "--unshare-user", "--unshare-pid", "--unshare-ipc", "--unshare-net",
                    "--die-with-parent", "--cap-drop", "ALL", "--info-fd", str(info_write),
                    "--block-fd", str(gate_read), *mounts(home, dns, private_tmp, endpoint, upstream,
                                                       gpg_endpoint, browser_endpoint, private_run=private_run),
                    "--", "/usr/bin/python3", str(Path(__file__).resolve()), "--_exec", *command]
            # bwrap's monitor must survive foreground/caller signals so the real
            # command can flush and stop gracefully instead of receiving SIGKILL.
            child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--_bwrap", *args[1:]],
                                     env=environment, pass_fds=(info_write, gate_read))
            os.close(info_write)
            fds.remove(info_write)
            status = setup_status(info_read, child)
            os.close(info_read)
            fds.remove(info_read)
            pid = status.get("child-pid")
            if type(pid) is not int or pid <= 0:
                raise DisplayError("Invalid bubblewrap namespace identity")
            private_pid_namespace = os.readlink(f"/proc/{pid}/ns/pid")
            if browser_bridge is not None:
                browser_bridge.pin_namespace(pid)
            # --dev can make bwrap enter a second user namespace for devpts.
            # The network still belongs to the first: joining the command's
            # final user namespace would lose permission to configure it.
            netns = os.open(f"/proc/{pid}/ns/net", os.O_RDONLY | os.O_CLOEXEC)
            try:
                network_owner = fcntl.ioctl(netns, 0xb701)  # NS_GET_USERNS
            finally:
                os.close(netns)
            fds.append(network_owner)
            network = subprocess.Popen([SLIRP, "--configure", "--disable-host-loopback",
                                        "--userns-path", f"/proc/self/fd/{network_owner}",
                                        "--ready-fd", str(ready_write), "--exit-fd", str(exit_read),
                                        str(pid), "tap0"], pass_fds=(ready_write, exit_read, network_owner),
                                       stdout=subprocess.DEVNULL, start_new_session=True)
            os.close(network_owner)
            fds.remove(network_owner)
            os.close(ready_write)
            fds.remove(ready_write)
            ready_byte(ready_read, (child, network))
            os.write(gate_write, b"1")
            os.close(gate_write)
            fds.remove(gate_write)
            previous = {}
            cancelled_before_exec = None
            def forward(number, _frame):
                nonlocal cancelled_before_exec
                if child.poll() is not None:
                    return
                delivered = False
                try:
                    children = Path(f"/proc/{pid}/task/{pid}/children").read_text().split()
                    for child_pid in map(int, children):
                        descriptor = os.pidfd_open(child_pid)
                        try:
                            if os.readlink(f"/proc/{child_pid}/ns/pid") == private_pid_namespace:
                                signal.pidfd_send_signal(descriptor, number)
                                delivered = True
                        finally:
                            os.close(descriptor)
                except (OSError, ValueError):
                    pass
                if not delivered:
                    cancelled_before_exec = number
                    child.kill()
            try:
                for number in CONTROL_SIGNALS:
                    # Terminal INT/QUIT already reach the command's foreground
                    # group. Re-sending turns a graceful abort into force-quit.
                    handler = (lambda *_: None) if number in (signal.SIGINT, signal.SIGQUIT) else forward
                    previous[number] = signal.signal(number, handler)
                result = child.wait()
            finally:
                for number, handler in previous.items():
                    signal.signal(number, handler)
            if cancelled_before_exec is not None:
                return 128 + cancelled_before_exec
            return 128 - result if result < 0 else result
        finally:
            # Closing an unreleased block-fd grants permission to execute.
            # Kill the setup first so a failed launch cannot run its command.
            stop(child)
            stop(network)
            for fd in fds:
                os.close(fd)
            if bridge is not None:
                bridge.close()
            if gpg_bridge is not None:
                gpg_bridge.close()
            if browser_bridge is not None:
                browser_bridge.close()


def execute(command):
    # This runs only after bwrap and slirp have established the real boundary.
    environment = clean_environment(os.environ)
    environment["OMP_ENGINEER_DISPLAY"] = MARKER
    environment["OMP_ENGINEER_DISPLAY_NS"] = os.readlink("/proc/self/ns/mnt")
    environment["XDG_RUNTIME_DIR"] = f"/run/user/{os.getuid()}"
    private_tmp = str(Path(pwd.getpwuid(os.getuid()).pw_dir) / ".cache/tmp")
    environment.update(TMPDIR=private_tmp, TMP=private_tmp, TEMP=private_tmp)
    environment["GPG_TTY"] = ""
    environment["BROWSER"] = "false"
    os.environ.update(environment)
    if not isolated():
        raise DisplayError("Native execution requires a real private namespace")
    os.closerange(3, os.sysconf("SC_OPEN_MAX"))
    for number in CONTROL_SIGNALS:
        signal.signal(number, signal.SIG_DFL)
    signal.pthread_sigmask(signal.SIG_UNBLOCK, CONTROL_SIGNALS)
    os.execvpe(command[0], command, environment)


def main(argv):
    if argv[:1] == ["--_bwrap"]:
        signal.pthread_sigmask(signal.SIG_BLOCK, CONTROL_SIGNALS)
        os.execv(BWRAP, [BWRAP, *argv[1:]])
    if argv[:1] == ["--_exec"]:
        return execute(argv[1:])
    if argv in (["--help"], ["-h"]):
        print("Usage: omp-display -- COMMAND...\n"
              "Private desktop isolation; use native work-tracker for Powder.")
        return 0
    if argv[:1] != ["--"]:
        raise DisplayError("Usage: omp-display -- COMMAND...")
    return namespace(argv[1:])


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except (DisplayError, OSError, ValueError) as exc:
        print(f"omp-display: {exc}", file=sys.stderr)
        sys.exit(1)
