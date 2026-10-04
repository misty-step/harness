# Admission candidate: one commission, one lane, one review

Source-only trusted-local prototype. No installer selects it. No network, model,
Mage native send, hosted intake, account fallback, retry, or deployment is implicit.
Summon's existing `TaskSpec`, `NativeRequest`, `NativeResult`, `SummonStore`, run
states, delivery digest and `ReviewReceipt` remain the task/proof authority.
Mage's existing `Envelope` is the input and output transport shape.

## CLI

`bun agent-config/candidates/admission/cli.ts --state-dir /absolute/private/state`
reads ONE JSON object from stdin (512 KiB maximum, 5 second read deadline), writes
ONE JSON object plus LF to stdout, and exits:

- **0**: `status: "pass"`, Summon reports `verified_delivery`.
- **2**: `status: "refused"` (admission) or `"block"` (known review refusal).
- **3**: `status: "unknown"`; acceptance/outcome needs explicit reconciliation.

`--digest` instead prints `{ "digest": "sha256..." }` for the same request's
immutable commission, lane, commands and policy. It runs no reader or lane and
creates no state. Authorization and occupancy are excluded from this digest.
Module entry points are `commissionDigest(request)` and `admit(request, stateDir)`.

## Request

```json
{
  "commission": {
    "deliveryId": "commission-1",
    "sessionId": "exact-executive-session",
    "sessionFile": "/absolute/native/session.jsonl",
    "kind": "commission",
    "payload": "SERIALIZED SUMMON TaskSpec JSON",
    "runId": "task-1"
  },
  "laneId": "engineer-a",
  "engineer": {"argv": ["/owner/engineer-adapter"], "vendor": "anthropic", "accountId": "author-seat"},
  "reviewer": {"argv": ["/owner/reviewer-adapter"], "vendor": "google", "accountId": "review-seat"},
  "usageReader": {"argv": ["/owner/read-usage"]},
  "policy": {"maxAgeMs": 60000, "maxUsedPercent": 90, "readerTimeoutMs": 1000, "commandTimeoutMs": 30000},
  "authorization": {"authorized": true, "digest": "DIGEST_FROM_--digest", "expiresAt": 1791115260000, "evidence": ["owner-approval-reference"]},
  "occupancy": {"laneId": "engineer-a", "status": "idle", "observedAt": 1791115200000, "evidence": ["occupancy-reference"]}
}
```

The payload is validated by Summon, not a second task schema. This small slice
supports its existing `claude-code/anthropic` and
`antigravity/google-antigravity` routes, with **exactly one review check**;
command checks and further turns are out of scope. Vendor labels are canonical
`anthropic`, `google`, `openai`; author vendor must match the TaskSpec provider.
The reviewer must have a different vendor. `commission.runId` must equal task ID;
`cf1:` IDs are refused (never written to the local TS store).

Commands are explicit argv without an implicit shell, run in `task.workspace`
with inherited local environment. They are trusted owner adapters, not a
credential sandbox. Authorization binds the full commission, all commands,
accounts, lane and policy; it must be unexpired with a nonempty evidence list.
Occupancy must be idle, fresh, nonfuture, evidence-bearing and lane-bound.
`maxAgeMs` is 1..300000; `maxUsedPercent` is >0..90 (10% reserve);
reader deadline 1..5000 ms; engineer/reviewer deadline 1..300000 ms.
These are explicit local commissioner policy, not adoption of proposed RED or
long-job pacing rules. No live principal, quota or occupancy is inferred.

## Command protocols

All commands receive one JSON object on stdin and return one JSON object on
stdout (512 KiB bound), exit 0. Nonzero exit, malformed JSON, pipe loss, output
overflow and deadline are never a successful outcome. Stderr is discarded.
Deadlines stop the owned command process group; this does not prove termination
of detached/external effects. No command is retried.

- **Usage reader** stdin: `{runId, laneId, accounts: [{vendor, accountId}, ...]}`
  for the author and reviewer. Stdout: `{readings: [{vendor, accountId,
  observedAt, usedPercent, capped, evidence: ["reference"]}, ...]}`. Exactly
  one reading per requested seat is required, with finite 0..100 percent,
  boolean `capped`, fresh nonfuture timestamp and evidence. Missing, invalid,
  failed, stale or timed-out reads produce `unknown_usage`, zero engineer and
  reviewer launches. At/above the requested usage threshold or `capped: true`
  produces `quota_exhausted`, also zero launches.
