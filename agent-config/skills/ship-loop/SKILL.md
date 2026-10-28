---
name: ship-loop
description: Drive a lane's confirmed work from ticket to verified production through builder, QA, reviewer and judge agents, then merge and watch the release. Use when a lane has scope to ship, for "run the loop", or for "ship this ticket".
---

# Ship loop

You lead the initiative. Keep its full outcome and elegant end design in view while shipping the smallest valuable units through builder, independent QA/review and judge agents.

Start with build, then independent QA and review (combined for light changes, parallel otherwise), then the judge. Allow at most one judge-authorized fix round. The tracker holds tickets, PRs and reports; keep no separate ledger.

No human reviews or merges, in any organization: the independent judge's SHIP plus passing checks is the whole gate.

Machine-generated, generator-only release PRs merge on passing checks alone, without a review round or `Story:` line. Exact-ID roster-only succession PRs also merge on passing checks under global **Merge** and `lane-succession` dispatcher step 3; authored policy, tests and other config changes keep ordinary review.

Many skills named here are user-invoked, so the Skill tool refuses them. For those, you and every agent you brief read `~/.claude/skills/<name>/SKILL.md` and follow it.

## 0. Use the repository's tools

Use its existing tracker and conventions. Add tracker guidance only when ambiguity blocks work.

Follow global Verification's external evidence rule: keep proof outside the checkout and link it from the PR. Existing repository evidence cleanup belongs to Foundation auditors in focused follow-ups.

Prove every change as global guidance's **Verification** section requires: the repository's verification skill drives the real user journey end to end, with owner sign-in where the product has sign-in, and the evidence is linked. When the repository has no skill, the builder adds one (`~/.agents/skills/create-verification-skill/SKILL.md`) or the ticket stacks on the open PR adding it. Use the agent's own AgentMail QA account, with `pass` references `workstation/<PROJECT>_QA_*`, for production login and proof of the required owner/admin role. Apply global guidance's mandatory generator override during verification rollout; run `scripts/probe-agent-policy --verification <repo>` from harness. Missing QA access is `owner sign-in UNPROVEN: needs <QA access/role>`, never verified; provision authorized QA allowlist/Cloudflare Access additions without asking for phaedrus's passwords. Native CLI subscriptions are execution authentication.

## 1. Settle intent

Settle every product and technical consideration before dispatching a builder. Agents decide technical choices. For unresolved product intent, interview the principal with `grilling` and `domain-modeling`, batching questions. Carry confirmed intent forward without another interview. Write settled stories in `SPEC.md` or the existing `USER_STORIES.md` with `user-stories`, then use `to-spec` and `to-tickets` to link them.

Specs, PRDs, grill-with-docs and to-spec describe the initiative’s full value and whole outcome, not a timid slice. Once scope is confirmed, lead a team: split it into the smallest atomically shippable PRs, each leaving main working and worth merging alone. The smallest diff achieving that unit wins. Dispatch independent builders in parallel, sequence dependencies, and keep the final design elegant. Count every subagent against the lane budget, sized by model, effort, speed and reset distance. Publish settled tickets without asking.

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

**The round helper is the path for every step below.** `scripts/ship-loop.ts` in this skill (`bun ~/.claude/skills/ship-loop/scripts/ship-loop.ts --help`) keeps each PR's round state in the PR's own comments. A new conductor, thread, succession, retry or new head reads the same state, so no round is tracked anywhere else:

The PR author is the ledger's sole writer, identified through GitHub's native PR and comment metadata. Use that native GitHub identity when recording events; markers from other commenters are ignored, including malformed ones. Unknown author or unreadable trusted events stop the command without resetting the round.

- `init --pr <url> ...`: once the builder has opened the PR. On an existing ledger it resumes and never resets.
- `status --pr <url> --json`: `phase`, `fix_round`, `review_thread_ids`, `review_thread_count`, `source_head`.
- `prompt --pr <url> --role <qa|review|qa-review|judge|recheck|fix-builder|final-judge>`: the only brief a role gets. It refuses a role out of phase.
- `record --pr <url> --kind <report|verdict|recheck|head> --file <payload.json>`: writes only what the user supplied, such as native thread IDs and report links. It refuses any write the workflow forbids.

