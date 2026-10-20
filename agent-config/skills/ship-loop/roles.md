# Role briefs

Fill every `<field>` before dispatch. QA, reviewer and judge each post one PR report with role, revision and evidence. Return its link, outcome and any blocker to the conductor.

## Rigor

The conductor chooses the highest matching tier, with any tier assigned to the initiative as a floor. File count and extension never lower the tier. Every authored change gets review and verification. Machine-generated, generator-only release PRs are exempt from review rounds and merge on passing checks alone.

| Tier | Change | Review shape and models |
| --- | --- | --- |
| light | Documents, briefs, measurements, copy or a local cosmetic/config edit that changes no runtime behavior or agent instructions (skills, AGENTS.md, CLAUDE.md or shared guidance), and meets no higher-tier trigger | Builder, combined QA and review agent, then an independent judge. Builder and judge use Opus 5.5 at medium; the combined check uses Sonnet 5.5 at medium. Trivial edits may use Haiku 5.5. |
| standard | Runtime behavior changes, new features, bug fixes, refactors across modules, or operational prompts (skills, AGENTS.md and shared guidance), without a critical trigger | Builder, separate QA and review agents, then an independent judge. Each uses Opus 5.5 at high. |
| critical | Changes to authentication, authorization, money movement, persisted-data integrity, migrations, security controls, deploy pipelines, shared infrastructure or irreversible operations, regardless of size | Builder uses Opus 5.5 at high. QA uses Opus 5.5 at xhigh; review uses Opus 5.5 at high. An independent Opus 5.5 judge uses high. |

Models are all Claude while every Codex account is out (global guidance, Routing until Upkeep). When `upkeep` shows a Codex instance with room, GPT-6.1 Sol at the same effort may replace any role's model, and critical QA then uses Sol at xhigh for a second model family. Never route to `claude-hello`, which is reserved for Home.

Unlisted or uncertain changes default to standard; unresolved critical risk takes critical. Record the tier and its concrete trigger in each dispatch.
Lane coordinators run on Opus 5.5 at high.
No Fable or Astra (phaedrus, 2026-10-20).
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

Inspect your diff. Run <check command> and drive the changed path with the repository's
verification skill <path>. If it has none, add one with create-verification-skill
(`.agents/skills/verify-<app>/`, `.claude/skills/` symlink), or say which open PR adds it. Put evidence in the PR. Push and open it against <base branch>,
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
Follow story-qa using the repository's verification skill <skill path>. If it has none, say so:
the builder adds one in this PR or the PR stacks on the PR adding it.
Check out <SHA> in your own worktree. Drive the real journey from the CLI; T3's preview
browser tools are an alternative for web UIs. When the product has sign-in, sign in as
the real owner identity <identity> on the real product; an email sent or a 200 response
is not a sign-in.

Walk every criterion and story affected by your scope. Exercise plausible failures and
check consequential state where it lives. Use disposable data, never production data.
QA account and inbox: <verification skill's | native harness's | "none">.

Post "QA report at <SHA>", linking retained evidence for unchanged behavior after a fix.
Verdict: PASS, ISSUES or BLOCKED. Owner sign-in: PROVEN (evidence link), UNPROVEN (the access
needed) or n/a (why).
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
