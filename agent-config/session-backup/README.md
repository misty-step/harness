# Agent session backups

`./agent-config/install --session-backup` from the workspace root installs the
backup CLI, names-only pass references and **inactive** user units; `--check` is
inert. It reuses Pile's encrypted workstation R2 restic repository (tag
`agent-session-stores`; 30 daily and 24 monthly snapshots per tag and host;
pack pruning stays with the repository owner).

The default legacy run saves `~/.omp/agent/sessions` directly and Kaylee's
`~/.hermes/profiles/kaylee/` `state.db`, `sessions/`, `cron/` and
`plugin-data/kaylee/`. SQLite databases go through the online backup API, never as
live files; snapshots are not one transaction across databases. The run restores
its uploaded Hermes staging tree and compares every SQLite hash before reporting
success or applying retention. Unreadable source files (restic exit 3) fail the
run. `~/.local/state/agent-session-backup/last-success.json` records the snapshot.

Opt-in `--config` selects bounded named hot/cold sources, including memories,
private overlays, executive/default Kanban/projects and `.sqlite3` state, with no
implicit OMP or Glass requirement in explicit Hermes-only mode. See the
[configured snapshot contract](CONFIGURED-SNAPSHOTS.md) for schema-1 source config,
schema-2 immutable snapshot manifests, fixture-only invocations, complete restored
inventory verification and oldest-required-cut RPO inputs. It is not a rebuild
installer or a complete production source manifest. The existing units still use
the legacy invocation; no production timer or retention change is implied.

Activate only after review:

```sh
systemctl --user daemon-reload
systemctl --user enable --now agent-session-backup.timer
systemctl --user start agent-session-backup.service
journalctl --user -u agent-session-backup.service --no-pager
pass-env run -f "$HOME/.config/agent-session-backup.env.pass" -- \
  restic snapshots --tag agent-session-stores
```

Recovery drill, against an exact snapshot and a finished Glass item with a ledger
(needs Go, Git, Bubblewrap and a Glass checkout holding the recorded revision):

```sh
target=$(mktemp -d "$HOME/.cache/tmp/agent-session-drill.XXXXXX")
pass-env run -f "$HOME/.config/agent-session-backup.env.pass" -- \
  python3 agent-config/session-backup/drill.py \
  --snapshot SNAPSHOT_ID --item FINISHED_ITEM_ID --target "$target" \
  --glass-source "$HOME/development/misty-step/board"
```

It restores everything into a network-less sandbox and compares Glass's own
ledger accounting with live Glass. Keep `$target/ledger-proof.json` as evidence;
the restore holds private transcripts (umask 077), so never publish it.
