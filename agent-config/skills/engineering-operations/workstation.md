# Workstation execution

Desktop RAM is shared with the operator. Portable heavy work uses `ws` in the
project's owned exe.dev workspace: full suites, coverage, large builds/typechecks,
browser or Electron walks, renders, and long-running services. GitHub-hosted CI
is off-host already. Standing approval covers one `<project>-ws` per project
within the existing $40 plan; other VMs need approval. Agent sessions and model
credentials remain local. Vendor details: `skill://using-exe-dev`.

## Workspace commands

`ws init` creates/reuses the standing VM and reruns `.exe/setup.sh` when its digest
changes. `ws up --task T` snapshots source, including non-ignored untracked files,
and leases a detached task worktree; `ws sync --task T` refreshes it.

```sh
ws run --task T -- cmd
pass-env run -e NAME=entry -- ws run --task T --env NAME -- cmd
ws browser --task T
ws browser --task T --stop
ws pull --task T [paths]
ws down --task T
```

The secret travels over stdin, not argv. Browser prints `cdp_url`; `--stop` closes
the owned tunnel and Chromium. Pull saves evidence and SHA-256 digests under
`~/.cache/tmp/ws/<project>/<task>/`. Down refuses unpulled/changed evidence and
removes the task worktree and lease, not the standing VM. `ws attach --task T`
opens a shell; `ws status` checks VM presence.

## Local execution

Native desktop/GPU, offline, and data-constrained work stays local. With the
desktop guard activated, launch heavy local work with
`desktop-guard run -- <command>`: two jobs fit, a third is refused. Lightweight
inspection and bounded low-concurrency checks can stay local. Set runner
concurrency in repository config; containers created by a daemon need their own
bounds, because a bounded client does not contain the daemon.

Use a run-scoped `TMPDIR` under `~/.cache/tmp` and clean it on exit. `/tmp` is
RAM-backed tmpfs on this workstation.

The operator-owned [desktop-memory runbook](https://github.com/misty-step/harness/blob/master/docs/desktop-memory-guard.md)
owns activation. The rolling OMP cage uses the stable `omp` entrypoint for new,
direct and resumed engineers; existing engineers remain in their old cgroups
until natural exit. Do not bypass it through the retained native ELF or restart
Herdr/working engineers to migrate them. Whole-Herdr service containment is a
separate disruptive option, not the rolling path. Staging files is not
activation. Bounds do not make broad searches safe; external daemons need their
own containment.

## Audio and ownership

Sessions route audio into the silent `agent-sandbox` sink. Default `pw-record`
or `parecord` records its monitor. Deliver a render file; the operator chooses
playback from their terminal with `mpv render.mp4`, `pw-play render.wav`, or
`pw-loopback --capture-props='target.object=agent-sandbox stream.capture.sink=true'`.
Keep the routing keys listed by `$AGENT_AUDIO_SANDBOX` intact; `sachstand` is the
explicit spoken-brief exception. Existing sessions and browser brokers retain
old environments until they exit.

Use one canonical checkout per repository; inspect existing runs and
`git worktree list --porcelain` before creating another. Native isolated
delegation serves parallel writers; separate top-level sessions may need a
worktree. Stop only owned processes. `skill://session-close` owns create-time
leases, stale review, evidence preservation, and resource removal; an empty
lease store says nothing about unleased or foreign resources.
