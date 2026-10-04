# Mage executive runtime

**Implemented, not production accepted/deployed.** One executable executive runtime,
with separate persistent COO and CTO conversations on **Pi Durable 1.0.2**. Rust
owns capability/effect boundaries and the local process. Summon owns commissioned
engineer runs, admission and proof; Glass owns commitments. No factory calendar,
run phases, second backlog, copied Hermes profile or live Kaylee migration.

## Shared host contract

`durable.mjs` exports:

```js
const mage = installMage(registry, { config, broker }); // BEFORE Harness.open
const { instances, recoveryHolds } = await mage.attach(harness, context);
const result = await mage.command(request, context);
mage.assertProgress(); // REQUIRED before a host's explicit harness.resume()
```

`host.mjs` exports `createMageInstallation(scope, {config,models,broker})`,
returning the cloud owner's `RuntimeInstallation` (`options`, `attach(harness)`,
`deadline(task)`) plus a command method fenced to that open Harness. Install it
through `pi-durable-cloud/src/host.ts`'s authenticated read/execute boundary;
never expose unguarded `Harness.submit/resume` or trust a caller-selected role.
Hosted Rust consumers use `Broker::execute_for` with the independently
principal-bound instance, refusing another `request.instance` before effects.

The shared Summon host supplies the **actual** `Harness`, `Models`/request admission,
checkpoint storage, environment and wake mechanism. `broker(request, abortSignal)`
returns original owner receipts; it must enforce Rust `Broker::execute`'s role,
immutable operation and exact-grant rules. Task ownership is not access control.
The host installs `mage.commission-reporter` v1 and both role extensions on every
open before scheduling, including recovery. Role conversations are seeded in one
commit and their configuration fingerprints are immutable; changed context needs
a negotiated handoff, never silent resume. No CodingTools, filesystem environment,
shell, generic RPC, MCP or executable-selection tool is installed.

Commands are `submit`, `steer`, `completion`, `status`, `wait`, `cancel`, `view`,
`capabilities`, `tasks`, `recall`, `compact`. Every request names an exact `instance`; delivery,
steering, cancellation and waits preserve the **original** `input_id`. Submission
returns native queued/placed/done/unanswered facts, not accepted product work.
`wait` includes the native answer entry and explicitly says `not_verified`.
A duplicate ID with changed text/mode refuses before upstream's ID-only dedup.
Duplicate completion creates no second wake. External inputs, internal CTO
commissions and report wakes use the same payload guard before native submit.
Conflicting IDs fault the reporter before it can substitute an earlier answer.
Recovery checks original native entries/inbox for f764 deliveries without a guard
hash; unavailable withdrawn legacy payloads refuse rather than bind a new hash.
Cancellation addresses membership of the original submission, so a repeated cancel
cannot stop later work.

COO `mage_delegate` creates one background native reporter task per immutable
commission ID. It submits the frozen brief to the distinct CTO, returns immediately,
and posts the CTO answer as one original-ID follow-up that wakes the COO. A CTO
answer is **not** independent acceptance. The CTO's `mage_factory_intake`, steer
and cancel tools consume the original shared Summon HTTP protocol. There is no
claim/proof/native-invoke/authority-grant tool or duplicate engineering executor.
Actual engineer completion arrives through `completion` with its original source
references; the existing Relay/native adapter remains its owner's plumbing.

## Rust capabilities and integration ports

- Both: source-backed versioned memory/recall, their selected skill bodies,
  conversation-bound raw-history search and canonical factory reads.
- COO only: CTO commission, configured schedule/mail/voice/Glass ports.
- CTO only: canonical engineer intake/steer/cancel. Glass read, not commitment writes.
- The model cannot select another instance, integration executable, environment,
  filesystem path, provider, shell or permission policy.
- External effects require a host-supplied grant matching exact instance,
  capability, argument SHA-256 and authority reference. Each grant funds **one**
  immutable intent across new model call IDs. Role prose and remembered permissions
  cannot grant an effect. Safe read tools do not consume a write grant.

The Rust broker commits an intent before a potentially effectful dispatch. Missing
reply/receipt stays `ambiguous_effect_hold` across reopen; a repeated call inspects
or returns a stored receipt, never resends. Approved integrations use fixed host
argv, JSON stdin, bounded JSON stdout, no inherited model credentials by default.
Their successful receipt must bind `operation_id` and `owner_ref`. Their underlying
owner still must implement real permission, accepted-write and reconciliation
contracts. This is not an exactly-once-effect or OS/credential sandbox claim.

