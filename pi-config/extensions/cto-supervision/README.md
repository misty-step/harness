# Native CTO supervision — candidate, not activated

Repairs `K-20261004-coo-stays-conversational-while-cto-owns` in the existing
Pi 1.0.1 session `01a103e1-9423-76a3-9ec0-17d2b0bad325`. No replacement
session, model/provider wrapper, Hermes writer, board writer, cron, Herdr
scheduler, native SDK fork or terminal injection.

## Owners and native footprint

- `index.ts`: supported Pi commands/events, exact session/file/root-cwd binding,
  coalesced custom-message wakes and finalized native ACK/return handling.
- `branch.ts`: original native branch reconstruction and action-ref validation.
- `runtime/`: Rust Linux inotify/stdio transport, exclusive kernel lock,
  actual **300,000 ms** timer, bounded private files and immutable native returns.
- Hermes export/return is **k-screams's** interface. This component never reads or
  writes the independent ledger. Glass remains work authority.

The Rust helper does not run models, read the board, dispatch engineers, retry
native inputs or maintain persistent work state. The original Pi branch owns
binding, event, may-have-sent intent, actual timer firing, wake message, tool ACK
and export facts. Inbox files are original externally authored event receipts;
return files reference original native messages/actions/ACKs, not a second work
ledger. Queueing, consuming a custom message, working status, helper readiness,
settlement and return export are **not an acted-on CTO pass or COO ACK**.

Every wake retains the primary commission explicitly. A completed advisory
input or `cto_supervision_ack` records only a supervision pass and cannot close,
replace or remove that primary, another pending event or original history.
`closes_primary: false` is a control fact, not a copied Glass status; every pass
must re-read actual work authority. No perpetual fabricated "doing" flag is kept.
Actions, approvals, rank, holds, worker ownership, money and completion remain
with their existing authorities. The module grants no additional execution,
filesystem, authentication, native-provider or Cloudflare authority.

## Export interface

k-screams publishes **create-only**, atomically visible, owner-only regular files
named `EVENT_ID.json` in an agreed canonical mode-0700 native inbox. Both sides
preserve the original IDs/objects. Maximum file 65,536 bytes, maximum 4,096 inbox
entries; do not silently overwrite, remove originals or reuse IDs. Non-JSON
partial-publication files are ignored. A malformed JSON event is reported and
retained without waking for it; other valid owners remain deliverable.

```json
{
  "schema": "cto-supervision.event/1",
  "event_id": "original-immutable-event-id",
  "target_session_id": "01a103e1-9423-76a3-9ec0-17d2b0bad325",
  "kind": "completion",
  "worker": "existing-owner",
  "commission_id": "original-commission-id",
  "source_ref": "original-source-receipt-reference",
  "summary": "Concise authored stopped-owner fact and existing next boundary"
}
```

Exactly these fields; `kind` is `completion` or `blocked`. Event/worker IDs use
1–128 ASCII letters/digits/dot/underscore/hyphen. Commission ID, summary and
reference are opaque nonempty text, at most 2,048 UTF-8 bytes each, no control
characters; original canonical `cf1:` commission IDs are not rewritten. No credentials, raw transcript,
private thinking, tool bodies, commands or new permission claims. Event text is
untrusted data, never executable input. **This is the source interface; path and
Hermes consumer agreement and actual native export/return remain rollout work.**

A 25 ms transport-burst window combines events into one native wake. While busy,
`sendMessage(..., {triggerTurn:true, deliverAs:"steer"})` uses the next supported
turn boundary; while idle it starts the existing session with `followUp`.
One wake admits each distinct batch of NEW event/timer causes. Admission comes
from original native intents claiming those causes, **not** from the arrival of
an older queued wake marker or its ACK. Further original events remain in the
branch and are flushed at supported turn/settlement boundaries. Duplicate
original events or matching timer firings do not create a second intent/wake.
A cleared/lost queued wake cannot suppress a genuinely new event or recovery
pass; its original ID/object/outcome remains UNKNOWN, never inferred unsent or
blindly resent. No ACK is inferred from busy/queued status. The SDK chooses
actual delivery timing.

