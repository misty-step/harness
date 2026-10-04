# Summon Cloudflare candidate — protocol v1

Rust `protocol/` owns transitions and wire types; Rust `worker/` hosts them in
workers-rs and a SQLite-backed Durable Object per run. **Candidate for review,
not deployed, adopted, product Done, or a new formal experiment.** No model calls,
queues, workflows, schedules, effects, or Glass writes. The default pilot is
loopback-only. `wrangler.canary.jsonc` is a separate, fail-closed hosted source
configuration; it has no allocated Access app, audience or principals.

## One authority

New runs use reserved `cf1:` IDs and DO names `summon-v1:<run_id>`. The DO alone
owns task/input/phase/proof metadata. Never submit these runs to PR219's TS
SQLite store, import that store, or dual-write. Native runtimes own native
sessions/transcripts; a future runner owns only transport spool/native facts.
Mage/executive delivery envelopes carry opaque commission/run/input references,
not phase authority. No executive channel enters the transition state.

Compared with PR219 original `98ec60a` (cherry-picked as base `6834ea5`): retain
immutable intake, exact-text input deduplication, ordered between-turn dispatch,
no automatic ambiguous resend, native-session identity, task-defined checks,
research without Git/Glass, artifact verification distinct from product Done.
Extend context selection, exact attempt receipts, explicit receipt issuers,
action holds and whole-workspace snapshot coverage. No TS paths are changed.
Definitive native ACK+answer can reconcile an initially unacknowledged uncertain
attempt, unlike the TS store's requirement for a previously persisted ACK.
It can never authorize a resend or classify an ambiguous input as unsent.

## End-to-end factory versus this kernel

The desired factory composes admission → execution → assessment → real consumer
verification → authorized release → observation. This source implements only the
low-level ordered run/input/native-reference/proof kernel. Runnable source is
not proof it was exercised; test results and exact candidate SHA are reported
separately by the engineer. Neither this boundary nor its local tests claim the
whole factory is Done.

| Boundary | Concrete owner/path | Guard and present scope |
|---|---|---|
| Admission | Commissioner freezes TaskSpec via intake; future runner validates its execution seat | No quota/resource/account admission here; intake is not permission to launch |
| Execution | Standalone runner consumes fresh claim; native adapter invokes/observes/cancels | Frozen route/context, spool, exact input/attempt/session; no blind replay |
| Assessment | Task-selected independent reviewer supplies proof receipt | Named required criterion + allowed issuer + exact coverage; identity remains trusted local assertion |
| Real consumer verification | Project verifier materializes isolated immutable source and invokes task argv/affected consumer | Actual complete snapshot hashing and consumer walk belong to verifier, not DO digest declaration |
| Authorized release | Existing project release owner/tool, outside this API | Current scope/permission and release hold; no effect endpoint or inference from artifact proof |
| Observation | External effect/product owners read back actual promoted version/health | No native exit/merge/check can substitute for external owner facts |

DO-per-run minimizes the first local implementation and isolates ordered writes.
The retained design's one factory DO would also own cross-run admission/calendar;
those are **absent**, not distributed among new competing ledgers. This pilot
has one Summon authority per run, no global scheduler/capacity authority.

Project foundations remain a deliberately adopted pinned contract: lean affected
contract checks plus independent review, isolated immutable preproduction, then
same-byte promotion and readback. Existing older pins stay until deliberate
migration. Full suites run nightly/on demand via existing ADR009 expected-run
and cause-deduplicated incident owners; not a universal every-story rerun here.
Potential Jev relevance/triage is judgment only; code owns facts/coverage/authority/
permission. There is no shipped Jev integration. Glass owns commitments, reviewed
marks and read projections, not chat or controller. A unified chat/control product
needs its own decision; no Glass expansion or retired Linear revival follows.
Standalone Summon requires neither Glass, Git nor Mage.

## Local immutable archives versus requested assessment

`PacketManifestV1::archive(record)` retains the complete canonical owner record,
binding and original child refs, with `proof: None` omitted from JSON. Omission is
**UNASSESSED**, never an empty passing `RecursiveProof`. Use this per node when
retaining a tree; repeating `export` at every ancestor copies descendant issues
quadratically. Derive the full requested root rollup once with `export` or
`reopen` from fresh owner facts and the original child catalog. Local records
already retain missing/failed/uncertain facts and authored inventory gaps.

