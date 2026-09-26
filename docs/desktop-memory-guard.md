# Native desktop memory guard (US-043)

## Boundary and ownership

Herdr remains the unmodified upstream binary. A systemd **user** service owns the
server before it creates any pane. New shells, explicit-command panes and native
agent restoration inherit that service's cgroup. The terminal is only a client.
No extension loading or shell-command classification owns this boundary.

```text
user@UID.service
├── app.slice                         desktop applications and terminal clients
└── dev.slice                         aggregate development ceiling
    ├── dev-fleet.slice
    │   └── herdr@SESSION.service     server and all inherited pane processes
    └── dev-exec.slice
        ├── dev-job-1.scope           first admitted local heavy job
        └── dev-job-2.scope           second admitted local heavy job
```

The unit sources in `agent-config/desktop-guard/units/` own the budgets. The
fleet budget is 36 GiB, not the initial brief's 40: 36 + 16 fits the 52 GiB
parent ceiling without deliberately making the fleet and job budgets compete
at the parent. Swap budgets likewise sum to the parent's limit. This is a
maximum, not a desktop memory reservation. Fleet and aggregate `MemoryHigh`
are unlimited; individual heavy jobs have a lower reclaim threshold.

`OOMPolicy=continue` and `memory.oom.group=0` prevent a child OOM from causing
systemd to stop the whole fleet service. They do **not** guarantee which task a
kernel OOM chooses. A kernel kill of Herdr itself can still lose that session.
Native named sessions can divide this failure domain further, at the cost of a
single-session fleet view. All sessions share the fleet aggregate budget.

The launcher checks live oomd monitoring roots rather than assuming the host
always monitors only `app.slice`. A monitor covering the fleet is a refusal,
not a reason to disable oomd. Missing units, missing effective bounds, unknown
server ownership and unavailable inspection also refuse launch. An already
running unmanaged default server must be stopped by the operator before cutover.
A client reattach does not relocate it or its existing memory charges.

