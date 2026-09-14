#!/usr/bin/python3
"""Journal and notify about filesystem, host memory, and dev-exec pressure."""
import argparse
import datetime
import json
import os
from pathlib import Path
import subprocess
import time

GIB = 1024**3


def log(level, message):
    timestamp = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    print(f"{timestamp} {level} {message}", flush=True)


def filesystem_pressure(path, usage):
    used = usage.f_blocks - usage.f_bfree
    usable = used + usage.f_bavail
    space = 100 * used / usable if usable else 100.0
    inodes = 100 * (usage.f_files - usage.f_ffree) / usage.f_files if usage.f_files else None
    inode_text = f"{inodes:.1f}%" if inodes is not None else "n/a (dynamic inodes)"
    log("INFO", f"{path}: space={space:.1f}% inodes={inode_text} available={usage.f_bavail * usage.f_frsize} bytes")
    alerts = {}
    if space > 80:
        alerts[f"space:{path}"] = f"{path}: disk usage {space:.1f}% (>80%)"
    if inodes is not None and inodes > 80:
        alerts[f"inodes:{path}"] = f"{path}: inode usage {inodes:.1f}% (>80%)"
    return alerts


def memory_pressure(memory, previous, now, boot):
    used = 100 * (1 - memory["MemAvailable"] / memory["MemTotal"])
    swap = memory["SwapTotal"] - memory["SwapFree"]
    swap_percent = 100 * swap / memory["SwapTotal"] if memory["SwapTotal"] else 0
    growth = 0.0
    elapsed = now - previous.get("sample_time", now)
    # Use same-boot, recent samples only; a restart must not invent a growth rate.
    if previous.get("boot") == boot and 1 <= elapsed <= 180:
        growth = max(0, swap - previous.get("swap", swap)) * 60 / elapsed
    log("INFO", f"RAM={used:.1f}% swap={swap / GIB:.2f} GiB ({swap_percent:.1f}%) swap_growth={growth / GIB:.2f} GiB/min")
    alerts = {}
    if used > 80:
        alerts["ram"] = f"RAM usage {used:.1f}% (>80%, based on MemAvailable)"
    if swap_percent > 80:
        alerts["swap"] = f"Swap usage {swap_percent:.1f}% (>80%)"
    if growth >= GIB:
        alerts["swap-growth"] = f"Swap growing {growth / GIB:.2f} GiB/min (>=1 GiB/min)"
    return alerts, swap


def slice_pressure():
    result = subprocess.run(
        ["systemctl", "--user", "show", "dev-exec.slice", "-p", "ControlGroup"],
        capture_output=True, text=True, check=True, timeout=5,
    )
    group = result.stdout.strip().removeprefix("ControlGroup=")
    if not group:
        log("INFO", "dev-exec.slice inactive; no resident jobs")
        return {}
    root = Path("/sys/fs/cgroup") / group.lstrip("/")
    try:
        current = int((root / "memory.current").read_text())
        high = (root / "memory.high").read_text().strip()
        swap = int((root / "memory.swap.current").read_text())
        peak = (root / "memory.peak").read_text().strip()
    except FileNotFoundError:
        # The last transient job may exit between the lookup and these reads.
        if not root.exists():
            return {}
        raise
    log("INFO", f"dev-exec.slice current={current} peak={peak} high={high} swap={swap} bytes")
    if high != "max" and current >= int(high) * 0.9:
        return {"slice-high": f"dev-exec.slice near MemoryHigh: {current / GIB:.2f}/{int(high) / GIB:.0f} GiB (>=90%)"}
    return {}


def notify(alerts, synthetic=False):
    title = "Workstation pressure TEST" if synthetic else "Workstation pressure"
    body = "\n".join(alerts.values())
    result = subprocess.run(
        ["notify-send", "--app-name=tmp-health", "--urgency=critical", "--expire-time=0",
         "--print-id", title, body],
        capture_output=True, text=True, check=True, timeout=10,
    )
    log("NOTICE", f"notification accepted id={result.stdout.strip()} synthetic={synthetic}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--test-alert", action="store_true", help="deliver a clearly labeled synthetic alert without changing pressure or saved state")
    args = parser.parse_args()
    if args.test_alert:
        alerts = {"test": "Synthetic breach — no load generated.\nDisk/inodes >80%; RAM >80%; swap growth >=1 GiB/min; dev-exec >=90% MemoryHigh."}
        log("WARNING", alerts["test"])
        notify(alerts, synthetic=True)
        return 0

    state_path = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local/state")) / "tmp-health/state.json"
    now = time.monotonic()
    boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
    try:
        previous = json.loads(state_path.read_text())
        if not isinstance(previous, dict):
            raise ValueError("state is not an object")
        for field in ("sample_time", "swap", "last_notified"):
            value = previous.get(field)
            if type(value) not in (int, float) or not 0 <= value < float("inf"):
                raise ValueError(f"state {field} is not a finite nonnegative number")
    except FileNotFoundError:
        previous = {}
    except (OSError, ValueError) as error:
        log("WARNING", f"resetting unreadable health state: {error}")
        previous = {}
    alerts = {}
    failed = False
    for path in (Path("/tmp"), Path.home() / ".cache/tmp"):
        try:
            alerts.update(filesystem_pressure(path, os.statvfs(path)))
        except OSError as error:
            alerts[f"error:{path}"] = f"Cannot inspect {path}: {error}"
            failed = True
    swap = previous.get("swap", 0)
    try:
        memory = {line.split(":")[0]: int(line.split()[1]) * 1024 for line in Path("/proc/meminfo").read_text().splitlines()}
        memory_alerts, swap = memory_pressure(memory, previous, now, boot)
        alerts.update(memory_alerts)
        alerts.update(slice_pressure())
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        alerts["error:memory"] = f"Cannot inspect memory pressure: {error}"
        failed = True
    for message in alerts.values():
        log("WARNING", message)
    keys = sorted(alerts)
    last_notified = previous.get("last_notified", 0)
    if alerts and (previous.get("boot") != boot or keys != previous.get("notified_keys") or now - last_notified >= 900):
        try:
            notify(alerts)
            last_notified = now
        except (OSError, subprocess.SubprocessError) as error:
            log("ERROR", f"notification delivery failed, will retry next check: {error}")
            keys = []
            failed = True
    state_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = state_path.with_suffix(".tmp")
    temporary.write_text(json.dumps({"boot": boot, "sample_time": now, "swap": swap, "notified_keys": keys, "last_notified": last_notified}) + "\n")
    temporary.replace(state_path)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
