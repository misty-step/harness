# Verification

Canonical checks: `./scripts/verify [all|shared|pi|omp|workspace]` from any cwd.
`./scripts/check` is the fixed entry point (ADR-004): it runs the same command
with the same arguments, and CI invokes it.
Requires Git, Bun >=1.4.2, jq, a POSIX shell, and Python 3 for root scanner and shared gallery checks. No bootstrap, provider credentials,
or installed harness is needed. Unit suites read working files; the installer
check deliberately clones committed HEAD. Commit installer changes before using
that evidence. Both source identity and dirty-tree status are reported.

## Resource boundary

Tests run sequentially with Bun concurrency capped at one. All scratch is
run-scoped under `~/.cache/tmp` and removed on ordinary exit. Run:

```sh
./scripts/verify all
```

CI uses one job, `./scripts/check all`, and a 15-minute timeout. Before that check,
the pinned Landmark action validates the prospective release candidate with
`prepare-protected` and supplies its checksum-verified binary for the release
race replay. CI therefore also needs access to GitHub release downloads.
No browser, Electron, model, cloud resource, or installed harness is needed.
All scratch is run-scoped under `~/.cache/tmp` and removed on ordinary exit; interrupted runs may leave an
owned directory. Remove only that directory once its process has ended.

## Observable contracts

- `scripts/references.test.ts` checks tracked Markdown file targets and canonical
  `harness/blob/master/` URLs against the working tree. It also runs both
  consumers' installers in disposable homes against working files, checks the
  installed `test-audit`, `story-qa`, and `check-cadence` entries and guidance
  routes (US-021–US-023), and rejects missing or out-of-package skill references,
  including legacy backticked `references/` paths. Regression fixtures reproduce
  the original defect and package escapes.
  Existing Markdown links in the foundation skill and operating pointer are
  checked for resolvable targets (US-024); this does not prove their wording,
  that a removed link survives, or semantic subordination to the standard.
  This is a CI guard, not a live installer preflight or general Markdown/network
  crawler: external web availability, anchors, native `skill://` discovery, and
  arbitrary prose/code paths need semantic review.
- `scripts/workspace-inventory.test.ts` creates real local Git repositories and
  worktrees to check external paths, nested repositories, dirty and prunable
  states, and non-destructive failure reporting while continuing past unreadable
  directories; it does not inspect or clean the host's worktrees.
- `scripts/protected-release.test.ts` guards the release validation
  configuration and, when `LANDMARK_BIN` is supplied, replays a docs-only
  candidate race against the real binary. CI always supplies it from the
  pinned Landmark action. Offline local runs explicitly skip that replay.
- `scripts/trufflehog-gate.test.ts` checks that the pre-push scanner admits only
  the pinned unverified GitHub OAuth false positive from a public commit SHA
  in a generated changelog link. Other commit links and findings, malformed
  results, and scanner errors fail closed without printing candidate secrets.
