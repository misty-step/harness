#!/usr/bin/env python3
# owned by misty-step/harness omp-config engineer-display
"""Run one command and its GUI tools on an engineer-owned headless display."""

import argparse
import os
from pathlib import Path
import selectors
import shutil
import signal
import stat
import struct
import subprocess
import sys
import tempfile
import time


class GuiError(Exception):
    pass


class Interrupted(Exception):
    def __init__(self, number):
        self.number = number


def require_namespace():
    """Environment is a routing hint; kernel state must establish the boundary."""
    if os.environ.get("OMP_ENGINEER_DISPLAY") != "isolated-v1":
        raise GuiError("requires an isolated engineer; launch through omp")
    try:
        namespace = os.readlink("/proc/self/ns/mnt")
        if os.environ.get("OMP_ENGINEER_DISPLAY_NS") != namespace:
            raise GuiError("engineer display namespace marker does not match this process")
        # A caller on the workstation can forge environment variables and may
        # already have tmpfs /tmp and /run. The launcher's private PID namespace
        # has an engineer-owned init, in the same mount/PID namespaces as us.
        if os.geteuid() == 0:
            raise GuiError("requires an unprivileged engineer namespace")
        uid_line = next(line for line in Path("/proc/1/status").read_text().splitlines()
                        if line.startswith("Uid:"))
        init_uids = [int(value) for value in uid_line.split()[1:3]]
        if init_uids != [os.getuid(), os.geteuid()]:
            raise GuiError("requires an engineer-owned private PID namespace")
        for kind in ("mnt", "pid"):
            if os.readlink(f"/proc/1/ns/{kind}") != os.readlink(f"/proc/self/ns/{kind}"):
                raise GuiError("engineer init and command namespaces do not match")
        mounts = []
        for line in Path("/proc/self/mountinfo").read_text().splitlines():
            before, after = line.split(" - ", 1)
            fields = before.split()
            mounts.append((fields[4], after.split()[0]))
        for target, filesystem in (("/tmp", "tmpfs"), ("/run", "tmpfs"), ("/proc", "proc")):
            matches = [kind for mount, kind in mounts if mount == target]
            if not matches or matches[-1] != filesystem:
                raise GuiError(f"requires private {filesystem} at {target}")
        # Xvfb's pathname socket must not land in a nested host bind mount.
        if any(mount.startswith("/tmp/") for mount, _ in mounts):
            raise GuiError("requires an unmapped private /tmp for X11 sockets")
        sockets = Path("/tmp/.X11-unix")
        sockets.mkdir(mode=0o1777, exist_ok=True)
        info = sockets.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_dev != os.stat("/tmp").st_dev:
            raise GuiError("X11 socket directory is not on the private /tmp")
    except (OSError, ValueError, StopIteration) as error:
        raise GuiError(f"cannot verify engineer display isolation: {error}") from error


def display_environment():
    environment = dict(os.environ)
    for name in (
        "DISPLAY", "WAYLAND_DISPLAY", "WAYLAND_SOCKET", "XAUTHORITY",
        "HYPRLAND_INSTANCE_SIGNATURE", "HYPRLAND_CMD", "SWAYSOCK", "I3SOCK",
        "DBUS_SESSION_BUS_ADDRESS", "DBUS_SESSION_BUS_PID", "DBUS_SESSION_BUS_WINDOWID",
        "AT_SPI_BUS_ADDRESS", "AT_SPI_DISPLAY", "GTK_MODULES", "GTK3_MODULES",
        "QT_LINUX_ACCESSIBILITY_ALWAYS_ON", "ACCESSIBILITY_ENABLED",
        "DESKTOP_STARTUP_ID", "SESSION_MANAGER", "XDG_SESSION_ID",
        "XDG_CURRENT_DESKTOP", "XDG_SESSION_DESKTOP", "GNOME_DESKTOP_SESSION_ID",
        "GBM_BACKEND", "__GLX_VENDOR_LIBRARY_NAME", "__EGL_VENDOR_LIBRARY_FILENAMES",
    ):
        environment.pop(name, None)
    # Keep the launcher's silent PULSE/PipeWire/ALSA routing unchanged. Toolkit
    # selection must never rediscover the workstation's Wayland compositor.
    environment.update({
        "XDG_SESSION_TYPE": "x11", "GDK_BACKEND": "x11", "QT_QPA_PLATFORM": "xcb",
        "SDL_VIDEODRIVER": "x11", "CLUTTER_BACKEND": "x11", "MOZ_ENABLE_WAYLAND": "0",
        "NO_AT_BRIDGE": "1", "QT_ACCESSIBILITY": "0", "LIBGL_ALWAYS_SOFTWARE": "1",
        "__GLX_VENDOR_LIBRARY_NAME": "mesa",
    })
    mesa = Path("/usr/share/glvnd/egl_vendor.d/50_mesa.json")
    if mesa.is_file():
        environment["__EGL_VENDOR_LIBRARY_FILENAMES"] = str(mesa)
    return environment


def write_authority(path):
    # FamilyWild with an empty display number matches the display selected by
    # -displayfd. Authentication also protects Xvfb's abstract Unix socket from
    # other namespaces sharing the network namespace. No xauth binary is needed.
    fields = (b"", b"", b"MIT-MAGIC-COOKIE-1", os.urandom(16))
    record = struct.pack("!H", 65535)
    for field in fields:
        record += struct.pack("!H", len(field)) + field
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as authority:
        authority.write(record)


def signal_group(process, number):
    if process is not None:
        try:
            os.killpg(process.pid, number)
        except ProcessLookupError:
            pass