The Rust `proof` field is now `Option<RecursiveProof>`; requested `export` always
returns `Some`, preserving its existing assessed JSON response. Valid historical
proof-bearing archives retain exact compact JSON bytes/digests/field order.
Their historical proof remains historical; reopening traverses ORIGINAL child
archives at every depth and cannot replace missing originals with new/unassessed
semantic equivalents. Old/new catalogs share the same canonical schema and
reader. Neither omission nor a retained historical pass authorizes current green.

## Authenticated gateway boundary

`protocol/src/authority.rs` owns the deterministic account/project/instance/
namespace and principal/action intersection. `worker/src/auth.rs` alone verifies
Access JWT signatures using WebCrypto RS256. The server pins the observed Access
issuer and its certs URL, never unverified `iss`, `jku` or `x5u`. Configured exact
application audience and strict expiry/not-before/issued-at checks are necessary
but do not grant project/actions. Only configured stable **user sub** grants map
to actors; unknown principals and unsupported service shapes refuse. Native
claim/fact endpoints additionally require explicit native enablement. Actual
service selectors await relay discovery, not guessed email/subject mappings.

`FACTORY_MODE=hosted` requires `FACTORY_AUTH_POLICY` (the shared `AccessPolicy`
JSON). Missing/invalid policy refuses, including on localhost. Hosted mode never
accepts `FACTORY_FIXTURE_JWKS`. Explicit `fixture` mode accepts those ephemeral
public keys only on loopback; fixture audiences/principals prove no live Access
grant. No mode retains the original local pilot's loopback guard.

Hosted/fixture POST `.../proof` is disabled with HTTP 403 `capability_refused`,
even when the configured principal has a generic Proof grant. That grant is not
receipt-source verification: the application must independently bind a receipt's
issuer to its verified source before enabling remote proof writes. The existing
trusted local loopback pilot proof path is unchanged. This is defensive endpoint
refusal, not delivery of the full hosted verifier capability.

Authenticated requests supply `Cf-Access-Jwt-Assertion` and `X-Summon-Authority`
(the exact requested `AuthorityBinding` JSON). These are checked against server
configuration. Incoming actor/internal identity headers are discarded. A fresh
internal DO request carries verified scope/actor. Hosted DO names are
`summon-hosted-v1:<binding-SHA256>:<run_id>`; identical run IDs in different
scopes cannot address the same object. Original creator/scope is stored inside
the canonical private run BLOB in the **same single intake commit**, never a
second ledger. GET `.../authority` returns it; response headers identify the
current verified actor/scope without changing `TaskSpec`, `Status` or `Reply`.
Later device handoff cannot rewrite the original creator, scope or task.

Existing unbound JSON runs remain readable through their original local owner,
not hosted activation. A hosted unbound/wrong-bound row refuses read/replay,
without rewriting accepted bytes. Use a fresh namespace, not unsafe restore.
Hosted supplied-record projection endpoints are disabled: an authorized caller's
arbitrary records are not an authenticated collector. Existing local projection
contracts remain unchanged. The actual workerd proof adds genuine ephemeral RSA
signatures, permission/scope negatives, two-client retry/restart and retained
unbound JSON, explicitly **not** live Access, service/native/provider proof.

This gateway is not shared account/cash admission, command-level actor history,
a packet authorization envelope/private R2 store, Jev, or hosted native execution.
JWKS currently reads the pinned public endpoint per request; network failures
refuse without stale-key/fallback grants. Those remaining boundaries are not
implied by signature or permission tests.

## Concrete HTTP contract

JSON uses snake_case; unknown request fields are rejected. See public Rust types
in `protocol/src/lib.rs` for the complete schema. Stable IDs are caller supplied.
Run IDs are ASCII `cf1:` plus letters/digits/`_`/`-`/`:` (max 128 bytes).

| Method/path | Body | Meaning |
|---|---|---|
| POST `/v1/intake` | `{task, initial_input_id}` | Freeze task + brief as first queued input |
| GET `/v1/runs/cf1:demo/status` | none | Read-only; absent run is 404 |
| POST `.../input` | `{input_id, text}` | Append queued input; duplicate exact text is a read |
| POST `.../claim` | `{claim_id, runner_id, expected_revision}` | Persist dispatching before returning native dispatch |
| POST `.../observe` | observation below | Bind native facts or completed delivery snapshot |
| POST `.../reconcile` | same shape as observe | Only uncertain input; definitive native ACK/answer, never retry |
| POST `.../cancel` | cancel below | Persist cancellation request, NOT stopped/terminated fact |
| POST `.../hold` | hold below | Add/update an action-scoped hold |
| POST `.../proof` | proof below | Bind task-authorized exact-coverage check receipt |

