# Foundations

Build less and build it well: the smallest change that solves the original
problem, simple interfaces, one owner per fact, and no obsolete replacement path.
Split new work rather than widening the ticket. Speed beats ceremony.

## Ten foundations every project keeps

Critical: a gap here can hurt people, data or money.

1. **Runs and QA'd in full.** The whole app starts from its README in a fresh
   workspace with realistic privacy-safe data and its real consumer surface.
   In the lean cadence, main builds once, deploys isolated production-like
   preprod and proves affected journeys and consequential boundaries there.
   The complete suite and every user story run nightly and on demand, not on
   every PR. Failed or absent candidate proof never authorizes production.
2. **Screams in production.** Every production error, failed health check or
   broken story reaches Sentry or an outside probe and starts agentic incident
   response and triage within minutes. Our own machinery screams the same way:
   every timer, cron, hook, reviewer, backup and release records one outcome
   per run, and a failed or missed run becomes one incident per cause.
3. **Safe releases.** A release ships only a proven change, reads back what
   shipped, and rolls itself back on failure without losing accepted data.
4. **Recoverable data.** Data people trust us with has an owned backup and a
   restore we have actually rehearsed.
5. **Safe secrets and access.** No secrets in code or logs, no open critical
   dependency alerts, and every user reaches only what they should.

Table stakes: a gap here makes a project look or work unlike ours.

6. **Tidy repository.** The GitHub repository has a description, a README that
   says what it is and how to run and ship it, and a licence if it is public.
7. **Written down.** The project has a short spec, user stories, and a ranked
   backlog of tickets in its tracker.
8. **Tested on every change.** Engineers exercise changed contracts, obtain
   independent review and run cheap secret/privacy scans before merge. Lean CI
   runs no automatic PR or PR-target jobs: main proves the exact candidate before
   automatic same-byte promotion; the full suite is an owned nightly run whose
   failed or missing completion screams through the existing approved intake.
9. **Public website.** A well-designed, marketing-minded site explains the
   project and holds its documentation.
10. **In a portfolio.** The project appears on the R90 site, mistystep.io or
    phaedrus.io.

Internal tools, infrastructure, config repositories and private betas skip 9
and 10; libraries and local apps skip 2's production clause, never its
machinery clause. Phaedrus approves any other exception. Approved: Cantrip
keeps recordings, transcripts, logs and history on the user's machine, so its
4 is durable local storage that no crash, update or migration loses, never an
off-disk backup. External backup is the user's choice, and accounts, automatic
backup and cloud sync are outside its scope (Phaedrus, 2 October 2026). Any
hosted service keeps 4 in full.

## Five principles for every change

1. **Prove the real candidate before shipping it.** Main's immutable artifact
   runs in isolated production-like preprod with representative privacy-safe
   data. Walk touched stories and mandatory access/data/migration/recovery
   boundaries there. Broaden relevant proof for shared or uncertain impact.
   Existing pins adopt this lean cadence explicitly (ADR-007).
2. **Only proven changes may alter access or accepted state.** The release
   script automatically promotes the tested bytes without rebuilding and reads
   back identity and a critical journey. An older slow run cannot replace newer.
   Failed health triggers automatic rollback to a compatible release, preserving
   accepted writes.
3. **A lost promise or silent check creates owned repair work.** Real failures
   go to the native tracker for triage and repair. Restore service before
   investigation; keep repair bounded to the failure.
4. **Every check earns its keep, or it goes.** Name the real failure and the
   smallest proof that rejects it. Delete prose hashes, duplicate gates and
   report rituals; preserve independent safety contracts.
5. **Keep intent and proof together.** The existing ticket or PR names the story
   or spec it serves and retains the bounded change and observed proof.

