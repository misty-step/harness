# summon-pi-runtime — standalone native Pi candidate

Rust native start/resume/observe/abort/owned-exit boundary. It depends on portable
`../factory/protocol` (`summon-protocol`), not Mage. It implements the shared
`RuntimeAdapter` trait and also exposes async `NativePi` for live cancellation.
No copied TaskSpec/run structs, phase store, scheduler or job database. Shared
factory source checkpoint `df3a99a` + fix `4ec17c5` is composed read-only here.
DO remains the single run authority; native Pi owns its transcript and receipt
facts. The active kernel is not a full factory or a verified deployment.

## Scope and supported APIs

Installed Pi 1.0.1 RPC JSONL and the explicit SDK glue
`pi-config/extensions/commission-relay/native-input.ts`. This glue does not
start Mage or a socket. CLI uses an explicit source extension and native
`--mode rpc`, exact provider/model/thinking, exact session ID/file, and native
context selectors. No login/key/token extraction, copying, relocation, alternate
provider or paid fallback. Pilot permits only `openai-codex` and exact model IDs;
actual `get_state` must report the selected route/thinking before input.

The **fixed pilot loadout** is native `read,grep,find,ls`, with ancillary/discovered
extensions and prompt templates disabled and only the explicit native-input glue
loaded. This avoids MCP, auxiliary Jev calls or fallback extensions in this
bounded read-only lane. It is not the operational safety/loadout policy for an
arbitrary task. It cannot fulfill a writable implementation task; such a task
needs separately negotiated runtime capability/confinement before execution.
Context selection cannot add tools or weaken this runtime policy/acceptance.
Read-only tool exposure is **not** filesystem or credential isolation; configured
native tools still run as the trusted same user. Existing required permission
extensions or stronger data boundaries must be admitted explicitly, not silently
replaced by this pilot. No hosted/external writes or new spend are authorized by
an intake/claim/admission string. Caller owns actual account/quota/scope admission.

Within shared task context:

- instructions omitted: native discovered defaults; `[]`: no context-file discovery;
- selected instructions: frozen literal text appended while discovered context
  files are disabled; unresolved existing file paths are refused (commissioner
  must resolve/freeze their bytes);
- skills omitted: native defaults; `[]`: no skills; selected: explicit existing
  absolute native skill references, with discovery disabled.

Neither affects the original checks, external-effect permissions or decision
owner. A changed task/loadout/runtime/host/session requires an explicit negotiated
new-session handoff; never fake a resume. Summon needs no Glass, Git or Mage.
Executive replacement does not rewrite run records. cf1 runs never enter the
older TS run store, and there is no dual-write/cutover path here.

## Invoke / recover / cancel

```sh
export TMPDIR=/absolute/run-scoped/scratch
export CARGO_TARGET_DIR="$TMPDIR/runtime-target" CARGO_BUILD_JOBS=2
cargo build --locked --manifest-path agent-config/candidates/summon/pi-runtime/Cargo.toml
cargo test --locked --manifest-path agent-config/candidates/summon/pi-runtime/Cargo.toml -- --test-threads=1
"$CARGO_TARGET_DIR/debug/summon-pi-runtime" request.json
```

Request is `{reply: shared Reply, config: {host,state_dir,extension},
mode:"invoke"|"observe", admission_ref?:string}`. Paths are explicit absolute
owned paths; state_dir is canonical owner-only. Reply must be the actual DO
claim response, with the exact task/input/attempt/session snapshot. Invoke requires
`replayed:false` and an admission reference; neither is an authenticated admission
service in this same-user local pilot. A replayed claim uses observe/reconcile.
No automatic HTTP mutation occurs: CLI returns **shared ObserveRequest values**
for the owner to submit to existing DO observe/reconcile. Preserve exact request
bytes/event ID/expected revision across retries. An unknown POST requires status
read/reconciliation, never a second native invocation.

Transport state contains only immutable native input intents, observed native
session references and an exclusive process lock. No run phases. Input intent
precedes dispatch. Duplicate intent inspects only; absent evidence remains
uncertain. Recovery requires an already observed exact native session, and
refuses a missing native file or runtime/host/session mismatch rather than
manufacturing a replacement. A native branch receipt references the exact
attempt/input/hash/custom message and is disk-checked/fsynced by SDK glue. RPC
prompt success or `message_end` alone is not ACK.

`agent_settled` is execution settled, not verified/shipped. An answer requires an
exact native ACK and a finalized native assistant `stop` message after that input,
before any next user/custom input; other branches are excluded. Missing/error/
aborted output is not an answer. ACK without answer remains delivered-unfinished;
the owner records uncertainty/termination as appropriate. No receipt grants
external action or changes acceptance.

During CLI execution, stdin accepts JSONL `{cancel: shared CancelRequest}` for
this exact input/attempt/authority reference. It clears queued native work and
requests RPC `abort`; a response is not termination. EOF does **not** time out or
abort the run. No lease, timer, forced kill, scheduling or fallback exists.
`shutdown()` drops the actual owned stdin pipe, drains stdout and waits the owned
child before returning a shared Termination reference. Its kernel lock remains
held until observed exit. Unknown native owner/exit stays unknown. The synchronous
trait's blocking invoke cannot itself multiplex control; use async `NativePi`
or CLI stdin for live cancellation.

## Observed checks and remaining proof

Three bounded Rust checks pass: context selectors/native resume/route refusal,
active-branch exclusion and immutable native intent conflicts. An opt-in installed
Pi **no-model-prompt** walk also passed: real RPC startup and exact route selection,
empty skills reflected in native commands, zero native messages/settled events,
actual owned-process exit, and refusal to "resume" its nonexistent transcript.
It exposed and fixed a real pipe-close bug: Tokio ChildStdin `shutdown()` alone
was not EOF; closing the owned handle was necessary. No provider task was run.

```sh
NATIVE_PI_MODEL=exact-configured-model \
NATIVE_PI_EXTENSION=/absolute/source/pi-config/extensions/commission-relay/native-input.ts \
cargo test --locked --manifest-path agent-config/candidates/summon/pi-runtime/Cargo.toml \
  installed_native_startup -- --ignored --test-threads=1
```

The companion installed-SDK zero-network fixture walk exercised native input,
durable receipt, duplicate suppression and SessionManager file restore with this
actual SDK glue. It is not authenticated provider/native-subscription proof.
The sibling HTTP/workerd walk used synthetic native receipts; it does not prove
this consumer. A complete real native DO→adapter→DO consumer, provider-error/
live-abort/kill-window recovery and verified artifact story are **not yet
exercised**. Native process loss/reconciliation requires owner attention; no
production crash/restore or credential-confinement claim is made.

Glass retains commitment/reviewed marks and can project referenced evidence
while CTO/Summon are offline, with failed native facts unknown, not successful.
No tracker changes or retired Linear reader revival. Project foundation checks
follow that project's adopted pin, not a universal all-story rerun. Code supplies
factual guards; Jev, if separately commissioned, supplies judgment only. No full
scheduling, effect broker, hosted provisioning or fleet cutover is delivered.
