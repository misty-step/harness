# summon-pi-runtime — standalone native Pi candidate

Rust native start/resume/observe/abort/owned-exit boundary. It depends on portable
`../factory/protocol` (`summon-protocol`), not Mage's spool or executable. Its
optional explicit HTTP CLI branch shares the owned stateless transport primitive
under `../../mage/factory-http`; the native engine remains independent.
It implements the shared
`RuntimeAdapter` trait and also exposes async `NativePi` for live cancellation.
No copied TaskSpec/run structs, phase store, scheduler or job database. Canonical factory source is composed read-only, frozen at Core268 for this
client slice; later Root imports do not authorize local schema/dependency edits.
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

Transport state contains only immutable native input/owner intents, observed
native session references, kernel PID/boot/start identities, owner-wait exit
receipts and an exclusive process lock. These are native ownership facts, not
run phases or a second run ledger. Input intent
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
Startup, CLI/control and synchronous adapter errors converge on the same
`shutdown()` close-and-wait path. It drops actual owned stdin, drains **raw**
stdout (malformed JSON cannot skip the wait), and waits the owned child before
writing its immutable exit receipt/returning a Termination reference. The native
process inherits the kernel lock: dropping/crashing the Rust owner cannot free
it while Pi is alive. An unresolved durable spawn intent refuses later recovery
or replacement even after the native process happens to exit; time, EOF, signal,
process absence and adapter exit do not substitute for this owner's wait receipt.
Legacy roots without observed owner-exit facts are also refused. No automatic
uncertainty clearance, kill/takeover or fake resume. These root-process facts do
not claim verified work or proof that arbitrary descendant/tool processes exited.

Each native/control JSONL stream owns its own persistent framing buffer. Losing
a `tokio::select!` read future preserves consumed partial bytes. LF-only, UTF-8,
1MiB framing and truncated/error EOF fail closed; a poisoned stream cannot resume
parsing a truncated tail as a fresh command/observation. The synchronous
trait's blocking invoke cannot itself multiplex control; use async `NativePi`
or CLI stdin for live cancellation.

## Explicit canonical remote HTTP client

`summon-pi-runtime factory CONFIG read RUN_ID status|view|packet|authority` and
`summon-pi-runtime factory CONFIG send RUN_ID intake|input|hold|cancel|claim|observe|reconcile|metadata BODY.json`
branch BEFORE native startup. They use
[the shared HTTP consumer](../../mage/factory-http/README.md), not a second
runtime, ledger or authority. TLS/requested scope/server-attributed response
binding are transport guards, not native account/capability/budget admission.
No claim-to-invoke, observation auto-submit, native ACK inference, cancellation
side effect, login, secret reader, profile/loadout change or fallback occurs.
Preserve original command IDs/bytes/revision when HTTP acceptance is unknown;
read/reconcile explicitly. Real deployed/client/grant verification belongs to Root.
The original local adapter and stdin cancellation contract remain unchanged.

## Observed checks and remaining proof

Five bounded Rust checks pass: context selectors/native resume/route refusal,
active-branch exclusion, immutable native intent conflicts, interleaved/cancelled
split native/control frames and LF/UTF-8/EOF/bound failure behavior. Framing checks
are in-memory protocol fixtures, not native execution. An opt-in installed
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

Material owner-release defects were reproduced against original `6032fd5` native
source with installed Pi and deliberately delayed SDK cleanup, **zero model
prompts**: startup command-source refusal and malformed raw shutdown output both
left actual Pi alive while another owner acquired its lock. Fixed checks observe
exit before release, preserve the lock/refuse recovery after unobserved drop,
refuse replacement even after time/process absence, and close/wait on malformed
CLI control. Four opt-in fault checks use real native PIDs/start identities and
retained wait receipts; the delay/raw-write/no-op-command extension and synthetic
CLI Reply are explicit fault fixtures, not DO/provider/admission proof.

```sh
NATIVE_PI_MODEL=exact-configured-model \
cargo test --locked --manifest-path agent-config/candidates/summon/pi-runtime/Cargo.toml \
  --test owned_exit -- --ignored --test-threads=1 --nocapture
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
