# Native commission relay — opt-in source pilot

Pi 1.0.1 SDK glue; Rust transport is `agent-config/candidates/mage`.
This is a local candidate, not fleet adoption or product completion. No installer
selects it. The native session owns messages, attempts, receipt entries and
execution-settled observations. There is no run phase, scheduler, commitment,
incident or acceptance store here. Changing the executive does not rewrite runs.

## Supported load and binding

Use **one** source identity, not both file and directory:

```sh
pi --extension /absolute/source/pi-config/extensions/commission-relay/index.ts
# Alternatively, operator opt-in in the intended project only:
pi install --local /absolute/source/pi-config/extensions/commission-relay/index.ts
# In that native Pi session, when idle:
/reload
/commission-relay-bind /absolute/private/binding.json
```

A directory source also works through the explicit `package.json` manifest.
Local registration records source in project `.pi/settings.json`; it neither
copies source nor installs dependencies. Do not also register the directory if
the file is already registered. Native interactive `/reload` refuses while
streaming. The extension's `/commission-relay-reload` uses `ctx.reload()` and
must likewise be operator initiated at an idle boundary. Never use raw pane
input or a second SDK process to modify the live owner's transcript.

```json
{
  "sessionId":"exact-native-id",
  "sessionFile":"/absolute/native/session.jsonl",
  "mageBinary":"/absolute/built/mage",
  "spoolDir":"/absolute/private/spool",
  "socketPath":"/absolute/private/spool/relay.sock"
}
```

Binding must name the **current exact native session ID and file**, not its name,
PID, tab or most-recent session. The command persists binding in the native
active branch. `session_start` reconstructs it after supported reload/resume;
`session_shutdown` closes only the Rust transport. `/commission-relay-stop`
stops transport, not native work; reload reopens the saved binding. Remove the
project registration via supported `pi remove --local SOURCE` and reload to
withdraw the extension. Spool/native records remain for reconciliation.

While bound, native switch/fork/tree navigation is refused. A separately forked
or moved session cannot inherit the original binding. Reconcile native ownership
before a new binding/handoff; there is no fake resume or lease-based takeover.
A kernel file lock, not an elapsed lease, owns the socket. Restart may remove an
owned stale socket only under that lock; it never terminates Pi.

## Delivery and receipts

Mage accepts immutable envelope JSON: `deliveryId`, `sessionId`, `sessionFile`,
`kind` (`commission`, `completion`, `decision`), exact string `payload`, and
optional opaque `runId`, `commissionRef`, `inputId`. Delivery IDs are transport
identities, **not** Summon input IDs. All fields bind the ID; changed payload,
identity, kind or correlation is refused. No job interpretation occurs.

The extension records an attempt, calls supported `pi.sendMessage()` with
`triggerTurn:true`, and uses native follow-up delivery when busy. Enqueue is
**not ACK**. A pull returns acknowledged only after:

1. The matching custom message, including exact details and payload, is on the
   current native active branch.
2. Pi has appended a receipt referencing that actual message entry.
3. Both entry IDs exist in the native JSONL file and the file is fsynced.

The installed SDK emits extension `message_end` before persistence; we explicitly
do **not** infer ACK from that event. A custom-only new Pi session can initially
be memory-only; it stays uncertain until native persistence actually occurs.
`agent_settled` records execution settling, not successful model output, artifact
verification, shipping, merge or product acceptance. Recovery exposes a receipt
with null settlement when input was delivered but execution is unfinished.

Rust persists may-have-dispatched before the native call. Reconnect/repeated send
inspects existing native evidence; it does not submit another message. Missing
ACK stays uncertain, including a cleared/lost native follow-up queue. Transport
queued means a spool envelope with no send intent. `recover` inspects only; queued
input requires explicit first delivery, uncertain input requires reconciliation,
and acknowledged-unsettled work requires native-owner attention. There is no
blind automatic replay or inference that an absent receipt means unsent.

## Proof and limits

`native-proof.ts` is a bounded native SDK + actual Unix/Rust transport walk with
an in-process **zero-network provider fixture**. It tests native persistence,
one new run on completion, duplicate suppression, conflicts, exact binding,
supported reload recovery and real native follow-up queue loss. It is **not**
authenticated provider/subscription or persistent live CTO proof.

```sh
TMPDIR=/absolute/run-scoped/scratch \
PI_SDK_ENTRY=/absolute/installed/@earendil-works/pi-coding-agent/dist/index.js \
MAGE_BINARY=/absolute/built/mage bun native-proof.ts
```

Live CTO proof must additionally observe the actual native completion message,
durable receipt and a **new** CTO native turn after idle. A process exit, tool
success or Herdr `prompt --wait` is insufficient. See Mage's README for observed
pilot evidence and remaining gaps.

This is a trusted same-user local boundary: a shell-enabled native agent is not
credential-isolated. Source extensions have the host's permissions. Owner-only
spool/socket access is not per-principal authentication or a filesystem sandbox.
No native login is copied, extracted, relocated or replaced.

Summon remains standalone and owns ordered run input/proof through its one DO.
Runtime capability changes require explicit negotiated new-session handoff;
executive replacement is independent. Task instructions/skills select context,
not permissions or acceptance. Omitted means native defaults; `[]` means none.
The active kernel is not a complete factory: no Jev/effect broker/calendar or
hosted admission is delivered. Glass retains commitments/reviewed marks and can
show referenced read projections offline, with runtime failures unknown—not an
executive conversation/controller. No Glass/Linear paths are modified here.
Project foundation checks follow that project's adopted pin; factual guards stay
in code and Jev, if later commissioned, supplies judgments only.
