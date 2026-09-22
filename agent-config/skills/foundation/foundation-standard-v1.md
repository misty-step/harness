# Foundation Standard

**Standard:** `misty-step.foundation`
**Version:** `1.0.0`
**Catalog:** [`foundation-standard-v1.json`](foundation-standard-v1.json)

This is the canonical engineering standard. The adjacent JSON is its
machine-readable catalog; this document gives the normative meaning. The Foundation
skill is an assessment and repair procedure that reads this standard, not a second
policy source.

## Principles

1. **Applicability follows capability.** Record the project's actual user,
   runtime, data, transition, and release capabilities, then disposition every
   obligation. A private utility and an operated multi-user product do not owe the
   same implementation. Absence alone does not justify a platform or a waiver.
2. **Evidence has layers.** Keep SDK or file presence, syntactic schema validity,
   semantic adequacy, and exercised runtime coverage distinct. A later layer is not
   proved by an earlier one, a task status, or a historical receipt.
3. **Use the smallest owned mechanism.** Prefer an executable check or missing
   affordance that closes a consequential failure path. Reuse an adequate signal,
   store, or platform; do not add telemetry merely to satisfy a tool count.
4. **Exceptions have authority and bounds.** `not_applicable` means the predicate is
   false. `exception` means it applies but is temporarily waived. Both name the
   accountable approver, bounded reason, and substitute or residual risk; an
   exception also expires. Reassess when capability, data scope, hosting, or release
   path changes.

## Adoption record

A repository adoption record pins this standard's ID, version, catalog digest,
canonical source path, and exact source revision. It lists project capabilities and
one disposition for every obligation:

- `satisfied`: cite retained evidence references. The checker verifies their shape
  and local targets; the referenced command or runtime retrieval must still run.
- `not_applicable`: state why the applicability predicate is false, who approved the
  decision, and the substitute or explicit absence of a needed signal.
- `exception`: state the applicable boundary, approver, substitute control, and an
  expiry. Expired or malformed exceptions reject.

Unknown, duplicated, or missing obligation IDs reject. A deterministic manifest
pass proves catalog identity, disposition completeness, and evidence-reference
integrity only. It never proves semantic adequacy or live runtime coverage.

## Verifiable obligations

### FND-CHG-001 — Executable change path

**Applies when:** the repository is expected to be changed or released.

A fresh authorized actor can exercise the core user outcome or consumer contract,
distinguish success from plausible failure, and clean up in an isolated or explicitly
authorized environment. Repository procedures identify representative data,
identities, external dependencies, and the exact command or supported interface.
File presence, a successful unrelated tool call, or an old receipt is not proof.

**Evidence:** an executed success path, at least one plausible failure path, exact
candidate identity, command or interface, environment boundary, result, and cleanup.

**Exception authority:** accountable project owner; security or data owner also
approves when access or private data is involved.

### FND-CHG-002 — Consequential checks and recovery

**Applies when:** a repeatable defect, unsafe transition, or release path exists.

Checks, local development, CI, builds, and recovery are judged by consequential
failures they catch or prevent. Prefer a pokayoke that makes the failure impossible
or rejects it in the path that matters over another warning. The named invalid case
must reject and a valid case must pass; exercise rollback or recovery when failure
would be consequential.

**Evidence:** executable must-reject and must-stay-valid cases on the candidate,
including raw command status and retained output.

**Exception authority:** accountable project owner with a time-bounded substitute
control and residual-risk statement.

### FND-TRN-001 — Safe transition and artifact identity

**Applies when:** a host, deployment, database, identity, realtime, or job boundary
changes.

Separate a host move from changes to data, identity, realtime, and job contracts.
Current deployment evidence, not a declaration or separate local implementation,
establishes cutover. Identify the exact candidate artifact and target; address
migration safety, authorization, private data, exposure, lifetime, rollback,
recovery, and operator ownership. An assessment or preview is not permission to
provision or publish.

**Evidence:** exact artifact and target identities plus exercised transition and
rollback/readback evidence for each changed boundary.

**Exception authority:** accountable project owner and the owner of every changed
persistence, identity, or hosting boundary.

### FND-OBS-001 — Structured diagnostics and errors

**Applies when:** code operates asynchronously, serves users, depends on external
systems, or must be diagnosed after execution.

Emit structured, queryable events at explicit `debug`, `info`, `warn`, and `error`
levels or stack-native equivalents. Cover material state transitions, dependency
boundaries, retries, and failures needed to reconstruct an execution without
capturing everything. Include a stable event and operation name, time, component,
environment, release or build, outcome, and safe request, trace, session, job, or
execution correlation as applicable. Keep verbose debug output disabled, sampled,
or time-bounded in normal operation.

Error records distinguish handled from unhandled failures and preserve a bounded
error class, cause chain, stack, impact, retryability, and safe context. Publish
source maps or debug symbols from the exact deployed artifact when compiled or
minified stacks otherwise cannot identify source.

