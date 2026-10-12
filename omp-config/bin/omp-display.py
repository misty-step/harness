#!/usr/bin/env python3
# owned by misty-step/harness omp-config engineer-display
"""Private engineer display/process/network namespace; no host desktop broker."""

import fcntl
import http.client
import json
import os
from pathlib import Path
import pwd
import selectors
import re
import signal
import socket
import stat
import struct
import subprocess
import sys
import tempfile
import threading
import time
import uuid

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
POWDER_URL = "https://powder.mistystep.io"
POWDER = ("pass-env", "run",
          "-e", "CF_ACCESS_CLIENT_ID=" + "/".join(("workstation", "POWDER_ACCESS_CLIENT_ID")),
          "-e", "CF_ACCESS_CLIENT_SECRET=" + "/".join(("workstation", "POWDER_ACCESS_CLIENT_SECRET")),
          "--", "work-tracker", "--url", POWDER_URL)
NOTE_ACTOR = "omp-display append-note"


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


def check_legacy_note_scope(item):
    """Historical reads remain; new Misty Step appends cannot reach Glass."""
    if not re.fullmatch(r"K-[A-Za-z0-9-]{1,197}", item):
        raise DisplayError("Legacy notes require an exact existing item ID")
    try:
        result = subprocess.run(["glass", "query", "item", item, "--json"],
                                capture_output=True, timeout=15, check=False)
        document = json.loads(result.stdout)
    except (OSError, subprocess.SubprocessError, ValueError) as exc:
        raise DisplayError("Canonical Glass scope could not be read; no append sent") from exc
    data = document.get("data") if isinstance(document, dict) else None
    answer = data.get("item") if isinstance(data, dict) else None
    value = answer.get("value") if isinstance(answer, dict) else None
    placement = value.get("placement") if isinstance(value, dict) else None
    placed = placement.get("value") if isinstance(placement, dict) else None
    if (result.returncode != 0 or not isinstance(answer, dict) or answer.get("state") != "ok"
            or not isinstance(value, dict) or value.get("id") != item
            or not isinstance(placement, dict) or placement.get("state") != "ok"
            or not isinstance(placed, dict)
            or not isinstance(placed.get("scope"), str) or not placed["scope"].strip()):
        raise DisplayError("Canonical Glass item scope is unknown; no append sent")
    scope = placed["scope"]
    if scope == "misty-step" or scope.startswith("misty-step/"):
        raise DisplayError("Misty Step evidence must use append-note --powder; no Glass append sent")


class GlassNoteBridge(HerdrBridge):
    """Restricted legacy append or exact native note transport; never opens a store."""

    def __init__(self, destination, upstream):
        super().__init__(destination, upstream, None)
        destination.chmod(0o600)

    def serve(self):
        while not self.stopped.is_set():
            try:
                connection, _ = self.server.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            with connection:
                connection.settimeout(5)
                try:
                    peer = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
                    if struct.unpack("3i", peer)[1] != os.getuid():
                        raise DisplayError("Wrong Glass note bridge peer")
                    request = json.loads(self.line(connection, deadline=time.monotonic() + 5))
                    if isinstance(request, dict) and set(request) == {"item", "native_wire"}:
                        try:
                            reply = bridge_powder_note(request["item"], request["native_wire"])
                        except (OSError, ValueError, RecursionError, DisplayError) as exc:
                            reply = {"returncode": None, "stdout": "", "stderr": str(exc)}
                        connection.sendall(json.dumps(reply).encode() + b"\n")
                        continue
                    if (not isinstance(request, dict) or set(request) != {"item", "text"}
                            or not isinstance(request["item"], str)
                            or not re.fullmatch(r"K-[A-Za-z0-9-]{1,197}", request["item"])
                            or not isinstance(request["text"], str)
                            or not request["text"].strip() or len(request["text"]) > 2000):
                        raise DisplayError("Glass note route requires an exact item ID and append text only")
                    check_legacy_note_scope(request["item"])
                    info = self.upstream.lstat()
                    if (not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid()
                            or stat.S_IMODE(info.st_mode) != 0o600):
                        raise DisplayError("Glass writer requires a UID-owned socket with mode 0600")
                    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as writer:
                        writer.settimeout(4)
                        writer.connect(str(self.upstream))
                        peer = writer.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
                        if struct.unpack("3i", peer)[1] != os.getuid():
                            raise DisplayError("Wrong Glass writer peer")
                        transport = http.client.HTTPConnection("localhost", timeout=4)
                        transport.sock = writer
                        body = json.dumps({"notes_append": request["text"], "relaying": "none",
                                           "caller": "omp-display append-note"}).encode()
                        transport.request("PATCH", "/v1/items/" + request["item"], body,
                                          {"Content-Type": "application/json", "Connection": "close"})
                        response = transport.getresponse()
                        raw = response.read(8 * 1024 * 1024 + 1)
                        if len(raw) > 8 * 1024 * 1024:
                            raise DisplayError("Glass writer response exceeds its bound")
                        reply = {"status": response.status, "body": json.loads(raw)}
                except (OSError, ValueError, RecursionError, DisplayError, http.client.HTTPException) as exc:
                    # A transport failure may follow a committed append. Never retry.
                    reply = {"status": 503, "body": {
                             "error": f"Glass note route failed; read the item before retrying: {exc}"}}
                try:
                    connection.sendall(json.dumps(reply).encode() + b"\n")
                except OSError:
                    pass


