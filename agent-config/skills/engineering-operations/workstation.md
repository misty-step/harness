# Workstation execution

Portable heavy work uses native SSH in the project's approved exe.dev VM;
`remote-execution` distinguishes the management lobby from the VM shell.
Reuse its existing checkout and runnable commands. Copy required source/evidence
with Git or `scp`; agent sessions, model credentials and auth stores stay local.
Standing approval covers one project VM in the existing $40 plan; other VMs need
approval. Never delete a standing or foreign VM.

Native desktop/GPU/data-constrained heavy work uses `desktop-guard run -- command`;
bounded low-concurrency checks can stay local. A bounded client does not bound its
daemon's containers. Scratch: run-scoped `~/.cache/tmp`, not RAM-backed `/tmp`.
Do not restart running sessions or change host limits as part of routine work.

The OMP resource cage uses the stable `omp` entrypoint, not the retained native
ELF. Existing sessions exit naturally; do not restart them to change the entrypoint.
The [memory runbook](https://github.com/misty-step/harness/blob/master/docs/desktop-memory-guard.md)
owns activation; staging files does not activate it.

Audio plays into silent `agent-sandbox`; default `pw-record`/`parecord` captures
its monitor. Deliver audio as a file for the operator to play.
Keep routing env intact. Reuse existing checkouts; stop only owned processes.
