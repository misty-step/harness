# ADR-010: Local CTO pilot; Summon owns runs, not the whole portfolio

Status: Accepted for local source implementation, 2026-10-03, under Glass
K-20261002-engineers-run-on-the-right-harness-per-p. Hosted activation is held.
This records the commissioned technical boundary, not a deployment receipt or
completion of the end-to-end factory.

## Four different claims

1. **Desired factory:** admission → execution → assessment/correction → real
   consumer verification → authorized release → observation, with recoverable
   coordination while the COO conversation remains available.
2. **Run kernel:** immutable intake, ordered input, exclusive dispatch attempt,
   native receipts, reconciliation, action holds and current proof binding. These
   low-level mechanics are necessary, not the full factory.
3. **Active source:** PR219's TS/native groundwork plus the Rust local Cloudflare
   candidate, native Pi boundary and executive relay. Source is in Harness;
   historical `summon` and private experiment archives are not new source owners.
4. **Exercised behavior:** only retained exact-revision command/native/consumer
   receipts establish this. Code, a tab, a declared digest, process exit, a PR,
   merge and a verified artifact do not establish deployment or product Done.

The local candidate excludes Jev integration, cross-run scheduling and external
release effects. Do not describe those exclusions as a delivered factory.
The three historical probes remain bounded study evidence; this commission is
ordinary engineering and authorizes no further formal comparison batch.

## One authority per fact

| Module/actor | Owns | Independently useful contract |
| --- | --- | --- |
| Glass / current project commitment owner | Commitments, decisions, reviewed marks and original acceptance | Kaylee can read/write commitments with CTO or Summon unavailable; Glass reads external facts, failed readers show unknown |
| COO (Kaylee on Hermes) | Priority, commitment writes, business decisions and accountability to Phaedrus | Strategy/conversation does not wait for an engineer or change her identity/profile |
| CTO | Scoped engineering dispatch, technical dispositions, independent review, verification and authorized landing | Native persistent session receives acknowledged commissions and bounded completion/decision reports |
| Mage | Executive client and communication transport | Submit/read/acknowledge messages without becoming a scheduler, incident or run ledger; another executive can use the same contracts |
| Summon | Run/input/attempt/hold/proof records, including the Cloudflare object | A standalone task works without Glass, Git or Mage; source reference and Git revision are optional |
| Native runtime / Pi-specific extension | Actual session, message, receipt, completion and process observations | Start/resume/observe/request abort using supported native APIs and existing authentication; no transcript import into Summon |
| Project checks, reviewer and consumer walk | Their actual evidence | Exercise the affected contract against the exact candidate; Summon binds receipts rather than inventing their truth |
| GitHub and each deployment/data owner | Applied external effects and accepted writes | Reconcile these owners before retrying a possibly non-idempotent action |
| Existing scheduler / ADR-009 intake | Expected occurrences / machinery outcomes and cause incidents | Stable occurrence → one commissioned run; failed/missed machinery uses the existing cause-deduplicated route |

Glass currently is a read-oriented commitment/portfolio product, not a native
agent controller or chat UI. A unified chat/control shell would deliberately
change that product contract and requires a separate product decision. This
pilot supplies a small status/evidence projection, not a Glass rebuild. Use the
actual current Glass/Habitat commitment decisions; dated references to retired
Linear readers do not authorize reviving them. No Glass UI/source is changed.

Native relay journals contain delivery IDs, exact payload/session bindings,
queued/send-intent/ACK/uncertainty and native receipt references only. They contain
no run phase, product acceptance, priorities or second mutable run history.
An executive replacement reads Summon records and native references; it does not
rewrite them or copy Kaylee's profile state.

## Source and replacement boundary

- `agent-config/candidates/summon/`: original PR219 groundwork, inspected at
  `98ec60a214b11d80a36a03df11d9104190bcc09d`; reused, not blindly merged.
