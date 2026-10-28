# Recovery

## Restore

Report impact and the proposed recovery (SKILL.md's Report). Check intervening releases, migrations and accepted data, then take a compatible path through the repository's own pipeline:

- **Platform rollback or feature flag.** List the later merges a rollback drops and confirm losing them is safe. Also land a revert or fix on the default branch, or the next deploy ships the bad merge again.
- **Revert.** Open `revert: <original title>` against the default-branch head with `git revert <SHA>` (`-m 1` for a merge commit). Resolve conflicts against the current tree, keep unrelated later changes, run checks, and merge once automated gates pass.
- **Installer rollback.** Run SKILL.md §1's installer path from the merge's first parent (`<merge-SHA>^1`) instead of `origin/<default>`, skipping the ancestry check; it drops later merges as a platform rollback does. Then land a revert and reinstall from the default branch.

No restore waits for a reviewer, in any organization. If recovery would risk accepted data or is otherwise unsafe, hold that mutation and report `escalated`. A reviewer wait is never `escalated`.

Then repeat SKILL.md §2 against the recovery release; its identity replaces the merge's. Report `restored` only once it verifies.

## Attribute

Reproduce the trigger against the previous healthy release in isolation, under the same configuration and data. If it fails there too, this merge is not the cause: diagnose it without reverting.

After the window, whoever finds the failure owns it. Find the last healthy and first failing deployed identities, diff that range, reproduce both ends, and bisect when attribution is ambiguous. Record the first failing SHA, or the range and the uncertainty.

## Incident

When users were hurt or accepted data is at risk, reuse an open incident with the same cause or open a `bug` issue. Record impact, onset, evidence, suspect SHA or range, restore links, owner and live state, and keep it open through an `escalated` recovery. The fix re-enters the lane as a ticket, diagnosed with `diagnosing-bugs`.

After such a material incident, write a short postmortem with `pokayoke` in the product's `docs/postmortems/`: impact, cause, recovery and prevention, linked from the incident. Close the incident once recovery is verified and the postmortem linked.

A harmless failed deploy or precautionary restore gets neither: record the result and lesson on its PR or ticket.
