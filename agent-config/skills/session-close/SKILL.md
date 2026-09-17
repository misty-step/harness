---
name: session-close
description: "Fail-closed wrap of session-owned host resources via create-time leases. Use when wrapping a session, after git worktree add or ssh exe.dev new, or when claiming leftover worktrees or exe.dev VMs are resolved."
---

# Session close

The class of error: a session ends while worktrees or exe.dev VMs it created
are still live, because wrap-up was optional.

The mechanism is a **create-time lease file**. [session-close.ts](session-close.ts)
fails while any lease remains. It does not inventory other sessions, standing
VMs, dirty trees, or pull requests. Exit 0 is the only wrapped state. Exit 2
means open leases. That is the pokayoke.

## Create

In the same turn as `git worktree add` or `ssh exe.dev new`:

```sh
bun path/to/session-close.ts add --kind worktree --target /absolute/path
bun path/to/session-close.ts add --kind exe.dev --target vm.exe.xyz
```

`--lease-dir` is a test seam. Live leases live under `~/.cache/tmp/omp-session-leases`.

## Close

```sh
bun path/to/session-close.ts
```

For each printed lease: destroy the resource (`git worktree remove --force`,
`ssh exe.dev rm <vm>`) or keep it as standing ownership with an explicit
operator decision, then:

```sh
bun path/to/session-close.ts drop --target /absolute/path-or-vm
```

Do not `rm` a VM or worktree this session did not lease. Re-run the check;
yield only on exit 0.

`--json` prints `{ ok, leases }`.

## Residual class

Creates without `add` never appear. Do not compensate with tags, global
worktree scans, or fleet `ls`. Fix create, then close.
