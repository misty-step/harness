# Workstation development execution

Deployed on the operator's Linux workstation on 2026-09-14, following the
[2026-09-09 memory-exhaustion postmortem](../postmortems/2026-09-09-workstation-memory-exhaustion.md).
This is opt-in, user-manager configuration, not a global harness policy or an
installer default. `./install` does not deploy these workstation-specific files.
No sudo, system units, `user.slice`, `app.slice`, or desktop limits are changed.

## Scope and limits

**Opt-in only: normal agent execution remains unbounded by this slice until a
job or service is explicitly placed in it.** No launch routing has changed;
nothing is routed automatically. Existing agents, forest services, and
daemon-created containers remain outside this boundary. The installer does not
deploy the slice or these workstation settings.

There is **no admission control**: the slice neither queues work nor enforces a
concurrent-job budget. Its aggregate cap does **not reserve desktop memory**;
work outside the slice can still exhaust the host.

To adopt the aggregate boundary for one command, choose a unique job name:

```sh
systemd-run --user --slice=dev-exec.slice --scope --unit=job-<name> <cmd>
```

Replace `<name>` and `<cmd>` before running. For a user service, set
`Slice=dev-exec.slice` in its `[Service]` section and restart that service after
reloading the user manager. Add the per-job limits shown below when an individual
job boundary is needed; slice membership alone shares only the aggregate cap.
Daemon-created containers require explicit limits and placement in their own
manager; placing the client in a scope does not place its containers there.

