# Desktop memory guard: decision pending (US-043)

Status: awaiting Phaedrus's decision (brief written 2026-09-26). No cutover may be rerun
until he decides.

## Resume note

**Live now.** One Herdr session, `default`, on an unmanaged server under `app.slice`.
That is the pre-incident memory boundary: no fleet ceiling, and systemd-oomd watches
the fleet's parent. Nothing from the guard is active. There is no `herdr@.service`,
no development slice, no autostart link and no binding hook. `dev-exec.slice` has its
old limits. The cutover log ends `RESULT RECONCILED`, followed by a `DISARMED`
entry. The retired preparation means `cutover.py launch` refuses. The staged files
under `~/.local/share/desktop-guard/` do nothing.

**Unrelated, also live:** the tailnet review folder
`https://mirrodin.tail5f5eb4.ts.net/review/` serves `/home/phaedrus/review`. It is
the user unit `review-serve.service`, with source in
`~/.local/share/review-serve/main.go`, and it is tailnet-only. The dead root proxy
was removed; it belonged to Pica's fleet endpoint, port 8088, and `pica.service` is
disabled now.

**What his decision unlocks.**

- **Option A** removes the merged guard (PR #110) and this branch's cutover runner,
  rewrites US-043, and adds a live ceiling to the existing fleet. It needs no
  restart.
- **Option B** repairs the runner and needs one more planned fleet restart.
- **Option C** changes nothing.

**Exact next step.** If he picks A, first run the `app.slice` pressure drill below on
a disposable scope. Apply the ceiling only if the drill passes. If he picks B, get
his go for a restart window, then prepare and launch.

## What happened on 2026-09-26

The cutover stopped the old server, installed the units, and started the managed
server in `dev-fleet.slice`. It passed the two-slot admission check. The runner then
called Omarchy's terminal launcher and waited 15 seconds for it to return. That
launcher keeps the terminal in the foreground, so it never returns, and the timeout
killed the new client window.

Recovery restored every configuration target correctly. It then hit the same
timeout reopening the old launcher and recorded `MANUAL_RECOVERY_REQUIRED`. Kaylee
resumed the engineers on the unmanaged server. `reconcile` verified no transaction
state remained. Commit `ed1ccf6` fixes the blocking call, but that fix was never
exercised live.

## First principles

One runaway process did not take the fleet down; systemd-oomd did. It acts on
`app.slice` at 50% memory pressure sustained for 20 seconds, and it kills a whole
cgroup at a time. The terminal, Herdr and every engineer shared one cgroup, so one
kill took all of them. The kernel OOM killer, by contrast, picks a single process.
Every process has `oom_score_adj=200`, and the Herdr server is about 95 MB while
each engineer is about 1 GB, so the kernel would pick the largest engineer.

The shape to avoid is moving a running fleet into a new service. That forces a
full stop, which then demands an orchestrated runner with snapshot and rollback,
a transcript inventory, resume automation and client authentication. It came to
more than 2,000 lines and failed on its first live run.

## Options

**A. Ceiling on the existing unit (recommended, conditional).**
Run `systemctl --user set-property <herdr scope> MemoryMax=40G MemorySwapMax=4G ManagedOOMPreference=avoid`
live, and add the same `-p` properties to the one Herdr launch binding
(`uwsm app -p …`).

- *Proven:* all three properties apply at runtime to a running scope in
  `app-graphical.slice` (`memory.max`, `memory.swap.max`, `user.oomd_avoid=1`).
- *Unproven:* whether a runaway that reaches the ceiling keeps oomd from killing
  the whole fleet. The man page says `avoid` can still be selected when no other
  candidate exists.
- *Unproven:* persistence through the launch binding. It was never exercised.
- *Prerequisite drill:* in a disposable scope under `app.slice`, set the same
  three properties with a small ceiling. Run a sentinel plus a memory hog, and
  observe `memory.events` together with the oomd journal. Pass means the kernel
  kills only the hog and oomd does not kill the scope.

**B. Keep the current guard.** It is stronger against oomd, because the fleet
moves outside the monitored tree. The cost is another fleet restart and a repaired,
still orchestrated runner. Pick B if the drill shows oomd still kills a scope that
is capped and marked `avoid`.

**C. Do nothing.** Exposure stays as it was on the incident day.

Separately, and whichever option he picks: bound OMP's broad concurrent searches,
the strongest allocator suspect, at the source.
