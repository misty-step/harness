# Workstation development execution

The [desktop memory guard runbook](../../docs/desktop-memory-guard.md) owns the
current native design, two-slot admission, staging, verification, cutover and
rollback (US-043). Portable heavy execution goes through `ws` to the project's
owned exe.dev workspace; local exceptions use `desktop-guard run -- <command>`
**after activation**.

The September 14 setup was an optional `dev-exec.slice` with high/max/swap limits
of 48/60/8 GiB and no admission control. It did not contain the engineer fleet;
the slice was effectively empty during the September 26 fleet OOM. Its earlier
small-hog proof established only the explicitly wrapped job boundary, not fleet
safety. See the [September 26 postmortem](../../docs/postmortems/2026-09-26-shared-terminal-oom.md)
and the [original September 9 incident](../postmortems/2026-09-09-workstation-memory-exhaustion.md).

Staging the new guard does not change those live limits or move any existing
process. The operator's cutover backs up and replaces the old user unit and its
limit drop-in together; leaving the old drop-in would override the new budget.
Do not run the retired unique-name `systemd-run` recipes to bypass the two
admission slots. Daemon-created containers still require separate bounds:
containing the client does not contain work created by another manager.
