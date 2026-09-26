# ADR-005: Every application ships on green, alerts loudly, and closes incident classes

Status: Accepted 2026-09-25 (MIS-150). Operator directive, relayed by Kaylee:
"a non-negotiable foundation standard, without exception, for every application
we work on in both orgs." This record adds three obligations to the Foundation
Standard catalog (version 1.3.0) and to `foundation-check`. It amends ADR-003's
enforcement (these three take no exception) and builds on ADR-004's `surfaces`
and `deployed` runbook. Rollout waves are a separate proposal.

## Context

The directive has three parts:

1. **Continuous deployment.** Green on main ships. CI, automated tests,
   verification and agentic QA are strong enough to deploy at 5pm on a Friday.
2. **Deep Sentry integration**, or an equivalent error-logging and health-check
   system, so production incidents alert loudly.
3. **Incident response** that ends in a postmortem and a fix that rules out the
   whole class of error.

What the standard already had:

- FND-OBS-001, FND-PRF-001 and FND-USE-001 cover structured diagnostics, proof
  of capture and owned alerts, but FND-USE-001 applies only when a signal "is
  claimed", and every obligation allows an `exception`.
- FND-DEF-SENTRY-001 makes Sentry the default tool without requiring anyone to
  use it.
- FND-CHG-001/002 and FND-TRN-001 cover change paths and transitions, not
  shipping cadence.
- ADR-004 gives a `deployed` repository a runbook (Release, Rollback, Recover)
  and says `docs/postmortems/` appears at the first incident. It removed the
  per-repository postmortem template; the template lives in the pokayoke skill.

The 2026-09-25 census of the 48 active repositories found no application that
meets any of the three in full (proposal:
`~/.cache/research-briefs/2026-09-25/operational-obligations-census.md`).
Examples it rests on:

- Most applications deploy by hand (wrangler, a dispatch-only workflow, a
  release PR someone must merge); several deploy through a platform git
  integration that does not wait for CI.
- Canary, the in-house equivalent, is archived and its hostnames do not resolve.
  Applications still configured for it drop their errors while their health
  endpoints report capture as "configured".
- Every Sentry alert workflow read notifies by email only: all 4 in r90 and
  the first 100 of misty-step's (the rest were not paged).
- Postmortems exist in a handful of repositories, mostly outside
  `docs/postmortems/`, and few link the change that closed the class.

## Decision

### Three obligations

| Id | Title | Owed by every application |
| --- | --- | --- |
| FND-REL-001 | Continuous deployment | Every push to the default branch that passes the gate ships automatically, through a job that waits on the gate; the gate (CI, tests of core journeys, story walks, agentic QA, then a readback of what shipped) is strong enough for a Friday 5pm deploy; rollback is exercised. |
| FND-ALR-001 | Loud production alerting | Remote error capture with release and environment (Sentry by default, or an approved equivalent that captures errors, checks health and raises incidents); an outside, scheduled health check; alerts only to an approved agent triage intake, proven by a controlled failure. For Sentry, all alert rule actions target the intake and no alert email goes to org members. |
| FND-INC-001 | Incident response closes the class | The runbook's `## Incidents` section turns an alert into an owned incident; the triage agent opens its ticket, starts an engineer or escalates to Kaylee only for a real alert; the ticket closes only when it links a postmortem from the pokayoke template under `docs/postmortems/` and the postmortem's structural, class-closing fix with a regression check. |

The catalog (`agent-config/skills/foundation/foundation-standard-v1.json`) holds
the normative fields; `foundation-standard-v1.md` explains them.

### Alert routing (operator decision 2026-09-26)

Production alerts in both orgs go only to the approved agent triage intake,
never to Phaedrus or any person's inbox or phone. Tach's test alert reached his
personal Gmail: he is the only member of each Sentry org, and Sentry emails
members by default. For Sentry, every alert rule's actions must target the
intake and no alert email may go to org members. The approved route is
`kaylee-alert-intake`: Sentry internal integration → Cloudflare Worker
`kaylee-alert-intake` → Kaylee's Hermes cron `alert-triage` → Kaylee's bot chat.
The triage agent reads each alert, opens its incident ticket, and starts an
engineer or escalates to Kaylee only when the alert is real; the ticket closes
only with its linked postmortem and class-closing fix. A repository names the
approved route key as `operations.alert.destination`, never a person, email
address, phone or provider channel. The route itself is owned in
`hermes-config/docs/alert-routing.md`; the checker verifies the declared key,
while the controlled-failure receipt proves actual delivery and handling.

### Applicability: every application

