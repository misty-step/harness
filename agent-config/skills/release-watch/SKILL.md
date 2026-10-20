---
name: release-watch
description: Watch a merged change through deploy and early production life. Restore, open an incident and start a postmortem when it hurts users. Use after a merge to a deploying branch, when dispatched after a human merges, for "watch the release", or when a deploy or health check fails.
---

# Release watch

Watch one merge SHA through release verification. On harm, **restore first, diagnose second**, through the repository's own pipeline in every organization. No restore waits for a human reviewer.

Inputs: repository, merge SHA, PR and touched stories. The dispatched watcher owns verification, including after a human merges. If the originating lane is gone, work in the current lane and keep evidence and handoffs on the incident issue.

## 1. Find the release path

Read the repository's AGENTS.md, README and release ADR. A library or tool with no deploy goes straight to its conventional release PR or tag check; report `released` only after that check passes. A failed check is a trigger.

For automated deploys, find this SHA's run or deployment (`gh run list --commit <SHA>`, `gh api repos/<owner>/<repo>/deployments?sha=<SHA>`).

An installer is a release path. Fetch the default branch and run its documented installer from that branch's head, after `git merge-base --is-ancestor <merge-SHA> HEAD` succeeds. Record that head and destination. Deploy the default-branch head, never the merge SHA: later merges must stay installed. A previous good ref is reserved for explicit recovery.

For misty-step/harness, use README's Deploy destinations and selections:

- `pi-config/` → `pi-config/install`; `omp-config/` → `omp-config/install`; `claude-config/` → `claude-config/install`.
- `agent-config/` → each consumer selecting the changed primitive; read component installer declarations. Use `./install` when all three are affected. The base installer alone does not deploy consumer selections.
- Root changes → trace deployed consumers; documentation or verification changes may change no installed artifact.

Run against the intended live destination. For isolated verification, use `./scripts/verify`; an agent-directory variable alone does not isolate HOME or launcher writes.

For a service with no deploy path or readable health signal, report `unwatched`. Find open mechanism tickets with `gh issue list -R <owner>/<repo> --state open --label release-mechanism`; comment once on the matching ticket or file one with that label, then stop. Installer releases are exempt: use readback and smoke below.

Done when the release check passes, or the deploy destination, verification surface and recovery path are known, or `unwatched` is reported with its ticket.

## 2. Watch

1. **Deploy.** Follow the run to completion (`gh run watch <id>`). For installers, record command, source head, destination and exit status instead of a run URL. Failure is a trigger.
2. **Identity.** Read the live version, SHA or deployed tag: this merge or a later release containing it. For installers, compare copied artifacts with the recorded source head (`cmp` for files, `diff -r` for skill directories). For composed guidance, read the changed section in the installed file, checking surrounding context and retired wording too; no single source file matches the whole composition. If no deployed bytes changed, report `no-op: no deployed artifact changed`; matching readback proves contents, not a newly loaded SHA.
3. **Smoke.** Walk touched stories on the deployed surface with the repo's verification skill, read-only or with disposable QA data. For installers, start a fresh native harness session at the recorded destination, confirm it loads the changed skill, guidance or extension, and exercise that behavior. Record session and observed result. If activation cannot be exercised, report `artifact verified` with the missing smoke; live behavior remains unverified. An observed smoke failure is a trigger.
4. **Signals.** For services, watch every available health endpoint, error tracker, log and alert for 30 minutes after deploy; compare with the preceding hour. For installers, readback and fresh-session smoke are the window; report timestamps and activation status.

Done when deploy and readback pass and either smoke plus signals prove live behavior, or installer artifacts are verified with the activation gap stated; otherwise act on the trigger.

## 3. Act on a trigger

A **trigger** is a failed deploy, touched-story smoke, newly failing health check or new error. Restore immediately when user harm is clear; attribution must not delay recovery.

For every trigger, restore, incident, unsafe recovery or after-window discovery, read and follow [recovery.md](recovery.md) for attribution, compatible recovery, incident ownership and postmortem closure.

## Report

Post every status or handoff in the current lane **and** through `home post --from <Lane>`, passing the same Markdown body on stdin. This appends `## <UTC> [<Lane>]` and the body to `~/.local/state/home/inbox.md`. Home's thread is written only by phaedrus; never use `t3_thread_send` to it. Link the report from the incident when one exists. Immediate restore warnings and incident/escalation updates use this route too.

Every report stands alone: link every referenced PR, issue, incident and thread with a one-line summary. Write each question in full, including its options, recommendation and what happens if phaedrus does not answer.

Start with the applicable outcome:

- `released`: library/tool release PR or tag, identity containing the merge and passed release-check evidence.
- `live behavior proven`: deploy run, live identity, smoke evidence and observed window. For installers substitute command, source head, destination, exit status, readback and fresh-session evidence with timestamps.
- `artifact verified`: installer command, source head, destination, exit status, readback, applicable no-op status, missing activation/smoke evidence and follow-up owner.
- `restored`: trigger evidence, recovery action and verification, incident link and postmortem status; state any remaining activation gap.
- `escalated`: restore is unsafe; explain risk, current live state, incident, recovery owner and recommended path. Continue incident/postmortem work.
- `unwatched`: missing deploy path or service health signal and mechanism ticket.