## Five-minute recovery and restart

The Rust helper watches the inbox immediately and scans originals on startup,
notification and every actual timer firing. A lost filesystem notification or
publication during downtime is recovered by scanning original event files.
The last native timer fact restores the next deadline; an overdue restart
coalesces missed periods, not a burst of model calls. An uncertain old wake is
never resent or reclassified as unsent. A genuinely new heartbeat pass references
unacknowledged original passes for CTO reconciliation, never repeats their
claimed inputs or authorizes replacement effects without original-owner/receipt
reconciliation. The latest unclaimed firing coalesces older missed ticks; no
backlog of model turns is replayed.

Queue observation uses only the supported `turn_end`/`agent_before_settle`
`context.pendingMessages` preview: original native `queue-preview.v1` records
presence/absence of that exact pass in that preview. This is **not a complete
queue inventory, current delivery, pass ACK, no-effect proof or admission lock**.
The installed `ctx.hasPendingMessages()`/UI text count excludes custom queued
messages, so it is not used to infer queue loss. A missing finalized marker
remains uncertain even after an absent preview; new causes remain independently
admissible.

Recovery reconstructs only the active original branch. Moving/switching/forking
that bound branch refuses. Missing finalized wake remains **UNCERTAIN**. Missing
ACK/export/COO receipts remain missing, not successful. Return replay re-exports
only the original durable ACK ID/content; unequal same-ID receipts refuse.
The exclusive helper lock refuses a second transport; no time/PID/lease takeover.
Orderly stop closes owned stdin and waits for owned process close; it does not
abort, reload, reset, create or shut down the native CTO session.

## CTO pass and return

The two control-only tools are registered inactive, `model-only` (not reachable
through codemode or a generic tool bridge):

- `cto_supervision_inspect`: original pass/wake refs and successful native action
  entry IDs, **no transcript or tool bodies**.
- `cto_supervision_ack`: requires original finalized successful non-supervision
  tool-result entries **after** that pass's original finalized wake, plus concise
  summary and original source refs. Empty, stale, failed, missing and queued-only
  actions refuse. The ACK itself must become an original persisted tool result;
  `message_end`/`tool_execution_end` never serves as durable ACK.

After finalization, the bridge verifies original branch IDs on the native
session's disk file, fsyncs file and directory, and exports through the owned
Rust helper. The return directory is a separate canonical mode-0700 native path.
The helper writes immutable mode-0600 `ack-ACK_ENTRY_ID.json`, fsyncs it and its
directory, and confirms export. The receipt's exact fields are:

```json
{
  "schema": "cto-supervision.pass/1",
  "target_session_id": "01a103e1-9423-76a3-9ec0-17d2b0bad325",
  "primary_commission": "K-20261004-coo-stays-conversational-while-cto-owns",
  "closes_primary": false,
  "pass_id": "original-native-pass-id",
  "message_entry_id": "original-wake-entry-id",
  "ack_entry_id": "original-tool-result-entry-id",
  "event_ids": ["original-immutable-event-id"],
  "action_entry_ids": ["original-native-action-entry-id"],
  "summary": "Concise sourced disposition; not commission completion",
  "source_refs": ["original-board-shipping-or-owner-readback-reference"]
}
```

k-screams owns supported executive delivery and its separate receipt back to
Kaylee. Export alone is not Kaylee consumption, verified worker delivery,
effect, shipping or full-factory completion. Tool success proves an observed
native action, not that its authored summary/effect claim is true: acceptance
must inspect original agent messages and actual board/shipping readbacks.

## Supported loading boundary — owner activation only

The main `pi-config/install` **does not select this candidate**. No live copy,
settings or persistent CTO binding has been changed. There is no runtime in an
unbound session, and merely loading the package does not activate the tools.