An application is a repository whose `surfaces` (ADR-004's vocabulary) include
`ui`, `cli`, `api` or `deployed`: it changes a live system or ships something
people run. Libraries, content vaults and fixtures are not applications. A
record without `surfaces` is treated as an application, so opting out takes an
explicit, reviewable declaration: a change that makes an application's record
declare a non-application is a third trigger for the designated reviewer
(ADR-003 Review authority), like a baseline extension. This change adds
`surfaces` to the adoption record now; ADR-004 stage 1 adds the document checks
keyed off it.

For a released artifact without a live service (a CLI, a desktop app, an
extension), "ships" means an automatic release and "health" means crash and
error reports from real installs.

### No exceptions

`foundation-check` rejects `exception` for these three, and rejects
`not_applicable` for an application. The ratchet is the only way to be late.

### Enforcement through the ratchet

- **Pending is a gap.** For an application, each of the three that is not
  `satisfied` is the gap `ops:ship`, `ops:alert` or `ops:incident`. In enforced
  mode it fails; in bootstrap mode it needs a baseline entry, at most 30 days
  out, and an extension needs the designated reviewer (ADR-003).
- **Satisfied must hold up.** The checker verifies the repository's side of each
  claim; runtime practice lives in the receipt:
  - FND-REL-001: `operations.ship` names the default branch, which the checker
    confirms from the CI event or the clone's `origin/HEAD` (unknown fails), and
    either a platform (a git integration, proved in the receipt) or a workflow
    that fires on every push to that branch, or on its successful
    `workflow_run`. Branch filters follow GitHub's globs and `!` exclusions; a
    `paths` or `paths-ignore` filter, `branches-ignore` covering the branch, or
    a tag-only trigger does not count, and a `workflow_run` must follow a
    workflow that itself fires on every push to the branch (a dispatch-only or
    scheduled upstream is a manual or periodic promotion). The named job must
    wait on the gate (`needs`, or the `workflow_run` success condition). It and
    every job it needs, transitively, must exist, and their `if:` may only
    combine, with `&&`, guards that keep every green push to the default branch:
    `success()`, `github.event_name == 'push'`, `github.event_name !=
    'pull_request'`, a `github.ref`/`github.ref_name` test for the default
    branch, the repository fork guard, and the `workflow_run` conclusion, head
    branch and event tests. Anything else (a promotion branch, a commit-message
    opt-in, a repository toggle, `always()`) fails closed, and a gate job with
    `continue-on-error` does not count. An all-green aggregator job with `if: always()`
    (a merge gate that fails unless every upstream succeeded) blocks correctly
    but cannot be verified from the file, so the ship job needs the checking
    jobs themselves; a repository using such an aggregator lists them.
  - FND-ALR-001: `operations.alert` names the file that initialises error
    capture (it must reference the provider), a scheduled health workflow or a
    named external monitor, and an approved agent triage route key as its
    destination, never a person's endpoint.
  - FND-INC-001: `docs/runbook.md` has a non-empty `## Incidents` section, and
    every postmortem in `docs/postmortems/` has `## Pokayoke` and
    `## Follow-up`; unless its status is `open`, the follow-up links the change
    that closed the class.
- **The receipt carries practice:** recent green commits reaching production
  without hand steps, a rollback drill, a controlled failure whose alert was
  seen and handled, and the regression check a postmortem cites. A lint cannot
  prove Friday confidence, so the checker never claims it.

### Adoption record shape

```json
{
  "surfaces": ["ui", "deployed"],
  "operations": {
    "ship": { "branch": "main", "workflow": ".github/workflows/deploy.yml", "job": "deploy" },
    "alert": {
      "errors": { "provider": "sentry", "init": "src/instrument.ts" },
      "health": { "monitor": ".github/workflows/health.yml" },
      "destination": "kaylee-alert-intake"
    }
  }
}
```

`ship` may instead be `{ "branch": "main", "platform": "vercel" }`, and
`health` may be `{ "external": "<named monitor>" }`.

### Pin bumps

`foundation-check baseline --revision SHA` on an existing record re-pins the
standard and adds every obligation the catalog gained as `pending`, so a pin
bump records the three new gaps in one command. It keeps the walk entries the
record already has and adds none, so a re-pin never re-baselines stories that
walk. Because the baseline grows, the
pin-bump PR carries an extension record for the designated reviewer.

## Consequences

- Every adopted repository fails its next pin bump until the three gaps are
  baselined or met; the rollout proposal sequences that.
- Structural checks prove shape, not practice. A dishonest `satisfied` with a
  well-formed `operations` block would pass the lint; the receipt and the
  review are the guard, as for every other `satisfied` disposition.
- A platform deploy that does not wait on CI can only be `satisfied` if the
  receipt shows the platform gates on the checks; otherwise it stays a gap.
- Email-only Sentry alerts are prohibited: every rule targets the agent triage
  intake, no alert email goes to org members, and the controlled-failure receipt
  proves the route was seen and handled.
- Tach (`r90group/agent-usage-telemetry`) is writing its own plan; its row in
  the census defers to it.

## Alternatives rejected

- **Fold the three into FND-OBS/USE/CHG.** They allow exceptions and apply only
  when a capability is claimed; the directive is unconditional.
- **Amend ADR-003.** ADR-003 owns checks and cadence; changes to the standard's
  content follow ADR-004's pattern of a new record amending the catalog.
- **Guess deploys from workflow text** (grep for `wrangler deploy`). Declarations
  verified against the workflow file are deterministic; guesses are not.
