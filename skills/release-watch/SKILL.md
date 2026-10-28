---
name: release-watch
description: Watch a merged change through deploy and early production life, and restore first when it hurts users. Use after a merge to a deploying branch, for "watch the release", or when a deploy or health check fails.
---

# Release watch

Watch one merge SHA through release verification. On harm, **restore first, diagnose second**, through the repository's own pipeline in every organization. No restore waits for a human.

## 1. Find the release path

Read the repository's AGENTS.md, README and release ADR. If the judge recorded `no deploy`, confirm the diff touches no deployed artifact path and stop without release queries or waiting; report `no deploy`. Otherwise take the matching path:

- **Library or tool:** check its release PR or tag. A failed check is a trigger; a pass is `released`. Go to Report.
- **Automated deploy:** find this SHA's run or deployment (`gh run list --commit <SHA>`, `gh api repos/<owner>/<repo>/deployments?sha=<SHA>`).
- **Installer:** resolve the default branch and run `git fetch origin && git worktree add --detach <tmp under ~/.cache/tmp> origin/<default>`. In that worktree, run `git merge-base --is-ancestor <merge-SHA> HEAD`, then the documented installer. Record `HEAD` as the source head, plus the destination. Remove the worktree after §2's identity readback. If any step fails, stop and report. Installing the default-branch head keeps later merges live.
- **No release path or readable health signal:** report `unwatched`. Search `gh issue list -R <owner>/<repo> --state open --label release-mechanism`; comment once on a match, otherwise create the label if missing and file one. Stop.

For misty-step/harness, README's Deploy destinations and selections map paths to installers:

- `pi-config/`, `omp-config/`, `claude-config/` → that component's `install`.
- `agent-config/` → each consumer selecting the changed primitive, per the component installer declarations; `./install` when all three are affected. The base installer alone deploys no consumer selection.
- Root changes → trace deployed consumers; documentation or verification changes may install nothing.

Install to the live destination; `./scripts/verify` is the isolated check.

## 2. Watch

1. **Deploy.** Follow the run to completion (`gh run watch <id>`). For installers, record command, source head, destination and exit status. Failure is a trigger.
2. **Identity.** Read the live version, SHA or tag: this merge or a later release containing it. For installers, compare copied artifacts with the source head (`cmp` for files, `diff -r` for skill directories); for composed guidance, read the changed section in the installed file. If no deployed bytes changed, report `no-op: no deployed artifact changed`.
3. **Smoke.** Walk the touched stories on the deployed surface with the repository's verification skill, read-only or with disposable QA data, including production sign-in with the agent's own AgentMail QA account and proof of the required owner/admin role when the product has sign-in. For installers, start a fresh native harness session at the destination and exercise the changed skill, guidance or extension. When you cannot, report `artifact verified` and name the missing smoke. An observed smoke failure is a trigger.
4. **Signals.** Watch the health checks, errors and alerts this change could move, for as long as its risk warrants. A low-risk change needs no waiting period; installers end at smoke.

Done when deploy, identity and smoke pass, or installer artifacts are verified with the smoke gap named.

## 3. Act on a trigger

A **trigger** is a failed deploy, failed smoke, newly failing health check or new error. When users are hurt, restore now; attribution comes after. Follow [recovery.md](recovery.md) for every trigger and for any failure found after the window.

## Report

Post in the current lane and through `home post --from <Lane>`, the same Markdown on stdin. Every report stands alone: link every PR, issue, incident and thread with a one-line summary, and write any question in full.

Start with the outcome:

- `released`: the release PR or tag containing the merge, and the passed release check.
- `live behavior proven`: deploy run, live identity, smoke and observed signals. For installers: command, source head, destination, exit status, readback and fresh-session smoke.
- `artifact verified`: the installer evidence, any no-op status, and the missing smoke with its owner.
- `restored`: trigger, recovery action and its verification, and the incident link if one exists.
- `escalated`: restore is unsafe; risk, live state, incident, recovery owner and recommended path.
- `unwatched`: what is missing, and the mechanism ticket.
