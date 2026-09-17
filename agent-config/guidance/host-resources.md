## Host resources

Desktop RAM is shared with the operator.

- **Heavy execution:** Run full suites, coverage, and browser/Electron verification off-host by default.
- **Runner budgets:** Cap runner concurrency in repo config, never the host default.
- **Scratch directory:** Always use run-scoped `TMPDIR` under `~/.cache/tmp`, never `/tmp` (RAM tmpfs). Clean up on exit.
- **Fleet hygiene:** Check for existing runs before starting one; stop only processes owned by this session.
