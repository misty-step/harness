# ADR-003: Foundation checks, cadence, and bootstrap

Accepted 2026-09-25 (MIS-150): the operator approved all three decisions below,
relayed by Kaylee, with two changes to who approves (see Review authority).
Pilot repository: Scry.

## Context

Skills do not enforce foundations. Transcripts showed prose mandates ignored:
682 of 686 browser-automation calls ran locally after the exe.dev rule. Checks
that fail do change behavior. The operator approved enforcement by required
checks (2026-09-25). This record defines the checks, how they run cheaply, how
an existing repository gets from zero to compliant without stalling work (the
chicken-and-egg), and who may approve the steps an agent cannot self-approve.

## Checks

All checks use `foundation-check`, which a repository's CI pins to a harness
revision. Deterministic checks are the gate. Jev drafts and advises but never
gates. CI runs the pinned checker from its own directory with `--repo` pointing
at the checkout, never with the checkout as Bun's working directory: Bun loads a
`bunfig.toml` preload from there, which a PR could use to skip the gate.

| Check | Verifies | Tool | Gate |
| --- | --- | --- | --- |
| Adoption record | `foundation.json` names every Foundation Standard obligation. Unknown or missing ids and a wrong catalog digest reject. Under [ADR-006](006-foundation-decisions.md) and catalog 1.5.0, applicable `pending` items have dated `obl:` gaps (ADR-005's `ops:` keys remain), `satisfied` needs a candidate-bound payload receipt, and `not_applicable`/`exception` need a matching approval record. | `foundation-check check` | required |
| Documents (FND-DOC-001) | [ADR-004](004-core-project-documents.md) stage 1: root README, AGENTS, DOMAIN ledger and USER_STORIES plus surface-specific files, aliases, references, ADR integrity, and executable `scripts/check`; no ADR count or postmortem template. | `foundation-check check` | required |
| User stories | Unique ids, a non-empty statement, SHALL criteria, resolvable supersede targets, no TODO text | `check-stories.sh`, via `check` | required |
| Feature map (FND-MAP-001) | Every live story is in ≥1 feature. Every `Source:` glob matches tracked files. Each feature has its four sections. | `foundation-check check` | required |
| Feature map, first draft | Jev decides per (story, source area) whether the area implements the story. Code writes one draft feature per capability. | `feature-map draft` (pilot, source-only) | advisory; reviewed by a human or agent |
| Verification surface (FND-WS-001) | A verify skill with Launch/Doctor/Drive/Evidence/Cleanup; a credential-free `.exe/setup.sh`; a walk runner that emits receipts. Proven by the walk jobs booting the app, not by file presence. | `check` + walk jobs | required |
| Story-walk evidence (FND-WLK-001) | For stories a PR affects: a same-job receipt bound to HEAD and its tree, every numbered criterion of each walked story passing, artifacts matching digests. A story with no walk yet (a valid `walk:` baseline entry) may be `unwalked`: the receipt reports it as advisory and passes, affected or not (operator decision 2026-09-26). A walk that ran and failed, or an `unwalked` story without an entry, fails. The repository's walk runner reports what it could not walk as `unwalked` and exits non-zero only when a walk failed or it crashed; the receipt is the judge. | `affected`, repo walk runner, `receipt` | required |
| Full walk | Every live story on master | nightly workflow | owned: opens or updates one issue on failure |
| Operations (FND-REL-001, FND-ALR-001, FND-INC-001) | Added by [ADR-005](005-operational-obligations.md): every application ships on green to every non-excluded tenant, alerts loudly and closes incident classes, with no exception. Each one still pending is the gap `ops:ship`, `ops:alert` or `ops:incident`; a `satisfied` claim must name its ship job and tenancy, alerting and runbook, which the checker verifies structurally; the receipt proves the live tenant fan-out. | `foundation-check check` | required |
| Independent review, security and story citation (FND-REV-001, FND-SEC-001, FND-CIT-001) | [ADR-006](006-foundation-decisions.md): an independent reviewer approves the head, the gate scans secrets and safely merges bot updates on green, applications test authorization, and mapped-source PRs cite affected stories. File and review metadata checks are structural; receipts show actual execution and judgement. | `foundation-check check` + `review` | required |

## Cadence

- **Local pre-push hook (sub-second).** Runs `foundation-check check` and prints the stories required CI will walk, with the `ws run` command. Nothing heavy runs on the desktop. Measured on Scry: 74 ms.
- **PR CI (minutes, required).**
  - `foundation`: structural. Scry: 7–8 s.
  - `story-walk`: affected stories only. Scry: about 1 min including setup.
  - The repository's own gate is unchanged.
- **Nightly (owned).** Full walk and receipt with 30-day retention, plus a failure issue. Scry's first run: 11/11 walked, receipt PASS, about 1 min of walking.
- **On demand.** The full host gate runs on the project VM via `ws run -- <gate>`. Scry: 56 s.

## Bootstrap: solving the chicken-and-egg

| Problem | Resolution |
| --- | --- |
| A required check cannot be required before it exists and passes, and the PR that adds it would have to pass it | Two steps. The bootstrap PR adds the checks as non-required. After the first green run on master, branch protection adds `foundation` and `story-walk` as required contexts. Scry followed this sequence. Repositories that cannot have branch protection run the checks as advisory (see Enforcement by plan). |
| Full compliance in one PR is large, and blocking every PR until the repository is compliant stalls work | Ratchet mode (US-027). `foundation-check baseline --owner NAME --write` records the current gaps as a bootstrap baseline, with or without an existing `foundation.json`: missing documents (`doc:`), story format (`stories:format`), map gaps (`map:`), the verify skill (`skill:verify`), and one `walk:US-nnn` per live story. Each entry has an owner and an expiry at most 30 days out. `check` passes only if (1) every current gap has an unexpired entry, (2) no entry has expired or outlived its gap: an expired entry fails until its gap is fixed and the entry removed, and (3) with `--base`, the baseline only shrinks versus the base branch. A new entry or a later expiry fails unless the PR adds a `foundation/extensions/` record (reason, gap, expiry) that the designated agent reviewer approves (see Review authority). A story the PR edits must be mapped, and a change's receipt accepts `unwalked` only for mapped, unaffected stories with an unexpired walk entry (an unmapped story's impact is unknown, so it is walked), so coverage grows where work happens. An empty baseline means mode `enforced`, and a bootstrap repository cannot stay in bootstrap past its latest expiry without an approved extension. |
| No `USER_STORIES.md` | An agent drafts stories in `user-stories` init mode. The designated agent reviewer, not the operator, approves the PR that first adds them (see Review authority). |
| The review gate only judges PRs once it is on the base branch (`pull_request_target` runs the base copy) | The adoption PR adds `foundation-review.yml` and nothing that needs review: no first stories and no extension record. First stories and extensions follow in later PRs, once the gate is on the default branch; on misty-step it becomes a required check with the others. |
| No feature map | `feature-map draft` gives the starting map. Feature files added by the change that first creates it (no `features/` files at all at the merge base) mark no story, since adding the map changes no behaviour; changed source and edited stories still do, and once any map file exists every touched feature file counts. So the adoption PR can map every story while unwalked ones stay under their `walk:` entries. On Scry: area precision 0.75, recall 0.87, identical across two runs, 286 questions in 26 calls, 6.8 s. An agent completes the prose, and the deterministic check gates. |
| No walk runner | Baseline stories stay `unwalked`, reported as advisory, until the repository's runner walks them or their `walk:` entry expires; unrelated PRs are never blocked by a story nobody can walk yet. Scry's `qa/walk` is the template. |
| New checker rules could break master | Repositories pin a harness revision. Stricter rules land only through an explicit pin-bump PR, as Scry #194 did for exact criteria. |
| Jev is unavailable in CI | Jev never sits on the required path. |

