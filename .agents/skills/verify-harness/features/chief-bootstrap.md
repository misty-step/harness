# Kaylee chief and Boat OMP workers

Use this scoped recipe for `agent-config/chief/`: Kaylee's identity and operating
manual, her skills and config cutover, and OMP workers that each run on their own
Boat VM. Legacy Claude/Codex `doctor` prerequisites and the `all` helper are not
prerequisites for this path.

Run on the chief's exe.dev host from the installed source worktree
`~/workspace/kaylee-src`. Retain the checked source revision and secret-free
results outside the checkout. Never print gateway, Boat, GitHub or Discord tokens,
`.env` files or resolved provider configuration.

## Installation and loading

1. Inspect the source revision and native versions (`hermes --version`,
   `omp --version`, `boat --version`). Install only under the owner's deployment
   authorization: `KAYLEE_DELIVER=discord:<owner DM> agent-config/chief/install-kaylee.sh`,
   then restart `hermes-gateway.service` at an idle moment. Do not run an
   installer as a test.
2. Read back the installed state: `~/.hermes/SOUL.md` matches source, the chief
   workspace `AGENTS.md` links to source, `hermes -p default config get` shows
   memory off, delegation/Kanban dispatch off, the legacy role profiles carry
   `gateway.parked`, and `hermes -p default cron list` shows `kaylee-workers` and
   `kaylee-legacy-fleet`. `journalctl -u hermes-gateway` shows
   `[Discord] Connected as kaylee` after the restart.
3. Fresh chief readback, bounded:

       hermes -p default chat -Q --max-turns 1 -q 'Without tools: who are you, who do you serve, how does engineering work get done, and where does shared context live?'

   Kaylee answers in her own voice: chief engineering officer, OMP workers on
   their own Boat VMs, Daybook. A generic Hermes identity fails.

## Actual dispatch

4. Rebake only when worker guidance or tooling changed:
   `agent-config/chief/worker/boat/build-snapshot.sh`, then
   `check-snapshot.sh` proves no credential files are baked in.
5. `kaylee-dispatch start` a bounded read-only brief on a private repository.
   Wait for `kaylee-dispatch list` to show it finished, read `result`, confirm the
   gateway journal attributes the inference to the worker client, then `finish`
   and confirm the VM and its tunnel unit are gone. A launch or exit code alone is
   not proof.
6. Through Discord or the web workspace, ask Kaylee to commission a real ticket.
   Observe her own `kaylee-dispatch` use, its Boat VM, and her follow-through to a
   reviewed PR. Her claim alone is not proof.

## Evidence and cleanup

Publish a concise source-revision, command and result summary on the PR; keep
private account, channel and conversation details out of public reports. Delete
only sandboxes you created; preserve Kaylee's sessions, cron jobs, credentials and
the owner's other sandboxes.
