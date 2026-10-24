## Workstation facts

Use native logins. Credential commands and discovery live in `skill://authenticated-commands`.
Scratch belongs under `~/.cache/tmp`; `/tmp` is RAM-backed.
Audio plays into silent `agent-sandbox`; record its monitor and hand over files for the operator to play.

## Remote-first execution

Run development, test environments and QA on exe.dev VMs, and builds, automated tests and CI on the Hetzner box (`ssh hetzner-ci`). Hetzner is build and CI only: no agent harness or agent session runs there, and agents SSH in only to queue jobs, run builds and run tests; `skill://remote-execution` has the commands.
The workstations (mirrodin, serenity, nassau) are overflow only, after checking that remote capacity is full.
Never run a privileged container or anything with host-device access on a workstation: no `--privileged`, `--device`, host `/dev` or console mounts, host PID/IPC namespaces or systemd-in-container.
Never reboot, shut down, restart the display or session, or `pkill`/`killall` on a workstation; stop only a process you started, by its exact PID.
If remote capacity is missing, tell Home what is missing in two sentences; this does not authorize buying capacity.

## Routing until Upkeep

For every dispatch, use the authoritative [ship-loop routing and rigor table](skill://ship-loop/roles.md#rigor) for review shape, models and effort.
Use the role's model from that table and an account with current room. `claude-hello` is reserved for Home. No Fable or Astra.
Account room is live state, never a written fact. Never write availability ("out until", "% left") into instruction files, handoffs, memory or briefs. Before saying an account is out or routing around it, run `upkeep room` (or, until it ships, one tiny probe call on that account). An "out" claim needs a reading under 15 minutes old with its source; a relayed "out" without one is stale. Unknown is unknown, not zero.
Before account routing, use `upkeep room --json` when available. Treat missing or stale quota as unknown. Use quota observations no older than ten minutes, or the command's cached tiny native probe evidence no older than fifteen minutes. Only a fresh provider limit proves exhaustion. A working probe proves the call works, not a remaining quota percentage; infrastructure or authentication failures remain unknown.
Reserve fast mode for bottlenecks and top priorities.
Pass the role's effort explicitly to `delegate_task`: Claude uses `target.options: [{"id":"effort","value":"<low|medium|high|xhigh>"}]`; Sol uses `target.options: [{"id":"reasoningEffort","value":"<low|medium|high|xhigh>"}]`.
For fast mode, add `{"id":"fastMode","value":true}` to Claude's `target.options` on models that offer it (Opus 5.5), or `{"id":"serviceTier","value":"priority"}` to Sol's.
Check `orchestrator_capabilities` before trusting any provider or model list.

For authorized Daybook note work, read `~/.agents/skills/daybook-sync/SKILL.md`.
Use its isolated workspace and immediate publication protocol across T3 providers.
