# Foundation Standard

**Standard:** `misty-step.foundation`
**Version:** `1.5.0`
**Catalog:** [`foundation-standard-v1.json`](foundation-standard-v1.json)

The adjacent JSON catalog is the **single normative source for structured obligation fields**: applicability, required evidence, exception authority, approved defaults, dispositions, and required decision fields. This document is the human-readable rationale and operating guidance keyed by those IDs; it does not restate a second normative copy. The Foundation skill is an assessment and repair procedure that reads the catalog and this guidance, not another policy source.

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
4. **Unknown stays pending and non-pass.** `pending` requires a dated bootstrap
   gap with an owner and expiry no more than 30 days away. The older ADR-005
   application gaps retain their `ops:` keys; the other obligations use
   `obl:<ID>`. `not_applicable` means the predicate is false. `exception` means
   an applicable obligation has a temporary waiver (never for ADR-005's three
   application obligations). Both require a separately approved record. No
   committed name, inline decision or unverified receipt grants authority.

## Adoption record

A repository's `foundation.json` pins the catalog ID, version, byte digest,
canonical source URL and revision. `surfaces` is a nonempty list drawn from
`ui`, `cli`, `library`, `api`, `deployed`, `content`, `public`. Every obligation
and approved default has one disposition:

- `satisfied`: `{"status":"satisfied","receipt":"foundation/receipts/FND-DOC-001.json"}`.
  This JSON receipt is generated in the candidate check job, not committed:
  `{"schema":"foundation-evidence/1","obligation":"FND-DOC-001","revision":"<HEAD SHA>","path":"FND-DOC-001.txt","sha256":"<payload SHA-256>","check":"<executed check>","run":"<run id>","exit":0}`.
  `path` resolves within the receipt's directory. The checker matches the
  obligation and HEAD revision, rejects committed receipts and escaped paths,
  and hashes the retained payload. A receipt still has to show the real
  execution and coverage; a self-authored JSON file does not prove practice.
- `pending`: `{"status":"pending","missing":"<proof>","owner":"<owner>","next":"<action>"}`.
  For every applicable pending obligation a `foundation.json` bootstrap
  baseline needs a current `obl:<ID>` entry with owner and expiry within 30
  days. ADR-005's application obligations retain `ops:ship`, `ops:alert`,
  `ops:incident` instead. Enforced mode cannot carry a baseline. A pin bump via
  `baseline --owner NAME --revision SHA --write` adds the new `obl:` entries;
  extensions require a `foundation/extensions/` record and designated review.
  Missing story-evidence paths stay advisory in bootstrap mode; before an
  otherwise gap-free record moves to enforced mode, `baseline` requires those
  paths to resolve rather than writing an immediately stale gap.
- `not_applicable` or `exception`: give `reason`, `substitute`, `approval_ref`;
  `exception` also gives an unexpired `expires` date within 30 days. The
  `approval_ref` is a committed `foundation/approvals/*.json` file at HEAD:
  `{"schema":"foundation-approval/1","obligation":"FND-DOC-001","disposition":"not_applicable","reason":"<same reason>","substitute":"<same substitute>"}`.
  An exception also repeats its exact `expires`. The checker matches every
  field and rejects extras; `foundation-check review` requires the designated
  reviewer's approval on the head of the PR adding or changing that disposition
  or record. Approval is authenticated through GitHub, never by a name in JSON.

Missing, duplicated or unknown IDs and a wrong catalog digest fail. A structural
pass is not a compliance verdict; actual behavior, review substance and live
tenant or security outcomes belong in independently judged receipts (ADR-006).

## Verifiable obligations

### FND-CHG-001 — Executable change path

A fresh authorized actor can exercise the core user outcome or consumer contract,
distinguish success from plausible failure, and clean up in an isolated or explicitly
authorized environment. Repository procedures identify representative data,
identities, external dependencies, and the exact command or supported interface.
File presence, a successful unrelated tool call, or an old receipt is not proof.

### FND-CHG-002 — Consequential checks and recovery

