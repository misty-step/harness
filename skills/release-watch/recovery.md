# Recovery

## 1. Restore

Warn the owning lane of user impact and the recovery path immediately. Check
intervening releases, migrations and accepted data before changing live state.
Use the compatible option through the repository's existing pipeline:

- **Platform rollback/flag:** identify later merges it removes and why dropping
  them is safe. Also land a source revert/fix so the next deploy stays healthy.
- **Revert:** branch from current default HEAD, `git revert <SHA>` (`-m 1` for a
  merge), preserve unrelated later work, run affected checks and pass the repo's
  recovery gates. Use `revert: <original title>`.
- **Installer rollback:** install the merge's first parent rather than current
  default HEAD, omitting the forward-ancestry check. Assess lost later merges as
  for platform rollback, then land the source revert and reinstall default HEAD.

Compatible authorized recovery does not wait for an ordinary review round.
Accepted-data risk or an unsafe restore is `escalated`: preserve the live state,
name the recovery owner and recommended path, and keep the incident open. A
reviewer wait alone is not escalation. Repeat deploy, identity, smoke and relevant
signals against the recovery release before reporting `restored`.

If recovery removes the delivered behavior, reopen every affected ticket trail:
`entire trail update <ticket-trail-number> --project <forge>/<project>
--status open`. Read back `status=open` before reporting recovery complete.
Preserve intent, acceptance criteria and dependencies when adding the recovery
record through the [body-update procedure](../misty/entire.md#open-and-describe-a-change).
Do not leave recovered-away work closed in the backlog.

## 2. Attribute

Compare the trigger with the previous healthy release in isolation under equal
configuration/data. A trigger there too refutes this merge as its cause; diagnose
that cause rather than reverting an unrelated merge. For failures discovered
later, the finder owns last-healthy/first-failing identity, range comparison and
bisection when needed. Name the first failing SHA or the remaining range and
uncertainty. Restore for user harm precedes this attribution work.

## 3. Close the incident class

For harmed users or accepted data at risk, reuse/open a `bug` incident in the
ticket backlog defined by the [forge procedure](../misty/entire.md), with impact,
onset, evidence, suspect revision/range, recovery links, owner and live state.
The source fix returns as a scoped ticket. A harmless failed deploy or
precautionary restore records its result/lesson on the owning trail, without an
incident or postmortem.

After a material incident, use [postmortem-template.md](postmortem-template.md) in
the product's `docs/postmortems/` and link it from the incident. Name one change
that removes the error class: eliminate the dangerous affordance or correct the
ownership/type shape before adding warnings. Keep it within the original
outcome; closing a class does not authorize a framework. Link the fix and real
regression proof; state residual risk rather than promising an impossible cure.
Close the incident only after verified recovery and the linked postmortem.
