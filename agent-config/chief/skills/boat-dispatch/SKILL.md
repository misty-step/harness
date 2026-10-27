---
name: boat-dispatch
description: Commission engineering as OMP on its own Boat VM.
---

# Commission through Boat

Kaylee is the chief: choose the outcome, author the brief, dispatch, judge the
returned evidence, and route decisions. Every engineering commission runs as
headless OMP on its own fresh Boat VM. Keep factory for chief coordination;
Kaylee never edits product code or runs an engineering agent on factory.

1. Read `kaylee-dispatch --help`. Write a brief for **one ticket**: goal, why,
   native issue/repo/decision links, scope, acceptance criteria, and required
   evidence. State the branch/PR expectation, verification commands and any
   read-only exception. A capable worker needs context and a completion bar,
   not a tool-by-tool script. Workers cannot spawn more agents on their VM;
   commission independent work on additional VMs.
2. Before starting, check `kaylee-dispatch list` and the ticket's latest
   comment: another of your sessions (a cron wake or a chat) may already have
   dispatched this role, and a duplicate worker posts conflicting reports.
   Then use `kaylee-dispatch start`. Sonnet 5.5 is the default for bounded work;
   Opus 5.5 for ambiguous design/review; GPT-6.1 Sol for implementation or
   difficult reasoning. Use the exact provider/model selectors in `--help`
   and an explicitly supported thinking level. The `factory-workers` gateway
   enforces the shared eligible accounts and reserves the chief's hello@
   identity. Unsupported grants are an error, never a reason to bypass it.
3. Comment the returned Boat ID on the ticket's issue. The `kaylee-workers`
   cron wakes you when a run changes state, so do not poll. An exit file means
   the process ended, not that acceptance passed.
4. Read `result`, open the returned GitHub PRs, and judge the actual checks and
   evidence against the brief. Ordinary engineering returns a PR plus a final
   report. Route missing evidence or a failed run to a new focused commission;
   do not implement the repair yourself. Credentials stay out of briefs and
   reports; workers receive only runtime gateway/GitHub tokens, never broker
   snapshots or subscription refresh credentials.
5. Run `finish ID` after collecting the result. It retains the report files
   (metadata, exit code, worker JSONL/stderr, session JSONL; nothing else from
   the worker's `~/run`) under `~/.local/state/kaylee/runs/ID/`, stops/disables
   its tunnel and deletes the VM. `result` on a live VM computes the final text
   on the VM and transfers only that. Use `--force` only to intentionally
   terminate and collect interrupted work.
   Confirm `list` has no abandoned `kaylee-` VM. Auto-stop is an orphan cost
   backstop, not teardown: stopped disks and credentials remain until deletion.

Re-bake `omp-worker` after worker guidance, shared skills or factory OMP changes:
run the source tree's `worker/boat/build-snapshot.sh` on factory. It reads the
adjacent `worker/AGENTS.md`, copies only shared skills and the identical OMP
binary, checks a fresh clone for baked credentials, and removes its scratch VMs.
Boat process monitoring is disabled, but disk snapshots still hold runtime tokens
until teardown. Tunnels reconnect under the lingering factory user manager; a
factory reboot can interrupt an in-flight request. Boat compute is EU-hosted.
