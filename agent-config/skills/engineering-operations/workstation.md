# Workstation execution

Portable heavy work uses the project's `<project>-ws` exe.dev VM via `ws`.
Standing approval covers one per project in the existing $40 plan; other VMs need
approval. Agent sessions/model credentials stay local.

```sh
ws init
ws up --task T
ws sync --task T
ws run --task T -- command
pass-env run -e NAME=entry -- ws run --task T --env NAME -- command
ws browser --task T
ws browser --task T --stop
ws pull --task T [paths]
ws down --task T
```
Up snapshots non-ignored untracked files too and leases a task worktree. Pull
retrieves evidence; down refuses unpulled/changed evidence and keeps the standing
VM. Secrets travel over stdin. Browser returns `cdp_url`.

Native desktop/GPU/data-constrained heavy work uses `desktop-guard run -- command`;
bounded low-concurrency checks can stay local. A bounded client does not bound its
daemon's containers. Scratch: run-scoped `~/.cache/tmp`, not RAM-backed `/tmp`.
Do not restart the fleet or change host limits as part of routine work.

The rolling OMP cage uses the stable `omp` entrypoint, not the retained native
ELF. Existing engineers migrate on natural exit; do not restart them or Herdr.
The [memory runbook](https://github.com/misty-step/harness/blob/master/docs/desktop-memory-guard.md)
owns activation; staging files does not activate it.

Audio plays into silent `agent-sandbox`; default `pw-record`/`parecord` captures
its monitor. Deliver audio as a file for the operator to play.
Keep routing env intact. Reuse existing checkouts; stop only owned processes.