- Existing shared, pi and OMP suites exercise component logic.
- `agent-config/skills/session-close/session-close.test.ts` exercises scoped lease
  ownership and stale/corrupt review (US-004). The existing close gate also owns
  deterministic landing verification: persistent owned branch/HEAD records,
  fetched origin-default merge proof, live origin/GitHub branch/PR facts,
  checkout cleanliness and owned worktree teardown. Its exit 0 means landed or
  explicitly parked, not independently verified deployment, review or ticket
  completion. Unparked GitHub auth, command and malformed-API failures fail
  closed, as does corrupt storage. Parked facts remain unverified.
  `leases --json` remains read-only lease introspection for `ws`, with
  no Git checks or auto-tracking. `agent-config/bin/ws.test.ts` uses real
  disposable Git repositories and a fake SSH lobby/VM to exercise snapshots,
  command input, leases and evidence-gated teardown (US-025).
  These checks do not provision a live VM or prove live CDP/browser readiness.

  US-004 owner-path verification uses the installed `session-close.ts`, the
  same owner identity/store throughout, and a real task PR:
  1. At the beginning, `track --repo PATH` the owned checkout (including an
     inherited worktree); create-time lease any newly created worktree/VM.
     Introduce a controlled Git-visible dirty change and run installed `check`;
     observe exit 2 and the dirty blocker. Resolve only that controlled change,
     preserving other owners' evidence.
  2. Obtain exact-head independent model review, recording the actual author
     model and using the cross-family reviewer without fallback. Await and
     observe green CI on the candidate against the current base, then merge
     normally without `--admin` or a human approval gate. Deploy the merged
     revision through both Pi/OMP installers for shared changes, restart and
     exercise the affected installed path. Record revision, target and observed
     production sanity result in the PR and relevant existing routed ticket
     (Habitat where used; Misty Step remains Linear).
  3. Delete only the owned merged local/origin branch, remove only the owned
     worktree without force and resolve its lease after evidence inspection;
     preserve `ws pull` before evidence-gated `ws down`. Leave the canonical
     checkout clean on the freshly fetched origin default head. Foreign dirt
     is a blocker to coordinate with its owner, never permission to erase it.
  4. Run installed `check` from the canonical checkout after the original
     worktree is gone; observe exit 0 and **landed** records, not parked records.
     Record installed script path, owner, revision, commands, exit codes and
     redacted output. A `park --repo PATH --note TEXT` pass is explicitly
     **unfinished**, with reason/owner/resume steps and retained-resource
     status; it is not evidence of this successful landing walk.

  Update affected documentation as part of the landing. Root Landmark release
  automation owns `CHANGELOG.md`; do not manually edit it.
- `agent-config/bin/openrouter-key.test.ts` builds real Git checkouts and a
  linked worktree to exercise R90 versus personal selection, damaged Git
  metadata, invalid-token failure with a usable personal key present, bounded
  stalled pass lookup, and `--which` without decryption (US-028). No real pass
  entry is read by the unit test.
- `omp-config/bin/omp-task-usage.test.ts` checks price-weighted whole-tree cost,
  failed-task inclusion, unknown/unpriced evidence, split-task worker ownership,
  scope escape, malformed archives and content-free reporting (US-018).
- `omp-config/bin/omp-roster.test.ts` runs a lone copy of the launcher against
  fixture ticket and usage views, fake `board`, `ai-usage` and `herdr` commands, and
  synthetic session files: first-usable launch with skip reasons, verdict and
  degraded reporting, the printed `export` and arguments, exit 3 with nothing
  written on an exhausted roster, exact roster-only overlay chains for the
  engineer and helper roles (with a guard over every role and model-keyed chain
  of the real `config.yml`), one overlay and one launch record per launch, refusals
  of bad tickets and usage views, and off-roster turn and fallback reporting
  judged per session file from its own launch record (a relaunch, two rosters, a
  subagent with its session, roster changed, an unreadable board, `--since`, a
  file with nothing judged, a half-written last line) with helper and designer turns on their approved
  primaries, cash routes and prompt text handled, and a launch without a ticket
  (`--model` and `--thinking`: refusals, exit 3 with nothing written, a one-route
  overlay and record, `check` on an `adhoc-` id, with a `board` that fails if run)
  (US-046). It makes no model call; the forced-outage walk against real OMP is a
  recorded manual smoke.
  US-047 adds the session-wide working-engineer admission boundary: default
  8 refuses at 8 and above with exit 5, empty stdout and no artifacts; 7 working
  engineers plus settled agents succeeds; a configured limit, unnamed agents,
  ticketless launches, malformed Herdr replies and invalid limits are covered.
