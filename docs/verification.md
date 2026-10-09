# Verification

Canonical checks: `./scripts/verify [all|shared|pi|omp|workspace]` from any cwd.
`./scripts/check` is the fixed entry point (ADR-004): it runs the same command
with the same arguments, and CI invokes it.
Requires Git, Bun >=1.4.2, jq, a POSIX shell, Python 3 and Rust 1.85+.
The Chromium shim links Linux's `libsystemd.so.0` without a Cargo dependency.
Unit and installer checks need no bootstrap, provider credentials or installed
harness. Unit suites read working files; the installer
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
The canonical checks need no browser, Electron, model, cloud resource or installed
harness. The subsequent semantic review gate does need `OPENROUTER_API_KEY`.
Reusable CI declares that secret required, and `Verify and Release` forwards only
that named secret; repository secrets do not cross a `workflow_call` automatically.
Missing credentials fail the review rather than silently skip it.
All scratch is run-scoped under `~/.cache/tmp` and removed on ordinary exit; interrupted runs may leave an
owned directory. Remove only that directory once its process has ended.

## Retired control-plane checks

Fleet roster/experiment/audit checks, custom workspace/session-close gates and
source-only Summon/Mage factory candidates are retired with their implementations.
Native configuration, credential/audio/display isolation, repository validators
and release gates remain. Preserve active owners' separate worktrees, assets,
native inspection/prompting and existing installed launch/settlement dependencies
until their work completes; source retirement is not permission to remove them.

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
- `agent-config/session-backup/test_backup.py` preserves committed WAL history
  while excluding uncommitted writes and leaving the running writer untouched;
  a foreign timer refuses the entire opt-in installation before any write.
  These tests do not prove offsite storage or ledger recovery. The live backup
  must report its exact restic snapshot and successful restored SQLite hashes;
  the full `session-backup/drill.py` must compare canonical Glass accounting
  from isolated restored mounts against a stable finished item's live ledger.
- `agent-config/bin/openrouter-key.test.ts` builds real Git checkouts and a
  linked worktree to exercise R90 versus personal selection, damaged Git
  metadata, invalid-token failure with a usable personal key present, bounded
  stalled pass lookup, and `--which` without decryption (US-028). No real pass
  entry is read by the unit test.
- `omp-config/bin/omp-task-usage.test.ts` checks price-weighted whole-tree cost,
  failed-task inclusion, unknown/unpriced evidence, split-task worker ownership,
  scope escape, malformed archives and content-free reporting (US-018).
- `omp-config/bin/test_omp_engineer.py` covers measured legacy accounting,
  full populated-scope reservations (including lingering helpers), the exact
  20-GiB physical scaling boundary without fictitious legacy/unused-heavy reserves,
  ancestor headroom refusal, hierarchy/oomd failures, serialized admission,
  updater-local PATH isolation and foreground-only terminal recovery. Fake-proc
  cases retain orphan memory in deleted cgroups and refuse opaque native roots
  without blocking on unrelated protected daemons. Fixtures are not real-launch
  overrides.
  Unit and installer gates do not activate user units or prove native loading.
  Live US-043 proof uses native Herdr fresh/exact-session resumed engineers,
  actual kernel leaf controls and Bash child membership, queued-response/owned
  SIGKILL recovery followed by unrepaired same-pane resume, and current-memory
  native admission. The floor refusal is an isolated boundary contract, not a
  claim of physically exhausting the host.
  Keep process/session evidence private and never kill a working engineer to
  repeat it.
