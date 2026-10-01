---
name: session-close
description: Close owned landing work and resource leases as landed or explicitly parked; review stale resources without deleting uncertain work.
---

# Session close

Close only your session's work: **landed** or explicitly **parked/unfinished**.
The checker proves deterministic Git/GitHub and lease facts, not deployment,
production correctness, ticket completion, or a globally clean workstation.

## Track and lease

Register each responsible repository, including inherited worktrees, before
editing, switching branches, or deleting resources:

```sh
bun /absolute/skill/dir/session-close.ts track [--repo /absolute/worktree]
```

Landing records survive removal of the original worktree. `check` auto-enrolls
the current repository as a safety net, not a replacement for early tracking.
In the same turn as creating a local worktree or non-standing VM:

```sh
bun /absolute/skill/dir/session-close.ts add --kind worktree --target /absolute/path
bun /absolute/skill/dir/session-close.ts add --kind exe.dev --target vm.exe.xyz
```

`ws up` automatically leases remote task worktrees; `ws init`'s standing project
VM is not a session lease. The store is `~/.cache/tmp/omp-session-leases`;
`landings/` records are separate from leases. Owner identity is
`pid:<pid>:<starttime>`; `SESSION_CLOSE_OWNER` overrides it for non-agent callers.
Leases default to 48 hours (`--expires-hours N`); `--lease-dir` isolates a store.

## Land and observe

Merge the exact reviewed head through required green CI and the normal path in
`skill://engineering-operations/review.md`. Deploy to actual targets and observe
production sanity. Update the PR and relevant existing ticket with revision,
status, context, and evidence; use the project's existing tracker, without
inventing a ticket. Update owning docs. Harness Landmark automation owns
`CHANGELOG.md`, not hand edits.

For shared harness changes, install through both `pi-config/install` and
`omp-config/install`. Pi defaults to `~/.pi/agent`; OMP uses `omp config path`
unless `PI_CODING_AGENT_DIR` is set. Shared launchers go to `~/.local/bin`; respect
OMP's declared scope/host targets and foreign state. Restart affected consumers
and observe loading: file presence or installer tests alone do not prove it.

Inspect branch changes, untracked/ignored artifacts, and evidence. Remove only
finished owned worktrees without `--force`; delete merged local/origin feature
branches. Leave the canonical checkout clean on the fetched origin default head.
Keep standing VMs and foreign or uncertain resources. For remote tasks, pull
evidence before `ws down`; it refuses unpulled/changed evidence.

## Check or park

```sh
bun /absolute/skill/dir/session-close.ts check [--repo /absolute/canonical] [--json]
bun /absolute/skill/dir/session-close.ts leases --json
bun /absolute/skill/dir/session-close.ts review
bun /absolute/skill/dir/session-close.ts park --repo /absolute/repo --note "Reason; owner; resume steps"
bun /absolute/skill/dir/session-close.ts unpark --repo /absolute/repo
bun /absolute/skill/dir/session-close.ts drop --target /absolute/path-or-vm
```

Check before yielding. It checks owned landing records even when their original
worktrees are gone; GitHub errors fail closed for unparked work. `leases` is
read-only introspection, without Git checks or auto-tracking. `review` identifies
expired, orphaned, and legacy ownerless leases for manual judgment; expiry never
erases landing obligations.

Parking records a meaningful resume note and preserves matching owned worktree
leases, not live VM leases. Report unfinished scope, owner, resume steps,
PR/ticket state, retained resources, and unavailable facts. `unpark` explicitly
resumes; later auto-tracking does not. `--repo` may be another extant checkout of
the same common Git repository. Drop a lease only after inspecting owned state
and removing its resource or recording standing ownership, never to hide work.
