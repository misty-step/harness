# Bounded configured snapshots

This is a snapshot/verification primitive, not a complete fleet rebuild. No
installer, service, timer, credentials or retention policy is changed by opting
into a config. Without `--config`, the existing legacy source selection,
OMP prerequisite, schema-1 manifest and Glass drill layout remain. Both Hermes
staging paths reject special files and snapshot `.sqlite3` as well as `.db` and
SQLite-header files. Legacy Hermes staging retains its previous file/directory
link dereferencing (including external targets); linked SQLite uses the online
backup API, and directory cycles fail clearly. Configured sources still reject
every link. Legacy real link targets cannot overlap backup state/scratch. The
legacy OMP input remains direct to restic; configured OMP is staged/inventoried.

## Source config schema 1

[`sources.fixture.json`](sources.fixture.json) is a **synthetic path example**,
not an approved production manifest. Its paths do not refer to an operator's
home or contain credentials. Production config is private and separately curated.
Do not just replace its base path and claim complete recovery scope.

The top object has exactly `schema: 1`, `mode`, and a nonempty `sources` array.
Each source has exactly:

| Field | Contract |
| --- | --- |
| `id` | Unique `[a-z][a-z0-9_-]{0,63}` staging namespace |
| `role` | Same syntax; owner/role label, not an activation instruction |
| `tier` | `hot` or `cold`; both are backed up, this only classifies retrieval |
| `required` | Boolean; true requires **every** included path, even empty directories |
| `root` | Canonical absolute path, not `/`, no `..`, expansion or symlink ancestors |
| `include` | Nonempty array of literal relative files/directories; no glob, absolute path, empty component, `.`, `..` or overlap |

Selections must not overlap within or between sources. A selected directory is
recursive; its entire subtree is the explicit scope. There is no home scan,
implicit profile discovery, cache filter, credential discovery or automatic
exclusion policy. Select individual durable children to omit caches/build trees.
There must be at least one required source. Optional missing selections are
recorded as `missing` or `partial`, never silently claimed complete; unreadable
or malformed existing optional data still fails the run.

`mode: "hermes-only"` is the only mode that drops the OMP prerequisite. It
forbids `role: "omp"`. `mode: "with-omp"` requires an explicit **required** source
with `role: "omp"`; for example a fixture source with root
`/home/fixture/recovery-input/omp` and include `["sessions"]`. Nothing implicitly
selects `.omp` or requires Glass in either configured mode.

All symlinks are rejected clearly, including in-root links and ancestor links.
Declare the desired real target as another explicit source instead; resolving
skill/runtime links on rebuild is still a consumer responsibility. Sockets,
FIFOs and other special files are rejected. Source directory topology must remain
stable during the cut: concurrent directory renames/link swaps are **not** an
adversarial race-safe snapshot contract. Ordinary SQLite/file writers are
supported; a regular file whose size/mtime changes during its copy fails the run.
Use a quiesced/versioned tree where multi-file config consistency is required.

`.db`, `.sqlite3` and regular files with a SQLite header use the existing bounded
online backup API plus `quick_check`. Never copy main/WAL/SHM/journal files raw.
Sidecars within selected directories are omitted only when a corresponding
SQLite main file exists; orphan sidecars fail closed. Selecting a sidecar itself
is an error. Each DB is consistent independently, not one transaction across
stores/hosts. No source WAL checkpoint, deletion or writer shutdown is performed.

## Fixture-only invocations

From the harness repository, after creating synthetic inputs and changing the
sample roots to an existing **fixture** directory:

```sh
python3 agent-config/session-backup/backup.py \
  --config /home/fixture/recovery-input/sources.json \
  --stage-only /home/fixture/recovery-output/snapshot
python3 agent-config/session-backup/backup.py \
  --verify-stage /home/fixture/recovery-output/snapshot
```

`--stage-only` needs `--config` and a **nonexistent** target under an existing
parent. It never runs restic, queries Glass, writes last-success, or touches a
service. An existing target (even empty) and overlaps with selected input are
refused. Failure removes only the newly created staging tree. Staging uses a
private 0700 outer directory, preserves selected file/directory mode and mtime,
and materializes synthetic parent directories as 0700. The CLI uses umask 077.
HOME and staging destinations reject `..` spellings and symlink ancestors before
containment checks or removal; they are never silently resolved through links.
Cleanup adds owner permissions only to opened, owned staging/proof directories,
does not follow links or chmod source files, and supports preserved 0555 trees.
Existing `backup.lock` and `last-success.json` leaves must be regular files owned
by the invoking UID with exactly one hardlink; unsafe leaves are refused before
lock creation, stale-stage removal or transport. Lock acquisition uses
`O_NOFOLLOW`, checks the opened inode and never truncates existing bytes, even
when another run holds the flock. Success receipts are written to an exclusive
0600 temporary file, flushed and atomically replaced; the old inode is never
written. An existing read-only receipt still refuses publication. Failed writes
or replacement leave the previous receipt intact and emit no success JSON.
Both manifest layouts create `manifest.json` exclusively rather than overwrite
an existing leaf. These checks retain the stable-topology assumption above;
they do not claim protection against adversarial concurrent ancestor swaps.
If cleanup itself fails, the primary failure is retained with a cleanup note.
No secret file is needed for fixture inputs: use synthetic `private-config.json`,
not a copied `.env`, auth store, vault or password-store entry.

