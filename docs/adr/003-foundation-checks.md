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
| Adoption record | `foundation.json` names every Foundation Standard obligation. Unknown or missing ids and a wrong catalog digest reject. `pending` means needs-evidence, never compliance. | `foundation-check check` | required |
| Documents (FND-DOC-001) | Root `README.md`, `DESIGN.md`, `USER_STORIES.md`; ≥1 ADR in `docs/adr/`; a postmortem README or template. Amended by [ADR-004](004-core-project-documents.md): the checker adopts its core set, surface matrix and stage 1 checks at the next pin bump. | `foundation-check check` | required |
| User stories | Unique ids, a non-empty statement, SHALL criteria, resolvable supersede targets, no TODO text | `check-stories.sh`, via `check` | required |
| Feature map (FND-MAP-001) | Every live story is in ≥1 feature. Every `Source:` glob matches tracked files. Each feature has its four sections. | `foundation-check check` | required |
| Feature map, first draft | Jev decides per (story, source area) whether the area implements the story. Code writes one draft feature per capability. | `feature-map draft` (pilot, source-only) | advisory; reviewed by a human or agent |
| Verification surface (FND-WS-001) | A verify skill with Launch/Doctor/Drive/Evidence/Cleanup; a credential-free `.exe/setup.sh`; a walk runner that emits receipts. Proven by the walk jobs booting the app, not by file presence. | `check` + walk jobs | required |
| Story-walk evidence (FND-WLK-001) | For stories a PR affects: a same-job receipt bound to HEAD and its tree, every numbered criterion of each story passing, artifacts matching digests, nothing `unwalked` | `affected`, repo walk runner, `receipt` | required |
| Full walk | Every live story on master | nightly workflow | owned: opens or updates one issue on failure |

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
| No feature map | `feature-map draft` gives the starting map. On Scry: area precision 0.75, recall 0.87, identical across two runs, 286 questions in 26 calls, 6.8 s. An agent completes the prose, and the deterministic check gates. |
| No walk runner | Baseline stories stay `unwalked` until the repository's runner exists; it is written in the first PR that touches a story. Scry's `qa/walk` is the template. |
| New checker rules could break master | Repositories pin a harness revision. Stricter rules land only through an explicit pin-bump PR, as Scry #194 did for exact criteria. |
| Jev is unavailable in CI | Jev never sits on the required path. |

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

Two steps need an approval the PR author cannot give: a repository's first
user stories, and any baseline extension (a new baseline entry or a later
expiry). The operator delegated both to an agent reviewer on 2026-09-25.

- **Who approves.** Each organisation has one designated agent reviewer, a
  GitHub App identity, written into `foundation-check` itself at the revision a
  repository's CI pins; neither the repository nor a flag can name another. The
  PR author never counts, whoever it is.
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
  and a PR cannot replace it; the PR's commits are read as data, never run.
  Review events cannot trigger it, so after any review action (approve,
  request changes, escalate) the agent reviewer adds or removes a label to
  re-run it; retargeting the base re-runs it too. Residual: a dismissal by
  anyone else leaves the last result until the next trigger, so the agent
  reviewer, which merges, re-runs the gate before merging. It reads the PR's base,
  head, author and reviews through the GitHub API, decides from the PR's own
  revisions whether review is needed, and passes at once when it is not.
- **Designated reviewers (2026-09-25).** misty-step: `kaylee-agent[bot]` (App
  4978618). r90group: none yet. `kaylee-agent` is private to misty-step and
  cannot be installed there. r90group Apps installed with pull-request write
  access include `vulcan-agent` (all repositories) and
  `olympus-eval-verifier-r90` (selected repositories), with no key found in the
  workstation pass inventory, project env files, `~/.config` or Hermes profiles
  (their own deployments were not checked), and `nopalito-agent` and `iron-forest`, with keys here but already
  a PR author and the workload token issuer. Until one is designated, r90group
  PRs that need review fail the advisory gate.

## Enforcement by plan

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