The tested native client entrypoint is Herdr **0.9.1**'s `client` subcommand.
Unlike ordinary `herdr` or `session attach`, it never auto-starts a daemon if
the socket disappears. Unknown versions refuse until this contract is reviewed.
The client scope is bound to the managed server's lifetime, so a disconnected
multi-machine client cannot outlive that service and reconnect to an unrelated
replacement. This uses native systemd dependencies, not a polling watchdog.
See the [versioned client entrypoint](https://github.com/herdrdev/herdr/blob/v0.9.1/src/main.rs#L561-L566).

This is resource containment, not a security sandbox. A same-user process can
ask another manager to create work elsewhere; a Docker client does not contain
the daemon's containers. Such work needs its own limits or remote execution.

## Execution choice

- Portable heavy builds, full suites, coverage, browser/Electron walks, renders
  and long-running development services: `ws` in the project's owned exe.dev
  workspace. Existing project workspaces are the default, not a new VM per job.
- Native desktop/GPU or data-constrained heavy work: after activation,
  `desktop-guard run -- <command>`. Two job slots are shared across terminals and
  sessions. A third job is refused; do not evade this with another unit name.
- Lightweight inspection and explicitly low-concurrency checks can stay local.
- Agent processes and model credentials remain local. Moving them remotely is
  a separate operator decision; command offload alone does not contain memory
  allocated inside an agent's tools.

A job preserves arguments, cwd, stdio, exit status and the caller's environment
except `TMPDIR`, which the guard sets to run-scoped scratch under `~/.cache/tmp`,
not RAM-backed `/tmp`. Its scope remains the authority if descendants outlive
the launcher.

## Stage, without activation

From a reviewed harness revision:

```sh
./agent-config/install --agent-dir "$HOME/.omp/agent" --desktop-guard --check
./agent-config/install --agent-dir "$HOME/.omp/agent" --desktop-guard
```

Staging installs the owned CLI and writes reviewed units and the
Omarchy binding below `~/.local/share/desktop-guard/staged/`. It does not put
units in the live user-manager search path, enable/start a service, load the
binding, alter oomd, or change existing limits. Normal Pi/OMP installs do not
opt this host into the guard.

The existing Omarchy `SUPER + CTRL + RETURN` binding launches Herdr. The staged
Lua snippet replaces that binding with the managed launcher, using an absolute
CLI path. It is loaded through the supported host-only
`~/.config/hypr/bindings.local.lua` hook; do not edit the Workbench release
symlinks or packaged `/usr/share/omarchy` files. The workstation's Hyprland PATH
places `/usr/bin` before `~/.local/bin`, so executable shadowing is not the
activation mechanism.

## Operator cutover — restarts every engineer

The reviewed one-shot runner replaces the manual file-copy procedure. It runs
in `desktop-guard-cutover.service` under `background.slice`, outside Herdr and
the development slices. No timer is installed. Staging and preparation never
stop a server, activate units, or reload Hyprland.

Prepare from the staged package:

```sh
~/.local/share/desktop-guard/staged/cutover/cutover.py prepare
```

Preparation checks the real host, pins the old server and configuration/source
fingerprints, and writes private per-engineer resume notes. Unknown foreground
workloads, missing transcript identities, active local jobs, existing managed
fleets, unexpected unit overrides and Hyprland errors refuse preparation.
OMP uses native transcript paths; Hermes uses its live TUI child's authoritative
active-session file and the exact profile database, never the newest session
row. The transaction is harness-neutral: Pi/OMP share the inherited process
boundary and job admission; transcript recovery follows the detected native
agent, not either harness's policy.

**Only after the operator chooses the interruption**, run this single command:

```sh
~/.local/share/desktop-guard/staged/cutover/cutover.py launch
```

The command only submits the independent user service. Its return is not proof
of success. The fixed plain log is:

```text
~/.local/state/desktop-guard/cutover.log
```

The fixed resume-notes path is:

```text
~/.local/state/desktop-guard/resume.md
```

The runner captures a fresh inventory immediately before interruption and moves
that notes pointer to the actual run. Preserve its private run directory and
`active.json`; they contain the exact pre-cutover backup and recovery phase.
The notes give each engineer's cwd, transcript identity and native resume argv.
First inspect native restoration; do not start a duplicate engineer or replay
old prompts, approvals, or side effects.

The ordered transition is:

1. Recheck the pinned server, files and host; lock both admission slots; require
   an empty development hierarchy. Capture every engineer's recovery identity.
2. Durably snapshot all unit files, drop-in trees, private binding and enablement
   link, including their absence, before any destructive action.
3. Stop only the recorded old default server and wait for its exit.
4. Apply the staged units and private binding transactionally; reload the user
   manager; start and authenticate the managed server; reload/check Hyprland.
5. Verify real bounded job scopes and prompt third-job refusal without executing
   the third command. Submit the guarded native terminal client without waiting
   for it: Omarchy's launcher runs the terminal in the foreground and returns
   only when the window closes. Attachment is proven only by the native client
   socket check. Restore eligible native sessions; explicitly resume a recovered
   Hermes identity only into its identified shell fallback, never when that
   session is already live and never over an existing agent.
6. Require the original engineer transcript identities, workspace/pane topology,
   actual restored foreground-process cgroups, effective limits, oomd exclusion
   and graphical-session enablement. Only then write `RESULT SUCCESS`.

The destructive OOM drill remains the disposable-session acceptance below; the
runner never lowers the live fleet's limit or deliberately OOMs production.
It reuses that native binary/guard contract and checks the live placement.

## Operator rollback

Any failed or interrupted transition invokes recovery through systemd
`ExecStopPost`, including a killed runner or start timeout. Recovery is not a
background thread in the engineer that is about to be terminated.

Before stopping the new managed fleet or restoring any file, recovery compares
**all** transaction targets with their recorded original/planned states. This
includes regular unit files, drop-in trees, the private binding, and the
enablement symlink. Foreign edits cause `RESULT MANUAL_RECOVERY_REQUIRED`,
preserve all snapshots and edits, and name the conflict; recovery never silently
overwrites another session's work.

With no conflict, recovery stops only the owned managed server, requires empty
development slices, restores the complete original configuration, retires the
empty new cgroups, reloads the managers and opens the original packaged terminal
launcher. It verifies transcript restoration before writing `RESULT ROLLED_BACK`.
This restores the known weaker old memory boundary, not successful protection.

`RESULT PREFLIGHT_FAILED` means the old fleet was never interrupted. An unknown
replacement server, new local workload, missing native client or unavailable
desktop can block automatic recovery; the log and resume notes remain the
authority for manual reconciliation. A failed attempt is not automatically
retried. Do not rerun preparation over an unfinished recovery.

After `MANUAL_RECOVERY_REQUIRED`, once the operator has restored the fleet by
hand, record it with:

```sh
~/.local/share/desktop-guard/staged/cutover/cutover.py reconcile
```

It changes no service or configuration. It refuses while the cutover unit runs,
while any transaction-installed file, link or created directory remains, while
the managed service is loaded, while development slices hold work, or while the
binding hook is present. It then records `RESULT RECONCILED` with the running
unmanaged server and a fresh engineer inventory. Only then may `prepare` pin
that fleet for a new attempt.

No package script or workbench-release symlink target is edited. Only Omarchy's
existing private `bindings.local.lua` hook is changed. No sudo, global oomd
change, broad `systemctl revert`, or desktop restart is part of the transition.

## Acceptance walk

Use a unique disposable **named** session, never the default fleet. Record the
candidate revision, actual Herdr/systemd versions, cgroup paths and kernel
`memory.events`. Temporarily lower only that test service's limit; never consume
the production ceiling for a memory-hog test.

1. Check that managed start refuses the existing unmanaged default server without
   replacing it. Record the real fleet's server identity before and after.
2. Start the disposable server through the managed launcher; corroborate its
   socket peer PID against systemd `MainPID` and `/proc/PID/cgroup`.
3. Create a sentinel and an explicit argv-command pane through native Herdr APIs.
   Inspect their actual `/proc` membership, not a copied expected path.
4. Restart only the disposable server. Verify restored pane processes and a
   native agent resume, where applicable, remain beneath the bounded service.
5. Run a small allocating child inside the test service. Observe an OOM kill,
   increased `memory.events:oom_kill`, unchanged server/sentinel identities and
   successful post-kill CLI interaction.
6. Fill both admitted job slots with tiny sleeping commands; a third invocation
   must refuse without running its command. Verify per-job bounds, command
   arguments/cwd/environment/exit behavior, and slot reuse after completion.
7. Check `oomctl dump`: no monitored path may be an ancestor of the fleet.
   Exercise refusal for a covering-monitor observation without changing global
   oomd. Review the failure path if inspection itself is unavailable.
8. Remove only the disposable session and test-owned runtime overrides; restore
   any temporary limits on the previously empty execution slice. Do not enable
   the default service or load the desktop binding.

The [incident postmortem](postmortems/2026-09-26-shared-terminal-oom.md) records
observed evidence and its limits. A passing disposable walk is not activation of
the real fleet.

### First live attempt (2026-09-26 21:58Z)

Snapshot, old-server stop, unit install, managed start inside
`dev-fleet.slice`, Hyprland reload, and two-slot admission (third job refused
with 75) all succeeded. The guarded client terminal then opened, but the runner
called Omarchy's launcher synchronously with a 15-second timeout. That launcher
`exec`s the terminal in the foreground of its systemd scope, so it could not
return; the timeout killed the terminal. `ExecStopPost` stopped the managed
service, restored every configuration target, and reopened the old launcher.
That identical 15-second timeout recorded `MANUAL_RECOVERY_REQUIRED`, but the
detached server had already started. Fleet verification never ran. Kaylee
resumed the engineers on that unmanaged server. The runner now submits both
terminals without waiting and proves attachment through the native socket.

### Prepared-runner evidence (2026-09-26)

The staged read-only `check` ran successfully in a disposable native
`background.slice` user service: 16 engineers (15 OMP, one Hermes), 24 panes,
zero recovery blockers, and private mode-0600 notes. No default-fleet cutover
was executed. The current unmanaged client's established native UI connection
was observed, and it correctly failed the managed-client predicate.

A separate native oneshot applied fixture configuration using the production
transaction module and was killed with SIGKILL. Its real `ExecStopPost`, in a
new process, restored original unit/binding bytes and modes, the drop-in tree,
and absent enablement. Another native drill held `ExecStopPost` open: systemd
rejected a duplicate start under the same unit name and the duplicate command
did not execute. The fixed production unit name owns serialization across the
ExecStart/ExecStopPost handoff; the file lock additionally guards both phases.

Filesystem regressions cover interrupted atomic staging and foreign edits,
including deletions. A wrong-checkout regression failed before repair and
passed after adding transcript-matched cwd checks. The eventual live result,
including all restored engineers and the guarded client, is deliberately left
to the operator-triggered run and its fixed result log.
