#!/usr/bin/env python3
# owned by misty-step/harness agent-config desktop-guard
"""Capture native Herdr recovery identities without touching the running session."""

import json
import os
from pathlib import Path
import shlex
import sqlite3
import stat
import subprocess
from datetime import datetime, timezone
from collections import Counter


HERDR = "/usr/bin/herdr"


def _herdr(args: list[str], env: dict) -> dict:
    clean_env = {key: value for key, value in env.items() if not key.startswith("HERDR_")}
    try:
        completed = subprocess.run(
            [HERDR, *args], env=clean_env, capture_output=True, text=True, timeout=15,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ValueError(f"Herdr {' '.join(args)} unavailable: {type(error).__name__}") from error
    if completed.returncode:
        # Native stderr may include paths or private data; keep only the exit status.
        raise ValueError(f"Herdr {' '.join(args)} exited {completed.returncode}")
    try:
        result = json.loads(completed.stdout)["result"]
    except (ValueError, KeyError, TypeError) as error:
        raise ValueError(f"Herdr {' '.join(args)} returned invalid JSON") from error
    if not isinstance(result, dict):
        raise ValueError(f"Herdr {' '.join(args)} returned an invalid result")
    return result


def _rows(result: dict, key: str, command: str) -> list[dict]:
    rows = result.get(key)
    if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
        raise ValueError(f"Herdr {command} did not return {key} rows")
    return rows


def _process(pane_id: str, env: dict) -> dict:
    info = _herdr(["pane", "process-info", "--pane", pane_id], env).get("process_info")
    if not isinstance(info, dict) or info.get("pane_id") != pane_id:
        raise ValueError(f"Herdr process-info mismatched pane {pane_id}")
    processes = info.get("foreground_processes")
    if not isinstance(processes, list):
        raise ValueError(f"Herdr process-info omitted foreground processes for {pane_id}")
    foreground = []
    for item in processes:
        if not isinstance(item, dict) or not isinstance(item.get("pid"), int) or item["pid"] <= 0:
            raise ValueError(f"Herdr process-info returned an invalid PID for {pane_id}")
        foreground.append({key: item.get(key) for key in ("pid", "name", "cwd")})
    if not isinstance(info.get("shell_pid"), int) or not isinstance(info.get("foreground_process_group_id"), int):
        raise ValueError(f"Herdr process-info omitted process identity for {pane_id}")
    return {
        "shell_pid": info["shell_pid"],
        "foreground_process_group_id": info["foreground_process_group_id"],
        "foreground_processes": foreground,
    }


def _hermes_session(process: dict, cwd: str, env: dict) -> tuple[dict, list[str]]:
    """Use the per-TUI active-session breadcrumb, never a 'latest' DB guess."""
    signals = set()
    for item in process["foreground_processes"]:
        try:
            # Only read two selected keys from the exact native foreground PID.
            data = (Path("/proc") / str(item["pid"]) / "environ").read_bytes()
        except OSError:
            continue
        fields = dict(part.split(b"=", 1) for part in data.split(b"\0") if b"=" in part)
        session_file = fields.get(b"HERMES_TUI_ACTIVE_SESSION_FILE")
        home = fields.get(b"HERMES_HOME")
        if session_file and home:
            signals.add((os.fsdecode(session_file), os.fsdecode(home)))
    if len(signals) != 1:
        raise ValueError("Hermes foreground process has no unique active-session file and profile")
    session_file, profile_home = signals.pop()
    path = Path(session_file)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as stream:
        metadata = os.fstat(stream.fileno())
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid() or metadata.st_mode & 0o077:
            raise ValueError("Hermes active-session file is not a private owned regular file")
        if not 0 < metadata.st_size <= 4096:
            raise ValueError("Hermes active-session file is empty or unexpectedly large")
        content = stream.read(4097)
        if os.fstat(stream.fileno()).st_mtime_ns != metadata.st_mtime_ns or len(content) != metadata.st_size:
            raise ValueError("Hermes active-session file changed during capture")
    reference = json.loads(content)
    if not isinstance(reference, dict) or not isinstance(reference.get("session_id"), str):
        raise ValueError("Hermes active-session file has no session ID")
    session_id = reference["session_id"].strip()
    if not session_id or session_id in ("latest", "default"):
        raise ValueError("Hermes active-session ID is not explicit")

    profile = Path(profile_home)
    root = Path(env.get("HOME") or str(Path.home())) / ".hermes"
    if profile == root:
        profile_name = "default"
    elif profile.parent == root / "profiles" and profile.name:
        profile_name = profile.name
    else:
        raise ValueError("Hermes process profile cannot be selected by its native CLI")
    try:
        connection = sqlite3.connect(f"file:{profile / 'state.db'}?mode=ro", uri=True, timeout=2)
        try:
            row = connection.execute(
                "SELECT source, cwd, profile_name, ended_at, message_count FROM sessions WHERE id = ?",
                (session_id,),
            ).fetchone()
        finally:
            connection.close()
    except sqlite3.Error as error:
        raise ValueError("Hermes profile session store is not readable") from error
    if row is None or row[0] != "tui" or row[1] != cwd or row[3] is not None or row[4] <= 0:
        raise ValueError("Hermes active-session ID has no usable, live transcript in its profile")
    if row[2] and row[2] != profile_name:
        raise ValueError("Hermes active-session profile disagrees with the profile store")
    transcript = {"kind": "id", "value": session_id, "session_store": str(profile / "state.db"),
                  "profile_home": str(profile)}
    argv = ["hermes", "--profile", profile_name, "--tui", "--in", cwd, "--resume", session_id]
    return transcript, argv


def _recovery(agent: dict, env: dict, blockers: list[str]) -> None:
    kind = agent["kind"]
    cwd = agent["foreground_cwd"] or agent["cwd"]
    pane = agent["pane_id"]
    if not isinstance(cwd, str) or not Path(cwd).is_absolute() or not Path(cwd).is_dir():
        blockers.append(f"Engineer {pane} ({kind}): working directory is missing or not absolute")
        return
    process = agent["process"]
    if process is None or not any(p["name"] == kind and p["cwd"] == cwd
                                  for p in process["foreground_processes"]):
        blockers.append(f"Engineer {pane} ({kind}): no matching native foreground process/cwd")
        return
    session = agent["agent_session"]
    if kind == "omp" and isinstance(session, dict) and session.get("kind") == "path":
        value = session.get("value")
        if not isinstance(value, str) or not Path(value).is_absolute():
            blockers.append(f"Engineer {pane} (omp): no absolute native session path")
            return
        try:
            metadata = Path(value).stat()
        except OSError:
            blockers.append(f"Engineer {pane} (omp): native session path is missing")
            return
        if not stat.S_ISREG(metadata.st_mode) or not metadata.st_size or not os.access(value, os.R_OK):
            blockers.append(f"Engineer {pane} (omp): native session transcript is not a readable regular file")
            return
        agent["transcript"] = {"kind": "path", "value": value}
        agent["resume_argv"] = ["omp", f"--cwd={cwd}", f"--resume={value}"]
    elif kind == "hermes":
        if session is not None and (not isinstance(session, dict) or session.get("agent") != "hermes"):
            blockers.append(f"Engineer {pane} (hermes): conflicting native session reference")
            return
        try:
            transcript, argv = _hermes_session(process, cwd, env)
        except (OSError, ValueError, UnicodeError) as error:
            blockers.append(f"Engineer {pane} (hermes): {error}")
            return
        if session is not None and (session.get("kind"), session.get("value")) != ("id", transcript["value"]):
            blockers.append(f"Engineer {pane} (hermes): native Herdr session disagrees with live TUI session")
            return
        agent["transcript"] = transcript
        agent["resume_argv"] = argv
    else:
        blockers.append(f"Engineer {pane} ({kind}): no validated explicit native resume method/session")


def _shell_only(process: dict | None) -> bool:
    if not process:
        return False
    foreground = process["foreground_processes"]
    return (len(foreground) == 1 and foreground[0]["pid"] == process["shell_pid"]
            == process["foreground_process_group_id"] and foreground[0]["name"] in
            {"bash", "zsh", "fish", "sh", "dash"})


def _user_processes() -> tuple[dict[int, dict], dict[int, list[int]], dict[int, list[int]]]:
    """One bounded, same-UID /proc census; never read argv or process environments."""
    processes: dict[int, dict] = {}
    children: dict[int, list[int]] = {}
    sessions: dict[int, list[int]] = {}
    try:
        with os.scandir("/proc") as entries:
            seen = 0
            for entry in entries:
                if not entry.name.isdecimal():
                    continue
                seen += 1
                if seen > 8192:
                    raise ValueError("Bounded process census exceeded 8192 PIDs")
                try:
                    if entry.stat(follow_symlinks=False).st_uid != os.getuid():
                        continue
                    raw = (Path(entry.path) / "stat").read_text()
                    close = raw.rfind(")")
                    fields = raw[close + 2:].split()
                    pid = int(entry.name)
                    state, parent, group, session = fields[:4]
                    if state in ("Z", "X"):
                        continue
                    process = {"pid": pid, "name": raw[raw.index("(") + 1:close],
                               "ppid": int(parent), "pgrp": int(group), "sid": int(session)}
                except (OSError, ValueError, IndexError):
                    continue  # A process exited during the census.
                processes[pid] = process
                children.setdefault(process["ppid"], []).append(pid)
                sessions.setdefault(process["sid"], []).append(pid)
    except OSError as error:
        raise ValueError("Cannot inspect same-UID shell session members") from error
    return processes, children, sessions


def _shell_jobs(shell_pid: int, census: tuple[dict[int, dict], dict[int, list[int]],
                                               dict[int, list[int]]]) -> tuple[int, list[dict]]:
    processes, children, sessions = census
    shell = processes.get(shell_pid)
    if not shell:
        raise ValueError(f"Shell PID {shell_pid} disappeared during process census")
    members = set(sessions.get(shell["sid"], ()))
    seen = {shell_pid}
    descendants = [shell_pid]
    while descendants:
        parent = descendants.pop()
        for pid in children.get(parent, ()):
            if pid not in seen:
                seen.add(pid)
                descendants.append(pid)
    members.update(seen)
    members.discard(shell_pid)
    return shell["sid"], [{"pid": pid, "name": processes[pid]["name"]} for pid in sorted(members)]


def _identity(row: dict) -> tuple:
    session = row.get("agent_session") or {}
    return (row.get("pane_id"), row.get("agent"), (session.get("kind"), session.get("value")),
            row.get("cwd"), row.get("foreground_cwd"))


def current_inventory(env: dict) -> dict:
    """Inspect the native default session; collect uncertainties as cutover blockers."""
    inventory = {"schema": 1, "captured_at": datetime.now(timezone.utc).isoformat(),
                 "engineers": [], "panes": [], "workspaces": [], "layouts": [], "blockers": []}
    blockers = inventory["blockers"]
    try:
        agents = _rows(_herdr(["agent", "list"], env), "agents", "agent list")
        snapshot = _herdr(["api", "snapshot"], env).get("snapshot")
        if not isinstance(snapshot, dict):
            raise ValueError("Herdr api snapshot did not return a snapshot")
        snapshot_agents = _rows(snapshot, "agents", "api snapshot")
        pane_rows = _rows(snapshot, "panes", "api snapshot")
        native_workspaces = _rows(_herdr(["workspace", "list"], env), "workspaces", "workspace list")
        inventory["workspaces"] = [{key: row.get(key) for key in
                                    ("workspace_id", "label", "active_tab_id", "pane_count", "tab_count")}
                                   for row in _rows(snapshot, "workspaces", "api snapshot")]
        inventory["layouts"] = [
            {"workspace_id": row.get("workspace_id"), "tab_id": row.get("tab_id"),
             "pane_count": len(row.get("panes", [])),
             "split_directions": sorted(str(split.get("direction") or split.get("orientation"))
                                        for split in row.get("splits", []))}
            for row in _rows(snapshot, "layouts", "api snapshot")
        ]
    except ValueError as error:
        blockers.append(str(error))
        return inventory

    if Counter(_identity(row) for row in agents) != Counter(_identity(row) for row in snapshot_agents):
        blockers.append("Herdr agent list and API snapshot disagree; native state changed during capture")
    if Counter((row.get("workspace_id"), row.get("pane_count"), row.get("tab_count"))
               for row in inventory["workspaces"]) != Counter(
               (row.get("workspace_id"), row.get("pane_count"), row.get("tab_count"))
               for row in native_workspaces):
        blockers.append("Herdr workspace list and API snapshot disagree")
    pane_map = {}
    for row in pane_rows:
        pane_id = row.get("pane_id")
        if not isinstance(pane_id, str) or pane_id in pane_map:
            blockers.append("Native snapshot has a missing or duplicate pane ID")
            continue
        try:
            process = _process(pane_id, env)
        except ValueError as error:
            process = None
            blockers.append(str(error))
        pane_map[pane_id] = {"workspace_id": row.get("workspace_id"), "tab_id": row.get("tab_id"),
                             "pane_id": pane_id, "cwd": row.get("cwd"),
                             "agent_status": row.get("agent_status"), "classification": "unclassified",
                             "process": process}

    observed_agents = {}
    for row in [*snapshot_agents, *agents, *(row for row in pane_rows if row.get("agent"))]:
        pane_id = row.get("pane_id")
        if not isinstance(pane_id, str):
            blockers.append("A native engineer has no pane ID")
            continue
        if pane_id in observed_agents:
            if _identity(row) != _identity(observed_agents[pane_id]):
                blockers.append(f"Engineer {pane_id} identity changed while capturing")
            continue
        observed_agents[pane_id] = row
    for pane_id, row in observed_agents.items():
        if pane_id not in pane_map:
            blockers.append(f"Engineer {pane_id} is missing from native pane inventory")
            pane_map[pane_id] = {"workspace_id": row.get("workspace_id"), "tab_id": row.get("tab_id"),
                                 "pane_id": pane_id, "cwd": row.get("cwd"),
                                 "agent_status": row.get("agent_status"), "classification": "agent_without_pane",
                                 "process": None}
        else:
            pane_map[pane_id]["classification"] = "engineer"
        engineer = {"kind": row.get("agent"), "name": row.get("name"),
                    "workspace_id": row.get("workspace_id"), "tab_id": row.get("tab_id"),
                    "pane_id": pane_id, "cwd": row.get("cwd"),
                    "foreground_cwd": row.get("foreground_cwd"),
                    "agent_status": row.get("agent_status"),
                    "agent_session": row.get("agent_session"), "transcript": None,
                    "resume_argv": None, "process": pane_map[pane_id]["process"]}
        inventory["engineers"].append(engineer)
        _recovery(engineer, env, blockers)

    census = None
    if any(row["classification"] == "unclassified" and _shell_only(row["process"])
           for row in pane_map.values()):
        try:
            census = _user_processes()
        except ValueError as error:
            blockers.append(str(error))

    for row in pane_map.values():
        if row["classification"] == "unclassified":
            if _shell_only(row["process"]):
                if census is None:
                    row["classification"] = "shell_members_unverified"
                    continue
                try:
                    session_id, jobs = _shell_jobs(row["process"]["shell_pid"], census)
                except ValueError as error:
                    row["classification"] = "shell_members_unverified"
                    blockers.append(f"Pane {row['pane_id']}: {error}")
                    continue
                row["shell_session_id"] = session_id
                row["unaccounted_processes"] = jobs
                if jobs:
                    row["classification"] = "shell_with_background_work"
                    identities = ", ".join(f"{job['pid']} ({job['name']})" for job in jobs)
                    blockers.append(f"Pane {row['pane_id']} has unaccounted shell session/descendant processes: {identities}")
                else:
                    row["classification"] = "shell_only_unknown"
            else:
                row["classification"] = "unclassified_foreground"
                blockers.append(f"Pane {row['pane_id']} is unrecognized and may hold an active workload")
    inventory["panes"] = list(pane_map.values())
    identities = [(_key(agent)) for agent in inventory["engineers"] if agent["transcript"]]
    if len(identities) != len(set(identities)):
        blockers.append("Multiple engineers share one native transcript identity")
    try:
        latest = _rows(_herdr(["agent", "list"], env), "agents", "agent list")
        if Counter(_identity(row) for row in latest) != Counter(_identity(row) for row in agents):
            blockers.append("Native engineer identity changed before capture completed")
    except ValueError as error:
        blockers.append(str(error))
    return inventory


def _key(agent: dict) -> tuple:
    transcript = agent.get("transcript") or {}
    return (agent.get("kind"), transcript.get("kind"), transcript.get("value"),
            transcript.get("session_store"))


def verify_inventory(before: dict, after: dict) -> list[str]:
    """Compare native identities and topology, independent of regenerated pane IDs."""
    errors = list(before.get("blockers", [])) + list(after.get("blockers", []))
    if before.get("schema") != 1 or after.get("schema") != 1:
        errors.append("Unsupported inventory schema")
        return errors
    old, new = before.get("engineers", []), after.get("engineers", [])
    old_keys, new_keys = [_key(item) for item in old], [_key(item) for item in new]
    if any(key[1] is None or key[2] is None for key in old_keys + new_keys):
        errors.append("An engineer has no validated native transcript identity")
    if len(old_keys) != len(set(old_keys)) or len(new_keys) != len(set(new_keys)):
        errors.append("Native transcript identities are duplicated")
    if Counter(old_keys) != Counter(new_keys):
        errors.append("Engineer transcript identities changed; do not dispatch replacement work")
    new_by_key = dict(zip(new_keys, new))
    for key, old_agent in zip(old_keys, old):
        new_agent = new_by_key.get(key)
        if new_agent is None:
            continue  # Already reported as a missing transcript identity.
        for field in ("cwd", "foreground_cwd"):
            if old_agent.get(field) != new_agent.get(field):
                errors.append(f"Engineer {old_agent['kind']} ({old_agent['pane_id']}) {field} changed")
    for field in ("panes", "workspaces", "layouts"):
        if len(before.get(field, [])) != len(after.get(field, [])):
            errors.append(f"Native {field} count changed")
    old_shells = sum(p.get("classification") == "shell_only_unknown" for p in before.get("panes", []))
    new_shells = sum(p.get("classification") == "shell_only_unknown" for p in after.get("panes", []))
    if old_shells != new_shells:
        errors.append("Native shell-only pane count changed")

    def workspace_panes(inventory: dict) -> Counter:
        labels = {row["workspace_id"]: row["label"] for row in inventory.get("workspaces", [])}
        by_workspace: dict[str, list[str]] = {}
        for row in inventory.get("panes", []):
            by_workspace.setdefault(row["workspace_id"], []).append(row["classification"])
        return Counter((labels.get(workspace), tuple(sorted(classes)))
                       for workspace, classes in by_workspace.items())
    if workspace_panes(before) != workspace_panes(after):
        errors.append("Native workspace pane classifications changed")

    for field, keys in (("workspaces", ("label", "pane_count", "tab_count")),
                        ("layouts", ("pane_count", "split_directions"))):
        def shape(inventory: dict) -> Counter:
            return Counter(tuple(json.dumps(row.get(key), sort_keys=True) for key in keys)
                           for row in inventory.get(field, []))
        if shape(before) != shape(after):
            errors.append(f"Native {field} topology changed")
    return errors


def _notes(inventory: dict) -> str:
    lines = ["# Native engineer recovery notes", "",
             f"Captured at: {inventory['captured_at']}", "",
             "Native Herdr restoration comes first. Never start a second copy of a live agent.",
             "Only consider an explicit resume after checking that native restoration did not",
             "restore that transcript. Resuming is not permission to replay prompts, repeat side",
             "effects, or silently dispatch new tasks. Do not send input to any existing agent.", ""]
    if inventory["blockers"]:
        lines += ["## Cutover blockers — do not interrupt the current session", ""]
        lines += [f"- {blocker}" for blocker in inventory["blockers"]]
        lines.append("")
    for agent in inventory["engineers"]:
        session = agent["agent_session"]
        transcript = agent["transcript"]
        lines += [f"## {agent['kind']} {agent['name'] or '(unnamed)'} — {agent['pane_id']}", "",
                  f"Workspace: {agent['workspace_id']} · tab: {agent['tab_id']} · status: {agent['agent_status']}",
                  f"Exact pane cwd: {agent['cwd']}", f"Exact foreground cwd: {agent['foreground_cwd']}",
                  f"Native agent_session: {json.dumps(session, ensure_ascii=False)}",
                  f"Validated transcript/session: {json.dumps(transcript, ensure_ascii=False)}",
                  f"Process identity: {json.dumps(agent['process'], ensure_ascii=False)}", ""]
        if agent["resume_argv"]:
            lines += ["Only if this transcript is NOT already live, resume without an initial task:", "",
                      "```sh", shlex.join(["cd", "--", agent["foreground_cwd"] or agent["cwd"]]),
                      shlex.join(agent["resume_argv"]), "```", ""]
        else:
            lines += ["No safe explicit resume command validated; do not guess or use latest/continue.", ""]
    lines += ["## Unrecognized panes", "",
              "Shell-only unknown panes are recorded, not counted as engineers; inspect anew before interruption.", ""]
    for pane in inventory["panes"]:
        if pane["classification"] != "engineer":
            lines.append(f"- {pane['pane_id']}: {pane['classification']}; cwd={pane['cwd']}; "
                         f"process={json.dumps(pane['process'], ensure_ascii=False)}; "
                         f"shell_session_id={pane.get('shell_session_id')}; "
                         f"unaccounted_processes={json.dumps(pane.get('unaccounted_processes', []))}")
    return "\n".join(lines) + "\n"


def _private_file(path: Path, data: bytes) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def capture(destination: Path, env: dict) -> dict:
    """Save a private immutable preview; callers MUST refuse cutover on blockers."""
    destination = Path(destination)
    destination.mkdir(parents=True, mode=0o700, exist_ok=True)
    directory = destination.lstat()
    if not stat.S_ISDIR(directory.st_mode) or directory.st_mode & 0o077:
        raise ValueError("Inventory destination must be a private real directory")
    inventory = current_inventory(env)
    _private_file(destination / "inventory.json", (json.dumps(inventory, indent=2) + "\n").encode())
    _private_file(destination / "resume.md", _notes(inventory).encode())
    return inventory