At catalog 1.5.0, a first adoption declares `--surfaces` explicitly, and
every applicable pending non-ADR-005 obligation also has a dated `obl:` gap.
FND-REV-001's independent review applies to every subsequent PR, even when
none of the five designated-review triggers below fires (ADR-006).

## Pilot evidence (Scry)

- **#193:** adoption. Map, ADRs, bootstrap, `qa/walk`, and required `foundation` and `story-walk` checks; 11/11 stories walked.
- **#194:** receipts must report exactly each story's numbered criteria.
- **#195:** Scry's host gate runs on the `scry-ws` workspace.
- **#196:** nightly full walk (run 36163081879: 11/11, receipt PASS) and a 74 ms pre-push hook.
- **#197:** failure-response drill. Runs 36165254989 and 36165310785 failed on purpose: the first created issue #198, the second commented on it with no duplicate, and #198 was closed as a drill.
- **Jev map pilot** (`feature-map`, results `~/.cache/tmp/feature-map-pilot-results-20260925.json`):
  - Micro precision 0.754, recall 0.867. Capability-level grouping agreement 0.655 (partly the deterministic one-feature-per-capability rule). Run-to-run agreement 11/11.
  - The threshold (0.20) was calibrated on Scry itself, so this is not a holdout result.
  - Misses include CLI wiring the reference counts (`cmd/scry/main.go` for US-004) and an offline eval runner Jev wrongly included.