POST success is `{run: Status, dispatch: Dispatch|null, replayed: bool}`.
Status has `protocol_version:1`, `authority:"summon_do"`, `revision`, `run_id`,
`task`, `manifest_sha256`, `phase`, ordered `inputs`, `native_session`, `delivery`,
`coverage_sha256`, `holds`, `cancellations`, `proofs`. GET returns Status directly. Errors are
`{code,message}` (400 malformed, 404 absent/unknown, 409 guard/conflict, 413 bound,
403 non-loopback). POST limit and durable snapshot limit remain 512KiB each;
refusal never commits a partial mutation. Private run snapshots are versioned
CBOR BLOBs: initial text refers to the frozen task, receipts refer to the single
native session, dispatch replays refer to canonical input/task, and final answers
are stored once. Original JSON snapshots remain readable with replay fingerprints
converted in memory; reads do not migrate SQL or advance revision. HTTP schemas
and `RuntimeAdapter` are unchanged.

Admission reserves bounded final answer/ACK/termination/claim bytes for every
unanswered accepted input, using the existing 64KiB text and 4096-byte reference
bounds, plus one maximum lost-ACK observation margin. Intake/steering/holds and
other non-native writes cannot consume it. Native facts may consume that recovery
margin but not the final-answer reservation; same-ID retries never grow storage.
An unsafe write is refused atomically **before** dispatch/acceptance. Metadata is
separately bounded and cannot consume the run's reservation. This is local byte
admission, not implemented hosted account/cash/entitlement admission. Legacy
snapshots accepted without a reservation remain retained/readable; insufficient
legacy capacity is not repaired by inventing room or dropping accepted data.

```json
{
  "task": {
    "id": "cf1:demo", "kind": "research", "brief": "Explain the supplied source.",
    "workspace": "/owned/demo",
    "route": {"harness":"pi", "provider":"openai-codex", "model":"selected-native-model", "effort":"high"},
    "checks": [{"id":"review", "type":"review", "criterion":"Conclusions are supported by the supplied source", "issuers":["commissioned-reviewer"]}],
    "outputs": ["report.md"],
    "source": {"adapter":"glass", "id":"optional-source-id"},
    "commission_ref": "optional-opaque-commission-reference",
    "context": {"instructions":[], "skills":[]}
  },
  "initial_input_id": "commission-1"
}
```

`source`, `commission_ref`, `context` are optional. Within context, omitted
instructions/skills mean runtime defaults; `[]` means none. Values are frozen
instruction text or skill references resolved by the runner. They cannot replace
built-in/non-overridable permissions. The runner must validate workspace,
confinement, route, capabilities, entitlement and permission before invoking.
The cloud cannot validate a Linux directory. Routes are explicit selectors;
there is no fallback and accepting intake does not admit paid/native execution.
Checks are supplied independent of task kind. Commands use explicit argv; reviews
use criteria. Both require frozen allowed receipt issuers. Zero checks permits
work but can never become verified delivery.

A fresh claim response includes `{run_id,input_id,attempt_id,runner_id,text,
text_sha256,task,native_session}`; `attempt_id` is `claim_id`. Task is the entire
frozen TaskSpec. A matching claim retry returns the same dispatch with
`replayed:true` **and is NOT permission to invoke again**. Lost response after
claim is ambiguous: inspect/reconcile native or local spool evidence, never
blindly invoke from a replay. Persist a local spool before invoking. Native
execution remains single-turn/between-turn. Different claims cannot take over
possible dispatch, even after disconnect, process loss or unlimited time.
No lease/expiry, automatic cancellation, stopped assertion or timer exists.

```json
{"cancel_id":"cancel-1", "input_id":"commission-1", "attempt_id":"claim-1", "reason":"Commissioner interruption", "authority_ref":"commissioner", "expected_revision":3}
```

Runner reads `cancellations` from status and requests native abort only for the
exact input/attempt/session it owns. Independently observed native exit can be
submitted via observe as `{kind:"terminated",termination:{session,evidence_ref}}`
with the usual stable event/input/attempt/digest/revision fields. Termination is
orthogonal native fact: without a final acknowledged answer the input remains
uncertain/interrupted, never stopped/unsent or retryable. Cancellation itself
cannot terminate or classify a native process. No cloud process supervision is
implemented; the sibling native runtime consumer owns actual abort.