- `agent-config/candidates/summon/factory/`: Rust protocol/reducer and Rust
  Worker/SQLite DO candidate; its README owns exact local wire/build commands.
- `agent-config/candidates/summon/pi-runtime/`: standalone native Pi consumer
  of the shared protocol, not part of the Mage executive's run truth.
- `agent-config/candidates/mage/` and
  `pi-config/extensions/commission-relay/`: thin Rust client/transport and narrow
  Pi SDK extension. SDK glue is runtime-specific; other owned control is Rust.
- `hermes-config`: supported Hermes profile/config/plugin changes only. Future
  Hermes pull/ACK integration is not an upstream fork, live input injection or
  implied autonomous wake. No silent profile cutover is authorized.

The TS candidate is selected by no live dispatcher/installer. The Rust pilot
uses reserved `cf1:` run IDs and does not import or dual-write TS run stores.
These are source candidates, not two active authorities for one run. Any later
explicitly authorized cutover must remove the obsolete active path and reconcile
existing records; running both ledgers or pretending their histories agree is
not a migration. Preserve parked artifacts and private study provenance.

## Why a Durable Object per run?

The retained architecture B illustrated one factory object. The first source
slice instead chooses one named Summon DO per run: its serialization/storage
boundary matches immutable intake and ordered attempts, and unrelated runs need
not share that lock. This is an execution/storage choice, not another factory
ledger or proof of fleet-wide admission.

**Not solved by per-run objects:** account/resource reservations across runs,
portfolio ordering, calendar occurrences and dead-man coverage. The local pilot
has CTO-controlled bounded admission using existing fleet/account readers, with
reserved COO/review capacity; the kernel does not enforce fleet-wide admission.
Intake acceptance is not authorization to launch a model or spend money.

Future cross-run admission belongs inside Summon's execution machinery, consuming
canonical priorities and exact-account/resource facts. It may own reservations,
not mirror per-run phases. A chosen scheduler owns due-time/expected-occurrence
facts and submits stable run/input IDs; it must not also maintain run state.
This source adds neither a scheduler nor a second admission database and enables
none of the paused audit schedules.

## End-to-end actor/guard map

| Boundary | Concrete current actor / command | Guard and remaining implementation |
| --- | --- | --- |
| Admit | Kaylee commission/ticket; CTO reads native Glass and existing `ai-usage`/Herdr; frozen `TaskSpec` via `POST /v1/intake` | Original scope/roster/action authority, current exact-account/resource facts; DO validates shape/identity, not Linux confinement, entitlement or cross-run capacity |
| Execute | Fresh `POST .../claim`; native adapter starts/resumes the exact session and returns `POST .../observe` | Durable send-intent before native dispatch; `replayed:true` permits observation only; ordered input, exact attempt/payload/session, native permissions; runtime consumer must be actually exercised |
| Assess/correct | Separate exact-head reviewer; CTO dispositions; `POST .../input` for one correction brief | Review evidence and independence are observed, not authenticated by an issuer name; correction invalidates current proof; budgets are commissioned, not infinite critics |
| Verify consumer | Project-owned affected check and real consumer walk on immutable isolated candidate; `POST .../proof` binds its receipt | Complete relevant source/artifact coverage, actual allowed/denied/data/recovery postconditions; declared snapshot/hash alone is not a pass; supplied checks vary by task |
| Release | CTO normal `gh pr checks` / exact-head merge for this source; project-owned release adapter for deployment | Independent review/current affected evidence and repository's actual change route; hosted resource/action approval; kernel has no merge/deploy effect endpoint |
| Observe | GitHub/deployment identity readback, product health/critical journey, accepted writes/recovery owner | Merge or kernel `verified_delivery` is not deployment/Done; automated promotion/health/rollback and ADR-009 integration must be exercised before being claimed |

