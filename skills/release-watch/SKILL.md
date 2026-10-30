---
name: release-watch
description: "Watch a merged change through release and early live behavior; recover a failed deploy, smoke or health check."
metadata:
  owner: phaedrus
  prevents: "Merged mistaken for live; incomplete installer/recovery paths repaired in mistystack PR #372; excessive postmortem/watch ceremony cut in #392."
  source: "misty-step/mistystack@0ccc1a308cdeefa29e991d3b7c1dbab016cfea03/agent-config/skills/{release-watch,pokayoke}; misty-step/foundations@d96c99ce1152ab1d6ae4a0eed0b22cbac93897b7/way-of-working.md#operate"
  sunset: "2026-11-27"
---

# Release watch

Watch one merge SHA through the repo's release path. For user harm, restore first
and attribute second. Compatible recovery follows existing authorization and the
repo's own pipeline; accepted-data risk stops that mutation and is escalated.
Use the [Entire forge procedure](../misty/entire.md) for work records and its
GitHub Actions and release-tooling exceptions.

## 1. Find the path

Read AGENTS.md, README and the release decision. A recorded `no deploy` plus a
diff touching no deployed artifact ends here without queries or waiting.

- **Library/tool:** find the release/tag containing the merge; a Landmark-backed
  repository may use its generator-only release PR. Passed release checks mean
  `released`; a failed check is a recovery trigger.
- **Automated deploy:** follow the run/deployment for this SHA to completion.
- **Installer/plugin:** use a disposable detached worktree at freshly fetched
  default-branch HEAD; prove the merge is its ancestor. Run the documented install
  or update against the authorized destination, recording command, source head,
  destination and exit status. Stop and report a failed step.
- **Missing mechanism/signal:** report `unwatched`. Reuse one open
  `release-mechanism` ticket, or create an intent-only trail for it; no implied live claim.

## 2. Observe

1. **Deploy:** successful run or installer/update exit status.
2. **Identity:** live version/SHA/tag contains the merge. For installers, compare
   deployed artifacts with source; for composed instructions, read the changed
   installed section. Unchanged deployed bytes are `no-op`, not a new release.
3. **Smoke:** drive touched stories with the `verification` skill. Installed
   skills/rules/extensions need a fresh session in the active harness at the destination
   exercising the change. Artifact readback without that smoke is `artifact verified`, with
   the exact missing proof named.
4. **Signals:** observe only health/error signals this change can move, for a
   risk-proportionate window. Low-risk changes need no arbitrary wait; installers
   finish at smoke. Remove the disposable source worktree after identity readback.

A failed deploy, smoke, newly failing health check or new error is a trigger.
[recovery.md](recovery.md) owns restore, attribution and incident closure, including
failures discovered after the watch window. A material incident's postmortem
names one change that removes the error class, not another reminder.

## Report

Record the result once on the owning trail with merge and checked live identity,
evidence, consumer impact and exact gaps under the core's claim rule. Follow
misty's report-link duty and link that record from the owning lane.

| Outcome | Required observation |
| --- | --- |
| `no deploy` | No deployed artifact changed |
| `released` | Containing release/tag and passed release check |
| `live behavior proven` | Deploy, identity, smoke and relevant signals |
| `artifact verified` | Installer readback, no-op status if any, missing smoke and owner |
| `restored` | Trigger, compatible recovery and verified recovered behavior |
| `escalated` | Unsafe recovery, current live state, incident, owner and recommendation |
| `unwatched` | Missing mechanism/signal and its ticket |