`forest-dev` on exe.dev is provisioned and SSH-smoke-tested, but is **not yet an
exercised offload pilot**. That smoke test is not a representative agent,
build, or test workload; no launch routing or production execution has moved
there. The remaining capacity decision and pilot are tracked in
[MIS-150](https://linear.app/misty-step/issue/MIS-150/offload-agent-execution-to-exedev-capacity-decision-and-pilot).

## Boundary and exclusions

| Boundary | MemoryHigh | MemoryMax | MemorySwapMax |
| --- | ---: | ---: | ---: |
| `dev-exec.slice` aggregate | 48 GiB | 60 GiB | 8 GiB |
| Recommended ordinary heavy job | 6 GiB | 10 GiB | 1 GiB |

`MemoryHigh` throttles/reclaims; it is not a kill threshold. `MemoryMax` can
OOM-kill a job. Aggregate limits cover all processes in this slice and its
children; they do not reserve RAM for the desktop. In systemd naming,
`dev-exec.slice` is a child of the implicit `dev.slice`, alongside—not inside—
`app.slice` and `session.slice`.

Existing agents, terminals, forest services, and running builds are **not moved**.
Launch expensive builds/tests at their execution boundary using the commands
below. Separately launched services, Docker-daemon containers, remote processes,
and applications delegated to another manager can escape the caller's cgroup.
Do not assume a Docker client wrapper contains its containers; configure their
own bounds and cgroup placement separately. This change neither queues jobs nor
automatically enforces the postmortem's proposed two-job admission budget.

## Run jobs

For an interactive command, preserve the current directory and environment in a
transient scope (choose a unique, non-sensitive name each time):

```sh
systemd-run --user --scope --slice=dev-exec.slice --unit=job-build-001 \
  -p MemoryHigh=6G -p MemoryMax=10G -p MemorySwapMax=1G \
  bun run build
```

The three per-job properties are required for an individual job boundary; merely
selecting the slice applies only the shared aggregate boundary. Apply runner
worker/concurrency flags as usual. A scope may leave other children alive when
one child is OOM-killed: inspect and stop that specific job's scope if necessary,
never the shared slice or a terminal's parent scope.

For a noninteractive job whose whole process group should stop on OOM:

```sh
systemd-run --user --slice=dev-exec.slice --unit=job-test-001 \
  --service-type=exec --wait --pipe --working-directory="$PWD" \
  -p MemoryHigh=6G -p MemoryMax=10G -p MemorySwapMax=1G \
  -p OOMPolicy=kill -p LimitCORE=0 \
  /usr/bin/bun test
```

Services inherit the user manager's environment, not all of the invoking shell's.
Pass only needed non-secret environment values with `--setenv`, or invoke the
project's authorized credential launcher inside the job. Never put secrets in
unit names, command arguments, or metadata. `--pipe` streams output to the caller;
it is incompatible with `--remain-after-exit`. For unattended jobs, omit
`--wait --pipe` and inspect the job journal. Stop only your own unit with
`systemctl --user stop job-test-001.service` (or `job-build-001.scope`).

## Read accounting and retain a job result

```sh
systemctl --user show dev-exec.slice \
  -p ControlGroup -p MemoryCurrent -p MemoryPeak -p MemorySwapCurrent \
  -p MemoryHigh -p MemoryMax -p MemorySwapMax -p TasksCurrent
systemctl --user show job-test-001.service \
  -p ActiveState -p Result -p ExecMainCode -p ExecMainStatus \
  -p MemoryPeak -p MemorySwapPeak -p CPUUsageNSec
journalctl --user -u job-test-001.service --no-pager
systemd-cgls --user-unit=dev-exec.slice
```

Live cgroup counters are under the `ControlGroup` path in `/sys/fs/cgroup`:
`memory.current`, `memory.peak`, `memory.swap.current`, `memory.events` (including
descendant OOM events), and `memory.pressure`. Completed transient units/cgroups
can disappear; record their peak/result before reset/collection, and retain the
`systemd-run --wait` summary. A failed unit remains inspectable until
`systemctl --user reset-failed <unit>`. Slice peak is lifetime aggregate peak,
not the sum of child peaks, and resets if the cgroup is recreated.

The health check logs aggregate current/peak/swap every minute while the slice
exists. Its state file contains only the previous sample and notification
cooldown—not a per-job history database. User journal retention remains the
existing journal policy. Long-term attribution, admission control, and bounds
for externally created containers are not provided by this change.

## Installed files and pressure alerts

`~/.config/systemd/user/dev-exec.slice`:

```ini
[Unit]
Description=Bounded development execution (opt-in heavy jobs)

[Slice]
MemoryAccounting=yes
CPUAccounting=yes
TasksAccounting=yes
```

`~/.config/systemd/user/dev-exec.slice.d/limits.conf`:

```ini
[Slice]
MemoryHigh=48G
MemoryMax=60G
MemorySwapMax=8G
```

The existing `~/.local/bin/tmp-health` is replaced with the tracked
[`bin/tmp-health.py`](../bin/tmp-health.py). It retains `/tmp` and
`~/.cache/tmp` disk/inode checks and adds:

- Disk or inode use **>80%** (dynamic inode counts remain not applicable).
- Host RAM usage **>80%**, calculated from `MemAvailable`, not merely `MemFree`.
- Swap usage **>80%**, or net occupied swap growth **>=1 GiB/min** over recent
  same-boot samples (1–180 seconds apart). Initial/reboot/stale samples do not
  invent a rate. Fast grow-and-shrink activity between samples can be missed.
- `dev-exec.slice` current memory **>=90% of MemoryHigh** (43.2 GiB).
- Inspection errors also warn; notification failures fail the service and retry
  on the next check rather than silently claiming delivery.

Breaches go to the user journal **and** `notify-send` critical desktop
notifications. New sets of alert conditions notify immediately; unchanged active
conditions repeat at most every 15 minutes. Recovery clears the suppression, so
recurrence notifies again. `~/.local/state/tmp-health/state.json` (or
`$XDG_STATE_HOME/tmp-health/state.json`) retains the previous sample and cooldown.
The service's existing `UMask=0077` protects it. Notifications require a logged-in
notification server; the monitor journals failure when none is available.

The original service/timer files stay intact. Added drop-ins are:

`~/.config/systemd/user/tmp-health.service.d/pressure.conf`:

```ini
[Unit]
Description=Journal and notify about filesystem, memory, swap and dev-exec pressure

[Service]
TimeoutStartSec=30s
```

`~/.config/systemd/user/tmp-health.timer.d/pressure.conf`:

```ini
[Unit]
Description=Check filesystem and memory pressure every minute

[Timer]
OnCalendar=
OnBootSec=2min
OnUnitActiveSec=1min
AccuracySec=5s
```

After installing the listed files, activate as the user:

```sh
install -m 755 bin/tmp-health.py ~/.local/bin/tmp-health
systemctl --user daemon-reload
systemctl --user start dev-exec.slice
systemctl --user restart tmp-health.timer
systemctl --user start tmp-health.service
journalctl --user -u tmp-health.service -n 20 --no-pager
```

The timer was already enabled. A new machine additionally needs the original
`tmp-health.service`/`tmp-health.timer` and `systemctl --user enable --now
tmp-health.timer`; this is not an automatic portable installer. The slice starts
on demand whenever a job selects it; it does not need enabling.

Safely exercise notification delivery without allocating pressure or modifying
saved production samples:

```sh
systemd-run --user --wait --unit=tmp-health-notification-proof \
  ~/.local/bin/tmp-health --test-alert
journalctl --user -u tmp-health-notification-proof.service -n 8 --no-pager
```

This explicitly labeled synthetic notification uses the production delivery path;
it does not claim real pressure. Confirm the popup visually, not merely the
returned notification ID.

## Observed small-scale proof (2026-09-14)

No 60 GiB experiment was performed. A Python allocator attempted at most
20 × 64 MiB, paced at 150 ms, in `job-dev-exec-hard-proof.service` with
`MemoryHigh=MemoryMax=1G`, `MemorySwapMax=0`, `OOMPolicy=kill`, `TasksMax=32`,
`RuntimeMaxSec=30s`, and `LimitCORE=0`.

- Allocated through 960 MiB, then cgroup OOM killed the process in **2.324 s**.
- `Result=oom-kill`, `ExecMainCode=2`, `ExecMainStatus=9` (SIGKILL).
- Job `MemoryPeak=1,073,741,824` bytes, `MemorySwapPeak=0`.
- Slice peak **1,073,815,552 bytes**, swap peak **0**, current returned to **0**.
- Slice `memory.events`: `high=454`, `max=37`, `oom=1`, `oom_kill=2`,
  `oom_group_kill=1`. These are aggregate event/process counters, not two failed
  test jobs. The earlier throttle probe contributes the `high` events.
- Unrelated sentinel PID **2973764**, outside `dev-exec.slice` in a terminal's
  `app.slice` scope: heartbeat **70 → 528 → 1265 → 1796**, then intentional
  180-second completion with exit **0**.
- Compositor PID **1877** stayed active in `session.slice`, with all three memory
  limits still infinity. `hyprctl -j monitors` answered during the experiment;
  before/after screenshots showed the desktop rendering, including the alert.
- A normal short scope command with the documented **6/10/1 GiB** limits exited
  successfully and printed its cgroup below `dev-exec.slice`.

An initial 1 GiB-cap probe used `MemoryHigh=768M`; reclaim throttled it until its
30-second safety timeout (SIGTERM, 825.1 MiB peak), so that was **not** the OOM
proof. Repeating with high equal to max exercised the hard boundary. An initial
launcher combined incompatible `--pipe`/`--remain-after-exit` and exited before
starting a job; that combination is not used in the workflow above.

At **12:56:13 CDT**, `--test-alert` returned notification ID **286** and the
Quickshell desktop visibly displayed **Workstation pressure TEST** with the
synthetic disk/inode/RAM/swap/slice message. A second run at **13:02:34 CDT**
without `--pipe` proved both the journal WARNING and visible popup together:
notification ID **291**, with `notification-journal-crop.png` and journal text
retained in the evidence directory. Real service sampling also completed
successfully. In-memory fixture checks separately exercised >80% disk/inodes,
exact-80% non-breach, RAM/swap/growth breaches, reboot rate exclusion, and slice
>=90% high; no host pressure was generated by those checks.

Private workstation proof and exact deployment diffs are retained locally under
`~/.local/state/dev-exec-install/20260914/`. Screenshots contain desktop content
and are deliberately **not** committed. `notification-crop.png` isolates the
alert. Full capture used `grim` because the computer helper failed with
`Wayland capture requires the wayland-pipewire feature`. Synthetic test units
were reset only after recording their results; the sentinel ended naturally.

## Revert (user scope only)

First finish or individually stop jobs inside the slice. **Do not stop a populated
slice**: doing so can stop all its jobs. Review `systemd-cgls
--user-unit=dev-exec.slice` first. The original health script is backed up at
`~/.local/state/dev-exec-install/20260914/tmp-health.before`.

```sh
# After confirming dev-exec.slice has no jobs:
systemctl --user stop dev-exec.slice
systemctl --user stop tmp-health.timer tmp-health.service
cp -p ~/.local/state/dev-exec-install/20260914/tmp-health.before ~/.local/bin/tmp-health
rm ~/.config/systemd/user/dev-exec.slice.d/limits.conf
rm ~/.config/systemd/user/dev-exec.slice
rm ~/.config/systemd/user/tmp-health.service.d/pressure.conf
rm ~/.config/systemd/user/tmp-health.timer.d/pressure.conf
systemctl --user daemon-reload
systemctl --user start tmp-health.timer
```

This restores the original 15-minute journal-only disk/inode monitor. The empty
drop-in directories and small health state/evidence files may remain; they impose
no limits. Preserve the evidence/backup until rollback is no longer needed. Do
not remove another operator's later drop-ins or use `systemctl revert` broadly.
