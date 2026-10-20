---
name: release-watch
description: Watch a merged change through deploy and early production life. Revert it, open an incident and start a postmortem when it hurts users. Use after a merge to a deploying branch, for "watch the release", or when a deploy or health check fails.
---

# Release watch

A merge is done only when the release is healthy for the people using it. You watch one merge SHA from deploy to a quiet window, and you act on the first sign of harm: **restore first, diagnose second**. Restoring returns users to the last verified state, so it is pre-authorized like any merge. Diagnosis happens on a calm system.

Inputs: the repository, the merge SHA, the PR, and the stories the change touched.

## 1. Find the release path

Read the repository's AGENTS.md or README, and its ADR if it has one, for how a merge reaches users. Then find this SHA's run or deployment (`gh run list --commit <SHA>`, `gh api repos/<owner>/<repo>/deployments?sha=<SHA>`).

With no automatic deploy, or no health signal to read, say so in the report. File a ticket for the missing mechanism (continuous deployment with automatic rollback is the foundation; see ADR-007 in misty-step/harness), or comment once on the one already open, then stop. A library or tool with no deploy needs only a release check: the release PR or tag the convention produces.

Done when you know where this SHA runs, how to tell whether it's healthy, and how to roll it back.

## 2. Watch

1. **Deploy.** Follow the run to completion (`gh run watch <id>`). A failed deploy is a trigger.
2. **Identity.** Read back what the live surface reports it runs: a version or SHA endpoint, a release header, the deployed tag. It must be this SHA or a later release that contains it.
3. **Smoke.** Walk the touched stories on the deployed surface with the repo's `verify-<app>` skill, read-only or with the QA account and disposable data. Never write real production data.
4. **Signals.** For 30 minutes after the deploy finishes, read every health signal the repo has: health endpoints, error tracking, logs, alerts. Compare each one with the hour before the deploy.

Done when the deploy succeeded, the live identity matched, the smoke passed and the window stayed quiet, or a trigger fired.

## 3. Act on a trigger

A **trigger** is a failed deploy, a failed smoke on a touched story, a health check that starts failing, or an error that is new since the deploy. Something that also fails at the previous SHA isn't this change's trigger. Open an incident for it without reverting.

1. **Restore.** Post one line in the lane right away: what broke and that you are restoring. Then use the fastest compatible path: the platform's rollback to the previous healthy release, or a feature flag that turns the change off, if the repository documents either. Otherwise open `revert: <original title>` from `git revert <merge SHA>`, merge it once the repository's gate passes, and watch that deploy the same way. Stop and escalate instead when restoring would put accepted data at risk, as with a migration or data write a revert can't undo. Give the principal the facts and your recommended path.
2. **Incident.** Open a `bug` issue: what broke, for whom, since when, the evidence, the merge and restore links. The fix re-enters the lane's loop as a ticket, diagnosed with `diagnosing-bugs` (read `~/.claude/skills/diagnosing-bugs/SKILL.md`).
3. **Postmortem.** When users were hurt, a restore ran, or data was at risk, write one with `pokayoke` (read `~/.claude/skills/pokayoke/SKILL.md`) in the product's `docs/postmortems/` within a day. Link the fix, and say how the class of failure is now closed.

## Report

One message to the lane, starting with one word:

- `live behavior proven`: the deploy run, the live identity, the smoke evidence and the window you watched.
- `restored`: the trigger and its evidence, how you restored and its link, the incident link, and whether a postmortem is due.
- `escalated`: why restoring was unsafe, what is live now, and your recommendation.
- `unwatched`: what's missing (deploy path, health signal) and the ticket you filed or commented on.
