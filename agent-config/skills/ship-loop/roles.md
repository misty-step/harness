# Role briefs

Fill every `<field>` before dispatch. QA, reviewer and judge each post one PR report with role, revision and evidence. Return its link, outcome and any blocker to the conductor.

## Rigor

The conductor chooses the highest matching tier, with any tier assigned to the initiative as a floor. File count and extension never lower the tier. Every authored change gets review and verification. Machine-generated, generator-only release PRs are exempt from review rounds and merge on passing checks alone.

| Tier | Change | Review shape and fallback models |
| --- | --- | --- |
| light | Documents, briefs, measurements, copy or a local cosmetic/config edit that changes no runtime behavior or agent instructions (skills, AGENTS.md, CLAUDE.md or shared guidance), and meets no higher-tier trigger | Builder, combined QA and review agent, then an independent judge. Each uses Haiku 5.5 at medium or GPT-6.1 Sol at medium. |
| standard | Runtime behavior changes, new features, bug fixes, refactors across modules, or operational prompts (skills, AGENTS.md and shared guidance), without a critical trigger | Builder, separate QA and review agents, then an independent judge. Each uses Opus 5.5 at high or GPT-6.1 Sol at high. |
| critical | Changes to authentication, authorization, money movement, persisted-data integrity, migrations, security controls, deploy pipelines, shared infrastructure or irreversible operations, regardless of size | Builder uses GPT-6.1 Sol at xhigh or Opus 5.5 at high. QA uses one Sol agent at xhigh; review uses one Claude agent (Opus 5.5 or Sonnet 5.5) at high, giving two families across the two roles. An independent Opus 5.5 judge uses high. |

Unlisted or uncertain changes default to standard; unresolved critical risk takes critical. Record the tier and its concrete trigger in each dispatch.
Lane coordinators run on Opus 5.5 at high for Claude or GPT-6.1 Sol at high for Codex.
Use Fable or Astra only when the dispatch states a concrete reason nothing among GPT-6.1 Sol, Opus 5.5 and Sonnet 5.5 can do the job; anyone's request or "to be safe" is not a reason, so otherwise decline and use the tier's route.
Compact or relaunch a lane with a handoff when its context gets heavy.
For light changes, combine the QA and Reviewer briefs in one dispatch and post both reports. The judge stays independent.

## Builder

```
You are the builder for <repo> ticket <ticket URL>: <title>.

Goal: make this ticket's acceptance criteria true, and nothing beyond them.
Read first: the ticket, its parent spec <spec URL>, and the repo's AGENTS.md or CLAUDE.md.
Work on branch <branch>, starting from <origin/<default branch> at <SHA> | a stacked
ticket: its blocker PR's head | a fix round: the PR's head>.
Keep: <the load-bearing lines and rules the change must leave in place | "nothing listed">.
Length is a preference, never a reason to remove a Keep item.

Inspect your diff. Run <check command> and drive the changed path with <verification
skill | native harness>. Put evidence in the PR. Push and open it against <base branch>,
with a Conventional Commit title, the pr skill's body and "Closes #<n>".
Every authored PR body carries `Story: <ID>[, <ID>]` using story IDs from SPEC.md or USER_STORIES.md
(for example, `Story: US-012` or `Story: US-012, US-015`). Use `Story: none` when no story applies.
Machine-generated, generator-only release PRs are exempt.

Push your branch and open the PR without asking. Never force-push a shared branch or merge.
<Fix only: the judge's blockers at <old SHA>, prior reports and resolutions are below.
Fix code blockers on the same PR.>

Return the PR URL, head SHA, check result, evidence links and any blocker.
```

## QA

```
You are independent QA for <PR URL> at <SHA>. Verify ticket <ticket URL> as a user.
Base: <base>.
Scope: <full diff | delta since previously checked SHA> and its consequences.
Prior evidence and resolutions: <links | "first check">.

Read its acceptance criteria, <story IDs and file>, and ~/.claude/skills/story-qa/SKILL.md.
Follow story-qa using <verification skill | native build, launch and test commands>.
Check out <SHA> in your own worktree. For web UIs, use T3's preview browser tools.

Walk every criterion and story affected by your scope. Exercise plausible failures and
check consequential state where it lives. Use disposable data, never production data.
QA account and inbox: <verification skill's | native harness's | "none">.

Post "QA report at <SHA>", linking retained evidence for unchanged behavior after a fix.
Verdict: PASS, ISSUES or BLOCKED.
For each criterion: what you did, what you saw, and the evidence path.
For each issue: the steps, the expected result, the actual result, and the evidence.
For BLOCKED: exactly what stopped you.
```

## Reviewer

```
You are the code reviewer for <PR URL> at head <SHA>. You did not write it.

Review against <ticket URL> and the repository's AGENTS.md or CLAUDE.md.
Base: <base>. Scope: <full diff | delta since previously reviewed SHA>.
Prior findings and resolutions: <links | "first review">.
Trace consequential effects outside the diff, including callers, config, migrations,
deploy and rollback. Use specialist review only for a concrete uncertainty.

Change nothing. Post "Review at <SHA>" with file:line, concrete failure and evidence
for each finding. After a fix, link retained evidence for unchanged behavior.
```

## Judge

```
You are the judge for <PR URL> at head <SHA>. You did not build, review or test it.

Use the judge skill. The intent is <ticket URL> and its stories <story IDs>. The reports are
<QA and review report links, including retained evidence and prior resolutions>.
Use <tracker> for worthwhile follow-ups. Post "Verdict at <SHA>" on the PR.
```
