# Local native staging: final-fetch source boundary

The final-fetch source continuation of frozen `f749c756` was delivered at `f764b84`
without changing the portable SDK. The later commission/report identity repair
changes only its shared submission guard; `host.mjs` and this native guard remain
unchanged. This is source/zero-provider proof, **not permission to send**.
USD20 authorizes only the no-model Cloudflare recovery canary, not this route.

## What is enforced

- `runtime.mjs` without `native_staging` is inspection-only. Submission, wake,
  wait/resume and all model sends refuse; compaction is refused in this staging host.
- A fresh, explicitly handed-off pair of Durable conversations gets only source
  memory/recall, skill/context reads, canonical factory **read**, and COO internal
  commission. CTO factory intake/steer/cancel, external integrations, bash/read/MCP,
  deferred writes, image/classifier and alternate model/account routes are absent.
- `native-stage.mjs` binds provider affinity to the actual role conversation,
  placed native submission and original commission/reporter records. The three
  admitted inputs are the specified COO input, its CTO commission and original COO
  report wake. One input per run; steering cannot manufacture a new request bucket.
- `native-final-guard.mjs` registers wrappers around BOTH original native provider
  `stream` and `streamSimple`, retaining its original OAuth object, catalog and
  request conversion. SSE and retries0 are mandatory. A caller-supplied fetch
  cannot bypass the captured owner transport.
- The original `onPayload` callback executes first. Actual native declarations
  must equal the trusted role declarations; the post-callback physical tools must
  retain their complete original schemas. Wrong model/effort/tool type/name/schema
  or post-callback body over96KiB refuses.
- At the **last fetch**, final native URL/method/account/AbortSignal are checked.
  Actual `RequestInit.body` is independently parsed, including bounded zstd
  decompression, after all earlier transformations. Unknown encoding/body refuses.
  Final headers and wire bytes are copied before asynchronous admission; OAuth
  Authorization remains opaque and is forwarded only to the original sink.
- The selected account pseudonym matches the native `ai-usage` algorithm:
  `acct-` + SHA256(`ai-usage:` + FINAL `chatgpt-account-id`)[0..10]. No token decode,
  export, credential file read/copy, new endpoint or audience is implemented here.
- Rust `native-admit` invokes the host-bound quota reader **at every final fetch**.
  It requires the same account/route and the original stored authentication,
  fresh usable plan quota without degradation, positive remaining allowance and
  explicit `extra_usage_enabled:false`. Unknown is refused.
- One SQLite policy/counter scope in `broker.sqlite` reserves an immutable native
  send intent BEFORE original fetch:12total/4perinput. Both stream paths and the
  three role inputs share it. Restart, another input ID or another admission ref
  cannot reset it; failed/ambiguous sends never refund it. These are execution
  attempt facts, not account allowances or another task/run/schedule ledger.

Native output-token limit enforcement remains **unproven**. A startup auth/catalog
snapshot, a plan billing label, or a model tool/header hook is not admission.

## Host configuration (names/facts only)

A fresh owner-only state directory and new scoped conversation handoff are required;
the native9+1 observations and old state are retained, never silently reconfigured.
Add the following host-owned field to `mage-executive/1` configuration:

```json
{
  "native_staging": {
    "admission_ref": "actual-coordinated-stage-reference",
    "account_ref": "acct-0123456789",
    "coo_input_id": "original-coo-input",
    "commission_id": "original-commission",
    "quota_reader": {
      "executable": "/absolute/owned/native-quota-reader",
      "args": [],
      "env_names": ["HOME"]
    }
  }
}
```

This field must come from the owning coordinator, not model text. No external
grant/integration is selectable in this staging configuration. Tool schemas and
source memory are still the original Mage registration, not a stock Pi seat.
The old Summon read-four pilot's permissions/budget are NOT inherited.

The reader consumes its **existing supported** account metadata and returns:

```json
{
  "schema":"mage-native-quota/1", "owner_ref":"actual-owner-observation",
  "account_ref":"acct-0123456789", "provider":"openai-codex",
  "model":"gpt-6.1-sol", "effort":"xhigh", "auth_type":"oauth",
  "auth_source":"stored", "billing":"plan", "verdict":"usable",
  "observed_at_ms":0, "remaining_percent":75,
  "extra_usage_enabled":false, "degraded":null
}
```

`observed_at_ms:0` above intentionally cannot pass. The real observation must be
current (not future, at most300seconds old). Reader failure, missing explicit
extra-usage state, exhausted/degraded/unknown quota or other account refuses.

**Existing reader gap:** the installed `ai-usage` dispatch view supplies account,
route, age, verdict and plan billing, but not an explicit Codex extra-usage-disabled
fact. Its Codex parser normalizes absent credit flags with `bool(...)`; that must
not be relabeled proof that overage is disabled. No new collector/probe permission
is inferred. A supported owner-produced explicit state join is still needed.

## Zero-provider checks

The optional installed-SDK test uses public `ModelRuntime.create`, a synthetic
in-memory `CredentialStore`, the ORIGINAL legacy Codex provider and fake HTTP
transport. It reads no workstation auth and makes no provider/key/quota API calls.

```sh
export TMPDIR="$HOME/.cache/tmp/mage-guard-RUN"; mkdir -p "$TMPDIR"
export CARGO_BUILD_JOBS=1 CARGO_TARGET_DIR="$TMPDIR/target"
cargo test --locked --manifest-path agent-config/candidates/mage-executive/Cargo.toml -- --test-threads=1
cargo build --locked --manifest-path agent-config/candidates/mage-executive/Cargo.toml
NATIVE_PI_SDK_ENTRY=file:///absolute/installed/pi-coding-agent/dist/index.js \
MAGE_NATIVE_GUARD_BINARY="$CARGO_TARGET_DIR/debug/mage-executive" \
npm run test:native-guard --prefix agent-config/candidates/mage-executive
```

Negatives reach the original provider callback/final-fetch path: wrong final
account, low effort, mutated postcallback model/tool/schema/oversize body, altered
serialized zstd body, already-aborted request, credit/unknown/extra-usage state and
fifth request through raw stream. Positive fixture paths prove unchanged auth/
catalog, caller-fetch non-bypass and12fake physical calls across three inputs.
Rust checks exercise durable12/4 counts, reopened exhaustion, input/ref reset
refusal, fresh same-account quota/extra-usage and stage effect/tool refusals.
These are guard source proofs, not included billing or real native execution.

## Canonical join remains blocked

Core/Hosted must supply the admitted broker and supported native/cloud Models
composition, actual final-account/extra-usage observation, and exact input/loadout
admission before a coordinated real walk. Existing service scope is still the
six factory actions, not native/claim/proof/provider/cash. No desktop proxy,
synthetic engineering report, inferred native grant or live Hermes migration.