def append_note(item):
    """Read one note from stdin and print the existing writer's receipt."""
    text = sys.stdin.read(MAX_REQUEST + 1)
    request = json.dumps({"item": item, "text": text}).encode() + b"\n"
    if len(request) > MAX_REQUEST:
        raise DisplayError("Glass note request exceeds its bound")
    # This fence also protects an existing cage's older bridge process.
    check_legacy_note_scope(item)
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(10)
        connection.connect(f"/run/user/{os.getuid()}/glass-note.sock")
        connection.sendall(request)
        reply = json.loads(HerdrBridge.line(connection, 8 * 1024 * 1024,
                                            deadline=time.monotonic() + 10))
    print(json.dumps(reply["body"]))
    return 0 if 200 <= reply["status"] < 300 else 1


def append_powder_note(item):
    """Submit one retained native note request; Powder owns its receipt and replay."""
    raw = sys.stdin.buffer.read(MAX_REQUEST + 1)
    if len(raw) > MAX_REQUEST:
        raise DisplayError("Powder note request exceeds its bound")
    request = json.loads(raw)
    change = request.get("change") if isinstance(request, dict) else None
    if (not isinstance(request, dict)
            or set(request) != {"request_id", "actor", "id", "expected_revision", "change"}
            or request["id"] != item
            or not isinstance(change, dict) or set(change) != {"kind", "comment"}
            or change["kind"] != "note"):
        raise DisplayError("Powder append requires an exact item and a native note-only request")
    # Keep the original request bytes and opaque revision. Never generate a new
    # request ID, refresh a revision, retry, or fall back to the old board.
    return subprocess.run(["work-tracker", "--url", "https://powder.mistystep.io", "write"],
                          input=raw, check=False).returncode


def native_note_request(item, raw, text=None):
    """Validate the restricted fresh/native bridge envelope, without rewriting it."""
    if not isinstance(item, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", item):
        raise DisplayError("Powder notes require an exact native item ID")
    if len(raw) > MAX_REQUEST:
        raise DisplayError("Powder note request exceeds its bound")

    def unique_object(pairs):
        value = {}
        for key, entry in pairs:
            if key in value:
                raise DisplayError("Duplicate native note request field")
            value[key] = entry
        return value

    request = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object)
    change = request.get("change") if isinstance(request, dict) else None
    if (not isinstance(request, dict)
            or set(request) != {"request_id", "actor", "id", "expected_revision", "change"}
            or request["id"] != item
            or any(not isinstance(request[field], str) or not request[field].strip()
                   for field in ("request_id", "actor", "expected_revision"))
            or not isinstance(change, dict) or set(change) != {"kind", "comment"}
            or change["kind"] != "note"
            or not isinstance(change["comment"], str) or not change["comment"].strip()
            or len(change["comment"]) > 2000
            or (text is not None and (change["comment"] != text or request["actor"] != NOTE_ACTOR))):
        raise DisplayError("Powder append requires a matching native note-only request")
    return request