```json
{
  "event_id":"native-ack-1", "input_id":"commission-1", "attempt_id":"claim-1",
  "text_sha256":"<SHA-256 of exact UTF-8 input text>", "expected_revision":2,
  "observation": {
    "kind":"acknowledged",
    "receipt": {
      "session":{"runtime":"pi", "host":"owned-runner", "session_id":"native-session-id", "session_file":"/owned/native/session.jsonl"},
      "native_message_ref":"native-user-entry-id", "evidence_ref":"native-transcript-receipt-ref"
    }
  }
}
```

`answered` uses the same exact receipt plus `text` (final native answer) and
`answer_ref` (native assistant entry). Completion-only adapters may submit this
combined native ACK+answer, but transport acceptance is never a native ACK.
`uncertain` uses `{kind:"uncertain",reason,evidence_ref}`. It preserves any ACK,
never clears session, and blocks all further claims. Delayed native facts use
reconcile against current status revision, with stable event ID. Event IDs bind
exact arguments (including the original expected revision); exact retries read
current status without committing. A native session is the exact tuple
runtime/host/session_id/session_file and cannot switch across inputs.

Delivery after all inputs are answered:

```json
{
  "event_id":"delivery-1", "input_id":"commission-1", "attempt_id":"claim-1",
  "text_sha256":"<input digest>", "expected_revision":4,
  "observation":{"kind":"delivery", "delivery":{
    "workspace_sha256":"<complete immutable workspace snapshot SHA-256>",
    "revision":"optional exact candidate revision; null for non-Git work",
    "artifacts":[{"path":"report.md", "sha256":"<artifact bytes SHA-256>"}],
    "evidence_ref":"immutable-snapshot-manifest-ref"
  }}
}
```

`revision` is actually JSON string or null (the illustrative text above is not a
literal revision). All digests are 64 lowercase hex. Workspace digest must cover
all relevant source, including undeclared/untracked/dirty files, via a complete
immutable snapshot. HEAD plus declared outputs is insufficient. DO records a
candidate snapshot, not verified artifact truth. The external task-authorized
verifier must retrieve/hash that immutable snapshot and artifacts and actually
run the named check. Its receipt binds `coverage_sha256` returned by status.
Coverage is SHA-256 of typed canonical JSON containing frozen manifest digest,
ordered complete input/answer/native receipts and complete Delivery. Steering
removes current delivery; changed snapshot/revision/artifacts makes old proof
historical. Status derives phase; there is no phase-write API.

```json
{"proof_id":"check-invocation-1", "check_id":"review", "coverage_sha256":"<status coverage digest>", "issuer":"commissioned-reviewer", "verdict":"pass", "evidence_ref":"exact-snapshot-review-receipt", "expected_revision":5}
```

Every required check must have its latest current-coverage verdict pass; block,
missing, stale or unauthorized receipts cannot verify. Verified delivery is
artifact acceptance only, never merge/deploy/external effect/product Done.
This loopback pilot treats issuer/authority strings as trusted local caller
assertions, **not authentication or proof of independent review**. It refuses
non-loopback requests; hosted operation requires separate authentication and
receipt-source verification approval. Arbitrary candidate digests alone never
satisfy checks; only current-coverage receipts from the task's allowed issuer do.

```json
{"hold_id":"approval-1", "action":"release", "reason":"Owner approval required", "authority_ref":"source-owned-decision-ref", "active":true, "expected_revision":5}
```

Actions: dispatch, verify, release. A release hold never blocks status, input,
native observations or verification; there is no release effect endpoint.
A verify hold prevents proof import/verified phase; a dispatch hold prevents new
claims but never erases in-flight facts. Clearing uses same hold ID/action/authority
and current revision. Expected revision is required for every state mutation
except append-only exact-ID intake/input. Conflicts require a status read and
re-evaluation, not silent CAS retry of external work.

## Recursive read/export contract (shared Rust source)

`visibility::AgentRunAttemptV1` is the single version-1 agent/run/attempt read
schema; `evidence::PacketManifestV1` is the single packet schema. Native/Mage
collectors must import these types, not create parallel author schemas. Existing
TaskSpec/Status/Reply/mutation wire and RuntimeAdapter are unchanged.

- `management: summon|observed_only`; `managed: Option<Status>` retains the
  original DO facts, not a second phase machine. An observed-only native CTO or
  worker has `managed:null`, no invented run/attempt and unknown Summon phase.
  A failed managed reader may retain a known run reference with no Status and an
  explicitly unavailable source; it cannot invent an attempt.
