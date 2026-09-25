---
name: session-close
description: "Close owner-scoped worktree and VM leases; review stale leases without deleting uncertain resources."
---

# Session close

Create-time leases keep a session from silently abandoning resources. The check
blocks only this caller's live leases. It does not inventory other sessions,
standing project VMs, unleased resources, or dirty trees.

## Create

In the same turn as creating a local worktree or a non-standing VM:

```sh
bun path/to/session-close.ts add --kind worktree --target /absolute/path
bun path/to/session-close.ts add --kind exe.dev --target vm.exe.xyz
```

`ws up --task T` records an `exe.dev-worktree` lease automatically. `ws init`
creates a standing owned project VM, not a session lease. Every lease records
`kind`, `target`, `owner` (`pid:<pid>:<starttime>`), `created`, and `expires`
(default 48 hours; `--expires-hours N` overrides it). `SESSION_CLOSE_OWNER`
overrides process ancestry for tests or non-agent callers. `--lease-dir` selects
a different store for isolated checks; live leases use
`~/.cache/tmp/omp-session-leases`.

## Close

```sh
bun path/to/session-close.ts check
bun path/to/session-close.ts review
```

`check` exits 2 only for this caller's own live leases, 0 otherwise, or 1 for
corruption. Foreign leases are informational. `review` exits 3 while expired,
orphaned (process gone or starttime changed), or legacy ownerless leases exist;
never delete these automatically. Corrupt lease files fail closed (exit 1).
`--json` includes `leases`, `own`, `foreign`, and `needsReview`.

For each owned lease: inspect the branch, Git-visible changes, ignored files,
and other evidence before removal. `ws down` enforces an owner-bound lease and
refuses unpulled or changed remote evidence; run `ws pull --task T` first.
Remove a confirmed finished local worktree without `--force`, or remove a
non-standing VM only after confirming ownership and purpose. Keep uncertain or
externally owned resources. Once the resource is removed or a standing-ownership
decision is recorded:

```sh
bun path/to/session-close.ts drop --target /absolute/path-or-vm
```

`drop` prints the recorded owner; it can drop a stale lease after manual review.
Exit 0 from `check` is the only wrapped state for the caller, not proof the
host is clean. Creates without leases remain invisible: fix create-time
recording rather than scanning or deleting other sessions' resources.