- Reviewer-family acceptance (US-014, US-046; operator rule 2026-09-30) uses a
  real OMP process with a network-disabled synthetic provider. Preserve the
  JSONL transcript, provider attempts and active child config readback.
  With fallback enabled and Sol authenticated, force Sonnet failure: observe
  same-model retries followed by terminal failure, with no other reviewer
  attempt. Remove the guard as a positive control and observe the forbidden
  hop. Cover both author directions, security-reviewer, missing reviewer auth,
  inherited concrete/effort/wildcard chains, and an actual parent failure after
  review to prove the engineer's recovery still works. Registry record
  overrides merge keys; the native settings singleton is not child-scoped.
  The 2026-10-01 acceptance walk on OMP 18.4.6 found and rejected both traps.
  Also remove the extension while retaining the default disabled-agent gate:
  protected tasks must remain unavailable. Inject a child initialization failure
  through a supported extension wrapper: no reviewer provider request or fallback
  is permitted. Confirm enabled specialists remain present in the model-visible
  task description. The standalone review-only process disables model switching
  as well as emptying its selected reviewer's recovery chains; verify same-model
  retries still occur and remove both restrictions for its forbidden-hop control.
  Disable the loaded guard through native extension settings after its first
  successful unlock: observe native hook suspension and closed specialist
  permissions, with no child request. Revoke reviewer auth between preflight
  and SDK startup: the child's requested-model provenance must refuse parent
  substitution before its first provider request.
- `omp-config/extensions/credentials/credentials.test.ts` checks stable opt-in
  context, names-only default inventory, and no tool/prose-triggered interruption
  with a synthetic pass store (US-019). The [token-efficiency procedure](token-efficiency.md)
  records the native pre-dispatch smoke and separate quality promotion gates;
  unit assertions are not evidence of model quality or production cache savings.
- `agent-config/audio-sandbox/audio-sandbox.test.ts` checks the agent audio
  contract (US-026): Claude Code settings keep foreign keys, the OMP dotenv block
  yields the exact contract and an unterminated block fails closed, the routing
  proof resolves native and Pulse streams and rejects leaks and vacuous passes,
  requested sachstand speech leaves the sandbox, and an unowned PipeWire drop-in
  is refused. The live routing proof runs in `install.ts host` only when
  PipeWire is reachable.
- `pi-config/bin/pi-audio-prefix.test.ts` checks that pi-config owns
  `shellCommandPrefix`: its own prefix is created, kept, or renewed with foreign
  keys preserved, and any other prefix (an operator's own, ours composed with
  more shell, extra assignments, trailing syntax) fails closed (US-026).
- `omp-config/extensions/audio-sandbox/audio-sandbox.test.ts` runs revised Python
  eval cells under a runner-like environment: spawned processes receive the
  exact contract, `from __future__` cells still run, revision is idempotent,
  `%%bash` cells export the contract, and a standalone `local://` load is
  routed and loaded by canonical path, or refused when unresolvable or when a
  path or symlink escapes the root (US-026).
- `scripts/verify-installers` clones committed HEAD and runs both actual installers
  with a sanitized environment, synthetic HOME, agent directories and development
  root. It prints individual PASS/FAIL results and exits nonzero on any failure.
- Exact guidance composition is compared with the committed intro/sections.
- Launcher bytes and executable bit must match the shared source.
- The installed `foundation-check` must resolve its catalog and story checker
  from the installed skills and fail closed on a repository without
  `foundation.json` (US-024); `foundation-check.test.ts` covers its contracts,
  including ratchet mode and the review gate against a fake GitHub API (US-027).
- Foreign skill files and OMP's synthetic auth file remain byte-identical.
- Both installers deploy byte-identical executable `openrouter-key`; the
  isolated Pi install replaces only `auth.json.openrouter`, preserving another
  provider's synthetic credential, and the OMP install retains its auth store
  while configuring `models.yml` to use the command (US-028).
- Both installers must deploy the audio sandbox's two layers, drop-in, and Claude
  Code env with foreign settings preserved; the installed extension must apply
  the contract self-contained, and the isolated run must not reach live PipeWire.
  Pi's own prefix must redeploy byte-identical, and a foreign prefix must stop the
  install in preflight with settings unchanged and no package written.
- Disposable clone and destinations are removed on exit.