Run **phase**, input **delivery**, action **holds** and proof **freshness** remain
orthogonal. No writable status string substitutes for their facts. Release held
does not prevent inspection, native observations or unrelated conversation.
A requested cancel is not stopped; native termination must be observed, and
termination does not prove a possibly dispatched input or effect never happened.
Lost ACK/disconnected host/expired lease is uncertainty, never retry authority.

## Where foundations and operating principles enter

Project-owned recipes select that project's **actually adopted** foundation
catalog/pin, live stories/invariants, checks, accepted release/recovery path and
allowed actions. Existing older pins remain their adopted contracts until an
explicit migration. Do not silently apply a new universal gate to every project
or turn an ordinary fix into repository-wide foundation adoption.

The current shared constitution/catalog's lean cadence is the direction:

- Before merge: exercise affected contracts, obtain independent review and run
  cheap secret/privacy scans. Expand proof for shared or uncertain impact.
- Build one immutable candidate; run isolated production-like preprod with
  representative privacy-safe data and affected real journeys. Mandatory access,
  accepted data, migration, artifact identity and recovery stay on this path.
- Promote the same tested bytes without rebuilding; serialize promotions and
  read back deployment identity and a critical consumer journey. Safe rollback
  must preserve accepted writes and be rehearsed.
- Full suite/every story runs nightly and on demand at a recorded revision, not
  on every change. Nightly breadth is delayed detection, not an unrelated veto;
  missing/failed candidate proof never authorizes promotion.
- Failures and missed machinery runs go through existing scheduler-owned
  expected runs and ADR-009's one outcome per run / one incident per cause, not a
  new factory incident ledger or notifier.

Foundations also cover actual backup/restore, safe secrets/access, docs/stories/
ranked backlog and applicable website/portfolio requirements and approved
exceptions. An internal-tool website exception is not a blanket security,
recoverability or other catalog exception. The present local source slice does
not claim these operational obligations satisfied. Existing Harness CI and
project pins are unchanged by this ADR.

The five principles constrain choices here: prove the real candidate; only
proven changes alter access/accepted state; failures create owned bounded repair;
every check rejects a named plausible failure; trace the commissioned ticket to
session/diff/proof packet. Use the current constitution and sole normative
catalog, not another prose foundation standard.

Jev can later rank eligible options, judge relevance or group/triage findings
through the fleet's bounded OpenRouter Decisions path. Code checks factual
preconditions, evidence coverage, revision/freshness, authority and permission.
Jev failure yields a conservative route or CTO judgment, never invented pass or
permission. This kernel ships **no Jev integration**. Task context omitted means
runtime defaults; explicit empty instructions/skills means none. Neither changes
tool permissions, product acceptance or the commissioning source's authority.

## Approval and failure boundaries

Hosted activation must name account/environment, Worker/DO/storage resources,
principals/action scopes, content/retention/cost bounds, restore/reconciliation
and residual gaps before approval. Local DO restart is not hosted PITR/restore;
a native session file is not a tested off-machine backup. Trusted local issuer
assertions are not hosted multi-principal authentication.

No credential relocation, paid Anthropic fallback, purchases/new spend,
production data operations, broad fleet cutover, paused audit activation or story
weakening follows from this source. The first pass stops as delivered or at a
named operator approval with exact proof/gaps; Kaylee owns commitments and gets
outcomes/complete decisions, not raw worker chatter.

Sources: [constitution](../../agent-config/skills/foundation/constitution.md),
[normative catalog](../../agent-config/skills/foundation/foundation-standard-v1.json),
[adoption/cadence](../../agent-config/skills/foundation/foundation-standard-v1.md),
[ADR-007](007-braver-engineers-continuous-deployment.md),
[ADR-009](009-nothing-fails-silently.md),
[existing architecture review](https://mirrodin.tail5f5eb4.ts.net/review/summon-architectures-2026-10-03/),
[retained factory-state dossier](https://mirrodin.tail5f5eb4.ts.net/review/harness/laboratory/factory.html).