After exact independent review, normal merge and owned package installation,
select the merged local package with the supported `pi install ABSOLUTE_PACKAGE`
(or approved extension resource selection). Use the existing CTO's **ordinary
idle `/reload`**, or its next exact-file native resume. Never force reload while
busy, reset, use `--continue`/latest, create a session if missing, or inject
terminal input. Existing tool allowlists must explicitly admit the two control
tools; the bridge cannot override that policy and refuses before runtime start.
No account/model/credential/fallback/grant changes are part of loading.

Build reviewed Rust bytes, not an arbitrary replacement:

```sh
CARGO_BUILD_JOBS=2 cargo build --locked --offline \
  --manifest-path pi-config/extensions/cto-supervision/runtime/Cargo.toml \
  --target-dir OWNED_ABSOLUTE_BUILD_DIRECTORY
```

The owner prepares a private mode-0600 binding file with **exact** fields:

```json
{
  "schema": "cto-supervision.binding/1",
  "sessionId": "01a103e1-9423-76a3-9ec0-17d2b0bad325",
  "sessionFile": "/exact/existing/native/session.jsonl",
  "cwd": "/exact/current/owned/cto/repository-root",
  "runtimeBinary": "/reviewed/owned/build/cto-supervision-runtime",
  "runtimeSha256": "SHA256_OF_REVIEWED_BINARY",
  "inboxDir": "/agreed/private/native/inbox",
  "returnDir": "/agreed/private/native/returns"
}
```

Canonical existing paths, original exact identity, owned file permissions and
binary SHA are checked before spawn. No secrets belong in it. From that exact
native session, `/cto-supervision-bind ABSOLUTE_BINDING_FILE` opts in;
`/cto-supervision-status` reads the actual boundary;
`/cto-supervision-stop` stops transport only and retains the primary/binding/
uncertain inputs. Ordinary reload/resume reconstructs that original binding.

## Source checks versus acceptance

```sh
bun test --max-concurrency=1 pi-config/extensions/cto-supervision/branch.test.ts
CARGO_BUILD_JOBS=2 cargo test --locked --offline \
  --manifest-path pi-config/extensions/cto-supervision/runtime/Cargo.toml \
  -- --test-threads=1
```

The Rust consumer test uses actual processes, inotify, competing kernel-lock
refusal, immutable original return replay, `Child::wait` and downtime recovery.
The opt-in `sdk-load.test.mjs` loads these source bytes with the actual installed
SDK in isolated synthetic storage, no credentials/model/network calls. It tests
exact-identity/loadout refusal, supported command registration, opt-in bind,
unchanged route/existing tools and owned helper exit. Routine Bun skips it.
Set `CTO_PI_SDK_ENTRY`, `CTO_RUNTIME_BINARY` and run-scoped `TMPDIR` explicitly.

`queue-recovery.test.mjs` is the c6 regression: actual installed Pi queue method
with a synthetic busy receiver, actual public queue clear, and isolated source
helper/sink. Both new-event and new-heartbeat paths keep the original uncertain
intent, produce one genuinely new pass, refuse old-input ACK, coalesce duplicate
causes and return the original duplicate-ACK ref without another action. No
agent run/model input/network/real worker effect occurs. Timer frames, action
entries and the helper are explicitly synthetic: this proves source/queue
behaviour, **not production queue loss, native CTO action or timer firing**.
The exact e9 baseline failure and fixed results are retained for owner review.

The ignored Rust `real_five_minute_timer_firing` waits a real 300 seconds, never a
shortened test timer. Even its pass would be **source helper proof only**.

**Active operation remains unproved until reviewed/merged/installed native load,
automatic completion/blocked wake, actual CTO action/ACK, worker completion,
missed-event/restart recovery, an actual five-minute timer fire in that native
runtime, and concise sourced executive return are observed.** Source checks,
a timer definition, queued/working state and a fabricated ACK are not those
postconditions. Both original LOCAL cases, their policy/IDs and the separate
three-file HTTP candidate remain untouched; no additional pilot inference or
Cloudflare spending is authorized by this module.
