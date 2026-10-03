# Mage — executive transport candidate

Independently useful Rust Unix client/spool and pull/ACK outcome inbox, with
native Pi SDK glue in `pi-config/extensions/commission-relay`. No scheduler,
run phase, commitment, incident, proof or authoritative job database. The native
Pi session owns delivered messages/ACK facts. Summon DO is the single factory
run authority; changing the executive never rewrites its records. No cf1 run is
sent to the older TS database. No installer selects this candidate.

## Build and use

```sh
export TMPDIR=/absolute/run-scoped/scratch
export CARGO_TARGET_DIR="$TMPDIR/target" CARGO_BUILD_JOBS=2
cargo build --locked --manifest-path agent-config/candidates/mage/Cargo.toml
cargo test --locked --manifest-path agent-config/candidates/mage/Cargo.toml -- --test-threads=1
M="$CARGO_TARGET_DIR/debug/mage"
"$M" queue /absolute/private/spool envelope.json
"$M" send /absolute/private/spool/relay.sock envelope.json
"$M" inspect /absolute/private/spool/relay.sock envelope.json
"$M" recover /absolute/private/spool/relay.sock
```

The Pi extension starts `mage serve SOCKET SPOOL SESSION_ID SESSION_FILE` via
private stdio and stops it through stdin EOF, never by killing Pi. Use the
extension README's exact binding/load flow. Socket is `SPOOL/relay.sock`;
spool must be a canonical owner-only directory. Binding is immutable across
transport restarts. Kernel lock prevents overlapping owners. There is no timer
that turns a disconnected owner into termination or authority to steal.

```json
{
  "deliveryId":"completion-immutable-id",
  "sessionId":"exact-native-id",
  "sessionFile":"/absolute/native/session.jsonl",
  "kind":"completion",
  "payload":"Engineer result; review still required; next decision/action …",
  "runId":"cf1:optional-correlation",
  "commissionRef":"optional-opaque-commission",
  "inputId":"optional-summon-input"
}
```

All fields are immutable under a delivery ID. Conflicting payload, identity,
kind or correlations fail closed. JSONL frames split only at LF, preserving
Unicode paragraph separators. Reads and records are bounded. Rust spools only
immutable input, native binding and may-have-dispatched intent—not run status.
Receipts are queried from the active native session, not copied into a job DB.

- `queue`: immutable publication, no native effect; state queued unless a send
  intent exists, then uncertain.
- `send`: persists intent before one native dispatch. First response may be
  uncertain; pull a receipt. Repeats inspect only, never re-enqueue.
- `inspect` / `recover`: native branch reconciliation only; no new dispatch.
- acknowledged: actual durable native message and receipt references.
- uncertain: no definitive ACK; **never automatically retry**, including native
  queue loss, transport failure or client deadline. A deadline never kills Pi.
- null settled reference: acknowledged input with unfinished execution.
- settled reference: native execution observation only, not verified/shipped.

Recovery retains all envelopes; it does not turn possible dispatch into unsent.
Back up the private transport directory alongside the referenced native session
using the owner's existing backup route. Restore/recover against the exact
native session before any decision to deliver queued work. Transport files
alone cannot recreate receipts if the native transcript is unavailable.

## Kaylee pull inbox — bootstrap, not autonomous

```sh
"$M" inbox-put /absolute/private/outcome-inbox outcome.json
"$M" inbox-pull /absolute/private/outcome-inbox
"$M" inbox-ack /absolute/private/outcome-inbox DELIVERY_ID EXACT_DIGEST_FROM_PULL
```

Pull consumes nothing. ACK requires the full immutable-envelope digest. Outcome
payload should carry evidence references, remaining risk and required decisions;
it cannot authorize external action or close a commitment. This is transport
consumption only, not a native Pi ACK or Kaylee reading proof. It remains
bootstrap/non-autonomous until Kaylee actually reads/ACKs it. Never inject raw
text or keys into her Hermes input. Same-user shell access is trusted, not an
authenticated Kaylee principal.

Read-only Hermes discovery (no repository/profile/config/state edits):

- Existing owner: `hermes-config/plugins/jev-skill-suggest/__init__.py`
  `register(ctx)` registers `pre_llm_call`, returning `{context: …}`;
  `plugins/jev-checks/__init__.py` uses the same supported hook.
- Runtime support: `~/.hermes/hermes-agent/hermes_cli/plugins.py`
  `PluginContext.register_hook`; `hermes_cli/plugins_dispatch.py`
  `invoke_hook` accepts context results; `agent/turn_context.py`
  `_collect_pre_llm_call_context` injects them into the **next turn's user
  context**, with session provenance and oversized-output spill.
- Future integration belongs to Hermes-config's plugin owner using this native
  hook or a commissioned native tool calling pull/ACK. It is not idle wakeup.
  No automatic delivery to Hermes was implemented or observed.

## Observed proof / remaining gaps

Rust contract checks cover immutable spool conflicts, interruption markers,
exact inbox ACK digest and framing limits. Both `scripts/check pi` and
`scripts/check shared` passed at the source pilot base (installer checks use
committed HEAD, not uncommitted candidate installation).

The bounded installed Pi 1.0.1 SDK walk passed against actual Rust sockets and
native persisted JSONL: one completion wake, duplicate no second wake, payload
and binding refusal, supported reload reconciliation, lost native follow-up
queue remains uncertain. The provider was a local zero-network fixture: not
native subscription work or live persistent CTO proof. Live CTO activation is
still blocked: two separately authorized `/reload` attempts followed observed
Herdr DONE boundaries (seq2322 and seq2331), but new operator steering raced both.
Native Pi explicitly refused reload while streaming each time. No bind, socket
or completion wake was sent; the CTO spool stayed empty. Further retries stopped.
CTO registered only the explicit source file locally; no broad deployment occurred.
Do not call this a durable operational relay until live proof is attached.
Required decision: an operator-controlled quiet idle reload and verified source
load before the exact binding/single stable wake; no blind repetition.

No full factory, hosted deployment/auth/restore, fleet cutover, schedules, new
spend, Jev/effect broker or external product completion is delivered. Glass's
commitment/reviewed/read-projection responsibilities remain useful when the CTO
or Summon is offline; native failure stays unknown, not false success. No tracker
migration or retired Linear reader changes. Project-specific foundation checks
use the project's adopted pin, not universal all-story reruns.

Standalone native task execution belongs to `summon/pi-runtime`, independent of
Mage. Its runtime uses shared protocol types, exact native references and
explicit capability/new-session handoffs; no fake resume, copied protocol or
second ledger. Task context omitted=defaults / empty=none does not override
permissions or original acceptance. This local trusted-principal pilot is not
credential isolation for a shell-enabled agent.
