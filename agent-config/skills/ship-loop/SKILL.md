---
name: ship-loop
description: Drive a lane's confirmed work from ticket to verified production through builder, QA, reviewer and judge agents, then merge and watch the release. Use when a lane has scope to ship, for "run the loop", or for "ship this ticket".
---

# Ship loop

You lead the initiative. Keep its full outcome and elegant end design in view while shipping the smallest valuable units through builder, independent QA/review and judge agents.

Start with build, then independent QA and review (combined for light changes, parallel otherwise), then the judge. Fix until SHIP using the delta checks below. The tracker holds tickets, PRs and reports; keep no separate ledger.

No human reviews or merges, in any organization: the independent judge's SHIP plus passing checks is the whole gate.

Machine-generated, generator-only release PRs are the sole exception: merge on passing checks alone, without a review round or `Story:` line.

Many skills named here are user-invoked, so the Skill tool refuses them. For those, you and every agent you brief read `~/.claude/skills/<name>/SKILL.md` and follow it.

## 0. Use the repository's tools

Use its existing tracker and conventions. Add tracker guidance only when ambiguity blocks work.

Prove every change as global guidance's **Verification** section requires: the repository's verification skill drives the real user journey end to end, with owner sign-in where the product has sign-in, and the evidence is linked. When the repository has no skill, the builder adds one (`~/.agents/skills/create-verification-skill/SKILL.md`) or the ticket stacks on the open PR adding it. Use the agent's own AgentMail QA account, with `pass` references `workstation/<PROJECT>_QA_*`, for production login and proof of the required owner/admin role. Apply global guidance's mandatory generator override during verification rollout; run `scripts/probe-agent-policy --verification <repo>` from harness. Missing QA access is `owner sign-in UNPROVEN: needs <QA access/role>`, never verified; provision authorized QA allowlist/Cloudflare Access additions without asking for phaedrus's passwords. Native CLI subscriptions are execution authentication.

## 1. Settle intent

Settle every product and technical consideration before dispatching a builder. Agents decide technical choices. For unresolved product intent, interview the principal with `grilling` and `domain-modeling`, batching questions. Carry confirmed intent forward without another interview. Write settled stories in `SPEC.md` or the existing `USER_STORIES.md` with `user-stories`, then use `to-spec` and `to-tickets` to link them.

Specs, PRDs, grill-with-docs and to-spec describe the initiative’s full value and whole outcome, not a timid slice. Once scope is confirmed, lead a team: split it into the smallest atomically shippable PRs, each leaving main working and worth merging alone. The smallest diff achieving that unit wins. Dispatch independent builders in parallel, sequence dependencies, and keep the final design elegant. Count every parallel child against the lane budget, sized by model, effort, speed and reset distance. Publish settled tickets without asking.

## 2. Run rounds on the frontier

The **frontier** is every open ticket whose blockers are closed or have an open PR. Start a round for each frontier ticket that touches different files from the others, in parallel. One writer per branch.

A ticket with one open blocker PR **stacks** on it: its branch starts from that PR's head, its PR targets that branch, its QA and review take that branch as `<base>`, and it skips the file test against that PR. Fix a blocker on the PR that owns it; landing bottom-first (step 3) carries the fix up. A ticket with two open blocker PRs waits for one to land.