def current_powder_note_item(item):
    if not isinstance(item, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", item):
        raise DisplayError("Powder notes require an exact native item ID")
    try:
        result = subprocess.run([*POWDER, "get", item], capture_output=True,
                                timeout=35, check=False)
        value = json.loads(result.stdout)
    except (OSError, subprocess.SubprocessError, ValueError) as exc:
        raise DisplayError("Native Powder scope could not be read; no note sent") from exc
    if (result.returncode != 0 or not isinstance(value, dict) or value.get("id") != item
            or not isinstance(value.get("revision"), str) or not value["revision"].strip()
            or not isinstance(value.get("scope"), str)
            or not (value["scope"] == "misty-step" or value["scope"].startswith("misty-step/"))):
        raise DisplayError("Native Powder ID, revision, and Misty Step scope required; no note sent")
    return value


def retained_note(path, item, text):
    # No links, devices, public files, or unbounded reads in delivery custody.
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as retained:
        info = os.fstat(retained.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1):
            raise DisplayError("Retained Powder request requires a private UID-owned regular file")
        raw = retained.read(MAX_REQUEST + 1)
    native_note_request(item, raw, text)
    return raw


def append_new_powder_note(item, request_file):
    """Freeze a proven-new note before its only send; an existing file is exact replay."""
    text = sys.stdin.read(MAX_REQUEST + 1)
    if not text.strip() or len(text) > 2000:
        raise DisplayError("Powder notes require nonempty append text of at most 2000 characters")
    path = Path(request_file)
    try:
        raw = retained_note(path, item, text)
    except FileNotFoundError:
        current = current_powder_note_item(item)
        raw = (json.dumps({"request_id": "omp-display-" + uuid.uuid4().hex,
                           "actor": NOTE_ACTOR, "id": item,
                           "expected_revision": current["revision"],
                           "change": {"kind": "note", "comment": text}},
                          ensure_ascii=False) + "\n").encode("utf-8")
        native_note_request(item, raw, text)
        try:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        except FileExistsError:
            raw = retained_note(path, item, text)
        else:
            with os.fdopen(descriptor, "wb") as retained:
                os.fchmod(retained.fileno(), 0o600)
                retained.write(raw)
                retained.flush()
                os.fsync(retained.fileno())
            directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    else:
        current_powder_note_item(item)
    # Scope is checked, but the retained request's identity and opaque revision
    # remain unchanged: the native writer owns its exact replay receipt.
    return subprocess.run([*POWDER, "write"], input=raw, check=False).returncode


def bridge_powder_note(item, wire):
    """A distinct exact-wire frame; never converts an uncertain legacy delivery."""
    if not isinstance(wire, str):
        raise DisplayError("Native note bridge requires exact UTF-8 JSON Write bytes")
    raw = wire.encode("utf-8")
    native_note_request(item, raw)
    current_powder_note_item(item)
    try:
        result = subprocess.run([*POWDER, "write"], input=raw, capture_output=True,
                                timeout=35, check=False)
    except (OSError, subprocess.SubprocessError) as exc:
        raise DisplayError("Native note delivery is unknown; retain and replay only the same wire") from exc
    return {"returncode": result.returncode, "stdout": result.stdout.decode("utf-8"),
            "stderr": result.stderr.decode("utf-8")}



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


def mounts(home, dns, private_tmp, bridge=None, upstream=None, gpg=None, glass=None):
    uid = os.getuid()
    runtime = Path(f"/run/user/{uid}")
    args = ["--ro-bind", "/", "/", "--bind", str(home), str(home),
            "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/run",
            "--dir", str(runtime), "--chmod", "0700", str(runtime),
            "--tmpfs", "/tmp", "--tmpfs", "/var/tmp",
            "--tmpfs", str(home / ".omp/run"),
            "--bind", str(private_tmp), str(home / ".cache/tmp"),
            "--ro-bind", str(dns), str(Path("/etc/resolv.conf").resolve())]
    # Executables and desktop/service configuration remain host-owned. Native
    # administrative updates stay outside this coding-engineer boundary.
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
    # Cached pass/GPG decryption, silent audio, and Glass's read surface only.
    # The native PipeWire graph includes host screen-share video, not just audio.
    for path in (runtime / "pulse", runtime / "glass-read.sock", runtime / "gnupg/S.keyboxd"):
        if path.exists():
            args.extend(["--ro-bind", str(path), str(path)])
    if gpg is not None:
        args.extend(["--ro-bind", str(gpg), str(runtime / "gnupg/S.gpg-agent")])
    if glass is not None:
        args.extend(["--ro-bind", str(glass), str(runtime / "glass-note.sock")])
    if bridge is not None:
        args.extend(["--ro-bind", str(bridge), str(upstream)])
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
    scratch.mkdir(parents=True, exist_ok=True)
    child = network = bridge = gpg_bridge = glass_bridge = None
    fds = []
    with tempfile.TemporaryDirectory(prefix="omp-display-", dir=scratch) as directory:
        base = Path(directory)
        # Keep scratch on the existing disk filesystem, not charged tmpfs
        # storage that would consume the engineer's 4-GiB memory bound.
        private_tmp = base / "engineer-tmp"
        private_tmp.mkdir(mode=0o700)
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
            glass_endpoint = base / "glass-note.sock"
            glass_bridge = GlassNoteBridge(glass_endpoint, Path(f"/run/user/{os.getuid()}/glass.sock"))
            gpg_endpoint = None
            if gpg_upstream.exists():
                gpg_endpoint = base / "gpg.sock"
                gpg_bridge = GpgBridge(gpg_endpoint, gpg_upstream, None)
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
                                                       gpg_endpoint, glass_endpoint),
                    "--", "/usr/bin/python3", str(Path(__file__).resolve()), "--_exec", *command]
            # bwrap's monitor must survive foreground/caller signals so the real
            # command can flush and stop gracefully instead of receiving SIGKILL.
            child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--_bwrap", *args[1:]],
                                     env=clean_environment(os.environ), pass_fds=(info_write, gate_read))
            os.close(info_write)
            fds.remove(info_write)
            status = setup_status(info_read, child)
            os.close(info_read)
            fds.remove(info_read)
            pid = status.get("child-pid")
            if type(pid) is not int or pid <= 0:
                raise DisplayError("Invalid bubblewrap namespace identity")
            private_pid_namespace = os.readlink(f"/proc/{pid}/ns/pid")
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
            if glass_bridge is not None:
                glass_bridge.close()


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
    if argv[:2] == ["append-note", "--powder"]:
        if len(argv) != 3:
            raise DisplayError("Usage: omp-display append-note --powder ITEM < native-note-request.json")
        return append_powder_note(argv[2])
    if len(argv) == 4 and argv[0] == "append-note" and argv[2] == "--request-file":
        return append_new_powder_note(argv[1], argv[3])
    if len(argv) == 2 and argv[0] == "append-note":
        return append_note(argv[1])
    if argv[:1] == ["--_bwrap"]:
        signal.pthread_sigmask(signal.SIG_BLOCK, CONTROL_SIGNALS)
        os.execv(BWRAP, [BWRAP, *argv[1:]])
    if argv[:1] == ["--_exec"]:
        return execute(argv[1:])
    if argv in (["--help"], ["-h"]):
        print("Usage: omp-display -- COMMAND...\n"
              "       omp-display append-note --powder ITEM < native-note-request.json\n"
              "       omp-display append-note ITEM --request-file PATH < NOTE (new native note/exact replay)\n"
              "       omp-display append-note ITEM < NOTE (non-Misty-Step legacy transport)\n"
              "Kernel-enforced engineer display isolation; no host or work-owner fallback.")
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
