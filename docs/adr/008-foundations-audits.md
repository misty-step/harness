# ADR-008: Ten foundations, three audits, one auditor per repository

Status: Audit automation retired 2026-10-05 by the operator's native
configuration/install/skills-only scope decision. Foundation validators remain.
Historical acceptance on 2026-10-02 follows. Phaedrus approved foundations round 4
(<https://mirrodin.tail5f5eb4.ts.net/review/foundations/r4.html>), relayed by
Kaylee: "the nightly deletion pass that just gets folded in as one of a set of a
composition of auditors that we run each with different perspectives on every
single one of our repositories with some regularity... they're running on OMP,
with our subscriptions, with our OMP config, like that's fine. Yes, approved."
The Trellis viewer lockout on 1 October prompted the work: "How on Earth was
this regression possibly deployed?"

## Decision

The constitution states ten foundations every project keeps, five critical and
five table stakes, plus five principles for every change: round 2's four rules
and "every change traces from ticket to packet". Named exceptions skip the
website, portfolio and production-alerting foundations.

Three audits apply them: Foundations, Principles and Simplicity. The deletion
pass folds into Simplicity. They run weekly on every active `misty-step` and
`r90group` repository. Plain code (`omp-audit`, under systemd user timers)
launches one visible OMP auditor per repository and audit, in that repository's
fresh checkout. Each auditor uses the fixed template, our subscriptions and the
OMP config.

Auditors are read-only. Tool scope and a tool guard enforce this, not prose.
Their one write is recording findings; the launcher files them outside the
auditor's sandbox and keeps one ticket per gap through a trusted marker. There
is no ticket cap; ranking and weekly priority climb replace it. A finding that
cannot be filed is kept and fails the run loudly, to be refiled without another
audit. Auditors never fix gaps, steer engineers or message anyone; only the desk
dispatches. Routing: Habitat for R90; Glass board items for Misty Step and for
doctrine proposals that Phaedrus decides. Misty Step left Linear on 2 October;
the audits have no Linear path.

## Consequences

Kaylee's nightly deletion-audit cron and skill retire once Simplicity is
installed. The foundation-check catalog, `foundation.json` and the foundation
workflows remain until their own retirement, which the audits will file.
Gaps found on the first run arrive as tickets in the product trackers.
Fixing them is ordinary engineering work.
