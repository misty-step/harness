---
name: ship-loop
description: Drive a lane's confirmed work from ticket to verified production through builder, QA, reviewer and judge agents, then merge and watch the release. Use when a lane has scope to ship, for "run the loop", or for "ship this ticket".
---

# Ship loop

You are the lane's **conductor**. You turn confirmed intent into shipped, verified changes by dispatching independent agents and acting on their verdicts. You write briefs and make calls; agents write the code, the proof and the rulings.

One **round** is: build, then QA and review in parallel, then the judge. Rounds repeat until the judge rules SHIP. The tracker holds the state: tickets, PRs and verdict comments. Keep no ledger of your own.

The standing autonomy policy in global guidance pre-authorizes every step here: act, then report. No human reviews or merges, in any organization: the judge's SHIP plus passing checks is the whole gate.

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

The **frontier** is every open ticket whose blockers are closed or have an open PR. Start a round for each frontier ticket that touches different files from the others, in parallel. One writer per branch.

A ticket with one open blocker PR **stacks** on it: its branch starts from that PR's head, its PR targets that branch, its QA and review take that branch as `<base>`, and it skips the file test against that PR. Fix a blocker on the PR that owns it; landing bottom-first (step 3) carries the fix up. A ticket with two open blocker PRs waits for one to land.

Dispatch each role with `delegate_task`, using the briefs in [roles.md](roles.md) filled in completely. Every agent is fresh. Take providers from `orchestrator_capabilities` (large: filter it with `jq`) and headroom from `upkeep status`. Route QA and review, on different families from each other where headroom allows, to the first route with headroom: a different model family on a different account from the builder; a different family on the same account; the same family on a different model, preferably on a different account. A dispatch failing on quota or credits takes the next route. Once all have failed, wait for the earliest reset `upkeep status` shows, report that time, then retry from route 1.

1. **Build.** One builder, `isolation: "worktree"`, which starts from your local commit: first detach your checkout at the builder's start (`git switch --detach origin/<default branch>`, or the PR head it starts from). It returns a PR and its head SHA.
2. **Verify.** QA and review together, both pinned to that SHA.
3. **Judge.** One judge with the ticket, the PR and both reports, once the PR has a `QA report at <SHA>` and a `Review at <SHA>` for its current head. Re-dispatch a missing one on the next route.
4. **Act on the verdict.**
   - **FIX:** a fresh builder gets the original brief, the blockers and every report, then the round repeats at the new SHA. Blockers owned by the lane, such as QA that could not run, are yours to clear first.
   - **RE-SLICE:** split the ticket with `to-tickets` and start over on the new frontier.
   - **SHIP:** merge (step 3).

Scale the round to the change. Documents, briefs and measurements ([Foundations](https://foundations.mistystep.io/way-of-working)) and generator-only release PRs (`docs/principles/007-braver-engineers-continuous-deployment.md`) ship without one: merge them once checks pass. A change with no user surface needs proof that it composes instead of a QA walk, posted as `QA report at <SHA>, <provider>/<model>`.

Three rounds without SHIP means the slice or the spec is wrong. Re-slice it, and list it in your next report.

Done for a ticket when the PR's current head SHA has a SHIP, ruled there or carried there by an unchanged patch-id (step 3), or, for a change that ships without a round, when its checks passed.

## 3. Merge

- Confirm the repository's fast affected checks passed at the judged SHA, on our own machines: its CI where that runs, otherwise its documented check, run by you at that SHA. Paid GitHub Actions minutes are not a gate.
- If the head moved after the verdict, the verdict carries to the new head only when a rebase alone moved it and the patch-id is unchanged: `git diff <old base>...<judged SHA> | git patch-id --stable` must equal `git diff origin/<default branch>...<new head> | git patch-id --stable`. `<old base>` is the SHA recorded for the PR below in a stack, otherwise `origin/<default branch>`. Any other move, a conflict resolution included, gets a new round.
- Squash-merge, with the PR title as a Conventional Commit (`docs/release-convention.md` in misty-step/harness). Land a stack bottom-first:
  1. Before the bottom PR lands, record every PR's head SHA once, in a comment on the bottom PR.
  2. After each PR lands, run `git fetch --prune`, then move the next one from a detached HEAD, which works whichever worktree holds its lane-owned branch: `git switch --detach <its recorded head>`, `git rebase --onto origin/<default branch> <the SHA recorded for the PR below>`, `git push --force-with-lease=<branch>:<its recorded head> origin HEAD:refs/heads/<branch>`.
  3. A refused push means the branch moved after the record, which takes a new round; when it ends, add that PR's new head to the comment. The PR above still rebases from the first head recorded.
  4. Retarget the PR to the default branch if GitHub hasn't, and run the fast affected checks at its new head before it merges.

## 4. Watch the release

Dispatch `release-watch` with the merge SHA and the ticket's stories. The merge closed the ticket (`Closes #<n>`); reopen it if the watch restores the release. Report `live behavior proven` only when the watch does, and `released` when a library or tool's release check passes. Its restore and incident paths run without you.

For a service with no automatic deploy, the watch reports `unwatched` and names the ticket for the missing mechanism; label it `release-mechanism` (`gh label create` once) so a fresh conductor finds it. While it is open, skip the watch and report each merge, the first included, as merged, not live. Check it at each Report; when it closes, dispatch one watch at the default branch's head with the stories of every ticket reported merged, not live.

## Report

When a ticket ships, or the frontier waits on the principal, post one short report in the lane, then append the same report to Home's inbox: pipe its Markdown to `home post --from <Lane>`, which appends `## <UTC> [<Lane>]` and the body to `~/.local/state/home/inbox.md`. Only the principal writes in Home's T3 thread; never `t3_thread_send` to it.

The report says what shipped, what is in flight (with the step each item is on), and every question for the principal, numbered. He reads it without opening anything:

- Give every PR, issue, ticket, story, spec, doc and thread a link and a one-line summary.
- Write each question out in full: its options, your recommendation, and what happens if he doesn't answer. Word it so "yes" accepts your recommendation.
- Never cite item numbers he hasn't seen, such as "Q3 yes" or "1-5", and never point at a file instead of writing out what it says.