`schedule_request/read/cancel` are ports to the **shared execution host's owning
scheduler capability (currently unsupported)**, not JS timers or another
due/occurrence database. A binding must return its durable
schedule/occurrence receipt and preserve timezone, missed/overlap policy. None is
selected/activated by default. Current Kaylee source establishes AgentMail inbox
polling, maintenance and guard jobs, not a new factory schedule authority. Paused
audits are not revived. A recovery alarm merely resumes engine checkpoints.

`agentmail-read` is a concrete Rust read-only implementation of the actually used
fixed `phaedrus-kaylee@agentmail.to` inbox: unread received threads or one full
paginated thread, exact inbox/message binding, complete-count checks and no redirect.
It takes `AGENTMAIL_KAYLEE_KEY` at the existing local consumer via `pass-env`.
No send, draft, unread ACK or arbitrary inbox/URL exists on this port. Mail is data,
not authority. The generic `mail_send` port remains unbound until its owning sender
and exact grants are supplied. No message in Phaedrus's name is commissioned here.

Voice discovery found designed Gemini TTS with pronunciation, meeting/presence and
mute gates, plus a master-desk backend provenance check. `kaylee-voice` itself only
controls mute; it is **not** a speaker. Mage does not bypass that gate, copy voice
identity or pretend Hermes is recording audio. `voice_speak` stays unbound until
an approved voice gateway preserves these contracts; no synthesis/billing probe.

## Configuration and local entrypoint

No installer currently selects this module. Build/test without inference:

```sh
export TMPDIR="$HOME/.cache/tmp/mage-executive-RUN"; mkdir -p "$TMPDIR"
export CARGO_BUILD_JOBS=1 CARGO_TARGET_DIR="$TMPDIR/target"
cargo build --locked --manifest-path agent-config/candidates/mage-executive/Cargo.toml
npm ci --prefix agent-config/candidates/mage-executive --ignore-scripts --no-audit --no-fund
cargo test --locked --manifest-path agent-config/candidates/mage-executive/Cargo.toml -- --test-threads=1
TMPDIR="$TMPDIR" npm test --prefix agent-config/candidates/mage-executive
```

Host-owned `mage-executive/1` JSON (all paths absolute/canonical, state directory
already created mode 0700, no secret values in configuration):

```json
{
  "schema": "mage-executive/1",
  "state_dir": "/absolute/private/mage-staging",
  "node": "/usr/bin/node",
  "adapter": "/absolute/source/mage-executive/runtime.mjs",
  "native_models_entry": "/absolute/installed/pi-coding-agent/dist/index.js",
  "native_staging": null,
  "instances": [
    {"id":"coo-staging","role":"coo","instructions":"Own strategy; commission CTO and require independent acceptance.","skills":[],"provider":"openai-codex","model":"gpt-6.1-sol","thinking":"xhigh"},
    {"id":"cto-staging","role":"cto","instructions":"Commission engineers only through Summon; report original evidence and risks.","skills":[],"provider":"openai-codex","model":"gpt-6.1-sol","thinking":"xhigh"}
  ],
  "factory": null,
  "integrations": [],
  "grants": []
}
```

Skills are frozen `{name,description,body}` values, independently selected per role;
bodies load through `mage_skill_read`, not wholesale at startup. Factory configuration
is the original `summon-http-client::Config`, including real scope/auth; its existing
shared transport's supported service-auth update belongs to Relay.
An integration is `{capability,executable,args,env_names}`; these are host selected,
never model argv. A grant is `{id,instance,capability,arguments_sha256,authority_ref}`.
For the concrete mail reader bind the built binary's `agentmail-read CONFIG` command
with only the existing scoped key environment name. Do not move credentials to cloud.

```sh
"$CARGO_TARGET_DIR/debug/mage-executive" serve /absolute/config.json
# JSONL stdin / correlated JSONL stdout, concurrent commands supported:
# {"id":"read-1","action":"view","instance":"coo-staging"}
# Above configuration is inspection-only: submit/wait/resume refuse model execution.
# A separately reviewed native_staging handoff is required; see NATIVE_GUARD.md.
"$CARGO_TARGET_DIR/debug/mage-executive" inspect /absolute/config.json coo-staging
```

