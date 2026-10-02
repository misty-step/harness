# ADR-009: Nothing fails silently — one outcome per run, one incident per cause

Status: Accepted 2026-10-02 (K-20261002). Phaedrus, relayed by Kaylee: "the
automatic code reviewer failing more than five thousand times without any
alerts ... design a strategic fix that makes that class of error impossible ...
Anytime anything goes wrong anywhere, it should scream and it should immediately
dispatch investigation, triage and strategic remediation and postmortem."
Design: <https://mirrodin.tail5f5eb4.ts.net/review/harness/screams-r1.html>.
Postmortem: [2026-09-28-diff-review-silent-key](../postmortems/2026-09-28-diff-review-silent-key.md).

## Decision

Our machinery uses the same route as product alerts, with three relationships
that make silence a data-shape error rather than a monitoring gap:

1. **One outcome record per run, in one shape** — job, run, time, ok, and a
   cause when not ok. Reporters adapt each scheduler (systemd and Hermes on
   mirrodin, Nopalito's Hermes, GitHub Actions through the signed webhook,
   Cloudflare cron triggers) and `outcome record` covers hooks and reviewers.
2. **Expected runs are declared by the scheduler that owns the schedule.** Each
   reporter sends its scheduler's complete job list with `every`, the longest
   allowed gap. A job past its gap is a `missed` failure; a missed parent
   (a silent host or scheduler) explains its children, so it screams once.
3. **One path from failure to incident, deduplicated by cause.** The alert
   intake (hermes-config Worker and D1) keeps jobs, runs and episodes. The first
   failure of a (job, cause) opens one episode and one alert; repeats count; an
   ok run closes it. Alert triage turns the alert into one ticket per cause
   marker and a Glass item. The ticket closes only with a postmortem and a
   class-closing change (FND-INC-001); the desk dispatches the investigation.

The Worker's five-minute cron is the outside dead-man for every reporter; the
route guard fails if that checker stops.

Wiring is by scheduler, not by job: a new timer, Hermes cron or workflow on a
covered scheduler reports without anyone adding it. A job outside every covered
scheduler is a foundations-audit gap (constitution foundation 2).

## Consequences

- The workstation reporter stops sending Sentry events; Sentry stays the route
  for product errors, where Sentry's issue is the cause.
- GitHub workflow failures reach triage as outcome episodes instead of one
  alert per failed run.
- The Tach backup exception (MIS-199) is superseded: it left those backups with
  no page if Tach's own send failed.
- Advisory checks in this repository record their runs. The diff review CLI
  exits 2 and `semantic-check` exits 3 when they could not run; CI's review
  step skips only fork pull requests.
- No new platform, per-job alert rule, dashboard or Sentry Crons spend.

## Alternatives rejected

- **Sentry Crons** — the expected-run monitor we want, but billed per monitor
  beyond one; the misty-step seat is already used and r90 has no on-demand budget.
- **A local ledger on mirrodin** — cannot watch Fly, GitHub or Cloudflare, and
  cannot notice that mirrodin itself stopped.
- **Per-job heartbeat rules** — the bureaucracy Phaedrus ruled out, and every
  new job would start unwatched.
