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
within the plan's limits with `remote-run`, which tags it `remote-run` plus your
owner tag (`$REMOTE_RUN_TAG`, else `$USER`):

```sh
remote-run vm new <lane>-<task> --comment '<task>; disposable'   # waits for ssh
remote-run vm exec <lane>-<task> -- sh -c 'cd ~/work && <project command>'
remote-run vm put <lane>-<task> ./src '~/work'                   # vm get to fetch
remote-run vm rm <lane>-<task>             # deletes only VMs it created
```

Raw fallback: `ssh exe.dev new --name=N --tag=T --comment=C --json`, `ssh N.exe.xyz`,
`scp -r`, `ssh exe.dev rm N`.

`--privileged`, `--device` and systemd-in-container belong on a VM, never on a
workstation. A VM that needs more than the plan allows is a question for Home
with two sentences on what is missing, not a purchase.

## Builds, automated tests and CI on Hetzner

`remote-run build` copies the git-tracked and untracked-unignored files to
`hetzner-ci:~/agent-work/<repo>-<id>/`, runs the command unprivileged in docker
at `/work` and removes the copy afterwards, also on failure or interrupt:

```sh
remote-run build --image oven/bun:1 --fetch out/results.txt -- sh -c 'bun test'
```

Options: `--dir`, `--cpus`, `--memory`, `--timeout`; fetched files land under
`~/.cache/tmp/remote-run/<id>/`. Privileged, device, host-namespace and volume
flags are rejected. Raw fallback: `ssh hetzner-ci` with `rsync`, run the
project's command in a task-named directory and remove it when done.
Leave the box's runner services, Incus and firewall alone. Hetzner is build and
CI only: never install or start an agent harness (codex, claude or similar) or
an agent session there.
If the box is saturated or unreachable, say so rather than falling back to a
workstation without checking first that remote capacity is full.