For the real **local-repository fixture** path, with restic already on PATH:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s agent-config/session-backup -p 'test_*.py' -v
```

These tests use fresh temporary paths and an isolated synthetic local repository
with fixture-only encryption input. They never read production restic bindings or
access R2. Restic integration tests explicitly skip if restic is unavailable.
Doubles exercise restore failure and unchanged retention ordering; real local
restic also proves exact-snapshot restoration after removing the original fixture
and rejects injected corruption of the actually restored bytes. This is **not**
offsite/fresh-server/application recovery evidence.

## Snapshot manifest schema 2

All configured inputs are staged under `sources/<id>/<include-relative-path>`.
`manifest.json` is written once before upload; upload/verification receipts stay
outside the snapshot. A restic snapshot makes those manifest bytes immutable.
The object contains:

- `schema: 2`, `source_host` (actual source hostname), `mode`.
- `config_sha256`: SHA-256 of source config JSON, sources sorted by `id`, JSON
  keys sorted, separators `,` and `:`, ASCII escaping, UTF-8 encoded, no newline.
  `backup.config_digest()` is the canonical implementation. Source object order
  in a decoded manifest is irrelevant.
- `cut_started`, `cut_finished`: UTC ISO-8601 interval encompassing this staging
  run. These describe capture, **not** upload completion or application uptime.
- `sources`: object keyed by source id. Each value contains the original `root`,
  `role`, `tier`, `required`, `include`, a `missing` array, status
  `complete|partial|missing`, and per-source `cut_started` / `cut_finished`.
- `files`: exact staged inventory keyed by safe relative POSIX path. Directories
  (including empty/synthetic parents) have `kind: "directory"`, integer `mode`
  (permission bits) and integer `mtime_ns`. Regular bytes have `kind: "file"` or
  `"sqlite"`, lowercase SHA-256 `sha256`, integer `size`, `mode`, `mtime_ns`, and
  per-file capture `cut_started` / `cut_finished` inside the source interval.
- `databases`: subset of `files`, mapping every SQLite path to its SHA-256.
- `oldest_required_cut`: minimum **start** of all required source intervals,
  including required cold sources. Using starts conservatively bounds loss; the
  exact SQLite transaction point lies within its file interval.

The config SHA is a coverage identity, not a signature. Authenticate the exact
snapshot via the approved restic repository and compare the expected source
manifest/roles separately; internal consistency alone does not prove that the
operator selected every required store. `mtime_ns` is recorded/preserved metadata,
not a cross-filesystem timestamp precision gate. Verification checks exact path
inventory, types, modes, sizes, all file hashes, required selection coverage,
config digest, cut bounds, DB subset and read-only immutable `quick_check`. It
rejects extra/missing paths, links and any restored sidecars. It never consults
source paths, so it works after the original host/roots are gone.

## Thin rebuild consumer and later approved activation

1. Select exact authenticated snapshot ids covering the externally approved
   role/host/source-config set. No unfiltered `latest` or single-host completeness
   assumption. Obtain the original staged path from the snapshot metadata or the
   configured last-success receipt's `stage` field.
2. Restore the exact `SNAPSHOT_ID:ORIGINAL_STAGE_PATH` into a fresh private target
   with restic `restore --verify`. Invoke `backup.py --verify-stage TARGET` before
   installation. When an independently retained receipt is available, also compare
   the restored manifest file SHA with its `manifest_sha256`.
3. Compare required source ids, roles, original roots, tiers and config identity
   against the private recovery plan. For each required snapshot, measure
   `drill_start_utc - oldest_required_cut <= 24 hours`; the overall recovery set
   uses the **oldest** cut across all required hosts. Never substitute receipt
   mtime, upload time or the newest DB's cut. This primitive records inputs for
   that check; it does not establish a scheduling or maximum-loss guarantee.
4. Map `sources/<id>` to approved owned destinations; keep service/cron/adapters
   parked. This primitive deliberately does not install, rewrite, activate, claim
   cross-store atomicity, reconcile outbox effects or bootstrap native logins.

The later approved backup invocation is the existing names-only credential
launcher plus `backup.py --home HOME --restic BINARY --config PRIVATE_CONFIG`.
Without `--stage-only`, this **writes to the existing repository and invokes the
unchanged tag/host-scoped forget policy** after the exact uploaded manifest and
all configured files/DBs are restored and verified. Do not execute it as a
read-only inspection. The last-success receipt adds `scope_restore`,
`oldest_required_cut`, `source_host`, `verified_at`, `manifest_sha256` and `stage`
to the legacy snapshot/count fields. Failed upload/restore/integrity checks never
apply retention or overwrite the prior success receipt. Owned proof and staging
cleanup must finish before retention, receipt writing or success JSON; a cleanup
failure is not a success. Production activation,
full private hot/cold source reconciliation, independent key escrow, offsite
retrieval and a real fresh-host rebuild are separate approved work.