1. **Build.** One builder, `isolation: "worktree"`, which starts from your local commit: first detach your checkout at the builder's start (`git switch --detach origin/<default branch>`, or the PR head it starts from). It returns a PR and its head SHA. Run `init` with that PR.
2. **Verify.** `prompt --role qa-review` for light changes, or `qa` and `review` otherwise. Record each report with `record --kind report`. If the head changes before any report exists, such as a rebase or base update, record it with `record --kind head` and `{"reason": "refresh", "from": "<recorded head>", "sha": "<new head>", "base": "<its base>"}`; after any report, only a FIX or a carry moves the head.
3. **Judge.** `prompt --role judge` gives the independent judge the eligible findings. Resolve missing proof before SHIP. A user-facing change without linked verification-skill evidence of the real journey is missing proof. Record the ruling with `record --kind verdict`.
4. **Act on the verdict.**
   - **FIX:** only a judge's FIX ruling naming exact eligible blockers authorizes a fix round. Reviewer findings alone do not. The helper persists the authorization before the builder runs; `prompt --role fix-builder` then fixes those code blockers, and the new head is recorded with `record --kind head`. You clear named lane blockers such as missing proof. Dispatch a new independent thread for the blocking reporter's recheck role with `prompt --role recheck`; `record --kind recheck` keeps its actual new `thread_id`, the original `reporter_thread_id`, exact blocker results and fix-introduced `regressions` (empty if none). Retain unchanged QA/review evidence. New unrelated findings become follow-up tickets. Rechecks do not hunt for new edge cases or reopen the full review.
   - **REVERT / SPLIT:** drop or revert the unit, or split it into independently shippable PRs with `to-tickets`.
   - **SHIP:** merge (step 3).

An internal change needs proof that it composes instead of a QA walk.

After the first fix round, `prompt --role final-judge` includes the recheck report, named results and recorded regressions, with no FIX option: SHIP with follow-up tickets or REVERT / SPLIT. The helper refuses a second FIX. No third round. Rebases, changed SHAs and new findings do not reset this cap.

Already on main means never a blocker for this PR. Track pre-existing bugs separately. Ship heuristic features labeled approximate; accuracy improvements are follow-up work.

Done for a ticket when the PR's current head SHA has a SHIP, ruled there or carried there by an unchanged patch-id (step 3), or when a checks-only exception above passes at its current head.

## 3. Merge

- Confirm the repository's fast affected checks passed at the judged SHA, in its CI or by running its documented check command.
- A verdict carries across a rebase or base merge alone only when the patch-id is unchanged: `git diff <old base>...<judged SHA> | git patch-id --stable` must equal `git diff <new base>...<new head> | git patch-id --stable`. `<old base>` must resolve to the ledger's recorded base (including a base moved by a prior carry or refresh); if that recorded base no longer resolves, the helper refuses. `<new base>` must resolve to `origin/<base ref>`, where `<base ref>` is the PR's actual target branch reported by GitHub, not a caller-selected branch or PR-internal commit. Fetch origin first and retarget a stacked child on GitHub before its carry. From a checkout holding all four commits, record the carry with `record --kind head` and `{"reason": "carry", "from": "<judged SHA>", "from_base": "<old base>", "sha": "<new head>", "to_base": "<new base>"}`; the helper validates the bases, computes both patch-ids and records their full SHAs. A base move during review that was not recorded fails closed and requires re-verification. For any other head change, including conflict resolution, re-verify and get the independent judge's ruling under the fix-round cap (step 2).
- Squash-merge, with the PR title as a Conventional Commit (`docs/release-convention.md` in misty-step/harness). Land a stack bottom-first:
  1. Before the bottom PR lands, record every PR's head SHA once, in a comment on the bottom PR.
  2. After each PR lands, run `git fetch --prune`, then move the next one from a detached HEAD, which works whichever worktree holds its lane-owned branch: `git switch --detach <its recorded head>`, `git rebase --onto origin/<default branch> <the SHA recorded for the PR below>`, `git push --force-with-lease=<branch>:<its recorded head> origin HEAD:refs/heads/<branch>`.
  3. If the push is refused, fetch and inspect the branch's delta. Keep those commits. Carry the verdict by unchanged patch-id, or re-verify and get the independent judge's ruling under the fix-round cap. Record the resulting judged head and repeat step 2 from it, including the detached checkout and rebase, with the lease pinned to that same head. Never force over the commits that moved the branch. The PR above still rebases from the first head recorded.
  4. Run the fast affected checks at the new head before it merges.

## 4. Watch the release

First identify whether this diff changes a deployed artifact. If none does, the judge records `no deploy`: skip release-watch and release waiting. Otherwise dispatch `release-watch` with the merge SHA and the ticket's stories. The merge closed the ticket (`Closes #<n>`); reopen it if the watch restores the release. Report `live behavior proven` only when the watch does, and `released` when a library or tool's release check passes. Its restore and incident paths run without you.

For a service with no automatic deploy, the watch reports `unwatched` and names the ticket for the missing mechanism; label it `release-mechanism` (`gh label create` once) so a fresh conductor finds it. While it is open, skip the watch and report each merge, the first included, as merged, not live. Check it at each Report; when it closes, dispatch one watch at the default branch's head with the stories of every ticket reported merged, not live.

## Report

When a ticket ships or the frontier needs a principal decision, post one short report in the lane and send it through `home post --from <Lane>` under global autonomy's delivery rule.

The report says what shipped, what is in flight (with the step each item is on), and every question for the principal, numbered. He reads it without opening anything:

- Give every PR, issue, ticket, story, spec, doc and thread a link and a one-line summary.
- Write each question out in full: its options, your recommendation, and what happens if he doesn't answer. Word it so "yes" accepts your recommendation.
- Never cite item numbers he hasn't seen, such as "Q3 yes" or "1-5", and never point at a file instead of writing out what it says.
