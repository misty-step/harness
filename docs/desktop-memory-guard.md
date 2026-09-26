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

Run these steps from a **separate ordinary terminal, outside Herdr**, only when
the operator has chosen the interruption. No agent performs this transition.
Keep that terminal open for rollback. Save work and confirm native session
references are recorded; snapshot restoration preserves layout, not arbitrary
running processes.

1. Record the current server and job state:

   ```sh
   herdr status server --json
   systemctl --user show dev-exec.slice -p TasksCurrent -p DropInPaths
   systemctl --user list-units 'dev-job-*.scope' --no-pager
   ```

   Wait for local jobs to finish. Do not stop a shared slice. Confirm no named
   Herdr service already owns a running fleet, and no other unit/drop-in changes
   have appeared since staging. Review any unfamiliar configuration first.

2. Stop the old default server deliberately:

   ```sh
   herdr server stop
   herdr status server --json
   ```

   The result must report `running: false`. This is the step that terminates the
   existing engineers. A running unmanaged server is never adopted automatically.

3. Back up live units, drop-ins and the private binding file, then install the
   staged units. The old `dev-exec.slice.d/limits.conf` must move with its old
   unit; otherwise its 48/60/8 GiB settings would override the new budget.

   ```sh
   set -eu
   stage="$HOME/.local/share/desktop-guard/staged"
   units="$HOME/.config/systemd/user"
   backup=$(mktemp -d "$HOME/.local/share/desktop-guard/cutover.XXXXXX")
   printf '%s\n' "$backup"
   test "$(systemctl --user show dev.slice -p TasksCurrent --value)" = 0
   mkdir -p "$backup/units" "$backup/hypr" "$backup/retired" "$units" "$HOME/.config/hypr"
   chmod 700 "$backup" "$backup/units" "$backup/hypr" "$backup/retired"
   for name in dev.slice dev-fleet.slice dev-exec.slice herdr@.service; do
     for path in "$name" "$name.d"; do
       if [ -e "$units/$path" ] || [ -L "$units/$path" ]; then
         cp -a -- "$units/$path" "$backup/units/$path"
       fi
     done
   done
   if [ -e "$HOME/.config/hypr/bindings.local.lua" ]; then
     cp -a "$HOME/.config/hypr/bindings.local.lua" "$backup/hypr/"
   else
     touch "$backup/hypr/bindings-was-absent"
   fi
   touch "$backup/complete"
   # No configuration changes precede the complete backup.
   for name in dev.slice dev-fleet.slice dev-exec.slice herdr@.service; do
     if [ -e "$units/$name.d" ] || [ -L "$units/$name.d" ]; then
       mv -- "$units/$name.d" "$backup/retired/$name.d"
     fi
     rm -f -- "$units/$name"
     install -m 600 "$stage/systemd/user/$name" "$units/$name"
   done
   systemctl --user daemon-reload
   "$HOME/.local/bin/desktop-guard" start
   "$HOME/.local/bin/desktop-guard" check
   systemctl --user show dev.slice dev-fleet.slice dev-exec.slice \
     -p Id -p MemoryMax -p MemorySwapMax
   ```

   Retain the printed backup path. Stop here on any error; do not attach using a
   bare Herdr fallback. `check` must authenticate the default server and verify
   all three slices and oomd exclusion; the following readback shows the limits.

4. Enable the reviewed service for graphical-session startup, and activate the
   native binding. Append the hook **once**, after inspecting the private file
   for an existing desktop-guard hook:

   ```sh
   systemctl --user enable herdr@default.service
   printf '\n-- desktop-guard US-043\ndofile(os.getenv("HOME") .. "/.local/share/desktop-guard/staged/hypr/herdr.lua")\n' \
     >> "$HOME/.config/hypr/bindings.local.lua"
   hyprctl reload
   hyprctl configerrors
   "$HOME/.local/bin/desktop-guard" attach
   ```

   Require no Hyprland configuration errors. Attaching supplies the terminal
   context that Herdr uses to resume eligible native agent sessions. Check the
   service again after restoration and inspect actual pane process cgroups.
   Do not interpret an empty layout or a shell fallback as resumed engineers.

## Operator rollback

Rollback also interrupts the managed fleet. Use the same outside terminal and
its recorded `backup` path. Stop local jobs first. If private bindings or unit
files changed after cutover, reconcile those edits before restoring the snapshot;
do not overwrite another session's work.

```sh
if systemctl --user is-active --quiet herdr@default.service; then
  systemctl --user stop herdr@default.service
fi
if systemctl --user is-enabled --quiet herdr@default.service; then
  systemctl --user disable herdr@default.service
fi
# Confirm every named managed server/job has stopped before changing shared limits.
systemctl --user list-units 'herdr@*.service' 'dev-job-*.scope' --no-pager
```

When no affected workload remains:

```sh
set -eu
units="$HOME/.config/systemd/user"
# Set backup to the exact path printed by cutover; never guess or select "latest".
test -f "$backup/complete"
test "$(systemctl --user show dev.slice -p TasksCurrent --value)" = 0
for name in dev.slice dev-fleet.slice dev-exec.slice herdr@.service; do
  # A partial cutover may leave an unchanged original drop-in directory.
  # Anything different requires review, never deletion or a blind merge.
  if [ -e "$units/$name.d" ] || [ -L "$units/$name.d" ]; then
    diff -qr -- "$backup/units/$name.d" "$units/$name.d"
  fi
  rm -f -- "$units/$name"
  for path in "$name" "$name.d"; do
    if { [ -e "$backup/units/$path" ] || [ -L "$backup/units/$path" ]; } &&
       [ ! -e "$units/$path" ] && [ ! -L "$units/$path" ]; then
      cp -a -- "$backup/units/$path" "$units/$path"
    fi
  done
done
if [ -e "$backup/hypr/bindings-was-absent" ]; then
  rm -f -- "$HOME/.config/hypr/bindings.local.lua"
else
  cp -a "$backup/hypr/bindings.local.lua" "$HOME/.config/hypr/bindings.local.lua"
fi
systemctl --user daemon-reload
hyprctl reload
hyprctl configerrors
omarchy-launch-terminal-herdr
```

This restores the old launch path and its known weaker memory boundary. It does
not uninstall the inert staged package. No sudo, global oomd change, broad
`systemctl revert`, or desktop restart is part of cutover or rollback.

A missing `backup/complete` means backup did not finish and this procedure has
not changed configuration; retain the partial backup and restart the old launch
path only when the operator chooses. With that marker present, rollback also
handles a failure midway through installing the new units: absent destinations
are harmless and all original files remain in the complete snapshot.

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