**Evidence:** controlled debug/error paths, sanitized records retrieved from the
intended sink, correlation and release attribution, and source resolution where
applicable.

**Exception authority:** accountable project owner. A local-only utility may use
bounded local structured records when no remote operation exists; it does not thereby
waive diagnostics needed for its own execution.

### FND-ACT-001 — Authoritative product activity

**Applies when:** the project promises a user or operator journey whose completion
cannot be inferred from uptime or absence of errors.

Define a versioned first-party event schema for material journey transitions,
including success, rejection or failure, abandonment, and recovery—not just clicks
or client intent. Each event has one semantic owner, event identity and
deduplication rule, source and occurrence time, schema version, environment and
release, outcome, and safe correlation. Prefer a server or durable receipt as
authority for accepted and completed states; label client-only observations.

Define identity scope, pseudonymization, consent or other approved basis, user choice
and deletion, and tenant isolation. Avoid durable user identifiers when aggregate or
session-scoped evidence answers the question.

**Evidence:** representative journey transitions retrieved from the authoritative
store, with duplicate/retry behavior and success/failure/recovery semantics tested.

**Exception authority:** accountable product owner with an explicit substitute for
the promised-journey decision; private deployment alone is not a blanket waiver.

### FND-DAT-001 — Safe and bounded operational data

**Applies when:** the project emits diagnostics, errors, traces, metrics, or product
activity.

Allowlist typed fields at the producer. Do not emit secrets, credentials,
authorization values, cookies, raw headers or bodies, arbitrary user content,
prompts, messages, or stack locals by default. A narrow exception needs a documented
diagnostic purpose, access boundary, consent or approval, and deletion policy.

Bound and own retention, access, region, deletion, cardinality, volume, cost, and
sampling; preserve actionable errors and important low-volume or tail paths. A slow
or failed telemetry sink must not fail or stall the product path or trigger recursive
logging. Use bounded buffering, retry, or drop behavior, with an independently
observable loss or backpressure signal.

**Evidence:** typed schema/producer checks, synthetic secret and content canaries,
access/retention/volume decisions, and a controlled sink outage showing product
survival and visible loss behavior.

**Exception authority:** security or privacy owner plus accountable project owner.

### FND-PRF-001 — Executed observability proof

**Applies when:** `FND-OBS-001`, `FND-ACT-001`, or `FND-DAT-001` applies.

Exercise representative success and every material failure journey. Assert event
shape and level, correlations, authoritative outcomes, cause and release attribution,
single semantic emission or deduplication, and retrieval from the intended sink.
Include negative tests proving synthetic secret and content canaries never leave the
producer, plus controlled failures proving useful error capture, source mapping when
applicable, and product survival when the sink is unavailable.

Production-readiness evidence identifies the exact test, environment, release,
sanitary query or record, and every unproved boundary. An installed SDK, logger
import, valid schema, or a declared pass is not runtime proof.

**Evidence:** raw executed positive/negative results and a fresh sanitized sink
readback bound to the exact candidate/release.

**Exception authority:** accountable project owner with the exact unproved runtime
boundary and a time-bounded production-readiness condition.

### FND-USE-001 — Owned operational use

**Applies when:** an emitted signal is claimed to support a material failure response
or product decision.

Give each material failure and product decision a documented query or dashboard,
freshness and retention expectation, owner, and response. Alert only on actionable
user or operating impact; define its condition, window, destination, recovery
behavior, direct diagnostic query, and runbook. Verify a fresh sanitized signal and a
controlled failure-and-recovery retrieval before treating configuration as coverage.

**Evidence:** the exact query or dashboard, owner and expected action, plus controlled
error/recovery and retrieval output.

**Exception authority:** accountable operations or product owner with the decision
explicitly removed or a named substitute query and response path.

## Approved tool defaults

These are explicit Misty Step defaults, not provider-neutral obligations hidden as
universal law. A project records the default it uses or the approved equivalent.

### FND-DEF-SENTRY-001 — Error capture

For a Misty Step user-facing application or operated service without an approved
equivalent, **Sentry is the approved default** for error capture, environment and
release association, and exact-release source-map or debug-symbol processing. The
project still owes the outcome and proof obligations above; installing an SDK does
not satisfy them. The accountable project owner may name an existing equivalent that
meets the same applicable obligations.

### FND-DEF-ACTIVITY-001 — Product activity

When a project already owns a suitable durable store, an **existing first-party store
is the approved default** for a minimal versioned activity table—D1 or Convex where
those are already the project store—before adding another analytics platform. The
accountable product owner may approve another owned platform with equivalent
authority, privacy, deletion, retrieval, and deduplication behavior.

Comprehensive means every material success, failure, and decision has enough safe,
owned evidence. It does not mean capturing every interaction or value.
