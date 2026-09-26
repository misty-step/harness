#!/usr/bin/env python3
# owned by misty-step/harness agent-config desktop-guard
"""Prepare or explicitly trigger a one-shot native fleet cutover. Never scheduled."""
import argparse
import hashlib
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import signal
import stat
import subprocess
import sys
import tempfile
import time

from cutover_transaction import Transaction
import cutover_inventory as inventory

HOME = Path.home()
STATE = HOME / ".local/state/desktop-guard"
STAGE = HOME / ".local/share/desktop-guard/staged"
CLI = HOME / ".local/bin/desktop-guard"
UNIT = "desktop-guard-cutover.service"
LOG = STATE / "cutover.log"
PLAN = STATE / "plan.json"
ACTIVE = STATE / "active.json"
NAMES = ("dev.slice", "dev-fleet.slice", "dev-exec.slice", "herdr@.service")
HOOK = '\n-- desktop-guard US-043\ndofile(os.getenv("HOME") .. "/.local/share/desktop-guard/staged/hypr/herdr.lua")\n'
loader = importlib.machinery.SourceFileLoader("desktop_guard", str(CLI))
spec = importlib.util.spec_from_loader(loader.name, loader)
guard = importlib.util.module_from_spec(spec)
loader.exec_module(guard)


def log(message):
    line = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) + " " + message
    print(line, flush=True)
    if os.environ.get("DESKTOP_GUARD_LOG_CAPTURED") != "1" and STATE.is_dir():
        fd = os.open(LOG, os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "w") as stream:
            stream.write(line + "\n")


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.NamedTemporaryFile(mode="w", prefix="." + path.name + ".", dir=path.parent, delete=False) as stream:
        temporary = stream.name
        json.dump(value, stream, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def private_directory(path):
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise RuntimeError(f"Not a private owned directory: {path}")


def fingerprint(path):
    try:
        info = path.lstat()
    except FileNotFoundError:
        return None
    mode = stat.S_IMODE(info.st_mode)
    if stat.S_ISLNK(info.st_mode):
        return ["link", os.readlink(path)]
    if stat.S_ISREG(info.st_mode):
        return ["file", mode, hashlib.sha256(path.read_bytes()).hexdigest()]
    if stat.S_ISDIR(info.st_mode):
        return ["directory", mode, {p.name: fingerprint(p) for p in sorted(path.iterdir())}]
    raise RuntimeError(f"Unsupported configuration node: {path}")


def paths():
    units = HOME / ".config/systemd/user"
    result = [units / suffix for name in NAMES for suffix in (name, name + ".d")]
    return result + [HOME / ".config/hypr/bindings.local.lua",
                     units / "graphical-session.target.wants/herdr@default.service"]


def sources():
    return [CLI, *sorted(Path(__file__).parent.glob("*.py")), STAGE / "hypr/herdr.lua",
            *[STAGE / "systemd/user" / name for name in NAMES]]


def read_state():
    return json.loads(ACTIVE.read_text()) if ACTIVE.exists() else None


def command(argv, timeout=30):
    return guard.command([str(arg) for arg in argv], timeout=timeout, env=guard.native_env())


def identity():
    running, socket_path = guard.server_status("default")
    if not running:
        raise RuntimeError("Default Herdr server is not running")
    pid, uid, _ = guard.peer_credentials(socket_path)
    if uid != os.getuid():
        raise RuntimeError("Default server is not owned by this user")
    tick = Path(f"/proc/{pid}/stat").read_text().rpartition(")")[2].split()[19]
    return {"pid": pid, "start_tick": tick, "cgroup": guard.process_group(pid)}


def empty_development():
    root = guard.user_root()
    path = guard.CGROUP / guard.slice_path("dev.slice", root).lstrip("/")
    if path.exists():
        for procs in path.rglob("cgroup.procs"):
            if procs.read_text().strip():
                raise RuntimeError(f"Development workload remains: {procs.parent}")


def graphical_check():
    errors = command(["/usr/bin/hyprctl", "configerrors"]).strip()
    if errors:
        raise RuntimeError("Hyprland reports configuration errors: " + errors)


def baseline_check(plan):
    guard.verified_herdr_binary()
    if identity() != plan["server"]:
        raise RuntimeError("Default server changed since preparation; prepare again")
    if "/dev.slice/" in plan["server"]["cgroup"]:
        raise RuntimeError("Prepared server is already in a development slice")
    for name, expected in plan["files"].items():
        if fingerprint(Path(name)) != expected:
            raise RuntimeError(f"Configuration or staged source changed since preparation: {name}")
    empty_development()
    for row in json.loads(command([guard.SYSTEMCTL, "--user", "list-units", "--all", "--output=json", "herdr@*.service"])):
        if row["active"] not in ("inactive", "failed"):
            raise RuntimeError("Another managed Herdr service is active: " + row["unit"])
    guard.assert_oomd_safe(guard.slice_path("dev-fleet.slice", guard.user_root()))
    for name in NAMES:
        properties = guard.systemd_show(name.replace("@.", "@default."), "DropInPaths", "FragmentPath")
        original = HOME / ".config/systemd/user" / name
        if properties["FragmentPath"] and properties["FragmentPath"] != str(original):
            raise RuntimeError(f"Unreviewed unit source: {properties['FragmentPath']}")
        for path in shlex.split(properties["DropInPaths"]):
            if not path.startswith(str(original) + ".d/"):
                raise RuntimeError(f"Unreviewed unit override: {path}")
    graphical_check()


def snapshot(destination):
    captured = inventory.capture(destination, guard.native_env())
    temporary = STATE / f".resume-{time.time_ns()}"
    os.symlink(os.path.relpath(destination / "resume.md", STATE), temporary)
    os.replace(temporary, STATE / "resume.md")
    if captured["blockers"]:
        raise RuntimeError("Recovery inventory incomplete: " + "; ".join(captured["blockers"]))
    return captured


def prepare():
    private_directory(STATE)
    if read_state() and read_state()["result"] not in ("SUCCESS", "ROLLED_BACK", "PREFLIGHT_FAILED"):
        raise RuntimeError("An unfinished cutover needs recovery before preparing another")
    binding = paths()[-2]
    if binding.is_symlink() or (binding.exists() and not binding.is_file()):
        raise RuntimeError("Private binding must be a regular file or absent; never modify a workbench symlink")
    if binding.exists() and b"desktop-guard" in binding.read_bytes():
        raise RuntimeError("A desktop guard hook already exists; reconcile before preparing")
    plan = {"server": identity(), "files": {str(p): fingerprint(p) for p in paths() + sources()},
            "prepared_at": time.time()}
    baseline_check(plan)
    captured = snapshot(Path(tempfile.mkdtemp(prefix="prepared-", dir=STATE)))
    save(PLAN, plan)
    if ACTIVE.exists():
        ACTIVE.rename(STATE / f"previous-{time.time_ns()}.json")
    log(f"PREPARED; {len(captured['engineers'])} engineers; nothing activated")
    log(f"Resume notes: {STATE / 'resume.md'}")
    log(f"Trigger only when authorized: {Path(__file__).resolve()} launch")
    log(f"Result log: {LOG}")


def changes():
    units = HOME / ".config/systemd/user"
    result = {units / name: (STAGE / "systemd/user" / name).read_bytes() for name in NAMES}
    result.update({units / (name + ".d"): None for name in NAMES})
    binding = HOME / ".config/hypr/bindings.local.lua"
    result[binding] = (binding.read_bytes() if binding.exists() else b"") + HOOK.encode()
    result[units / "graphical-session.target.wants/herdr@default.service"] = "../herdr@.service"
    return result


def outside_fleet():
    expected = guard.user_root() + "/background.slice/" + UNIT
    if guard.process_group(os.getpid()) != expected:
        raise RuntimeError("Cutover/recovery must run in its dedicated background.slice user service")


def launch():
    private_directory(STATE)
    if not PLAN.is_file() or ACTIVE.exists():
        raise RuntimeError("No unused preparation; run prepare and inspect its result first")
    flags = [guard.SYSTEMD_RUN, "--user", "--collect", "--unit=" + UNIT,
             "--property=Type=oneshot", "--property=Slice=background.slice",
             "--property=TimeoutStartSec=600", "--property=TimeoutStopSec=300",
             "--property=MemoryMax=512M", "--property=MemorySwapMax=0", "--property=OOMPolicy=kill",
             "--property=UMask=0077", "--property=Restart=no",
             "--setenv=DESKTOP_GUARD_LOG_CAPTURED=1",
             "--property=StandardOutput=append:" + str(LOG), "--property=StandardError=inherit",
             "--property=ExecStopPost=" + shlex.join(["/usr/bin/python3", str(Path(__file__).resolve()), "recover"])]
    if LOG.exists() and (LOG.is_symlink() or not LOG.is_file()):
        raise RuntimeError("Refusing non-regular result log")
    fd = os.open(LOG, os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o600)
    os.close(fd)
    for name in ("DISPLAY", "WAYLAND_DISPLAY", "HYPRLAND_INSTANCE_SIGNATURE", "XDG_CURRENT_DESKTOP"):
        if name in os.environ:
            flags.append("--setenv=" + name + "=" + os.environ[name])
    subprocess.run(flags + ["/usr/bin/python3", str(Path(__file__).resolve()), "run"], check=True,
                   env=guard.native_env())
    log(f"Submitted independent user service {UNIT}; result log {LOG}")


def admission_check(directory):
    release = directory / "jobs-release"
    marker = directory / "third-job-ran"
    jobs = []
    program = ("import json,os,pathlib,sys,time; p=pathlib.Path(sys.argv[1]); "
               "p.write_text(json.dumps({'pid':os.getpid()})); end=time.monotonic()+30; "
               "exec('while not pathlib.Path(sys.argv[2]).exists() and time.monotonic()<end: time.sleep(.1)')")
    try:
        for index in (1, 2):
            ready = directory / f"job-{index}.json"
            jobs.append(subprocess.Popen([str(CLI), "run", "--", "/usr/bin/python3", "-c", program,
                                          str(ready), str(release)], env=guard.native_env()))
            deadline = time.monotonic() + 8
            while not ready.exists():
                if jobs[-1].poll() is not None or time.monotonic() > deadline:
                    raise RuntimeError("A bounded admission probe did not become ready")
                time.sleep(.1)
            pid = json.loads(ready.read_text())["pid"]
            group = guard.process_group(pid)
            prefix = guard.slice_path("dev-exec.slice", guard.user_root()) + "/dev-job-"
            if group not in (prefix + "1.scope", prefix + "2.scope"):
                raise RuntimeError("Admission probe escaped the job scopes")
            guard.assert_group_limits(group, guard.JOB_LIMITS, "Admission probe")
        result = subprocess.run([str(CLI), "run", "--", "/usr/bin/touch", str(marker)],
                                env=guard.native_env(), timeout=5, check=False)
        if result.returncode != 75 or marker.exists():
            raise RuntimeError("Third job was not promptly refused without execution")
        log("PASS two bounded jobs; third refused with exit 75 and no workload")
    finally:
        release.touch(mode=0o600)
        for process in jobs:
            process.wait(timeout=35)


def client_attached(managed):
    """Corroborate an established native UI socket, not terminal submission."""
    running, api_socket = guard.server_status("default")
    if not running:
        return False
    server = identity()
    client_socket = str(Path(api_socket).with_name("herdr-client.sock"))
    rows = [line.split(None, 8) for line in command(["/usr/bin/ss", "-H", "-xnp"]).splitlines()]
    peers = {row[7] for row in rows if len(row) == 9 and row[1] == "ESTAB"
             and row[4] == client_socket and f"pid={server['pid']}," in row[8]}
    allowed_groups = set()
    if managed:
        for row in json.loads(command([guard.SYSTEMCTL, "--user", "list-units", "--output=json",
                                       "desktop-guard-client-*.scope"])):
            if row["active"] != "active":
                continue
            props = guard.systemd_show(row["unit"], "BindsTo")
            if "herdr@default.service" in props["BindsTo"].split():
                allowed_groups.add(props["ControlGroup"])
    for row in rows:
        if len(row) != 9 or row[1] != "ESTAB" or row[5] not in peers:
            continue
        for value in re.findall(r'\("herdr",pid=(\d+),', row[8]):
            pid = int(value)
            try:
                if os.readlink(f"/proc/{pid}/exe") != guard.HERDR:
                    continue
                if managed and guard.process_group(pid) not in allowed_groups:
                    continue
                return True
            except (OSError, guard.GuardError):
                continue
    return False


def verify_fleet(before, directory, managed):
    deadline = time.monotonic() + 100
    last_errors = []
    resumed = set()
    while True:
        after = inventory.capture(directory / f"attempt-{time.time_ns()}", guard.native_env())
        # Native Herdr restores OMP transcript references. Hermes' native TUI
        # records its session separately; start only an identified shell fallback.
        panes = {pane["pane_id"]: pane for pane in after["panes"]}
        for index, engineer in enumerate(before["engineers"]):
            if engineer["agent_session"] is not None or engineer["kind"] != "hermes":
                continue
            pane = panes.get(engineer["pane_id"])
            if pane and pane["classification"].startswith("shell_only") and index not in resumed:
                resumed.add(index)
                name = engineer["name"] or f"guard-resume-{index}"
                command([guard.HERDR, "agent", "start", name, "--kind", engineer["kind"],
                         "--pane", pane["pane_id"], "--", *engineer["resume_argv"][1:]], timeout=45)
                after = inventory.capture(directory / f"attempt-{time.time_ns()}", guard.native_env())
        last_errors = inventory.verify_inventory(before, after)
        if not client_attached(managed):
            last_errors.append("No independently verified native client attachment")
        if not last_errors:
            if managed:
                guard.verify_running("default", guard.user_root(), guard.server_status("default"))
                group = guard.slice_path("dev-fleet.slice", guard.user_root()) + "/herdr@default.service"
                for pane in after["panes"]:
                    for process in pane["process"]["foreground_processes"]:
                        if guard.process_group(process["pid"]) != group:
                            raise RuntimeError("Restored foreground process escaped managed fleet")
            log(f"PASS restored {len(after['engineers'])} engineers with matching transcript identities")
            return
        if time.monotonic() >= deadline:
            raise RuntimeError("Fleet restoration failed: " + "; ".join(last_errors))
        time.sleep(2)


def run():
    outside_fleet()
    lock = guard.lock_slot(guard.runtime_lock_dir() / "cutover.lock")
    if lock is None:
        raise RuntimeError("Another cutover holds the transaction lock")
    job_locks = []
    state = None
    try:
        if ACTIVE.exists():
            raise RuntimeError("This preparation has already been used")
        plan = json.loads(PLAN.read_text())
        baseline_check(plan)
        for number in (1, 2):
            fd = guard.lock_slot(guard.runtime_lock_dir() / f"job-{number}.lock")
            if fd is None:
                raise RuntimeError("A local job is active; cutover refused before interruption")
            job_locks.append(fd)
        empty_development()
        directory = Path(tempfile.mkdtemp(prefix="cutover-", dir=STATE))
        state = {"directory": str(directory), "phase": "preflight", "result": "RUNNING", "server": plan["server"]}
        save(ACTIVE, state)
        before = snapshot(directory / "before")
        transaction = Transaction(directory / "configuration")
        transaction.prepare(changes())
        baseline_check(plan)
        state["phase"] = "stopping-old-server"
        save(ACTIVE, state)
        log("Stopping old default server; durable recovery inventory and configuration snapshot complete")
        command([guard.HERDR, "server", "stop"])
        deadline = time.monotonic() + 20
        while guard.server_status("default")[0]:
            if identity() != state["server"] or time.monotonic() >= deadline:
                raise RuntimeError("Old server did not stop, or another server replaced it")
            time.sleep(.2)
        empty_development()
        transaction.apply()
        command([guard.SYSTEMCTL, "--user", "daemon-reload"])
        guard.start("default")
        state["phase"] = "managed-started"
        state["managed_server"] = identity()
        save(ACTIVE, state)
        command(["/usr/bin/hyprctl", "reload"])
        graphical_check()
        command(["/usr/bin/luac", "-p", HOME / ".config/hypr/bindings.local.lua"])
        for fd in job_locks:
            os.close(fd)
        job_locks.clear()
        admission_check(directory)
        command(["/usr/share/omarchy/bin/omarchy-launch-terminal", str(CLI), "attach"], timeout=15)
        verify_fleet(before, directory / "after", True)
        if command([guard.SYSTEMCTL, "--user", "is-enabled", "herdr@default.service"]).strip() != "enabled":
            raise RuntimeError("Managed service is not enabled for graphical-session startup")
        transaction.check_rollback()  # No foreign edits occurred during activation.
        guard.verify_running("default", guard.user_root(), guard.server_status("default"))
        state.update(phase="complete", result="SUCCESS")
        save(ACTIVE, state)
        log(f"RESULT SUCCESS: managed fleet verified; resume notes {directory / 'before/resume.md'}")
    except BaseException as error:
        log(f"Cutover failed: {type(error).__name__}: {error}")
        if state is None:
            log("RESULT PREFLIGHT_FAILED: no destructive transition began")
        if state and state["phase"] == "preflight":
            state["result"] = "PREFLIGHT_FAILED"
            save(ACTIVE, state)
            log("RESULT PREFLIGHT_FAILED: old fleet was not interrupted")
        raise
    finally:
        for fd in job_locks:
            os.close(fd)
        os.close(lock)


def recover():
    outside_fleet()
    lock = guard.lock_slot(guard.runtime_lock_dir() / "cutover.lock")
    if lock is None:
        raise RuntimeError("Another cutover holds the transaction lock; recovery did not mutate anything")
    try:
        recover_locked()
    finally:
        os.close(lock)


def recover_locked():
    state = read_state()
    if not state or state["result"] in ("SUCCESS", "ROLLED_BACK", "PREFLIGHT_FAILED"):
        log("Recovery: no incomplete destructive transition")
        return
    if state["phase"] == "preflight":
        state["result"] = "PREFLIGHT_FAILED"
        save(ACTIVE, state)
        log("RESULT PREFLIGHT_FAILED: old fleet was not interrupted")
        return
    directory = Path(state["directory"])
    transaction = Transaction(directory / "configuration")
    job_locks = []
    try:
        transaction.check_rollback()
        # A SIGKILL bypasses Python finally blocks. Release only our tiny probes;
        # their own 30-second deadline also prevents orphaned acceptance jobs.
        (directory / "jobs-release").touch(mode=0o600)
        deadline = time.monotonic() + 35
        for number in (1, 2):
            while True:
                fd = guard.lock_slot(guard.runtime_lock_dir() / f"job-{number}.lock")
                if fd is not None:
                    job_locks.append(fd)
                    break
                if time.monotonic() >= deadline:
                    raise RuntimeError("A local job blocks recovery; no unrelated job was stopped")
                time.sleep(.2)
        props = guard.systemd_show("herdr@default.service", "MainPID")
        if props["ActiveState"] in ("active", "activating", "failed"):
            if props["ActiveState"] == "active":
                guard.managed_server("default", guard.user_root(), guard.server_status("default"))
                if state.get("managed_server") and identity() != state["managed_server"]:
                    raise RuntimeError("Managed server changed during cutover; refusing to stop it")
            command([guard.SYSTEMCTL, "--user", "stop", "herdr@default.service"])
        elif (guard.server_status("default")[0] and identity() != state["server"]
              and state["phase"] != "restoring-native"):
            raise RuntimeError("Another unmanaged server appeared; refusing to replace it")
        while True:
            try:
                empty_development()
                break
            except RuntimeError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(.2)
        transaction.rollback()
        # Empty slices can be stopped safely; do not leave live cgroups carrying the new limits.
        for unit in ("dev-fleet.slice", "dev-exec.slice", "dev.slice"):
            if guard.systemd_show(unit)["ActiveState"] == "active":
                command([guard.SYSTEMCTL, "--user", "stop", unit])
        command([guard.SYSTEMCTL, "--user", "daemon-reload"])
        command(["/usr/bin/hyprctl", "reload"])
        graphical_check()
        state["phase"] = "restoring-native"
        save(ACTIVE, state)
        if not guard.server_status("default")[0]:
            command(["/usr/share/omarchy/bin/omarchy-launch-terminal-herdr"], timeout=15)
        before = json.loads((directory / "before/inventory.json").read_text())
        verify_fleet(before, directory / "rollback-fleet", False)
        state.update(phase="recovered", result="ROLLED_BACK")
        save(ACTIVE, state)
        log(f"RESULT ROLLED_BACK: original configuration and native fleet verified; resume notes {directory / 'before/resume.md'}")
    except BaseException as error:
        state["result"] = "MANUAL_RECOVERY_REQUIRED"
        save(ACTIVE, state)
        log(f"RESULT MANUAL_RECOVERY_REQUIRED: {type(error).__name__}: {error}; preserved backup {directory}")
        raise
    finally:
        for fd in job_locks:
            os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "check", "launch", "run", "recover"))
    action = parser.parse_args().action
    os.umask(0o077)
    try:
        if action == "prepare":
            prepare()
        elif action == "check":
            baseline_check(json.loads(PLAN.read_text()))
            snapshot(Path(tempfile.mkdtemp(prefix="checked-", dir=STATE)))
            log("PASS read-only preflight; no service or live configuration changed")
        elif action == "launch":
            launch()
        elif action == "run":
            def interrupted(signum, frame):
                raise RuntimeError(f"Interrupted by signal {signum}; systemd ExecStopPost owns recovery")
            signal.signal(signal.SIGTERM, interrupted)
            signal.signal(signal.SIGINT, interrupted)
            run()
        else:
            recover()
        return 0
    except BaseException as error:
        log(f"ERROR {type(error).__name__}: {error}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
