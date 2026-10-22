---
name: remote-execution
description: Use exe.dev SSH destinations and project workspaces without confusing the management lobby with a VM shell.
---

# exe.dev

`ssh exe.dev` is the management lobby (not a shell/scp endpoint);
`ssh VM.exe.xyz` is the VM shell with normal SSH/scp. Read only the needed
[docs](https://exe.dev/docs.md) or `ssh exe.dev help COMMAND`.
VM disks persist; `https://VM.exe.xyz/` provides TLS and account-policy auth.

Use native SSH to run the project's existing commands in its workspace;
transfer source and evidence with Git or `scp`.
Agent sessions, model credentials and local auth stores stay on the workstation.
Verify the provider host-key fingerprint before the first connection; never
treat an unseen host-key prompt as a hung job or disable host-key checking.
Reuse existing VMs. Obtain the owner's decision for consequential spend or
irreversible changes to their resources.

## Disposable VM for development, test environments and QA

Check `ssh exe.dev ls` and reuse a VM with your tag first. Otherwise create one
within the plan's limits and tag it so its owner is clear:

```sh
ssh exe.dev new --name=<lane>-<task> --tag=<lane> --comment='<task>; disposable' --json
ssh <lane>-<task>.exe.xyz 'cd ~/work && <project command>'   # run
scp <lane>-<task>.exe.xyz:~/work/results.txt ~/.cache/tmp/<task>/   # fetch
ssh exe.dev rm <lane>-<task>                                 # delete when the task ends
```

`--privileged`, `--device` and systemd-in-container belong on a VM, never on a
workstation. A VM that needs more than the plan allows is a question for Home
with two sentences on what is missing, not a purchase.

## Builds, automated tests and CI on Hetzner

`ssh hetzner-ci` reaches the Hetzner box. Clone or `rsync` the source into a
task-named directory under your home, run the project's existing build or test
command there and fetch the results as above. Remove the directory when done.
Leave the box's runner services, Incus and firewall alone, and use no
privileged or host-device access beyond what the box's own bootstrap provides.
If the box is saturated or unreachable, say so rather than falling back to a
workstation without checking first that remote capacity is full.