- `omp-config/bin/omp-browser-helper.rs` rejects malformed permission, foreign
  or unchanged leaf placement and weakened controls. The display suite executes
  the actual shim in private namespaces to prove denied/stale permission cannot
  execute its target and a blocked launch can be cancelled. These gate journeys
  require an actual caged caller; uncaged CI reports them skipped. They are not
  Chromium-use or OOM-survival proof. Real host proof follows the
  [helper boundary runbook](desktop-memory-guard.md#chromium-helper-boundary--k-20261007-increment).
- Reviewer-family acceptance (US-014; operator rule 2026-09-30) uses a
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
  task description.
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
  `foundation.json` (US-024); `foundation-check.test.ts` covers its catalog,
  ratchet baseline and independent consumer contracts (US-027).
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

Use the shared [`test-audit` skill](../agent-config/skills/test-audit/SKILL.md)
to judge consumer failures and preserve independent contracts without a per-test
ledger. `./scripts/verify` tests working source but clones committed HEAD for
installer checks; smoke changed composition in disposable destinations.

The shared [`story-qa` skill](../agent-config/skills/story-qa/SKILL.md)
requires agents to adversarially review their own work and, for user-facing
changes, manually walk affected request and story criteria through the actual
end-user surface before calling the work done. Docs-only and internal changes
get proportionate owner-path checks; recurring runs rotate broader curated
walks. Its [check-cadence reference](../agent-config/skills/story-qa/check-cadence.md)
tiers migrated repositories by catalog 1.7.0's accepted lean cadence: engineer-run
affected proof, independent review and cheap pre-main scans; one main build with
targeted exact-candidate preprod proof and automatic same-byte promotion; the
complete suite nightly and on demand through the existing owned alert route.
This guidance does not install a scheduler or migrate other repositories.
Keep access, data, migration, privacy, artifact identity and recovery proof on
the candidate path; an unrelated nightly failure is not a blanket shipping veto.

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
CI, without human approval or server-required status checks. Native GitHub owns
settings and merges; the [root release guide](../README.md#contributing-and-releases)
describes the harness route. Retired App/maintainer controllers are not required.

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

## Story deletion replays (US-051)

Commission K-20261002-deletions-that-remove-a-user-story-need was exercised
against two **real public past PRs**, with their original immutable PR heads and
base story registries. These are counterfactual replays, not claims that the
historical PRs were held by this newly built check.

| Case | Exact base → PR head | Observed CLI outcome | Jev receipt |
| --- | --- | --- | --- |
| [Harness #199](https://github.com/misty-step/harness/pull/199): delete automatic OMP turn-end review and weaken its story in the same PR | `3a1a6103b5b4fb36e41b36029e00883c7a1d4f62` → `81b7e347961d8526edae91f7bb74b17fa01856c1` | **hold**, exit **1**, **US-005**; base criterion 5 still requires OMP/Pi extension review and criterion 9 requires the OMP review/key path | Choice `removes`; probability **0.86**, confidence **0.80**; **597 ms**, **31,073** input tokens, **$0.001305066** |
| [Harness #138](https://github.com/misty-step/harness/pull/138): consolidate redundant verification/design guidance | `02a2d69b228ba9d8d583129464f9f798681870a6` → `2690da0c98a8c5a0844828f141a2ab0502e19c03` | **pass**, exit **0**; all **29** base stories selected `preserved`, no approval hold | **462 ms**, **16,501** input tokens, **$0.000693042** |

Both resolved `typesafe/jev-1.13-20260917` through the existing harness
OpenRouter Decisions engine. #199 removes the actual OMP extension and installer
path while retaining Pi and explicit CLI review: retained manual access does
not replace the promised continuous OMP capability. The same PR's story edits
did not hide that loss. #138 folds overlapping prose into retained rules,
without removing the named consumer capabilities.

The provisional confidence ≥0.90 rule missed #199 (`removes` probability 0.87,
confidence 0.80). The admitted rule uses **removal probability ≥0.80**, not
distribution confidence, for escalation. This is calibration on two labeled
cases, **not a holdout accuracy estimate**. Uncertain/service-unavailable results
remain non-blocking and are supplied to the existing independent reviewer.

Working-source installers were also exercised in separate disposable homes:
Pi's installed bundled CLI held #199 (exit 1, 655 ms); OMP's guidance-only
installed bundled CLI passed #138 (exit 0, 494 ms). Neither executable depended
on a sibling source module at runtime. Five actual paid requests, including
the provisional evaluation and installed replays, cost **$0.005301282** total;
dry/unavailable-before-egress attempts incurred no model request.

Raw exact-head records and installation logs were retained in
`~/.cache/tmp/story-deletion-proof.nTggUq/`: `pr-199-live.json`,
`pr-138-live.json`, `replay-summary.json`, `pi-pr-199-installed.json`,
`omp-pr-138-installed.json`, and `installed-summary.json`. The focused consumer
checks exercise same-PR story retirement, replacement, renamed entrypoints,
provider/shape failure, safe egress, and durable review holds. The PR workflow
was validated with `actionlint`; no GitHub workflow run, review publication,
server-setting mutation, or live harness deployment was performed.

Final affected checks: **85 pass, 0 fail**, 458 assertions across the deletion,
engine, review, installer and reference suites; shell syntax and `actionlint`
pass. The broader local offline `env -u CI ./scripts/check all` passed 669 Bun
tests (one optional Landmark binary replay skipped) and nine shared Python tests,
then stopped at nine OMP display-isolation failure cases: missing `/dev/net/tun`
and namespace-boundary assertions. Those display/engineer files were untouched;
the complete gate is **not reported green**, and its committed-HEAD installer
stage was not reached. Working-source disposable installation was proved above.
The first broad invocation inherited `CI=true` without CI's `LANDMARK_BIN`;
the documented local offline invocation corrected that environment, not the test.
Owned disposable homes were removed after inspection; JSON receipts and logs
remain. No live configuration was installed.

### Live rollout (2026-10-03)

[PR #225](https://github.com/misty-step/harness/pull/225) landed normally as
`bca1b7e4574c9aeb323edc2a3e1ddea5480bb433`, after an
[exact-head Gemini 3.8 Flash high review](https://github.com/misty-step/harness/pull/225#pullrequestreview-5398278289)
and [green CI](https://github.com/misty-step/harness/actions/runs/37083880226).
Rebased focused checks passed 106 tests, 547 assertions, and the committed-HEAD
installer walk passed both consumers, including their deployed browser checks.

Real release [PR #224](https://github.com/misty-step/harness/pull/224), head
`e7d844f787e94167cb75b7a0ae3ae5f43e0ebbc7`, automatically triggered the
[live workflow](https://github.com/misty-step/harness/actions/runs/37085461382).
Its exact additions-only proposal returned `skipped`, no model request and no
capability hold. This proves live dispatch and the no-deletion path; paid
loss/preservation behavior is proved by the historical replays above.

The first older-PR event also exposed an adoption-window defect:
[run 37085345651](https://github.com/misty-step/harness/actions/runs/37085345651)
recorded base `c4a47298fde27c502cb80bc683e7b8057f15a261`, which predates the
checker, and failed with `Module not found`. Checker source therefore loads
from the trusted workflow's immutable `github.workflow_sha`; the PR's recorded
base remains Git evidence for the story comparison. Candidate source is never
executed, and no other PR or server setting is changed to repair that failure.

Both real-path installer attempts stopped at the launcher write because
`~/.local/bin` is read-only in the engineer cage. Kaylee subsequently reported
the OMP `cli` component installed from clean `bca1b7e`; that component does not
deploy the shared story checker, Pi review launcher, deletion guidance or
`user-stories` skill. Those use the shared/guide/skill installer selections,
separately from the OMP CLI deployment.