`workspace` runs shell syntax, reference tests, and both installer checks without
component unit suites. All selections run both installer checks because their
shared contract is cheap to exercise. These checks do not claim native
credential resolution, provider calls, billing, or authentication-failure
behavior. For US-028, deploy the narrow `openrouter-auth` (Pi) and `config`
(OMP) components from a merged revision, restart each harness in R90 and
Misty Step directories, make real OpenRouter calls, and compare per-key usage
via OpenRouter's management API. In a separate R90 process, point
`PASSWORD_STORE_DIR` at a missing test store to make the lookup fail without
modifying pass; an auth failure must not increase the personal key's usage.
Keep keys and `auth.json` contents out of logs. Other changed native behavior
still needs the fresh-session procedures in component READMEs.

Never pipe verification through tail without preserving its exit status. Do not
substitute a successful tool invocation or file presence for a postcondition.

## Selecting evidence (US-001, US-021)

Before changing uncertain behavior, identify plausible failures and choose checks
that distinguish the intended outcome from them. Prefer real consumer journeys
for complex changes; keep focused isolated tests for contracts and failure paths
that a journey cannot cover reliably or safely. Do not retain tests that merely
mirror implementation. For end-to-end evidence, record the exact revision,
repeatable setup and command, observed postconditions, and redacted output or
captures where relevant; passing one path does not prove another.

When writing, changing, or auditing tests, follow the shared
[`test-audit` skill](../agent-config/skills/test-audit/SKILL.md). Its authoring
gate and focused-audit evidence prevent duplicate or circular coverage; the
[campaign workflow](../agent-config/skills/test-audit/CAMPAIGN.md) applies only
to an explicitly commissioned subsystem. `./scripts/verify` tests working
source but clones committed HEAD for installer checks. Before commit, exercise
changed skill packaging and guidance composition in disposable destinations.

The shared [`story-qa` skill](../agent-config/skills/story-qa/SKILL.md)
requires agents to adversarially review their own work and, for user-facing
changes, manually walk affected request and story criteria through the actual
end-user surface before calling the work done. Docs-only and internal changes
get proportionate owner-path checks; recurring runs rotate broader curated
walks. Its [check-cadence reference](../agent-config/skills/story-qa/check-cadence.md)
tiers repository checks by measured cost and delayed-detection risk: PR feedback
should take minutes; expensive matrices belong to owned nightly or weekly
runs with notification and on-demand execution. This guidance does not install
a scheduler. Keep security and installer verification intact; agents await and
inspect their results rather than making them server-required merge gates.

## Merge-rule census (2026-10-01)

The supported-settings cutover inspected every owned repository, including
archives, all classic branch-protection patterns, and repository rulesets with
`includes_parents=true`. Owner pagination was exhausted; no classic rule list
was truncated.

| Owner | Repositories | Ruleset API unavailable on current private plan |
| --- | ---: | ---: |
| `misty-step` | 128 | 0 |
| `r90group` | 54 | 51 |
| `moomooskycow` | 167 | 29 |

