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
HIGH = 80.0
CLEAR = 75.0
SLICE_FIRE = 0.9
SLICE_CLEAR = 0.8
COOLDOWN_SEC = 900


def log(level, message):
    timestamp = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    print(f"{timestamp} {level} {message}", flush=True)


def latch_level(value, high, clear, was_latched, fire_inclusive=False):
    if value is None:
        return False
    fired = value >= high if fire_inclusive else value > high
    if fired:
        return True
    return bool(was_latched) and value >= clear


def due_keys(latched_now, latched_prev, now, rate_keys=(), cooldown=COOLDOWN_SEC):
    due = []
    rate_keys = set(rate_keys)
    for key in latched_now:
        last = latched_prev.get(key, None)
        if key not in latched_prev or last is None:
            due.append(key)
            continue
        if key in rate_keys and now - last >= cooldown:
            due.append(key)
    return due


def should_replace(latched_now, latched_prev, due):
    if not latched_now:
        return False
    if due:
        return True
    return set(latched_now) != set(latched_prev)


def apply_latch(candidates, was_latched):
    latched = {}
    for key, spec in candidates.items():
        was = key in was_latched
        kind = spec["kind"]
        if kind == "level":
            if latch_level(spec["value"], spec["high"], spec["clear"], was, spec.get("fire_inclusive", False)):
                latched[key] = spec["message"]
        elif kind == "rate":
            if spec["active"]:
                latched[key] = spec["message"]
        else:
            latched[key] = spec["message"]
    return latched


def filesystem_candidates(path, usage):
    used = usage.f_blocks - usage.f_bfree
    usable = used + usage.f_bavail
    space = 100 * used / usable if usable else 100.0
    inodes = 100 * (usage.f_files - usage.f_ffree) / usage.f_files if usage.f_files else None
    inode_text = f"{inodes:.1f}%" if inodes is not None else "n/a (dynamic inodes)"
    log("INFO", f"{path}: space={space:.1f}% inodes={inode_text} available={usage.f_bavail * usage.f_frsize} bytes")
    candidates = {
        f"space:{path}": {
            "kind": "level",
            "value": space,
            "high": HIGH,
            "clear": CLEAR,
            "message": f"{path}: disk usage {space:.1f}% (>{HIGH:.0f}%, clear <{CLEAR:.0f}%)",
        }
    }
    if inodes is not None:
        candidates[f"inodes:{path}"] = {
            "kind": "level",
            "value": inodes,
            "high": HIGH,
            "clear": CLEAR,
            "message": f"{path}: inode usage {inodes:.1f}% (>{HIGH:.0f}%, clear <{CLEAR:.0f}%)",
        }
    return candidates


def memory_candidates(memory, previous, now, boot):
    used = 100 * (1 - memory["MemAvailable"] / memory["MemTotal"])
    swap = memory["SwapTotal"] - memory["SwapFree"]
    swap_percent = 100 * swap / memory["SwapTotal"] if memory["SwapTotal"] else 0
    growth = 0.0
    elapsed = now - previous.get("sample_time", now)
    if previous.get("boot") == boot and 1 <= elapsed <= 180:
        growth = max(0, swap - previous.get("swap", swap)) * 60 / elapsed
    log("INFO", f"RAM={used:.1f}% swap={swap / GIB:.2f} GiB ({swap_percent:.1f}%) swap_growth={growth / GIB:.2f} GiB/min")
    return {
        "ram": {
            "kind": "level",
            "value": used,
            "high": HIGH,
            "clear": CLEAR,
            "message": f"RAM usage {used:.1f}% (>{HIGH:.0f}%, based on MemAvailable, clear <{CLEAR:.0f}%)",
        },
        "swap": {
            "kind": "level",
            "value": swap_percent,
            "high": HIGH,
            "clear": CLEAR,
            "message": f"Swap usage {swap_percent:.1f}% (>{HIGH:.0f}%, clear <{CLEAR:.0f}%)",
        },
        "swap-growth": {
            "kind": "rate",
            "active": growth >= GIB,
            "message": f"Swap growing {growth / GIB:.2f} GiB/min (>=1 GiB/min)",
        },
    }, swap


def slice_candidates():
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
        if not root.exists():
            return {}
        raise
    log("INFO", f"dev-exec.slice current={current} peak={peak} high={high} swap={swap} bytes")
    if high == "max":
        return {}
    high_bytes = int(high)
    ratio = 100 * current / high_bytes if high_bytes else 100.0
    return {
        "slice-high": {
            "kind": "level",
            "value": ratio,
            "high": SLICE_FIRE * 100,
            "clear": SLICE_CLEAR * 100,
            "fire_inclusive": True,
            "message": (
                f"dev-exec.slice near MemoryHigh: {current / GIB:.2f}/{high_bytes / GIB:.0f} GiB "
                f"(>={SLICE_FIRE * 100:.0f}%, clear <{SLICE_CLEAR * 100:.0f}%)"
            ),
        }
    }


def finite_nonnegative(value):
    return type(value) in (int, float) and 0 <= value < float("inf")


