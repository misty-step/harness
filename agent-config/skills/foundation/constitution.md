# Foundations

Build less and build it well: the smallest change that solves the original
problem, simple interfaces, one owner per fact, and no obsolete replacement path.
Split new work rather than widening the ticket. Speed beats ceremony.

## Ten foundations every project keeps

Critical: a gap here can hurt people, data or money.

1. **Runs and QA'd in full.** The whole app starts from its README on a fresh
   exe.dev VM, with realistic data and a clickable dev server, and an agent
   walks every user story on it before and after each ship.
2. **Screams in production.** Every production error, failed health check or
   broken story reaches Sentry or an outside probe and starts agentic incident
   response and triage within minutes.
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
8. **Tested on every change.** CI runs real behaviour tests on every change and
   answers within minutes.
9. **Public website.** A well-designed, marketing-minded site explains the
   project and holds its documentation.
10. **In a portfolio.** The project appears on the R90 site, mistystep.io or
    phaedrus.io.

Internal tools, infrastructure, config repositories and private betas skip 9
and 10; libraries and local apps skip 2. Phaedrus approves any other exception.

## Five principles for every change

1. **Reproduce the whole product before trusting a change.** Each PR's exact
   head runs on its own private exe.dev VM with privacy-safe, production-like
   seeded data. Walk touched stories before merge; destroy the preview VM at
   merge or close. No persistent QA.
2. **Only proven changes may alter access or accepted state.** The release
   script ships only a proven head and reads back what shipped. Failed health
   triggers automatic rollback to a compatible release, preserving accepted
   writes.
3. **A lost promise or silent check creates owned repair work.** Real failures
   go to the native tracker for triage and repair. Restore service before
   investigation; keep repair bounded to the failure.
4. **Every check earns its keep, or it goes.** Name the real failure and the
   smallest proof that rejects it. Delete prose hashes, duplicate gates and
   report rituals; preserve independent safety contracts.
5. **Every change traces from ticket to packet.** Its ticket names the story or
   spec it serves; its packet keeps the brief, the agent session, the diff and
   the proof.

## Audits

Three weekly audits read every active repository, one read-only OMP auditor per
repository: Foundations, Principles and Simplicity. Each files one ticket per
gap, with no cap, and never fixes, steers or messages anyone. Their template,
launcher and schedules live in harness `omp-config/auditors/`.