- Each `SourceStamp` includes owner, original reference, read timestamp in Unix
  milliseconds, digest, `current|missing|stale|failed|uncertain|cancelled|inaccessible`
  and optional detail. `Fact<T>` binds supplied source/value bytes. Freshness is
  a source observation, not automatic lease-age logic or authenticated identity.
- `Origin` freezes original brief, descriptive acceptance, agent identity and
  attributed already-authored rationale/decision source refs. It never replaces
  TaskSpec checks/outputs or non-overridable native permissions, and never
  reconstructs private thinking. `RunMetadata` carries origin/native/lineage,
  candidate/deliverable/trace/check/review/consumer/authorization/release refs,
  and immutable child packet refs. A separate default-empty `decisions` list
  retains later already-authored CTO dispositions without changing frozen origin;
  decision source identity/digest and registered relationship history cannot be
  removed or rewritten to hide a failed/interrupted child. It is source metadata,
  not aggregate status.
- `Lineage` explicitly states discovery completeness and unresolved inventory.
  Child/dependency edges retain stable identity, source owner/digest/reference
  and original provenance. Shared children are one node with multiple edges.
- `VisibilityGraph::new` rejects conflicting identities/edge owners/provenance
  and known cycles before projection/export. Iterative traversal is stack-safe;
  snapshots are bounded to 10,000 records, pages to 128, with digest-bound cursors.
  More work is explicit drill-down/incomplete discovery, never a green parent.
- Packets retain failed/interrupted/unavailable records; successful export is
  archive construction, not verification. Recursive pass is freshly derived
  from source/current managed proof, complete discovered inventory and bound
  child archives. It is not product Done, release authority or authenticated
  independent review. Missing child/catalog/evidence or reader failure blocks it.
  Required receipts come from the frozen managed task and actual native/delivery/
  check facts: complete snapshot reference; each acknowledged input's native trace;
  each declared output path and exact artifact bytes; each original check's current
  passing receipt/reference and task-allowed issuer (command or review kind).
  Required receipts must carry the exact current candidate and coverage digests.
  Empty, partial, unrelated, unbound or stale evidence is incomplete, without
  invalidating a useful immutable archive. There is no universal consumer/review
  quota and descriptive origin/metadata cannot change checks or permissions.
  Loopback issuer strings and synthetic receipts still are not hosted auth or
  independent materialization/verification.
- `binding_sha256` excludes read timestamps and child archive timestamp-only
  refreshes; actual archive hash includes every byte. Candidate/coverage/edge/
  native/source-state/semantic child changes invalidate recursive currentness.
  `reopen` verifies ORIGINAL bound child archives against fresh source inventory,
  not a convenient latest archive. It never writes run phase.

### Local read/source-metadata API

| Method/path | Shared Rust body/result | Fact owner |
|---|---|---|
| GET `/v1/runs/cf1:demo/view` | `AgentRunAttemptV1` | Existing run DO plus original referenced native/commission sources |
| GET `.../packet` | `PacketManifestV1` | Read-only local export; absent child sources/archives remain unresolved |
| POST `.../metadata` | `MetadataRequest` → read record | Run DO owns registered source metadata, not native truth or aggregate phase |
| POST `/v1/visibility/page` | `PageRequest` → `GraphPage` | Pure supplied source snapshot projection |
| POST `/v1/visibility/export` | `ExportRequest` → `PacketManifestV1` | Pure supplied records + immutable packet catalog |
| POST `/v1/visibility/reopen` | `ReopenRequest` → `RecursiveProof` | Fresh source/candidate/child validation, no writes |

Metadata body: `{expected_run_revision, expected_metadata_sha256, metadata}`.
Read the CAS digest from `view.metadata_sha256` (`null` before metadata). Freeze
origin before any claim; already-started runs remain explicitly missing original
origin metadata rather than backfilling invented rationale. Original acceptance
and brief cannot change. Later dispositions append attributed source references.
Lineage registration preserves all original outgoing child/dependency edges,
owned by this `summon_do:<run_id>` with original delegation provenance. Changing
an edge identity/owner/reference or deleting it is refused. A failed source may
retain last-good bytes with failed/stale/inaccessible state, never current.
These local caller assertions are **not** authenticated discovery completeness.
Collectors must actually read each source and mark missing/failed inventory;
export independently blocks absent reachable records or child packet catalogs.
No permission, native input state, kernel revision or phase is changed by reads,
projection/export or metadata. Separate SQLite metadata commit has run+metadata
CAS and the same 512KiB bound; it is not another mutable run ledger.