Before: 65 classic rules and nine rulesets. Only three branches in two archived
repositories required a positive approval count. The live blockers were required
CI contexts, including `foundation-review`, whose workflow demanded an identity
other than the shared author. Scry already required zero approving GitHub reviews.
Historical admin merges include
[harness #137](https://github.com/misty-step/harness/pull/137),
[#138](https://github.com/misty-step/harness/pull/138), and
[#169](https://github.com/misty-step/harness/pull/169);
[#173's resume note](https://github.com/misty-step/harness/pull/173#issuecomment-5899946049)
records the unresolved binary/submodule review path.

Change: remove 60 classic required-status-check subrules and 27 review subrules;
delete eight gate-only rulesets and remove the required-check rule from the ninth,
retaining its deletion and non-fast-forward protections. GitHub rejects settings
writes on archives: 53 affected repositories were temporarily unarchived, changed,
then rearchived. Readback found no archive-state differences.

After: zero classic approval/status-check gates and zero ruleset approval,
required-check or merge-queue gates across the same 349 repositories. The
80 private-plan failures explicitly say to upgrade to GitHub Pro or make the
repository public; these settings are unsupported, not repository exemptions.
No upgrade, bypass actor, new App or credential change was made. Independent
model review, observed CI and actual-flow verification remain agent obligations.
The release workflow opens its candidate PR but no longer enables server
auto-merge, which could otherwise merge before model review once required checks
are removed.

## Protected release walk (US-015)

The `verify` job validates the prospective PR merge, not only the head
branch, with the same pinned Landmark `prepare-protected` action used to create
release candidates. This invokes the publisher's local candidate classifier.
It may generate an uncommitted changelog in the disposable CI checkout; it
cannot publish, push, or mutate the source checkout used by subsequent jobs.
The original publish-time validation remains in place.

The merge policy is uniform across `misty-step`, `r90group`, and `moomooskycow`
(operator decisions, 2026-09-28/30): independent model review plus green observed
CI, without human approval or server-required status checks. The
[normal merge procedure](../agent-config/skills/engineering-operations/review.md)
owns supported settings changes and exact-head merging; no bypass actors,
per-repository exclusions, or plan upgrade substitute for that policy.

Removing a strict required `verify` rule does not remove release-candidate
validation. The agent must check the candidate against the current base and
await the observed `verify` jobs before merging. A base advance after successful
CI can invalidate a release marker even if the PR head is unchanged. Re-read
the base immediately before merge; if it moved, update the branch, regenerate
a stale candidate through the normal Landmark preparation flow, and await fresh
CI on the resulting prospective merge. Refresh model review for changed
head/state. `--match-head-commit` guards the head, not the base; do not treat
that flag or an old green run as proof of current-base validation.

For a bounded local race replay, use the checksum-verified binary from the
Landmark release matching the action pin, then run:

```sh
LANDMARK_BIN=/absolute/path/to/landmark bun test --max-concurrency=1 scripts/protected-release.test.ts
```

The fixtures live under run-scoped `~/.cache/tmp` and are removed on exit. The
replay rejects a stale docs-only candidate, then proves regeneration and the
next tagged boundary. It does not pretend to publish a GitHub Release.
With `CI=true`, a missing `LANDMARK_BIN` fails the job rather than silently
skipping this replay.

Between a release PR landing and its tag being published, other PR checks can
reject that pending candidate if they add commits. After publication, rerun
their checks with freshly fetched tags; validation is then bounded by the
published tag. Do not remove the guard to clear this transient state.

For real-path acceptance, observe green `verify` against the current base on the
fix PR and merge its reviewed exact head normally. Observe green `Verify and
Release` on master, then follow the generated `landmark/release` PR through
current-base candidate validation, model review, observed green CI and normal
merge, without a human approval gate or admin override.
Read the resulting tag target and GitHub Release back through `gh`, confirming
the target is the landed release commit. Dispatch the release workflow again
and confirm the existing tag is unchanged and no duplicate release is created.
Do not deploy either harness while doing this walk.

If an unpublished stale candidate already landed, first confirm its claimed
version has neither a remote tag nor a published release. Withdraw only that
unpublished section in a verified repair PR. After it merges, let the normal
release workflow prepare a replacement from the accumulated commits; never
hand-edit fingerprints, move tags, skip publication errors, or bypass checks.
See the [MIS-177 postmortem](postmortems/2026-09-27-stale-protected-release.md).

## Git hook setup

`./scripts/bootstrap` checks Git, gitleaks, trufflehog, and Python 3, then
selects `.githooks` as the repository hook directory. It refuses a foreign
local hooksPath rather than taking ownership silently. Pre-push scans outgoing
commits with gitleaks and the worktree with trufflehog. The sole TruffleHog
exception is the pinned unverified GitHub OAuth false positive equal to the
first 20 hex characters of one public full commit SHA in a generated
`CHANGELOG.md` GitHub commit link; another SHA, line, detector, or value
still blocks. Runtime installers do not configure Git hooks. Prose-only edits
call for consistency review; changed deployed guidance also needs composition
inspection, not a model run.
