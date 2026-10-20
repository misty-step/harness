# Recovery

## Restore

Immediately report impact and proposed recovery using SKILL.md's Report contract: current lane and Home inbox. Inventory intervening releases, migrations and accepted data before choosing a compatible path:

- Use a documented platform rollback or feature flag through the repo's own pipeline when compatible. A rollback drops later merges: list those changes and verify their loss is safe; otherwise use a targeted revert or fix forward.
- Otherwise open `revert: <original title>` against the current default-branch head. Use `git revert <SHA>` (for a merge commit, select its mainline parent from history). Resolve conflicts against the current tree, preserve unrelated later changes and run repository checks; resolve conflicts in a recovery patch rather than forcing the revert. Merge through the repository's pipeline after automated gates pass, without waiting for a human reviewer.
- For installer rollback, re-run the affected installer from a recorded previous good ref, then read back and smoke it. Account for later changes it removes as for platform rollback.

In every organization, carry safe recovery through to verification without a team-review gate. If recovery risks accepted data or is otherwise unsafe, stop that mutation and report `escalated` with facts, recovery owner and recommended path. A reviewer wait is never an `escalated` state.

After any restore, repeat SKILL.md §2 against the chosen recovery release/ref: its identity replaces the original merge. Verify recovery before reporting `restored`; record any remaining activation gap.

## Attribute without delaying restoration

Reproduce the trigger against the previous healthy release under the same configuration and data conditions in isolation. A failure there too is an incident, without attributing it to this merge or reverting it on that evidence. When harm is clear, restore first and diagnose second.

After the window, whoever discovers the failure becomes the watcher; the original lane need not survive. Find the last healthy and first failing deployed identities from release history and incident timestamps. Diff that range, reproduce both ends with a repeatable check in isolation, and bisect candidate commits when attribution remains ambiguous. Record the check and first failing SHA; if unknown, record the range and uncertainty.

## Incident and postmortem

Search open incidents for the same cause; reuse one, otherwise open a `bug` issue. Record impact, affected users, onset, evidence, suspect SHA/range, restore links and owner, and current live state. Report the incident through the lane and Home inbox. Continue even when recovery is `escalated`. The fix re-enters the current lane as a ticket, diagnosed with `diagnosing-bugs` (read `~/.claude/skills/diagnosing-bugs/SKILL.md`).

When users were hurt, a restore ran or data was at risk, write a postmortem with `pokayoke` (read `~/.claude/skills/pokayoke/SKILL.md`) in the product's `docs/postmortems/` within 24 hours of discovery, including during unsafe recovery. Link the fix and how the failure class is closed. Put a standalone `postmortem due YYYY-MM-DDTHH:MM:SSZ` line in the incident body (UTC deadline), plus an owner. On completion, replace it with `postmortem: <link>`; close the incident only after recovery is verified and the required postmortem is linked. Report updates using SKILL.md's Report contract, including summarized links and complete questions.