Checks, local development, CI, builds, and recovery are judged by consequential
failures they catch or prevent. Prefer a pokayoke that makes the failure impossible
or rejects it in the path that matters over another warning. The named invalid case
must reject and a valid case must pass; exercise rollback or recovery when failure
would be consequential.

### FND-TRN-001 — Safe transition and artifact identity

Separate a host move from changes to data, identity, realtime, and job contracts.
Current deployment evidence, not a declaration or separate local implementation,
establishes cutover. Identify the exact candidate artifact and target; address
migration safety, authorization, private data, exposure, lifetime, rollback,
recovery, and operator ownership. An assessment or preview is not permission to
provision or publish.

### FND-OBS-001 — Structured diagnostics and errors

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

### FND-ACT-001 — Authoritative product activity

Define a versioned first-party event schema for material journey transitions,
including success, rejection or failure, abandonment, and recovery—not just clicks
or client intent. Each event has one semantic owner, event identity and
deduplication rule, source and occurrence time, schema version, environment and
release, outcome, and safe correlation. Prefer a server or durable receipt as
authority for accepted and completed states; label client-only observations.

Define identity scope, pseudonymization, consent or other approved basis, user choice
and deletion, and tenant isolation. Avoid durable user identifiers when aggregate or
session-scoped evidence answers the question.

### FND-DAT-001 — Safe and bounded operational data

Allowlist typed fields at the producer. Do not emit secrets, credentials,
authorization values, cookies, raw headers or bodies, arbitrary user content,
prompts, messages, or stack locals by default. A narrow exception needs a documented
diagnostic purpose, access boundary, consent or approval, and deletion policy.

Bound and own retention, access, region, deletion, cardinality, volume, cost, and
sampling; preserve actionable errors and important low-volume or tail paths. A slow
or failed telemetry sink must not fail or stall the product path or trigger recursive
logging. Use bounded buffering, retry, or drop behavior, with an independently
observable loss or backpressure signal.

### FND-PRF-001 — Executed observability proof

Exercise representative success and every material failure journey. Assert event
shape and level, correlations, authoritative outcomes, cause and release attribution,
single semantic emission or deduplication, and retrieval from the intended sink.
Include negative tests proving synthetic secret and content canaries never leave the
producer, plus controlled failures proving useful error capture, source mapping when
applicable, and product survival when the sink is unavailable.

Production-readiness evidence identifies the exact test, environment, release,
sanitary query or record, and every unproved boundary. An installed SDK, logger
import, valid schema, or a declared pass is not runtime proof.

### FND-USE-001 — Owned operational use

Give each material failure and product decision a documented query or dashboard,
freshness and retention expectation, owner, and response. Alert only on actionable
user or operating impact; define its condition, window, destination, recovery
behavior, direct diagnostic query, and runbook. Verify a fresh sanitized signal and a
controlled failure-and-recovery retrieval before treating configuration as coverage.

### FND-DOC-001 — First-class project documents

Keep root `README.md` (orientation), `AGENTS.md` (operating rules and routes
to the gate, walk, release and DOMAIN ledger), `USER_STORIES.md` (intent), and
`DOMAIN.md` (glossary, ownership, code map and invariants ledger). `ui` adds
`DESIGN.md`; `deployed` adds `docs/runbook.md` with Release, Rollback and
Recover; `content` adds a machine schema and lint. ADRs, if present, belong
under `docs/adr/` with unique numbers, status and valid supersession targets.
`CLAUDE.md` and `GEMINI.md`, when present, are symlinks to AGENTS.md. Core
Markdown links, AGENTS routing commands, and the executable `scripts/check`
used by CI resolve at HEAD. A public face, generated references and prose
drift remain outside stage 1 (ADR-004).

### FND-MAP-001 — Navigable feature map

Index feature files from `features/README.md`. Each feature names live stories,
tracked source globs, sub-features, the user entry path, driving instructions,
and gotchas. Every live story needs a feature. The map should let a change
reviewer find the affected user journeys before choosing checks.

### FND-WLK-001 — Story-walk receipts

Run the repository's walk runner in the same CI job as receipt validation.
Bind the receipt to the exact candidate head and tree; pass every affected story
and criterion, and retain digests for each cited artifact. `unwalked` is
advisory only with a current `walk:` baseline, never a claimed pass (ADR-003).