- **Engineer** stdin: `{request: NativeRequest, envelope: MageEnvelope}`.
  Stdout: `{vendor, result: NativeResult}`. Complete delivery requires an exact
  author vendor, explicit `completed: true`, `acknowledged: true`, nonempty
  native session ID and the requested model. Missing model/usage remain null;
  missing or mismatched route/session evidence never produces a passing run.
  Unacknowledged or incomplete results remain Summon `uncertain`/`interrupted`.
- **Reviewer** stdin: `{task: TaskSpec, delivery: DeliveryInspection, envelope:
  MageEnvelope}`. Stdout: `{vendor, receipt: ReviewReceipt | null}`. Null means
  unknown. Receipt must bind the current run/check/digest, have evidence and
  identify the configured reviewer as `vendor:accountId`. Vendor must equal
  the authorized reviewer vendor and differ from the author. Missing receipts
  and `unknown`/`uncertain` verdicts stay unknown; they are not imported as a
  Summon pass/block receipt. Only the original
  Summon receipt fields are imported; same-vendor or mismatched receipt cannot
  create a passing proof. Output changes during review invalidate the digest.

## Result and safety boundary

Every result contains `status`, `code`, and `launches: {engineer, reviewer}`;
these count command launch attempts, excluding the read-only quota reader.
Admission reason codes: `invalid_input`, `invalid_authorization`,
`unknown_occupancy`, `lane_occupied`, `unknown_usage`, `quota_exhausted`,
`same_vendor_review`, `invalid_route`, `state_unavailable`.
Post-admission codes include `engineer_uncertain`, `review_unknown`,
`invalid_review`, `review_blocked`, `delivery_changed`, `verified_delivery`,
and `reconciliation_required`.

Envelope payloads must fit Mage's <128 KiB payload / 256 KiB record bounds.
Oversized review evidence produces an explicit unknown receipt, never a passing
transport envelope; the run projection still reports Summon's observed state.
Guard cleanup failure also preserves actual launch counts and returns unknown.

After admission, results also include Summon's `run` projection
`{runId, state, deliveryState, deliveryDigest}`, the imported `review` if any,
and a Mage `completion` envelope. Its payload is the JSON result without the
envelope, and delivery ID is the SHA256 of the commission delivery ID plus
`:completion`. Other envelope bindings/correlations are preserved. **An emitted
envelope is transport intent, not Mage native ACK or factory acceptance.** The
caller may explicitly publish it through the existing Mage inbox/transport.
The final inspection rechecks passing proof freshness. Inspection or guard-cleanup
errors stay `unknown` with the actual launch counts. Completion payloads remain
below Mage's 128 KiB payload / 256 KiB record limits; oversized review evidence
produces `unknown/invalid_review` with a compact receipt. If the binding itself
cannot fit the record limit, no envelope is emitted.

Use one existing, canonical, owner-only state directory for all contenders.
The admission subdirectory stores only exclusive lane guards and immutable
task attempt markers; it is not a second run ledger. An exclusive filesystem
guard covers occupancy validation, quota read, engineer execution and review.
Racing contenders for a lane cannot both launch. Marker publication precedes
the native launch. Any repeated task ID or abandoned marker returns explicit
`unknown/reconciliation_required`, zero new launches. Uncertain outcomes retain
the lane guard; there is no TTL, stale-owner stealing or automatic retry.
Settled pass/block releases the guard. Before a manual recovery, inspect
Summon's state plus command/native evidence; the CLI has no reset/retry command.
This is local deduplication, not exactly-once external effects or distributed
occupancy reservation. Foreign callers bypassing this entry point are outside
its boundary. Caller assertions are not authenticated vendor/principal proof.
An existing Summon task, including a queued task created by another caller,
requires explicit reconciliation; this entry point never silently takes it over.

## Verification

`bun test agent-config/candidates/admission` uses fake commands only. It covers
admission refusal with zero launches, bounded hung readers, cross-vendor review,
uncertain outcomes, stale proof, duplicate suppression and racing lane owners.
No Mage/Summon source or installer/check wiring is changed by this candidate.
