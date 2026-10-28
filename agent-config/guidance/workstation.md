## Workstation facts

Use native logins. Credential commands and discovery live in `skill://authenticated-commands`.
Scratch belongs under `~/.cache/tmp`; `/tmp` is RAM-backed.
Audio plays into silent `agent-sandbox`; record its monitor and hand over files for the operator to play.
Verify desktop UI off-screen and read the framebuffer (`skill://engineering-operations`); the operator's workspaces, popups and screen stay untouched.

## Remote-first execution

Run development, test environments and QA on exe.dev VMs, and builds, automated tests and CI on the Hetzner box (`ssh hetzner-ci`). Hetzner is build and CI only: no agent harness or agent session runs there, and agents SSH in only to queue jobs, run builds and run tests; `skill://remote-execution` has the commands.
The workstations (mirrodin, serenity, nassau) are overflow only, after checking that remote capacity is full.
Never run a privileged container or anything with host-device access on a workstation: no `--privileged`, `--device`, host `/dev` or console mounts, host PID/IPC namespaces or systemd-in-container.
Never reboot, shut down, restart the display or session, or `pkill`/`killall` on a workstation; stop only a process you started, by its exact PID.
If remote capacity is missing, report what is missing in the current chat in two sentences; this does not authorize buying capacity.

## Agent routing

For authorized delegation, use the authoritative [ship-loop routing and rigor table](skill://ship-loop/roles.md#rigor) for review shape, models and effort. Use the host's native collaboration tools and their current supported model and effort settings. Reserve fast mode for bottlenecks and top priorities. `claude-hello` is reserved for Home. No Fable or Astra.

Account room is live state, never a written fact. Before claiming an account is exhausted, use the host's native usage-limit tools or `upkeep room --json` when available. Treat missing or stale quota as unknown. A working probe proves the call works, not a remaining quota percentage; infrastructure and authentication failures remain unknown. Never write transient availability into instruction files, handoffs, memory or briefs.

For authorized Daybook note work, read `~/.agents/skills/daybook-sync/SKILL.md`. Use its isolated workspace and immediate publication protocol.