```json
{"root":"cf1:demo", "records":["<AgentRunAttemptV1 read from real sources>"], "packets":["<bound PacketManifestV1 archives>"]}
```

The strings above denote typed objects, not valid literal record payloads.
`page` additionally accepts `{cursor:null,limit:64}`; `reopen` uses
`{packet,records,packets}`. Missing discovery/child facts produce explicit issues
and `recursive_pass:false`; exporting/reopening an interrupted archive is not an
error or fabricated success. Read-only unmanaged native records carry
`management:"observed_only", managed:null`, actual agent/native references and
no run/attempt IDs. A collector must not import its executive channel as phase.

`archive_sha256()` hashes the deterministic compact JSON manifest representation
including read timestamps (write `serde_json::to_vec` bytes for exact archives).
Semantic bindings ignore only read timestamps, CAS metadata token and child
archive timestamp-only refresh identity; a changed child semantic binding or
failed current reader is never fresh. Reopen still requires original immutable
child archive bytes, not a convenient latest file.

Deep/shared/cycle/failure graph tests in `protocol/tests/visibility.rs` and
metadata history tests are **fixtures**. Workerd HTTP/SQLite read/metadata/export
and restart paths are separate real runtime proof with synthetic native facts;
actual native collection, snapshot materialization and independent review remain
separate owner proofs. See reported exact-head execution receipts, not a prose
claim that a source file or successful archive export is verified delivery.

## Local proof commands

Pinned dependencies live here only. Use run-scoped TMPDIR under `~/.cache/tmp`.
Build portable WASM on approved `harness-ws` with `CARGO_BUILD_JOBS=2`:

```sh
F=agent-config/candidates/summon/factory
export SESSION_CLOSE_OWNER="pi:$PI_SESSION_ID"
ws up --task factory-core-pilot
ws sync --task factory-core-pilot
# If tools were installed task-scoped, export their existing CARGO_HOME,
# RUSTUP_HOME and PATH inside this shell. No credentials belong in the build.
ws run --task factory-core-pilot -- sh -c 'agent-config/candidates/summon/factory/scripts/build-worker'
ws pull --task factory-core-pilot worker-build.tgz
tar -xzf "$HOME/.cache/tmp/ws/harness/factory-core-pilot/worker-build.tgz" -C "$F/worker"
cd "$F"
npm ci --ignore-scripts
npm run proof
```

`tests/workerd.proof.mjs` starts/stops its own local Wrangler/workerd, uses a private
run-scoped persisted DO directory, and exercises actual HTTP + SQLite persistence
including restart and atomic rejection at the storage bound. These are real
HTTP/runtime/persistence checks with synthetic native facts, **not** proof of
native Pi delivery or actual reviewer/materialized snapshot authenticity. No
account/resource/auth command, remote binding, native turn or paid call. `npm run dev` is for manual local inspection after the WASM build.
`worker-build` 0.8.5 and Rust 1.98 are the exercised toolchain; Python 3 writes
the build manifest. Cargo.lock/package-lock pin dependencies, including matched
workers-rs macro/sys versions and bindgen. `strip=debuginfo` preserves required
WASM target features (symbol stripping breaks bindgen catch wrappers).
Pinned Wrangler's bundled workerd supports compatibility date 2026-09-25.
The build script rejects uncommitted factory source, runs protocol tests and
records exact Git HEAD plus WASM/glue byte digests. The HTTP test refuses stale
HEAD, dirty source or changed generated bytes before starting workerd; logs
report actual checked HEAD and run-scoped evidence directory. This prevents a
false green against yesterday's WASM. Test runner concurrency is 1. Protocol checks can run locally bounded with jobs=2.
The candidate proof is explicit opt-in: `.proof.mjs` avoids Bun's recursive
legacy `.test` discovery. The existing fixed shared gate still covers PR219's
TS contracts, not this Rust/workerd candidate. No root gate or CI migration is
included (outside ownership).
If the repository's filesystem secret scanner flags third-party node_modules
fixtures, move that ignored install directory into run-scoped scratch before
ws sync/commit; set `WRANGLER_BIN` to its absolute wrangler/bin/wrangler.js for
`npm run proof`. Do not change scanner exclusions or bypass gates.

Remaining boundaries: no real native transport consumer yet in this subtree,
no Linux confinement/admission implementation, no hosted auth/deployment,
no production backup/restore. Local DO restart proves persistence, not hosted
PITR or native session recovery. Snapshot evidence is owned by the external
verifier; this cloud state machine cannot inspect arbitrary Linux bytes.
