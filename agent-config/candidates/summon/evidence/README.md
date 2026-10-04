# summon-evidence (source candidate)

Standalone Rust read/retention/export consumer. The authoritative schemas and
recursive/freshness guards are `../factory/protocol::{visibility,evidence}`.
This crate does not own a scheduler, executor, DO phase, mutable run ledger,
shared protocol replica, model call, or visual surface. Nothing here is deployed.

## Build and read

```sh
CARGO_BUILD_JOBS=2 cargo test --locked -- --test-threads=1
cargo build --locked
summon-evidence snapshot SOURCES.json /absolute/private/archive RECORDS_NEW.json
summon-evidence page RECORDS_NEW.json ROOT [LIMIT [CURSOR.json]]
summon-evidence export RECORDS_NEW.json ROOT /absolute/private/archive
summon-evidence reopen /absolute/private/archive BUNDLE_SHA [FRESH_RECORDS.json]
summon-evidence object /absolute/private/archive OBJECT_SHA
```

`page` emits shared `GraphPage`, including unresolved facts and a revision-bound
cursor. `snapshot` emits shared `AgentRunAttemptV1` records to a **new** file;
it never overwrites an artifact. `export` retains the shared `ExportRequest`
frame, root `PacketManifestV1`, each exact original child manifest, filtered
native trace and candidate/source artifacts as immutable SHA-256 objects.
Copy the entire private archive directory to reopen without Glass. Missing
children are not recovered from an inline/latest manifest. `object` reads only
retained JSON, not the original raw native transcript. Output bounds are explicit.
A successful process/export is not recursive pass, verification or task Done.

`SOURCES.json` is input selection, not run state. Example (fixture names/IDs):

```json
{
  "root": "fixture-agent",
  "parents": {},
  "commission_entries": {},
  "native": [{
    "agent_id": "fixture-agent",
    "session": {
      "runtime": "pi", "host": "fixture-host",
      "session_id": "fixture-session",
      "session_file": "/absolute/native-owner/session.jsonl"
    },
    "candidate": "/absolute/git/worktree",
    "herdr_reference": "/absolute/captured-herdr-agent-get.json"
  }],
  "do_views": [{
    "run_id": "known-managed-run",
    "url": "http://127.0.0.1:8787/v1/runs/known-managed-run/view"
  }]
}
```

Native files must match the exact configured session ID. Supplied Herdr owner
facts must match the actual Pi agent name and native file; they retain the
original observer response, not an inferred native lifecycle. DO reads are
bounded, redirect-free, credential-free loopback GETs of shared source-owned
views. Failed reads retain a known run reference with unavailable facts and no
invented phase or attempt. No API/provider credential is forwarded.

Native-only agents have `management=observed_only`, `managed=null`, and no
invented run/attempt IDs. Persisted append facts do **not** identify the current
in-memory active branch or prove native settlement/termination. Native state
therefore remains unknown/uncertain, even if a Herdr display says working/done.
Discovery is explicitly incomplete until an actual inventory authority exists.
These records/packets cannot give a green parent or claim managed delivery.

## Original authority and privacy

`parents` explicitly selects child-alias → parent-alias registrar intent; ordinary
bidirectional messages never infer a parent relationship. `commission_entries`
selects the exact original `[parent_dispatch_entry_id, child_input_entry_id]`
for each child alias. Only that physically observed pair may create an edge,
with original line digests; shell templates are never evaluated to invent exact
payload equality. Payload/host/order mismatches remain **uncertain**. No selector,
unavailable parent/child source or missing selected entry retains a **named shared
InventoryGap** with child alias and both original references; it never falls back
to a matching later status. Native agent bootstrap may precede its task commission. A status reply cannot create
a fake reverse parent edge. Missing evidence stays unresolved; native
`parentSession` is never invented. The first input/acceptance remains frozen;
later user-authored steering/disposition refs live separately in shared
`decisions`, attributed to the native user role rather than an invented person.
They do not grant tool/project permission or reinterpret the original goal.

Retain authored user/assistant text, native IDs, receipt metadata, tool names,
argument digests, failure/stop facts, usage, and original entry refs/digests.
Never copy thinking/signatures, system bodies, raw tool arguments, tool output
bodies/details, or original full transcripts into the archive. Recognized
credential-looking text blocks are omitted entirely; an omitted first input
cannot be replaced by a later safe input. This is a trusted-principal source
reader, **not** a hardened secret classifier or filesystem/credential sandbox.
Keep private native evidence private and use an explicitly admitted source scope.

## Integrity is not freshness

Objects are owner-only, canonical-path, no-follow, bounded, exact-byte hashed,
file+directory-fsynced, atomically published without overwriting. Reopen is
read-only. Compact shared manifest bytes are used for shared archive digests.
The shared semantic binding excludes read timestamps; a newer read alone is
not a changed candidate. Git candidate manifests bind actual HEAD, tracked and
unignored source paths/bytes, including dirty/untracked source; symlink identity
is hashed without following foreign targets. Original source bytes and available
retained object digests are rechecked. Changed candidates/source/child bindings,
missing objects and inaccessible originals stay explicit issues. Reopen without
fresh shared owner views establishes archive integrity only, not current proof.
Fresh observed-only views omit exporter-owned child refs: reopen reconstructs only
those absent refs from the original frame and recomputes descendant bindings from
fresh owner facts, bottom-up. Managed or explicit owner refs are never replaced.
This removes export-only false staleness, not real source/child changes or gaps.
No implicit newest packet, replacement session, retry, or promotion to green.
Export uses one request-scoped graph/catalog and digest-deduplicated retained
objects. Each new manifest retains canonical local owner facts and original child
refs with omitted stored proof (**UNASSESSED**, never green). The requested root's
recursive rollup is derived once through Core's `reopen`, not retained in every
ancestor. Legacy proof-bearing objects remain byte/digest-exact and can mix with
new manifests; original child objects are still required at every depth.
Prior packet bytes, original edge refs and dispositions remain immutable; recovery creates a new
snapshot/packet and makes the original unavailable-source packet stale, not green.

Tests use clearly labeled native-file/HTTP fixtures, not provider work. They
exercise actual parsing/retention/export/reopen paths: privacy, immutable bytes,
partial/missing sources, named selected parent/child/no-match gaps through
projection/export/reopen and recovery, original-dispatch vs reply lineage, changed candidate
bytes, missing bound child and unavailable DO. Shared graph/deep DAG/cycle tests
belong to the protocol owner. Actual CTO/core/relay source walks are reported
separately; they are not DO-managed task execution or hosted consumer proof.
