---
name: remote-execution
description: Use exe.dev SSH destinations and project workspaces without confusing the management lobby with a VM shell.
---

# exe.dev

`ssh exe.dev` is the management lobby (not a shell/scp endpoint);
`ssh VM.exe.xyz` is the VM shell with normal SSH/scp. Read only the needed
[docs](https://exe.dev/docs.md) or `ssh exe.dev help COMMAND`.
VM disks persist; `https://VM.exe.xyz/` provides TLS and account-policy auth.

Prefer the project's `ws` commands for heavy execution, snapshots and teardown.
Lease non-standing VMs with `session-close` when created. Do not delete a standing
or foreign VM. For a first connection, verify the provider host-key fingerprint;
never mistake an unseen host-key prompt for a hung job.
