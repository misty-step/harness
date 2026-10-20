---
name: ship-loop
description: Drive a lane's confirmed work from ticket to verified production through builder, QA, reviewer and judge agents, then merge and watch the release. Use when a lane has scope to ship, for "run the loop", or for "ship this ticket".
---

# Ship loop

You are the lane's **conductor**. You turn confirmed intent into shipped, verified changes by dispatching independent agents and acting on their verdicts. You write briefs and make calls; agents write the code, the proof and the rulings.

One **round** is: build, then QA and review in parallel, then the judge. Rounds repeat until the judge rules SHIP. The tracker holds the state: tickets, PRs and verdict comments. Keep no ledger of your own.

The standing autonomy policy in global guidance governs every step. Everything here is pre-authorized under it, so act and then report.

Many skills named here are user-invoked, so the Skill tool refuses them. For those, you and every agent you brief read `~/.claude/skills/<name>/SKILL.md` and follow it.

## 0. Ready the repository, once

- **Tracker.** Without `docs/agents/issue-tracker.md`, run `setup-matt-pocock-skills` and take its recommended answers. They are process, not product intent.
- **Driver.** QA needs a scripted way to drive the real product: a `verify-<app>` skill. With none in `.agents/skills/` or `.claude/skills/`, make one with `create-verification-skill` before the first QA round. Write it to `.agents/skills/verify-<app>/`, and link it at `.claude/skills/verify-<app>` so Claude Code finds it. It ships through this loop as its own ticket.

Done when both exist on the default branch.

## 1. Settle intent

Work stays here until every product and technical consideration is decided. Interview the principal with `grilling` and `domain-modeling` (the `grill-with-docs` pair), asking every round's questions at once. Write the stories it settles into the repository's stories file (`SPEC.md`, or `USER_STORIES.md` where that exists) with the `user-stories` skill. Then `to-spec` and `to-tickets`, which link those stories.

The principal's confirmation of the spec is this loop's one product gate. After it, publish tickets without asking.

Done when the grilling frontier is empty, the stories are written, the principal confirmed the spec, and every ticket on the tracker has acceptance criteria and blocking edges.

## 2. Run rounds on the frontier

The **frontier** is every open ticket whose blockers are closed. Start a round for each frontier ticket that touches different files from the others, in parallel. One writer per branch.

Dispatch each role with `delegate_task`, using the briefs in [roles.md](roles.md) filled in completely. Every agent is fresh. Pick models and accounts by headroom (`upkeep dispatch`). Put QA and review on a different model family from the builder where one has headroom, and on a different account always.

1. **Build.** One builder, `isolation: "worktree"`. It returns a PR and its head SHA.
2. **Verify.** QA and review together, both pinned to that SHA.
3. **Judge.** One judge with the ticket, the PR and both reports.
4. **Act on the verdict.**
   - **FIX:** a fresh builder gets the original brief, the blockers and every report, then the round repeats at the new SHA. Blockers owned by the lane, such as QA that could not run, are yours to clear first.
   - **RE-SLICE:** split the ticket with `to-tickets` and start over on the new frontier.
   - **SHIP:** merge (step 3).

Scale the round to the change. Documents, briefs and measurements ship without one ([Foundations](https://foundations.mistystep.io/way-of-working)). A change with no user surface needs proof that it composes instead of a QA walk; the judge rules on that and the review.

Three rounds without SHIP means the slice or the spec is wrong. Re-slice it, and list it in your next report.

Done for a ticket when the judge ruled SHIP at the PR's current head SHA.

## 3. Merge

- Confirm the repository's fast affected checks passed at the judged SHA, on our own machines: its CI where that runs, otherwise its documented check, run by you at that SHA. Paid GitHub Actions minutes are not a gate.
- If the head moved after the verdict, the verdict is void unless only a rebase moved it and `git patch-id` is unchanged.
- **misty-step and moomooskycow:** squash-merge with the PR title as a Conventional Commit (`docs/release-convention.md` in misty-step/harness).
- **r90group:** request team review, report the PR as merge-ready, and move on. A human merges.

## 4. Watch the release

Dispatch `release-watch` with the merge SHA and the ticket's stories. Close the ticket when it reports `live behavior proven`. Its restore and incident paths run without you.

## Report

When a ticket ships, or the frontier waits on the principal, post one short message in the lane: what shipped (with links), what is in flight (with the step each item is on), and every question for the principal, numbered, each with your recommendation. The next lage picks this up.

While a question waits on the principal, keep working any frontier ticket it doesn't block. End a turn only when no unblocked work is left.
