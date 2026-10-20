---
name: ship-loop
description: Drive a lane's confirmed work from ticket to verified production through builder, QA, reviewer and judge agents, then merge and watch the release. Use when a lane has scope to ship, for "run the loop", or for "ship this ticket".
---

# Ship loop

You are the lane's **conductor**. Dispatch distinct builder, QA, reviewer and product-owner judge agents to turn confirmed intent into verified production changes.

Start with build, then independent QA and review in parallel, then the judge. Fix until SHIP using the delta checks below. The tracker holds tickets, PRs and reports; keep no separate ledger.

Global autonomy pre-authorizes this loop in every organization: the independent judge's SHIP plus passing checks authorizes merge.

Many skills named here are user-invoked, so the Skill tool refuses them. For those, you and every agent you brief read `~/.claude/skills/<name>/SKILL.md` and follow it.

## 0. Use the repository's tools

Use its existing tracker and conventions. Add tracker guidance only when ambiguity blocks work. Prove the change with its verification skill or native harness; extract a reusable verification skill when it saves repeated work, including it in this change when that is the smallest coherent repair.

## 1. Settle intent

Settle every product and technical consideration before dispatching a builder. Agents decide technical choices. For unresolved product intent, interview the principal with `grilling` and `domain-modeling`, batching questions. Carry confirmed intent forward without another interview. Write settled stories in `SPEC.md` or the existing `USER_STORIES.md` with `user-stories`, then use `to-spec` and `to-tickets` to link them.

Once the principal confirms scope, publish tickets without asking. Proceed when stories are settled and tickets have acceptance criteria and blocking edges.

## 2. Run rounds on the frontier

The **frontier** is every open ticket whose blockers are closed or have an open PR. Start a round for each frontier ticket that touches different files from the others, in parallel. One writer per branch.

A ticket with one open blocker PR **stacks** on it: its branch starts from that PR's head, its PR targets that branch, its QA and review take that branch as `<base>`, and it skips the file test against that PR. Fix a blocker on the PR that owns it; landing bottom-first (step 3) carries the fix up. A ticket with two open blocker PRs waits for one to land.

Dispatch roles with `delegate_task` and completed [role briefs](roles.md). Select available providers/models from `orchestrator_capabilities`. Prefer model diversity, but use an available independent agent rather than wait for an ideal family. Carry the original goal, findings and resolutions into fix briefs; reuse working context where supported. When replacing a delegated child with a retry, `task_cancel` the old task first: usage-limited threads auto-resume and could act on superseded instructions.

1. **Build.** One builder, `isolation: "worktree"`, which starts from your local commit: first detach your checkout at the builder's start (`git switch --detach origin/<default branch>`, or the PR head it starts from). It returns a PR and its head SHA.
2. **Verify.** QA and review together, both pinned to that SHA.
3. **Judge.** An independent judge gets the ticket, PR and both revision-linked reports. Resolve missing proof before SHIP.
4. **Act on the verdict.**
   - **FIX:** the builder fixes code blockers; you clear lane blockers such as QA that could not run. Independently test and review the changed delta and its consequences, retaining evidence for unchanged behavior. The independent judge rules on the resulting SHA. Recheck the whole scope only when impact is broad or uncertain.
   - **RE-SLICE:** split with `to-tickets` when diagnosis shows the outcome is too large, then continue on the new frontier.
   - **SHIP:** merge (step 3).

Documents, briefs and measurements ([Foundations](https://foundations.mistystep.io/way-of-working)) and generator-only release PRs (`docs/principles/007-braver-engineers-continuous-deployment.md`) merge on passing checks alone. Operational prompts change behavior and use the loop. An internal change needs proof that it composes instead of a QA walk.

If the same blocker survives a fix, revisit its cause or the proposed solution.

Done for a ticket when the PR's current head SHA has a SHIP, ruled there or carried there by an unchanged patch-id (step 3), or, for a change that ships without a round, when its checks passed.

## 3. Merge

- Confirm the repository's fast affected checks passed at the judged SHA, in its CI or by running its documented check command.
- A verdict carries across a rebase alone only when the patch-id is unchanged: `git diff <old base>...<judged SHA> | git patch-id --stable` must equal `git diff origin/<default branch>...<new head> | git patch-id --stable`. `<old base>` is the SHA recorded for the PR below in a stack, otherwise `origin/<default branch>`. For any other head change, including conflict resolution, use the delta checks and independent judgment in step 2.
- Squash-merge, with the PR title as a Conventional Commit (`docs/release-convention.md` in misty-step/harness). Land a stack bottom-first:
  1. Before the bottom PR lands, record every PR's head SHA once, in a comment on the bottom PR.
  2. After each PR lands, run `git fetch --prune`, then move the next one from a detached HEAD, which works whichever worktree holds its lane-owned branch: `git switch --detach <its recorded head>`, `git rebase --onto origin/<default branch> <the SHA recorded for the PR below>`, `git push --force-with-lease=<branch>:<its recorded head> origin HEAD:refs/heads/<branch>`.
  3. If the push is refused, fetch and inspect the branch's delta. Apply the patch-id rule or step 2's delta checks, record the new judged head, and retry with a lease pinned to the fetched head. The PR above still rebases from the first head recorded.
  4. Retarget the PR to the default branch if GitHub hasn't, and run the fast affected checks at its new head before it merges.

## 4. Watch the release

Dispatch `release-watch` with the merge SHA and the ticket's stories. The merge closed the ticket (`Closes #<n>`); reopen it if the watch restores the release. Report `live behavior proven` only when the watch does, and `released` when a library or tool's release check passes. Its restore and incident paths run without you.

For a service with no automatic deploy, the watch reports `unwatched` and names the ticket for the missing mechanism; label it `release-mechanism` (`gh label create` once) so a fresh conductor finds it. While it is open, skip the watch and report each merge, the first included, as merged, not live. Check it at each Report; when it closes, dispatch one watch at the default branch's head with the stories of every ticket reported merged, not live.

## Report

When a ticket ships or the frontier needs a principal decision, post one short report in the lane and send it through `home post --from <Lane>` under global autonomy's delivery rule.

The report says what shipped, what is in flight (with the step each item is on), and every question for the principal, numbered. He reads it without opening anything:

- Give every PR, issue, ticket, story, spec, doc and thread a link and a one-line summary.
- Write each question out in full: its options, your recommendation, and what happens if he doesn't answer. Word it so "yes" accepts your recommendation.
- Never cite item numbers he hasn't seen, such as "Q3 yes" or "1-5", and never point at a file instead of writing out what it says.
