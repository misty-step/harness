---
name: session-close
description: Close owned landing work and resource leases as landed or explicitly parked; review stale resources without deleting uncertain work.
---

# Session close

The colocated `session-close.ts` records only owned landing work/resources. It
does not prove product behavior, deployment or a globally clean workstation.

```sh
bun /absolute/skill/session-close.ts track --repo /worktree
bun /absolute/skill/session-close.ts add --kind worktree --target /new/worktree
bun /absolute/skill/session-close.ts add --kind exe.dev --target VM.exe.xyz
bun /absolute/skill/session-close.ts check --repo /worktree --json
bun /absolute/skill/session-close.ts park --repo /worktree --note "Reason; owner; resume steps"
bun /absolute/skill/session-close.ts unpark --repo /worktree
bun /absolute/skill/session-close.ts leases --json
bun /absolute/skill/session-close.ts drop --target /finished/resource
```
Track inherited repos before editing/branch changes; lease resources on creation.
`ws up` leases its worktree; standing VMs are not session leases. State is under
`~/.cache/tmp/omp-session-leases`; owner defaults to process identity.
Park preserves owned worktree leases, not live VM leases; tracking does not unpark.

At the requested stopping point, land through normal review/CI or explicitly park
with owner/resume steps. Do not merge or deploy past a user PR-only stop.
Harness Landmark owns changelogs. Full shared deployment uses both consumers'
installers, preserving foreign state; actual loading needs native observation.

Remove only finished owned resources, never `--force` or uncertain work. Pull
remote evidence before `ws down`. `review` lists stale/orphaned leases; expiry
never authorizes deletion. Drop records only after removal or standing-ownership
confirmation. Check before yielding; an open PR can be parked without pretending
it landed.
