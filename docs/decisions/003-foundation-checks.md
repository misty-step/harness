# ADR-003: Foundation checks, cadence, and bootstrap

Proposed 2026-09-25 (MIS-150). Pilot repository: Scry. This record becomes
accepted when the operator approves rollout beyond Scry and its change merges.

## Context

Skills do not enforce foundations. Transcripts showed prose mandates ignored:
682 of 686 browser-automation calls ran locally after the exe.dev rule. Checks
that fail do change behavior. The operator approved enforcement by required
checks (2026-09-25). This record defines the checks, how they run cheaply, and
how an existing repository gets from zero to compliant without stalling work:
the chicken-and-egg.

## Checks

All checks use `foundation-check`, which a repository's CI pins to a harness
revision. Deterministic checks are the gate. Jev drafts and advises but never
gates.

| Check | Verifies | Tool | Gate |
| --- | --- | --- | --- |
| Adoption record | `foundation.json` names every Foundation Standard obligation. Unknown or missing ids and a wrong catalog digest reject. `pending` means needs-evidence, never compliance. | `foundation-check check` | required |
| Documents (FND-DOC-001) | Root `README.md`, `DESIGN.md`, `USER_STORIES.md`; ≥1 ADR in `docs/adr/`; a postmortem README or template | `foundation-check check` | required |
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
| A required check cannot be required before it exists and passes, and the PR that adds it would have to pass it | Two steps. The bootstrap PR adds the checks as non-required. After the first green run on master, branch protection adds `foundation` and `story-walk` as required contexts. Scry followed this sequence. |
| Full compliance in one PR is large, and blocking every PR until the repository is compliant stalls work | Ratchet mode, **not built yet**: `foundation-check baseline` and `mode: bootstrap` are future work (decision 2). `foundation.json` carries `mode: bootstrap` and a baseline of the current gaps (missing documents, unmapped stories, unwalked stories), each with an owner and an expiry at most 30 days out. `check` passes only if (1) current gaps are a subset of the baseline, (2) no baseline entry has expired: an expired entry fails until its gap is fixed and the entry removed, and (3) with `--base`, the baseline only shrinks versus the base branch. Adding an entry or moving an expiry later fails unless the PR cites an operator-approved decision record, the same exception authority the Foundation Standard requires. Any story a PR touches must be mapped and walked, so coverage grows where work happens. An empty baseline flips the mode to `enforced`, and a bootstrap repository cannot stay in bootstrap past its latest expiry without an operator decision. |
| No `USER_STORIES.md` | An agent drafts stories in `user-stories` init mode. The operator merges, because only the operator sets intent. This is the one step that needs operator time. |
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
- **Unexercised:** ratchet mode (not built; Scry adopted in one PR) and map drift detection.

## Decision requested

1. Approve the checks and cadence above as the standard for every foundation repository.
2. Approve building ratchet mode (`foundation-check baseline` and `mode: bootstrap`) before the next repository. The candidates are the repositories whose stories already pass `check-stories`: cantrip, central, liminal, pantry, polymorph.
3. Keep Jev for first drafts only. Revisit drift detection when a holdout repository shows area precision ≥ 0.9.