- **Unexercised on a real repository:** ratchet mode (built with fixture tests; wave one is its first real use) and map drift detection.

## Review authority

The authority decisions describe the historical adoption rollout. Their records
remain the foundation checker's diagnostic contract, including the repaired
image/binary path below, not today's server merge policy. The uniform 2026-09-30
amendment supersedes the plan- and owner-specific server gates.

Three steps need an approval the PR author cannot give: a repository's first
user stories, any baseline extension (a new baseline entry or a later expiry),
and declaring that an application's record is not an application, which drops
its ADR-005 obligations. The operator delegated both to an agent reviewer on 2026-09-25.
ADR-006 (2026-09-26) adds two more: a change to a repository's `DOMAIN.md`
invariants ledger, and a `not_applicable` or `exception` disposition, whose
`foundation-approval/1` record the designated reviewer approves. Both take
effect with the catalog and checker change that cites ADR-006.

- **Who approves.** Each organisation has one designated reviewer, written into
  `foundation-check` itself at the revision a repository's CI pins; neither the
  repository nor a flag can name another. Where it is a GitHub App (misty-step),
  the PR author never counts, whoever it is. Where the organisation has no
  reviewer App (r90group), the decision is recorded instead; see Designated
  reviewers.
- **What counts.** An approving GitHub review on the PR's head commit from that
  App, read by CI through the GitHub API. Text in the repository grants no
  authority, per the Foundation Standard. The App is the only identity CI
  trusts: agent sessions also act under the operator's GitHub account, so an
  approval from that account cannot show who gave it, and it never counts.
- **First stories.** The PR in which `USER_STORIES.md` gains its first stories
  needs that approval; a placeholder file with no stories counts as none. Later
  changes to a story's intent stay with the operator.
- **Baseline extensions.** The PR adds a decision record naming each extended
  entry, its new expiry, and the reason; the same approval makes it valid.