def load_state(state_path, boot):
    try:
        previous = json.loads(state_path.read_text())
        if not isinstance(previous, dict):
            raise ValueError("state is not an object")
        for field in ("sample_time", "swap"):
            if not finite_nonnegative(previous.get(field)):
                raise ValueError(f"state {field} is not a finite nonnegative number")
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as error:
        log("WARNING", f"resetting unreadable health state: {error}")
        return {}
    if previous.get("boot") != boot:
        return {"sample_time": previous.get("sample_time", 0), "swap": previous.get("swap", 0)}
    latched = previous.get("latched")
    if not isinstance(latched, dict):
        keys = previous.get("notified_keys")
        last = previous.get("last_notified", 0)
        if isinstance(keys, list) and finite_nonnegative(last):
            latched = {key: last for key in keys if isinstance(key, str)}
        else:
            latched = {}
    cleaned = {}
    for key, last in latched.items():
        if not isinstance(key, str):
            continue
        if last is None or finite_nonnegative(last):
            cleaned[key] = last
    previous["latched"] = cleaned
    notify_id = previous.get("notify_id")
    if notify_id is not None and not (isinstance(notify_id, int) and notify_id >= 0):
        previous["notify_id"] = None
    return previous


def notify(alerts, synthetic=False, replace_id=None):
    title = "Workstation pressure TEST" if synthetic else "Workstation pressure"
    body = "\n".join(alerts.values())
    command = [
        "notify-send", "--app-name=tmp-health", "--urgency=critical",
        "--expire-time=0", "--print-id",
    ]
    if replace_id is not None:
        command.append(f"--replace-id={int(replace_id)}")
    command.extend([title, body])
    result = subprocess.run(
        command, capture_output=True, text=True, check=True, timeout=10,
    )
    notify_id = int(result.stdout.strip())
    log("NOTICE", f"notification accepted id={notify_id} synthetic={synthetic} replace={replace_id is not None}")
    return notify_id


def close_notification(notify_id):
    result = subprocess.run(
        [
            "gdbus", "call", "--session",
            "--dest", "org.freedesktop.Notifications",
            "--object-path", "/org/freedesktop/Notifications",
            "--method", "org.freedesktop.Notifications.CloseNotification",
            str(int(notify_id)),
        ],
        capture_output=True, text=True, timeout=10,
    )
    if result.returncode != 0:
        raise subprocess.SubprocessError(result.stderr.strip() or "CloseNotification failed")
    log("NOTICE", f"notification closed id={int(notify_id)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--test-alert",
        action="store_true",
        help="deliver a clearly labeled synthetic alert without changing pressure or saved state",
    )
    args = parser.parse_args()
    if args.test_alert:
        alerts = {
            "test": (
                "Synthetic breach — no load generated.\n"
                "Disk/inodes >80%; RAM >80%; swap growth >=1 GiB/min; dev-exec >=90% MemoryHigh."
            )
        }
        log("WARNING", alerts["test"])
        notify(alerts, synthetic=True)
        return 0

    state_path = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local/state")) / "tmp-health/state.json"
    now = time.monotonic()
    boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
    previous = load_state(state_path, boot)
    was_latched = previous.get("latched", {})
    candidates = {}
    failed = False
    for path in (Path("/tmp"), Path.home() / ".cache/tmp"):
        try:
            candidates.update(filesystem_candidates(path, os.statvfs(path)))
        except OSError as error:
            candidates[f"error:{path}"] = {
                "kind": "error",
                "message": f"Cannot inspect {path}: {error}",
            }
            failed = True
    swap = previous.get("swap", 0)
    try:
        memory = {
            line.split(":")[0]: int(line.split()[1]) * 1024
            for line in Path("/proc/meminfo").read_text().splitlines()
        }
        memory, swap = memory_candidates(memory, previous, now, boot)
        candidates.update(memory)
        candidates.update(slice_candidates())
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        candidates["error:memory"] = {
            "kind": "error",
            "message": f"Cannot inspect memory pressure: {error}",
        }
        failed = True

    alerts = apply_latch(candidates, was_latched)
    for message in alerts.values():
        log("WARNING", message)
    rate_keys = {key for key, spec in candidates.items() if spec.get("kind") == "rate"}
    due = due_keys(alerts, was_latched, now, rate_keys)
    notify_id = previous.get("notify_id")
    latched_times = {key: was_latched[key] if key in was_latched else None for key in alerts}
    if should_replace(alerts, was_latched, due):
        try:
            notify_id = notify(alerts, replace_id=notify_id)
            for key in due:
                latched_times[key] = now
        except (OSError, subprocess.SubprocessError, ValueError) as error:
            log("ERROR", f"notification delivery failed, will retry next check: {error}")
            failed = True
    elif not alerts and notify_id is not None:
        try:
            close_notification(notify_id)
            notify_id = None
        except (OSError, subprocess.SubprocessError, ValueError) as error:
            log("ERROR", f"notification close failed, will retry next check: {error}")
            failed = True

    state_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = state_path.with_suffix(".tmp")
    temporary.write_text(
        json.dumps({
            "boot": boot,
            "sample_time": now,
            "swap": swap,
            "latched": latched_times,
            "notify_id": notify_id,
        })
        + "\n"
    )
    temporary.replace(state_path)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
