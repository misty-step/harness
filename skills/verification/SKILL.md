---
name: verification
description: "Prove changed behavior on its real consumer path, create a missing repo verification skill, or maintain its feature map and check cadence."
metadata:
  owner: phaedrus
  prevents: "'Fix still fails / regression' (36 corrections); evidence-packet loaded in 12 audited sessions; changed-path scope repaired in mistystack PR #455."
  source: "misty-step/mistystack@0ccc1a308cdeefa29e991d3b7c1dbab016cfea03/agent-config/{skills/story-qa,guidance/engineering.md}; cursor/plugins@c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/skills/{create-verification-skill,maintain-verification-skill}; installed Misty ~/.omp/agent/skills/evidence-packet (SKILL.md sha256:08fb52a436fbc663c59648b9b07b87a9c3d3f782c5fd7f55a5568be886f78923); misty-step/foundations@d96c99ce1152ab1d6ae4a0eed0b22cbac93897b7/way-of-working.md#prove"
  sunset: "2026-11-27"
---

# Verification

## 1. Name the proof

Tie each changed behavior to its story/request criterion, exact scenario and
outside check before editing. Choose the shortest real consumer path that can
reject the plausible defect. For fixes, comparisons, persistence and performance,
capture a baseline with the same fixture; show the check rejecting the relevant
base defect or an injected fault, then passing on the candidate.

- Product journey: drive the built artifact through the repo's verification skill
  and feature map, in production-like isolation then on the live surface within
  authorized scope. Cover success, rejection and recovery where the change reaches
  them. Read consequential state at its owner; sender success is not delivery.
- Documents: read changed rendered/published text and check affected links/commands.
- Installed guidance/configuration: install, load and read the changed result.
- CLI/library/internal change: exercise the real consumer or composition boundary.

Widen for shared config, lockfiles, auth, migrations or uncertain impact. Changed
interleavings need the model check, including a broken variant; reading the chart
is not execution. Required skipped or unavailable checks leave proof incomplete.

## 2. Drive and inspect

Use `.agents/skills/verify-<app>/`. If needed proof has no skill, [generate it](generate.md)
in this change or depend on the change adding it through the [forge procedure](../misty/entire.md). A documents-only change does not
inherit missing product infrastructure. Production sign-in uses the [QA account
contract](accounts.md), including proof of the required role.

Apply misty's delegation boundary. Use authorized disposable data and clean only
what the run created. Capture action and result, inspect each artifact, and publish proof
by [evidence.md](evidence.md). After a fix, recheck only the judge's named blockers
and fix-introduced regressions; link unchanged proof rather than rerun it.

Done when each criterion has an observed result at the named revision, linked
proof and owned cleanup, or an exact unproved claim and missing prerequisite.
Follow the core's claim rule.

## Commissioned upkeep

For a verification-skill/feature-map audit, use [maintenance.md](maintenance.md).
For check placement, deletion or schedule repair, use [check-cadence.md](check-cadence.md).
For recurring product QA, agents use distinct user personas to walk pre-release
and live SPEC stories and file bugs/friction as tickets through the [Entire forge procedure](../misty/entire.md). Such walks
prove behavior, not demand or benefit; compare actual use to the initiative's
outcome criterion before continuing, revising or stopping it.