- **Escalation.** The agent reviewer approves on its own authority, then merges
  the PR through its existing process (Kaylee's factory merges as
  `app/kaylee-agent` on misty-step), unless the change is a real change in
  product direction. Then it does not approve: it leaves a review on the head
  commit marked `foundation-escalation: product-direction` and asks the operator
  through its usual channel. The operator's answer clears the escalation only as
  a later approving review from the same App, on the head, that records the
  decision and opens with `foundation-escalation: resolved` as its exact first
  line, so quoted PR text below it or behind markup cannot count; an earlier or
  routine approval does not. CI authenticates the App, not the operator: the decision is
  a process step the agent reviewer records (operator choice, 2026-09-25, after
  the first drill showed an escalated PR authored under the operator's account
  could never pass when only that account's approval counted).
- **Gate.** `foundation-check review --pr N` runs as the `foundation-review`
  workflow (template: `agent-config/skills/foundation/foundation-review.yml`)
  on `pull_request_target`, so the base branch's copy of the gate judges every PR
  and a PR cannot replace it. The job checks out only the base branch and fetches
  the PR's commits as git objects, so none of the PR's files are checked out or
  run (a static-analysis rule flagged the earlier head checkout, 2026-09-25).
  Review events cannot trigger it, so after any review action (approve,
  request changes, escalate) the agent reviewer adds or removes a label to
  re-run it; retargeting the base re-runs it too. Residual: a dismissal by
  anyone else leaves the last result until the next trigger, so the agent
  reviewer, which merges, re-runs the gate before merging. It reads the PR's base,
  head, author and reviews through the GitHub API, decides from the PR's own
  revisions whether review is needed, and passes at once when it is not.
- **Designated reviewers (2026-09-25).**
  - misty-step: `kaylee-agent[bot]` (App 4978618), as above.
  - r90group: no reviewer App (operator decision, 2026-09-25). Agents act as the
    operator's user `moomooskycow` there, so the agent reviewer records its
    decision as a review or comment from that user whose exact first line is
    `foundation-review: approved <head sha>`. An escalation is such an entry
    whose first line is `foundation-escalation: product-direction`; only a later
    entry whose first line is `foundation-escalation: resolved <head sha>`
    clears it (strictly later by timestamp, so a tie stays escalated; pending
    reviews record nothing), and Kaylee records the operator's decision that way. Every marker
    must be a first line because the shared account writes much other text, and
    a decision names its head because a comment is not tied to a commit. The
    record shows what was decided, not who decided it: CI cannot tell the author
    from the reviewer there, which is why r90group's checks stay advisory.
  - `kaylee-agent` could not serve r90group: it is private to misty-step, and its
    organization-level permissions would apply to all of r90group whatever
    repositories were selected.
- **Independent review by the agent reviewer (2026-09-29).** Operator rule of
  2026-09-28: model review plus green CI is the gate; no human approval gates a
  pull request. Agents author under the operator's account, so FND-REV-001's
  approval "from someone other than the author" needs another identity. On
  misty-step that identity is the designated reviewer `kaylee-agent[bot]`: the
  reviewing agent runs `agent-review --repo misty-step/NAME --pr N`
  (`agent-config/bin/agent-review.ts`, under `pass-env` with
  `KAYLEE_GITHUB_APP_ID` and `KAYLEE_GITHUB_APP_PEM`). A fresh Sonnet 5.5 high
  process sees the PR title, description, immutable diff and any complete vision
  inspections and returns a JSON verdict. Both model processes use a disposable
  supported OMP config with fallback disabled and selected model/effort/provider-
  wildcard/default/reviewer chains empty; native completed response identities
  must match their selected models and end successfully without fallback. The
  App approves the exact head when it is `correct` with no priority 0 or 1
  finding, else requests changes, then toggles the `agent-reviewed` label so the
  base branch's `foundation-review` re-runs. A model failure, an unusable
  verdict, an oversized diff (a partial diff is not a review), a head that moved
  during the review, or a PR the App authored posts nothing: no approval is ever
  a fallback. In an organisation with a reviewer App, FND-REV-001 now counts only
  that App's approval of the head: another person's approval does not, and the
  latest explicit change request or dismissal stands in its own review stream.
  A dismissed model record never revives an older approval. What the gate trusts
  is that approval, and
  so the reviewer's judgement of the title, description and diff alone; a
  persuasive PR can sway a model, and the approval says nothing about code the
  diff does not show. CodeRabbit is advisory everywhere: it reports `success` even when it
  reviewed nothing (rate limited or skipped on 49 of 119 recent merged heads,
  2026-09-29), so it never gates. r90group has no reviewer App and free-plan
  private repositories cannot enforce rules, so its checks stay advisory and
  `agent-review` refuses it. GitHub keeps an approval on a head after the PR is
  retargeted, edited or its base moved, so the review records the base, the merge
  base, and a hash of the title and of the description the model judged
  (`agent-review-state:` line) and the gate, which re-runs on `edited`, refuses an
  App approval that names a different one. The diff is the head against the
  merge base, so the head and merge base together cover it. Every PR, a
  designated-review trigger included, needs that record. The record and the
  designated approval are two streams from one identity: a review carrying the
  record is the model review and never the designated decision (or one automatic
  approval would satisfy both), a designated approval never stands in for the
  model review, and the App's later change request overrules the record. A bare
  App approval is not a model review. `agent-review` also refuses to post if any
  of these changed during its own review, and exits 4 when the review is
  recorded but the gate could not be re-run, because review events cannot
  trigger it and the old check result would keep standing. Its model processes
  run with `--no-tools` (an empty `--tools` list may read as unset) and no
  session. The description it binds to leaves out the release-notes block
  CodeRabbit writes into it as it reviews (a review that voided itself whenever
  CodeRabbit ran was observed on this repo's own PR); text an author hides inside
  such a marker would escape the binding, which the description does not warrant
  a stricter rule for. r90group ordinary PRs never had an independent-approver
  check, since the recorded-decision path returns first, and that is unchanged.

  Content a text model cannot read: classification comes from immutable Git raw
  entry modes/object IDs and blob-based root numstats, not diff text. NUL records
  preserve quoted/tab paths, rename-only images and opaque files, and regular text
  replacing a gitlink. Ordinary text beginning `Subproject commit` is not a pointer.
  The two standalone launchers retain this same contract independently because
  the installer does not allow launcher-to-launcher imports.

  PNG, JPEG, GIF and WebP head blobs (at most six of at most 5 MB) are read by the
  vision role (Opus, `anthropic/claude-opus-5-5` high) in a separate no-tools
  process on the attached blob bytes. Neither a mutable PR file list nor a
  temporary A → B → A push can substitute another image, and discovery has no
  PR-file pagination limit. Its complete written inspection reaches the reviewer
  as untrusted data; a vision failure, mismatched native identity, fallback,
  incomplete response or inspection over 20,000 characters posts nothing, never
  a cut-short account. The review body names only the images actually inspected.

  Gitlink pointers and other binaries (fonts, archives, wasm) have no native
  content review surface. An opaque-only PR still receives a model review of its
  description and immutable pointer/blob metadata. A clean verdict posts a
  `COMMENT` carrying the exact head/state record and the marker
  `agent-review-scope: metadata-only`; it disclaims opaque byte/submodule inspection.
  A defect posts `REQUEST_CHANGES` and remains blocking. The checker reports
  content advisory only after a clean current metadata record: a missing, stale
  or dismissed record or later explicit blocking decision fails, never waiving
  defects. A metadata-only comment cannot approve inspectable text/images or
  supply a separate designated decision. Mixed opaque/reviewable changes still
  refuse with exit 3 and must be split.

## Enforcement by plan

**Historical and superseded.** This describes the adoption rollout, not current
merge policy. The amendment below supersedes both owners' server-required gates.

- **misty-step:** `foundation` and `story-walk` become required checks after
  the first green run on master, as on Scry.
- **r90group:** stays on GitHub's free plan (operator decision 2026-09-25).
  Private repositories there cannot have branch protection or rulesets, so the
  same jobs run as advisory: they run on every PR, fail visibly, and the nightly
  failure issue stays owned, but no check is required.

## Decisions (2026-09-25)

1. Approved: the checks and cadence above are the standard for every foundation repository.
2. Approved: build ratchet mode (`foundation-check baseline` and `mode: bootstrap`) next. Wave one of the rollout census (Tach, Habitat, Nopalito in `r90group/infrastructure`, Linejam, Sploot) is the first proof.
3. Approved: Jev drafts first maps only. Revisit drift detection when a holdout repository shows area precision ≥ 0.9.
4. Operator changes: the designated agent reviewer, not the operator, approves first user stories and baseline extensions, escalating only a real change in product direction.

## Uniform merge-policy amendment (2026-09-30)

The operator's rule is uniform across **misty-step, r90group and moomooskycow**:
agents merge normally, without `--admin`, after independent model review,
green checks and the affected real product/CLI flow. Human approval and
server-required CI are not merge gates. Removing those GitHub settings does not
make review or verification optional, erase an explicit change request, or
permit an approval to claim image/opaque inspection that never happened.

There is no plan upgrade and no per-repository exemption. Use GitHub's supported
branch-protection/ruleset settings to remove the gates instead of building a new
reviewer App or permission workaround. A platform response requiring GitHub Pro
or a public repository is recorded as unsupported enforcement, not a policy
waiver; the same agent review, green-check and real-flow procedure still applies.
Credentials are not rotated or revoked by this cutover.

Historical `--admin` merges
[#137](https://github.com/misty-step/harness/pull/137),
[#138](https://github.com/misty-step/harness/pull/138) and
[#169](https://github.com/misty-step/harness/pull/169) are not precedents.
[#173](https://github.com/misty-step/harness/pull/173) records that #169 merged
with the App's changes requested still outstanding. The binary/image repair
requires a new exact-head independent review and real Scry proofs; this amendment
does not retroactively clear those findings.

### Settings census and cutover (2026-10-01)

The ticket owner's recorded census covered **349 repositories**: misty-step 128,
r90group 54 and moomooskycow 167; 116 were unarchived. Before the cutover there
were 65 classic protection rules and nine rulesets. Positive approval counts
appeared only on archived `gradient` (`master`) and `gradient-quarantine`
(`main`/`master`); live roots had required status checks including
`foundation-review` and workflows operating under the shared author identity.

The settings cutover removed 87 classic subrules (60 required-status and 27
review subrules) and deleted eight gate-only rulesets. `exocortex` retains its
deletion and non-fast-forward protections. Fifty-three archived repositories
were temporarily unarchived to apply the supported settings and restored:
the final archive states did not differ.

The after-census recorded zero classic approval/status blockers and zero gate
rulesets. Eighty private repositories returned the explicit GitHub Pro/public
403 (51 r90group, 29 personal); those unsupported capabilities are not exemptions.
The `includes_parents=true` endpoints disclosed no inherited organisation rule.
Settings evidence is separate from execution proof: source checks, exact-head
model review and normal live merges own the latter.