Classify each atomic PR using the [rigor table](roles.md#rigor), with its recorded reason and size; an initiative’s broad risk does not impose a floor on unrelated small slices.
Every authored change gets review and verification, including documents, briefs and measurements.
Use the tier's models for builders, QA, review and judges until Upkeep routing ships.
Upkeep owns model choice; ship-loop owns review shape and rigor.
Upkeep's route command does not exist yet ([Upkeep #75](https://github.com/misty-step/upkeep/issues/75)); when it ships, ask Upkeep:

- `upkeep route --kind <review|build|…> --difficulty <routine|hard|critical> --json`, optionally `--task "..."`, `--exclude-vendor <vendor>` and `--urgent`. Map light to routine, standard to hard, critical to critical. QA, review and judge all use `--kind review`; builders use `--kind build`.
- Try `choices` in order: pick first, then fallbacks. Empty `choices` means no room: wait until `no_room.next_room_at`, or use the rigor table if it is null.
- Map `choice.instance` to `target.providerInstanceId` and `choice.model` to `target.model`. Pass `choice.reasoning` in `target.options` as `{"id":"reasoningEffort","value":"<low|medium|high|xhigh>"}` for Sol or `{"id":"effort","value":"<low|medium|high|xhigh>"}` for Claude. Always pass effort explicitly, including table routes.
- Standard speed sets Codex `target.options.serviceTier: "default"` or Claude `target.options.fastMode: false`. Fast speed requires `--urgent`.

Dispatch roles with `delegate_task` and completed [role briefs](roles.md). Confirm routed providers/models against `orchestrator_capabilities`. Take an available account in the tier’s model class instead of waiting for an ideal route. Use one QA owner per SHA; extra cross-family QA needs a stated critical uncertainty. Carry the original goal, findings and resolutions into fix briefs; reuse working context where supported. When replacing a delegated child with a retry, `task_cancel` the old task first: usage-limited threads auto-resume and could act on superseded instructions.

1. **Build.** One builder, `isolation: "worktree"`, which starts from your local commit: first detach your checkout at the builder's start (`git switch --detach origin/<default branch>`, or the PR head it starts from). It returns a PR and its head SHA.
2. **Verify.** QA and review at that SHA, combined in one agent for light changes, separate otherwise.
3. **Judge.** An independent judge gets the ticket, PR and both revision-linked reports. Resolve missing proof before SHIP. A user-facing change without linked verification-skill evidence of the real journey is missing proof.
4. **Act on the verdict.**
   - **FIX:** the builder fixes code blockers; you clear lane blockers such as QA that could not run. Rerun only the reporter that raised the blocker on the changed delta and its consequences, retaining unchanged QA/review evidence, then use one independent judge on the new head. Bring both QA and review back only for new files or higher-risk paths, scoped to those changes.
   - **RE-SLICE:** split with `to-tickets` when diagnosis shows the outcome is too large, then continue on the new frontier.
   - **SHIP:** merge (step 3).

An internal change needs proof that it composes instead of a QA walk.

If the same blocker survives a fix, revisit its cause or the proposed solution.

Done for a ticket when the PR's current head SHA has a SHIP, ruled there or carried there by an unchanged patch-id (step 3), or when a generator-only release PR's checks pass at its current head.

## 3. Merge

- Confirm the repository's fast affected checks passed at the judged SHA, in its CI or by running its documented check command.
- A verdict carries across a rebase alone only when the patch-id is unchanged: `git diff <old base>...<judged SHA> | git patch-id --stable` must equal `git diff origin/<default branch>...<new head> | git patch-id --stable`. `<old base>` is the SHA recorded for the PR below in a stack, otherwise `origin/<default branch>`. For any other head change, including conflict resolution, use the delta checks and independent judgment in step 2.
- Squash-merge, with the PR title as a Conventional Commit (`docs/release-convention.md` in misty-step/harness). Land a stack bottom-first:
  1. Before the bottom PR lands, record every PR's head SHA once, in a comment on the bottom PR.
  2. After each PR lands, run `git fetch --prune`, then move the next one from a detached HEAD, which works whichever worktree holds its lane-owned branch: `git switch --detach <its recorded head>`, `git rebase --onto origin/<default branch> <the SHA recorded for the PR below>`, `git push --force-with-lease=<branch>:<its recorded head> origin HEAD:refs/heads/<branch>`.
  3. If the push is refused, fetch and inspect the branch's delta. Keep those commits. Carry the verdict by unchanged patch-id, or run step 2's delta checks and get the independent judge's ruling. Record the resulting judged head and repeat step 2 from it, including the detached checkout and rebase, with the lease pinned to that same head. Never force over the commits that moved the branch. The PR above still rebases from the first head recorded.
  4. Retarget the PR to the default branch if GitHub hasn't, and run the fast affected checks at its new head before it merges.

## 4. Watch the release

First identify whether this diff changes a deployed artifact. If none does, the judge records `no deploy`: skip release-watch and release waiting. Otherwise dispatch `release-watch` with the merge SHA and the ticket's stories. The merge closed the ticket (`Closes #<n>`); reopen it if the watch restores the release. Report `live behavior proven` only when the watch does, and `released` when a library or tool's release check passes. Its restore and incident paths run without you.

For a service with no automatic deploy, the watch reports `unwatched` and names the ticket for the missing mechanism; label it `release-mechanism` (`gh label create` once) so a fresh conductor finds it. While it is open, skip the watch and report each merge, the first included, as merged, not live. Check it at each Report; when it closes, dispatch one watch at the default branch's head with the stories of every ticket reported merged, not live.

## Report

When a ticket ships or the frontier needs a principal decision, post one short report in the lane and send it through `home post --from <Lane>` under global autonomy's delivery rule.

The report says what shipped, what is in flight (with the step each item is on), and every question for the principal, numbered. He reads it without opening anything:

- Give every PR, issue, ticket, story, spec, doc and thread a link and a one-line summary.
- Write each question out in full: its options, your recommendation, and what happens if he doesn't answer. Word it so "yes" accepts your recommendation.
- Never cite item numbers he hasn't seen, such as "Q3 yes" or "1-5", and never point at a file instead of writing out what it says.