`runtime.mjs` is a **local** Node/SQLite host, not a Cloudflare compatibility shim.
It uses the existing supported native `ModelRuntime` **only as pi-ai Models/auth**;
there is no stock Pi AgentSession, SessionManager, loop or transcript substitute.
It rejects absent included-subscription binding and any route other than the
commissioned Codex Sol/xhigh. The local Codex transport is explicit SSE (no websocket/SSE auto-fallback),
provider and Durable retries are off, and this local staging host refuses paid
compaction. Without a separately bound `native_staging` policy it is inspection-only.
[The final-fetch guard](NATIVE_GUARD.md) preserves the original provider/OAuth/catalog,
checks the final serialized body/account after callbacks, and asks the owning Rust
quota/counter gate before every send. Source and synthetic tests are not actual
selected-account/extra-usage, included-billing or model-send authority.

Local `engine.sqlite` is the actual Durable checkpoint/transcript/inbox authority;
`broker.sqlite` holds notes and immutable effect intents/receipts only. SQLite uses
WAL + FULL. A kernel lock follows the actual Node/broker children; EOF requests
close, and Rust observes the owned child wait before releasing ownership.
After joining Durable work, the local wrapper releases the **same installed
Models consumer's** supported session-resource registry (not another pi-ai version),
so cached provider connections cannot strand the owned wait. Paths
are same-user trusted host resources, not strong per-principal filesystem isolation.
On reopen, pending generation request/poll or compaction summarize checkpoints
produce a **global recovery hold**. Inspection is allowed; new inputs, wait, cancel, compaction or explicit
resume cannot accidentally trigger automatic generation resend. Host/provider owner
must resolve that uncertainty; retries=0 alone is not protection. Unknown metered
requests or effects are never free retry authority.

## Pins, proof, remaining acceptance

Dependencies `pi-durable/pi-ai/chord` are locked to **1.0.2**, npm gitHead
`cd32f7725fdbddbaecdff5b1e68491563394e0ca`; inspected upstream
`200387122ca450d6387f033949423114a270b96c` differs only in changelog headings.
The lab's verified artifact was consumed read-only, not rerun as a provider A/B.

Observed local source tests (4 Rust + 8 SDK/lifecycle): Rust role/skill refusals, sourced memory correction
and reopen, real lost-owner-reply effect hold, consumed-grant refusal and unsupported
schedule/provider paths. Actual Durable/SQLite tests cover distinct contexts, duplicate
input/wake, wrong-role offered-set refusal, background CTO report/wake, safe long
read/steer/follow-up/close/reopen, cancellation fencing, **two real SIGKILL/observed
exit/reopen paths** and no provider request after ambiguous-generation recovery.
A real local no-model-prompt startup also created the two distinct configured
Durable instances using the existing installed native Models/auth consumer and
observed owned close/exit. It is source-staging proof, not deployment or inference.
A later **real local native Codex** partial path used COO input 19 → CTO input 40 /
answer 53 → reporter 37 → COO wake submission 55 / message 54 / answer 57. Selected skills and source
memory were used; the absent canonical factory binding was honestly refused. No
engineer, external action or independent acceptance was invented. The first walk
exposed a shutdown defect: the native Models websocket cache outlived Harness close
and the owned wait deadline. Its original receipt remains retained; explicit SSE
and same-registry cleanup repair that local lifecycle path. This is not hosted
provider/admission/billing or full factory proof.
Model responses in tests are explicitly faux fixtures, not native subscription/engineering,
independent acceptance, Cloudflare deployment or live schedule/mail/voice proof.

Production acceptance still needs real admitted COO input → CTO commission → Summon
engineer result → independent review/acceptance/report; concrete scheduler/mail/voice
consumer receipts; host-wide provider/effect reconciliation; independently reviewed
merged bytes, authenticated hosted consumer/restore proof and reversible rollout.
Cloud storage/env/alarms belong to the `pi-durable-cloud` owner, deployment/clients
to Hosted, run/proof/account authority to Core/CTO. No live Hermes state is changed.

Rollback: stop only the new owner, retain its native DBs, original IDs, effects and
references. Restore both files from a **quiescent**, observed-close snapshot under
one owner and inspect before any resume. A closed-file copy is not off-machine/PITR
proof. Hermes remains the live desk/fallback; restoring a runtime is not authority
to replay a sent command or migrate executive identity. No production cutover yet.
