---
name: remote-execution
description: Use exe.dev SSH destinations and project workspaces without confusing the management lobby with a VM shell.
---

# exe.dev

`ssh exe.dev` is the management lobby (not a shell/scp endpoint);
`ssh VM.exe.xyz` is the VM shell with normal SSH/scp. Read only the needed
[docs](https://exe.dev/docs.md) or `ssh exe.dev help COMMAND`.
VM disks persist; `https://VM.exe.xyz/` provides TLS and account-policy auth.

Use native SSH to run the project's existing commands in its approved VM;
transfer source and evidence with Git or `scp`, not a separate workspace manager.
Agent sessions, model credentials and local auth stores stay on the workstation.
Verify the provider host-key fingerprint before the first connection; never
treat an unseen host-key prompt as a hung job or disable host-key checking.
Reuse approved VMs. Remove only your own finished scratch after retrieving
needed evidence; never delete a standing or foreign VM.