def stop_process(process):
    if process is None:
        return
    # Terminate the owned group even if its leader already exited: tools started
    # by a shell can otherwise outlive the command and hold the display open.
    signal_group(process, signal.SIGTERM)
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        pass
    signal_group(process, signal.SIGKILL)
    process.wait()


class Supervisor:
    def __init__(self):
        self.server = None
        self.child = None
        self.interrupt = None

    def handle_signal(self, number, frame):
        previous = self.interrupt
        self.interrupt = number
        signal_group(self.child or self.server, signal.SIGKILL if previous else number)

    def check_interrupt(self):
        if self.interrupt is not None:
            raise Interrupted(self.interrupt)

    def start_display(self, xvfb, environment, authority, log):
        read_fd, write_fd = os.pipe()
        try:
            self.server = subprocess.Popen(
                [xvfb, "-displayfd", str(write_fd), "-screen", "0", "1920x1080x24",
                 "-nolisten", "tcp", "-auth", str(authority), "-noreset"],
                env=environment, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                pass_fds=(write_fd,), start_new_session=True,
            )
        finally:
            os.close(write_fd)
            if self.server is None:
                os.close(read_fd)
        try:
            deadline = time.monotonic() + 15
            value = bytearray()
            with selectors.DefaultSelector() as selector:
                selector.register(read_fd, selectors.EVENT_READ)
                while b"\n" not in value:
                    self.check_interrupt()
                    if self.server.poll() is not None:
                        raise GuiError("Xvfb exited before its display was ready")
                    if time.monotonic() >= deadline:
                        raise GuiError("Xvfb display startup timed out")
                    if not selector.select(timeout=0.1):
                        continue
                    part = os.read(read_fd, 64)
                    if not part:
                        raise GuiError("Xvfb closed its display readiness pipe")
                    value.extend(part)
                    if len(value) > 32:
                        raise GuiError("Xvfb returned an invalid display number")
            number = bytes(value).strip()
            if not number.isdigit():
                raise GuiError("Xvfb returned an invalid display number")
            socket = Path(f"/tmp/.X11-unix/X{int(number)}")
            if not stat.S_ISSOCK(socket.lstat().st_mode):
                raise GuiError("Xvfb did not create a private X11 socket")
            return ":" + number.decode("ascii")
        finally:
            os.close(read_fd)

    def run_command(self, command, dbus, environment):
        self.check_interrupt()
        self.child = subprocess.Popen([dbus, "--", *command], env=environment,
                                      start_new_session=True)
        while True:
            try:
                code = self.child.wait(timeout=0.1)
                return 128 - code if code < 0 else code
            except subprocess.TimeoutExpired:
                if self.interrupt is not None:
                    # Give the command's signal handler a bounded chance to
                    # finish and preserve its own exit status before cleanup.
                    try:
                        code = self.child.wait(timeout=2)
                        return 128 - code if code < 0 else code
                    except subprocess.TimeoutExpired:
                        raise Interrupted(self.interrupt)
                if self.server.poll() is not None:
                    raise GuiError("Xvfb exited while the GUI command was running")


def main(argv):
    parser = argparse.ArgumentParser(
        prog="omp-gui", description=__doc__,
        usage="%(prog)s -- COMMAND [ARG ...]",
        epilog=("Requires an isolated omp engineer, Xvfb and dbus-run-session. "
                "Each invocation owns one display and session bus until COMMAND exits. "
                "For app + interaction + capture in one display, use e.g. "
                "omp-gui -- sh -c 'xmessage hello & app=$!; sleep 1; "
                "xdotool search --name hello; magick import -window root screenshot.png; "
                "kill \"$app\"; wait \"$app\"'. No host display fallback is available."),
    )
    parser.add_argument("command", nargs=argparse.REMAINDER, help="command and its arguments")
    args = parser.parse_args(argv)
    if not args.command or args.command[0] != "--" or len(args.command) == 1:
        parser.error("a command after -- is required")
    supervisor = Supervisor()
    previous = {}
    try:
        require_namespace()
        xvfb = shutil.which("Xvfb")
        dbus = shutil.which("dbus-run-session")
        if not xvfb or not dbus:
            raise GuiError("Xvfb and dbus-run-session must be installed; refusing host fallback")
        for number in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP, signal.SIGQUIT):
            previous[number] = signal.signal(number, supervisor.handle_signal)
        with tempfile.TemporaryDirectory(prefix="omp-gui-", dir="/tmp") as directory:
            authority = Path(directory) / "Xauthority"
            write_authority(authority)
            environment = display_environment()
            environment["XAUTHORITY"] = str(authority)
            # Server chatter never contaminates command stdout (screenshots and
            # machine-readable results often use it). Keep logs run-scoped.
            with tempfile.TemporaryFile(mode="w+b", dir=directory) as log:
                try:
                    environment["DISPLAY"] = supervisor.start_display(xvfb, environment, authority, log)
                    return supervisor.run_command(args.command[1:], dbus, environment)
                except GuiError:
                    log.seek(0, os.SEEK_END)
                    length = log.tell()
                    log.seek(max(0, length - 4096))
                    diagnostic = log.read().decode("utf-8", errors="replace").strip()
                    if diagnostic:
                        print(diagnostic, file=sys.stderr)
                    raise
                finally:
                    stop_process(supervisor.child)
                    stop_process(supervisor.server)
    except Interrupted as error:
        return 128 + error.number
    except (GuiError, OSError) as error:
        print(f"omp-gui: {error}", file=sys.stderr)
        return 1
    finally:
        for number, handler in previous.items():
            signal.signal(number, handler)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