### FND-WS-001 — Workspace-ready bootstrap

Every active repository needs a credential-free, idempotent `.exe/setup.sh`
that brings a fresh Ubuntu LTS exe.dev VM and a GitHub-hosted Ubuntu runner to
the toolchain its gate needs. Agent and model credentials stay on the desktop
(ADR-004).

### FND-REV-001 — Independent review

Every change needs an approving reviewer other than the PR author on its
candidate head. Review against the Foundation constitution, the
`DOMAIN.md` invariants ledger at the base revision, and the stories the
change serves. `review` verifies the GitHub review identity, state and head;
it cannot infer whether the reviewer actually judged those sources. That
judgement is the review receipt. In r90group, the designated decision marker
records the reviewer action, but a shared GitHub account cannot prove actor
separation; its gate is advisory (ADR-003/006).

### FND-SEC-001 — Security baseline

All active repositories run a secret scanner on PRs and pushes and configure
Dependabot to propose updates. A bot-only auto-merge job waits on a blocking
gate and uses Dependabot metadata to allow only patch and minor updates;
other updates require review. Applications (`ui`, `cli`, `api`, `deployed`)
additionally test authorization boundaries, including denied and allowed
identities. `foundation.json` names `security.secrets.{workflow,job}`,
`security.dependencies.{bot,config,automerge.{workflow,job}}`, and for
applications `security.authorization.{workflow,job,test}`. The checker
resolves workflow jobs, scanner command and unfiltered PR/push triggers,
blocking job and step guards, bot config, dependency metadata and transitive
gate, patch/minor-only auto-merge guard, and authorization test reference. Only
an executed receipt establishes that scanning caught secrets, safe updates
actually merged on green and authorization was tested meaningfully;
repository syntax cannot prove those outcomes.

### FND-CIT-001 — Affected-story citation

For a PR changing source mapped by a feature, cite every live story id from
`foundation-check affected --base <base>` in a PR-description
`Stories: US-001, US-002` line. `review` tests applicability against both the
base and candidate feature maps, then computes the full affected set from
candidate git objects; it never checks out or executes the PR.
The story's relevance and outcome still require human review and a walk
receipt. No citation is required when no mapped source changes.

### FND-REL-001 — Continuous deployment

Green on the default branch, whatever its name, deploys to production. Every
merge that passes the gate ships with no hand step. For a multi-tenant app, the
rollout reaches every tenant except those explicitly excluded in the adoption
record with a reason; exclusion is a reviewable record change. Migrate every
non-excluded tenant before deploy, keep migrations backward-compatible with
the code still running (expand/contract), and stop the rollout if one fails.
The repository supplies a complete tenant registry and a command or workflow
that reports every tenant's deployed revision and migration level, even for
excluded tenants. The receipt reads back each non-excluded tenant's production
state after deploy; file checks cannot prove actual fan-out or migration safety.
The gate is strong enough to ship at 5pm on a Friday: CI, automated tests of
the core journeys, story walks and agentic QA, then a readback or smoke check.
Rollback is exercised, not described. A manual promotion, a dispatch-only
workflow, or a deploy that does not wait on the gate is not continuous
deployment (ADR-005).

### FND-ALR-001 — Loud production alerting

Production errors reach a remote store with release and environment (Sentry by
default, or an approved equivalent), and outside health checks alert only to an
approved agent triage intake, never a person's inbox or phone. For Sentry every
alert rule's actions target that intake and no alert email goes to org members;
a controlled failure seen and handled by triage proves delivery. An unset DSN
or a route merely "prepared" is not alerting. `kaylee-alert-intake` is triaged
every five minutes; an alert waiting over 30 minutes fails its route guard
(`hermes-config/docs/alert-routing.md`, ADR-005).

### FND-INC-001 — Incident response closes the class

The triage agent reads each alert, opens its incident ticket and starts an
engineer or escalates to Kaylee only when the alert is real. Through the
runbook's Incidents section, the ticket links a postmortem from the harness
template (pokayoke skill) and its structural, class-closing fix with a
regression check; it closes only with both linked (ADR-005).

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
