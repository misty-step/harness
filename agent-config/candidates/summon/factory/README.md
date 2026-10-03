# Summon Cloudflare local pilot — protocol v1

Rust `protocol/` owns transitions and wire types; Rust `worker/` hosts them in
workers-rs and a SQLite-backed Durable Object per run. **Candidate for review,
not deployed, adopted, product Done, or a new formal experiment.** No model calls,
queues, workflows, schedules, effects, or Glass writes. All HTTP is local-only.

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
403 non-loopback). POST limit and durable snapshot limit are 512KiB each;
refusal never commits a partial mutation.

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

## Local proof commands

Pinned dependencies live here only. Use run-scoped TMPDIR under `~/.cache/tmp`.
Build portable WASM on approved `harness-ws` with `CARGO_BUILD_JOBS=2`:

```sh
F=agent-config/candidates/summon/factory
export SESSION_CLOSE_OWNER="pi:$PI_SESSION_ID"
ws up --task factory-core-pilot
ws sync --task factory-core-pilot
ws run --task factory-core-pilot -- sh -c 'export CARGO_BUILD_JOBS=2; cargo test --locked --manifest-path agent-config/candidates/summon/factory/Cargo.toml -p summon-protocol -- --test-threads=1; cd agent-config/candidates/summon/factory/worker; worker-build --release'
ws pull --task factory-core-pilot agent-config/candidates/summon/factory/worker/build
cd "$F"
npm ci --ignore-scripts
npm run proof
```

`tests/workerd.test.mjs` starts/stops its own local Wrangler/workerd, uses a private
run-scoped persisted DO directory, and exercises actual HTTP + SQLite persistence
including restart. No account/resource/auth command, remote binding, native turn
or paid call. `npm run dev` is for manual local inspection after the WASM build.
`worker-build` 0.8.5 is required; Cargo.lock/package-lock pin dependencies. Test
runner concurrency is 1. Protocol checks can run locally bounded with jobs=2.
The candidate tests are opt-in here, not added to root gates (outside ownership).
If the repository's filesystem secret scanner flags third-party node_modules
fixtures, move that ignored install directory into run-scoped scratch before
ws sync/commit; set `WRANGLER_BIN` to its absolute wrangler/bin/wrangler.js for
`npm run proof`. Do not change scanner exclusions or bypass gates.

Remaining boundaries: no real native transport consumer yet in this subtree,
no Linux confinement/admission implementation, no hosted auth/deployment,
no production backup/restore. Local DO restart proves persistence, not hosted
PITR or native session recovery. Snapshot evidence is owned by the external
verifier; this cloud state machine cannot inspect arbitrary Linux bytes.
