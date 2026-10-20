---
name: release-watch
description: Watch a merged change through deploy and early production life. Restore, open an incident and start a postmortem when it hurts users. Use after a merge to a deploying branch, when dispatched after a human merges, for "watch the release", or when a deploy or health check fails.
---

# Release watch

Watch one merge SHA through release verification. On harm, **restore first, diagnose second**. Restoring returns users to the last verified state; the r90group team-review gate below applies to every restore path.

Inputs: repository, merge SHA, PR and touched stories. The dispatched watcher owns verification, including after a human merges. If the originating lane is gone, work in the current lane and keep evidence and handoffs on the incident issue.

## 1. Find the release path

Read the repository's AGENTS.md, README and release ADR. For automated deploys, find this SHA's run or deployment (`gh run list --commit <SHA>`, `gh api repos/<owner>/<repo>/deployments?sha=<SHA>`).

An installer is a release path. Fetch the default branch and run its documented installer from that branch's head, after `git merge-base --is-ancestor <merge-SHA> HEAD` succeeds. Record that head and the destination. Select the default-branch head rather than pinning the merge SHA: later merges must stay installed. A previous good ref is reserved for explicit recovery in step 3.

For misty-step/harness, use README's Deploy destinations and selections:

- `pi-config/` → `pi-config/install`; `omp-config/` → `omp-config/install`; `claude-config/` → `claude-config/install`.
- `agent-config/` → each consumer selecting the changed primitive; read the component installers' declarations. Use `./install` when all three are affected. The base installer alone does not deploy consumer selections.
- Root changes → trace their deployed consumers; documentation or verification changes may change no installed artifact.

Run against the intended live destination. For verification in isolation, use `./scripts/verify`; changing only an agent-directory variable does not isolate HOME or launcher writes.

For a service with no deploy path or no readable health signal, report `unwatched`, file a missing-mechanism ticket (or comment once on the existing one), then stop. Installer releases are exempt: use their readback and smoke below. A library or tool with no deploy needs its conventional release PR or tag check.

Done when the deploy destination, verification surface and recovery path are known.

## 2. Watch

1. **Deploy.** Follow the run to completion (`gh run watch <id>`). For an installer, record the command, source head, destination and exit status instead of a deploy-run URL. Failure is a trigger.
2. **Identity.** Read the live version, SHA or deployed tag: this merge or a later release containing it. For installers, compare copied artifacts with the recorded source head (`cmp` for a file, `diff -r` for a skill directory). For composed guidance, read the changed section in the installed file: e.g. `grep -nF -- '<changed sentence>' ~/.claude/CLAUDE.md`, checking its surrounding section and retired wording too. A single source file cannot be compared with the whole composition. If no deployed bytes changed, report `no-op: no deployed artifact changed`; a matching readback proves artifact contents, not a newly loaded SHA.
3. **Smoke.** Walk the touched stories on the deployed surface with the repo's verification skill, read-only or using disposable QA data. For installers, start a fresh native harness session at the recorded destination, confirm it loads the changed skill, guidance or extension, and exercise the changed behavior. Record the session and observed result. If runtime activation cannot be exercised, report `artifact verified` with the missing smoke and leave live behavior unverified. An observed smoke failure is a trigger, not an artifact-only success.
4. **Signals.** For services, watch every available health endpoint, error tracker, log and alert for 30 minutes after deploy; compare with the preceding hour. For installers, readback and the fresh-session smoke are the window; report their timestamps and whether activation was verified.

Done when the deploy and readback pass and either smoke plus signals prove live behavior, or installer artifacts are verified with the activation gap stated; otherwise act on the trigger.

## 3. Act on a trigger

A **trigger** is a failed deploy, touched-story smoke, newly failing health check or new error. Reproduce against the previous healthy release under the same configuration and data conditions in isolation. A failure there too is an incident, without attributing it to this merge or reverting it on that evidence. Restore immediately when harm is clear; attribution must not delay recovery.

After the window, whoever discovers the failure becomes the watcher; the original lane need not survive. Find the last healthy and first failing deployed identities from release history and incident timestamps. Diff that range, reproduce both ends with a repeatable check in isolation, and bisect candidate commits when attribution remains ambiguous. Record the check and first failing SHA; if unknown, record the range and uncertainty rather than inventing a culprit.

1. **Restore.** Warn immediately in the current lane (or incident): impact and proposed recovery. Inventory intervening releases, migrations and accepted data before choosing a compatible path:
   - Use a documented platform rollback or feature flag when compatible. A rollback to an old release also drops later merges: list those changes and verify their loss is safe, otherwise use a targeted revert or fix forward.
   - Otherwise open `revert: <original title>` against the current default-branch head. Use `git revert <SHA>` (for a merge commit, select its mainline parent from history). Resolve conflicts against the current tree, preserve unrelated later changes and run the repository's checks; an unresolved conflict needs a reviewed recovery patch, not a forced revert. Merge after the repository's gate passes.
   - For an installer rollback, re-run the affected installer from a recorded previous good ref, then read back and smoke it. Account for later changes it removes as for a platform rollback.

   In **r90group, every restore** (revert merge, platform rollback, flag toggle or installer rollback) waits for team review. Open the recovery PR or incident proposal, request the affected component's CODEOWNERS through `gh pr edit <PR> --add-reviewer <reviewer-or-team>` or the repository's incident channel, and mark the request urgent with impact and recovery evidence. If no owner is declared, request the original PR's team reviewer; if unavailable, escalate to the repository maintainer. Record the requested reviewer and a named recovery watcher in the incident. A human merges or authorizes the action; the recovery watcher verifies its deploy when dispatched after that merge or approval. Report `escalated` while waiting and continue steps 2–3.

   When recovery risks accepted data, stop the mutation and escalate with facts and a recommended path. After any restore, repeat §2 against the chosen recovery release/ref (its identity replaces the original merge), and verify recovery before reporting `restored`; record any remaining activation gap.
2. **Incident.** Search open incidents for the same cause; reuse one, otherwise open a `bug` issue. Record impact, affected users, onset, evidence, suspect SHA/range, restore links and owner, and current live state. Continue this even when recovery is `escalated`. The fix re-enters the current lane as a ticket, diagnosed with `diagnosing-bugs` (read `~/.claude/skills/diagnosing-bugs/SKILL.md`).
3. **Postmortem.** When users were hurt, a restore ran or data was at risk, write one with `pokayoke` (read `~/.claude/skills/pokayoke/SKILL.md`) in the product's `docs/postmortems/` within 24 hours of discovery, including while recovery awaits review. Link the fix and how the failure class is closed. Put a standalone `postmortem due YYYY-MM-DDTHH:MM:SSZ` line in the incident body (UTC deadline), plus an owner. On completion, replace it with `postmortem: <link>`; close the incident only after recovery is verified and the required postmortem is linked.

## Report

One message to the current lane, linked from the incident when one exists, starting with the applicable outcome:

- `live behavior proven`: deploy run, live identity, smoke evidence and observed window. For installers substitute command, source head, destination, exit status, readback and fresh-session evidence with timestamps.
- `artifact verified`: installer command, source head, destination, exit status and readback; no-op status if applicable; missing activation/smoke evidence and follow-up owner. Live behavior remains unverified.
- `restored`: trigger evidence, recovery action and verification, incident link and postmortem status.
- `escalated`: unsafe recovery or pending team review, current live state, incident link, reviewer, recovery watcher and recommendation; incident and postmortem work continues.
- `unwatched`: missing deploy path or service health signal and the mechanism ticket.
