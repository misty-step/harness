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
- **Driver.** QA needs a scripted way to drive the real product: a `verify-<app>` skill, naming the product's QA account and mail inbox where it has them. With none in `.agents/skills/` or `.claude/skills/`, make one with `create-verification-skill`, at `.agents/skills/` everywhere that skill says `.cursor/skills/`. Link it at `.claude/skills/verify-<app>` so Claude Code finds it. It ships through this loop as its own ticket. Other rounds, new or in flight, run meanwhile; until it lands, their QA briefs describe the repository's own test harness.

Done when both exist on the default branch.

## 1. Settle intent

Work stays here until every product and technical consideration is decided. Interview the principal with `grilling` and `domain-modeling` (the `grill-with-docs` pair), asking every round's questions at once. Write the stories it settles into the repository's stories file (`SPEC.md`, or `USER_STORIES.md` where that exists) with the `user-stories` skill. Then `to-spec` and `to-tickets`, which link those stories.

The principal's confirmation of the spec is this loop's one product gate. After it, publish tickets without asking.

Done when the grilling frontier is empty, the stories are written, the principal confirmed the spec, and every ticket on the tracker has acceptance criteria and blocking edges.

## 2. Run rounds on the frontier

The **frontier** is every open ticket whose blockers are closed or have an open PR. A ticket with an open blocker PR **stacks**: its branch starts from that PR's head, and its PR targets that PR's branch. Start a round for each frontier ticket that touches different files from the others, in parallel; a stacked ticket skips that test against the PR it stacks on. One writer per branch.

Dispatch each role with `delegate_task`, using the briefs in [roles.md](roles.md) filled in completely. Every agent is fresh. Take providers from `orchestrator_capabilities` (large: filter it with `jq`) and headroom from `upkeep status`. Route QA and review to the first of these with headroom: a different model family on a different account from the builder; a different family on the same account; the same family, on a different model where one exists. A dispatch that fails at once on quota goes to the next route. Once every route has failed, wait for the earliest reset `upkeep status` shows, and put that time in your report.

1. **Build.** One builder, `isolation: "worktree"`. It returns a PR and its head SHA.
2. **Verify.** QA and review together, both pinned to that SHA.
3. **Judge.** One judge with the ticket, the PR and both reports.
4. **Act on the verdict.**
   - **FIX:** a fresh builder gets the original brief, the blockers and every report, then the round repeats at the new SHA. Blockers owned by the lane, such as QA that could not run, are yours to clear first.
   - **RE-SLICE:** split the ticket with `to-tickets` and start over on the new frontier.
   - **SHIP:** merge (step 3).

**Stacks.** Review and QA each stacked PR against its own base branch. Fix a blocker on the PR that owns it; landing bottom-first (step 3) carries it upward.

Scale the round to the change. Documents, briefs, measurements and generator-only release PRs ship without one ([Foundations](https://foundations.mistystep.io/way-of-working)): merge them once checks pass. A change with no user surface needs proof that it composes instead of a QA walk, posted as `QA report at <SHA>`.

Three rounds without SHIP means the slice or the spec is wrong. Re-slice it, and list it in your next report.

Done for a ticket when the PR's current head SHA has a SHIP, ruled there or carried there by an unchanged patch-id (step 3), or, for a change that ships without a round, when its checks passed.

## 3. Merge

- Confirm the repository's fast affected checks passed at the judged SHA, on our own machines: its CI where that runs, otherwise its documented check, run by you at that SHA. Paid GitHub Actions minutes are not a gate.
- If the head moved after the verdict, the verdict carries to the new head only when a rebase alone moved it and the patch-id is unchanged: `git diff <old base>...<judged SHA> | git patch-id --stable` must equal `git diff origin/<default branch>...<new head> | git patch-id --stable`. `<old base>` is the SHA recorded for the PR below in a stack, otherwise `origin/<default branch>`. Any other move, a conflict resolution included, gets a new round.
- **misty-step and moomooskycow:** squash-merge, with the PR title as a Conventional Commit (`docs/release-convention.md` in misty-step/harness). Land a stack bottom-first. Before the bottom PR lands, record every PR's head SHA once, in a comment on the bottom PR. After each PR lands, run `git fetch --prune`, then move the next one from a detached HEAD, which works whichever worktree holds its branch: `git switch --detach <its recorded head>`, `git rebase --onto origin/<default branch> <the SHA recorded for the PR below>`, `git push --force-with-lease=<branch>:<its recorded head> origin HEAD:refs/heads/<branch>`. It's the lane's own branch. A refused push means the branch moved after the record, which takes a new round. Retarget the PR to the default branch if GitHub hasn't, and run the fast affected checks at its new head before it merges.
- **r90group:** request team review, report the PR as merge-ready, and move on. A human merges.

## 4. Watch the release

Dispatch `release-watch` with the merge SHA and the ticket's stories. The merge closed the ticket (`Closes #<n>`); reopen it if the watch restores the release. Report `live behavior proven` only when the watch does. Its restore and incident paths run without you.

For a service with no automatic deploy, the watch reports `unwatched` and names the ticket for the missing mechanism. While that ticket is open, skip the watch and report each merge as merged, not live. When it closes, dispatch one watch at the default branch's head with the stories of every ticket closed since it opened.

## Report

When a ticket ships, or the frontier waits on the principal, post one short message in the lane: what shipped (with links), what is in flight (with the step each item is on), and every question for the principal, numbered, each with your recommendation.
