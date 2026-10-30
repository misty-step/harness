---
id: kernel-trial-2026-10-28
date: "2026-10-28"
title: "Kernel trial: six replayed factory tasks"
status: reported
sourceRevision: "e1ac0c21163b552a7670b754d92118772344322c"
taskCount: 6
harness: "OMP 18.13.3"
model: "openai-codex/gpt-6.1-sol"
thinking: high
judge: "anthropic/claude-opus-5-5, high; one independent blinded pass"
arms:
  - id: A
    label: Current guidance
    oraclePassed: 4
    oracleTotal: 6
    meanBlindScore: 14.33
    tokens: 13546907
  - id: B
    label: Mistystack kernel
    oraclePassed: 5
    oracleTotal: 6
    meanBlindScore: 15.17
    tokens: 12439199
  - id: C
    label: No injected guidance
    oraclePassed: 2
    oracleTotal: 6
    meanBlindScore: 13.67
    tokens: 11832545
limits:
  - "One run per task and arm; directional, not statistically conclusive superiority."
  - "9 of 18 observations reached the 720-second administrative cap; artifact Oracles were observed, natural completion was not."
  - "The no-injected-guidance control still read checked-in repository AGENTS.md and verification skill source."
  - "Five of six tasks come from mistystack; three exercise the same dispatcher."
  - "Raw transcripts, candidate patches, Oracle outputs and judge artifacts remain private local files; the run-record source review is private too."
  - "Oracle compatibility repairs, a stopped-allowlist specification mismatch and judge errata are disclosed in the report; raw scores are retained."
  - "Successive cohorts and variable shared-host load prevent clean causal wall-time or cap comparisons."
methodologyPath: "skills/misty/playbooks/eval.md"
evidence:
  - url: "https://github.com/misty-step/mistystack/issues/533#issuecomment-6476093437"
    label: "Public closing report: aggregate measurements and limitations"
    visibility: public
  - url: "https://github.com/misty-step/mistystack/pull/535#issuecomment-6455597212"
    label: "Public carry-bases correction ruling, not a trial artifact"
    visibility: public
  - url: "https://github.com/misty-step/mistystack/pull/564#issuecomment-6460743289"
    label: "Public live-result fix summary, not a trial artifact"
    visibility: public
  - url: "https://github.com/misty-step/mistystack/pull/555#issuecomment-6459384208"
    label: "Public optional-config correction ruling, not a trial artifact"
    visibility: public
  - url: "https://github.com/misty-step/mistystack/pull/548#issuecomment-6457993878"
    label: "Public stopped-allowlist predecessor failure, not a trial artifact"
    visibility: public
  - url: "https://github.com/misty-step/mistystack/pull/559#issuecomment-6459191376"
    label: "Public selected-reads transport correction, not a trial artifact"
    visibility: public
  - url: "https://github.com/misty-step/evals/pull/6#issuecomment-6470560464"
    label: "Private run-record source review; repository access required"
    visibility: private
---

# Kernel trial: six replayed factory tasks

**Reported measurement, directional only.** On these six replayed tasks, the
Mistystack arm passed 5/6 independent artifact Oracles, current guidance passed
4/6, and no injected guidance passed 2/6. Nine of the eighteen observations hit
the 720-second cap. The control still read repository instructions, and the tasks
are clustered. This is not a statistically conclusive superiority claim.

The public source is the
[#533 closing comment, 2026-10-28 at 17:34:20Z](https://github.com/misty-step/mistystack/issues/533#issuecomment-6476093437).
This record imports the accompanying private `report-A-B-C.txt` and
`report-A-B-C.json`, with their recorded inventories and judge errata. It is not
an independent rerun. Measurements and task observations below are reported from
those artifacts; interpretation is identified separately.

## Results

The denominator is six scheduled, scored task observations per arm, including
clock-capped observations whose resulting patches were independently checked.
Scores are the original blind scores out of 20, rounded to two decimals only in
the aggregate. Completion components for capped runs remain provisional.

| Arm | Guidance | Artifact Oracle passes | Mean blind score /20 | Total tokens | Clock-capped runs |
| --- | --- | --- | ---: | ---: | --- |
| A | Frozen current instructions and installed skills | 4/6 | 14.33 | 13,546,907 | 4/6 |
| B | Frozen Mistystack core and skills | 5/6 | 15.17 | 12,439,199 | 3/6 |
| C | No injected/global instructions, rules or skills | 2/6 | 13.67 | 11,832,545 | 2/6 |

The closing comment rounds token totals to 13.5M / 12.4M / 11.8M. These are sums
of the recorded input, output, cache-read and cache-write token counters, not
unique source tokens or output tokens alone. Candidate requests used an OAuth
subscription: incremental API cash spend was reported as zero, but account quota
was consumed. Provider catalog-dollar telemetry is not an invoice or a claim
that the work was free. Judge usage is separate from the arm totals.

For transparency, excluding capped observations leaves different task sets:

| Arm | Uncensored observations | Oracle passes among them | Mean blind score /20 |
| --- | ---: | --- | ---: |
| A | 2 | 1/2 | 15.00 |
| B | 3 | 3/3 | 16.67 |
| C | 4 | 1/4 | 15.00 |

Only `carry-bases` and `run-record` are uncensored in every arm. On that common
pair, Oracle passes are A 1/2, B 2/2, C 0/2, with mean scores 15.00 / 16.00 /
13.00. Neither this two-task subset nor unequal uncensored subsets establish a
general effect; they do not replace the six-task denominators above.

## Source revision boundaries

The frontmatter `sourceRevision` identifies **arm B's guidance snapshot**, not a
common task base, this site's build revision or a deployed release.
`plugin-inventory.json` records HEAD
`e1ac0c21163b552a7670b754d92118772344322c` from the `trial-b` worktree, captured at
`2026-10-28T16:31:02Z`, with 79 files and per-file hashes. The runner copied the
snapshot's `skills/` and `rules/core.md` into isolated runtime state; this trial
was not an end-to-end native plugin installation trial. The inventory's recorded
HEAD and file hashes are the provenance boundary, not a claim that the current
repository or later adapters were evaluated.

Arm A is a live-instruction/skill snapshot, not one Git revision.
`current-inventory.json` records its capture at `2026-10-28T15:13:19Z`, including
the global `AGENTS.md` and both installed skill trees. That AGENTS snapshot has
SHA-256 `d76f8a6f135ab0b62b40ff945c539040d89b2231a46886d77ddf12ff2bd54287`.
Automatic project-context injection was disabled. A's exact frozen standing text
was appended as a system segment, which differs from live native injection.
Repository files were nevertheless present and available for manual reads in
every arm: C actually read checked-in `AGENTS.md` and verification skill source.
Thus C means **no injected guidance**, not a pure no-guidance control.

Each task has its own replay base. These are the commissioned failing heads,
not necessarily the original PR target branches. The accepted historical fixes
provided Oracle-calibration references; candidates did not start from them.
Several paths still use the former `agent-config/` layout because that is the
historical source being replayed. Later harness policy in
[ADR 0016](../decisions/0016-harness-agnostic.md) does not retroactively broaden
this trial beyond OMP or prove Claude Code, Codex, pi, Grok Bot or Hermes loading.

## The six tasks

Public links in this table establish the real failure or correction used to
select a task. They are **not** public candidate transcripts, replay patches or
Oracle outputs. `misty-step/evals` is private; its review is not presented as a
public artifact.

| Task | Repository | Replay base | Accepted historical fix / Oracle reference | Public task-selection evidence |
| --- | --- | --- | --- | --- |
| `carry-bases` | `misty-step/mistystack` | `82fa48562ade66ad428f5079bb8527f9cb288951` | `7cf32f709e0e68d95ab3714bde3ac05d5b3d2b53` | [PR #535 correction ruling](https://github.com/misty-step/mistystack/pull/535#issuecomment-6455597212) |
| `live-result` | `misty-step/mistystack` | `e7ddbf73247824fa06c738b0440fcd528a201053` | `f29d4e149033b8a55b9357e95d78b2777013552f` | [PR #564 fix summary](https://github.com/misty-step/mistystack/pull/564#issuecomment-6460743289) |
| `optional-config` | `misty-step/mistystack` | `3f015bd3546619371621695049bbf8557b560fa4` | `310db393fc24ed86baf4fb4bf99e038befa7e51b` | [PR #555 correction ruling](https://github.com/misty-step/mistystack/pull/555#issuecomment-6459384208) |
| `run-record` | `misty-step/evals` (private) | `6fc317dce8905c00fca88733d72d9ffcace606b2` | `925a5b41315e81dc49f08ac57804678980834bd4` | None published; private PR #6 review retained |
| `stopped-allowlist` | `misty-step/mistystack` | `c2d219c8c241dea34b1df9b97ede00155665831c` | `7403332584c59d3fa85ec920b876bbcd949350cd` | [PR #548 predecessor failure and split](https://github.com/misty-step/mistystack/pull/548#issuecomment-6457993878) |
| `selected-reads` | `misty-step/mistystack` | `42b2ac3a331899653081867df2f322d0cd465568` | `c7a01cd28de5efab3bbe952e024a5b96f21b205b` | [PR #559 transport correction](https://github.com/misty-step/mistystack/pull/559#issuecomment-6459191376) |

The original factory briefs, prompt hashes, dispatch metadata and recovered
session headers remain in the private control artifacts. Recorded task timestamps
are dispatch/run-metadata timestamps, not asserted user-keystroke times.

## Per-task observations

Each cell gives strict artifact Oracle result and raw blind score /20.
**Capped** means observation ended administratively; it is not a claim that the
agent naturally finished or that the Oracle failed.

| Task | A: current | B: Mistystack | C: no injected guidance |
| --- | --- | --- | --- |
| `carry-bases` | FAIL · 13 | PASS · 15 | FAIL · 13 |
| `live-result` | PASS · 16 · capped | PASS · 18 | PASS · 17 |
| `optional-config` | PASS · 14 · capped | PASS · 13 · capped | PASS · 13 · capped |
| `run-record` | PASS · 17 | PASS · 17 | FAIL · 13 |
| `stopped-allowlist` | FAIL · 12 · capped | FAIL · 12 · capped | FAIL · 17 |
| `selected-reads` | PASS · 14 · capped | PASS · 16 · capped | FAIL · 9 · capped |

- **Carry bases — data fidelity and regression.** The correction binds a
  ship-loop carry to the ledger's recorded old base and the PR's real target
  base, without losing accepted retry idempotence. B passed 25/25 checks by
  retaining exact accepted retries as no-ops. A and C passed 24/25 but rejected
  an identical retry after a squash-merged parent moved the recorded base. This
  is the task where B uniquely preserved the existing retry contract.
- **Live result — regression and byte fidelity.** A prior atomic-publication fix
  still lost real Boat diagnostics because its stand-in modeled the wrong
  protocol. All arms passed the maintained 26-case lifecycle suite, including
  failure without partial report publication and byte-identical 168-byte success
  output. A reached the cap. Its base-gate fixture leaked a Git commit into the
  source checkout and was repaired by the candidate; B had a gitdir-pointer
  exposure that the judge could not establish was harmless. Fixture success is
  not live Boat proof.
- **Optional config — regression and scope preservation.** An absent optional
  Hermes key must not stop boundary restoration or swallow unrelated errors.
  All arms passed the maintained 11-case installer suite, but all were capped
  and none completed the required native Hermes readback. A covered more
  boundary values in its regression; B's assertions were narrower. B also
  repaired an unintended source-checkout commit with manual Git-file changes;
  C initially wrote owned tool fixtures outside its prescribed HOME and moved
  them. An artifact Oracle pass does not close those native-proof or authority
  obligations.
- **Run record — finish the work and scope cleanup.** This replays the complete
  first-round review, including required record fields, removed idle-probe
  behavior, accepted secret-reference forms and phone rendering, rather than a
  narrower later fix. A and B passed the independent checks and fault probes;
  C wrongly required a `pass:` prefix and rejected an otherwise legitimate
  secret reference. The recorded table widths in a 358px content area were
  A 229px, B 355px and C 261px: fitting on a phone did not establish data
  correctness. The review is private, and these measurements are imported, not
  newly exercised here.
- **Stopped allowlist — regression and fidelity.** All three strict Oracles
  failed. The merged suite requires exact minimal per-command result/log path
  sets, stronger than #553's present-allowlisted-files criterion. C's failures
  were confined to that mismatch; its fail-closed and transfer contracts
  passed. A also accepted an empty listed exit-code as finished; B had that
  defect plus weaker invalid-tree validation. A separate twelve-case direct
  #553 probe passed across A/B/C after judge launch. It supplements, never
  replaces, the raw scored suite or the genuine A/B failures. Excusing the
  subset-only mismatch would make C 3/6; this report retains strict C 2/6 and
  unchanged scores. No real-factory collection or deletion is proved here.
- **Selected reads — regression and local completion.** Narrow extraction still
  downloaded entire snapshots; the task required a selected-file network
  boundary while preserving errors and retention. A and B passed 29/29 checks.
  C omitted `/api/v1` from its snapshot request path and failed 25/29 with 404s.
  All arms were capped. B's recorded synthetic HTTP response sizes fell from
  10,000,157 bytes at base to 23–157 bytes; these are localhost payload
  measurements, not live Boat wire-byte measurements. A repaired another
  leaked fixture commit. C moved an out-of-workspace CLI download. B edited
  the Landmark-generated changelog during the replay, which the judge flagged
  as a release-protection risk; importing this record does not repeat that edit.

## Method

The maintained [eval playbook](../../skills/misty/playbooks/eval.md) describes the
kernel comparison. This particular trial's private `rubric.json` records its
rubric as frozen before candidate runs. The recovered full historical prompts
were replayed against recoverable bases with independent Oracles; no genuine
duplicate-data case qualified. Scope/finish coverage includes a reviewer's
REQUEST CHANGES as a proxy, not an invented direct user correction. Available
Serenity-only cases were insufficient, so factory briefs and PR ledgers were
authorized as task sources.

Each task/arm used a fresh OMP session, disposable checkout and HOME, the same
historical prompt, candidate model `openai-codex/gpt-6.1-sol`, `high` thinking,
tools (`read`, `bash`, `edit`, `write`, `glob`, `grep`, `eval`) and 720-second
administrative limit. The common authority boundary forbade source commits,
publishing, live systems and credentials. No paid model/search tools or
mixed-family helpers were supplied to candidates. Actual boundary violations
are disclosed above rather than erased by later repair. Original historical
publishing clauses were not exercised.

The outside artifact Oracles were:

| Task | Recorded Oracle |
| --- | --- |
| `carry-bases` | `bun test --timeout 30000 agent-config/skills/ship-loop/scripts/` |
| `live-result` | Maintained `agent-config/chief/worker/boat/test_pipeline.py` through the private Darwin compatibility launcher |
| `optional-config` | `python3 -B -m unittest discover -s agent-config/chief -p test_install_kaylee.py -v` |
| `run-record` | `bun test ./src/`; `bun src/runs.ts --check`; `./scripts/check`, supplemented by recorded fault and phone probes |
| `stopped-allowlist` | Maintained `agent-config/chief/worker/boat/test_pipeline.py` through the private Darwin compatibility launcher |
| `selected-reads` | Maintained `agent-config/chief/worker/boat/test_pipeline.py` through the compatibility launcher and disclosed UUID fixture repair |

The recorded runtime was OMP 18.13.3, Python 3.15.0, Bash 5.3.20, jq 1.8.2,
Bun 1.4.3 and GNU coreutils 9.12. The private runner/report commands and all
transcripts, diffs, usage and Oracle output remain outside Git, following the
playbook's artifact boundary.

One independent `anthropic/claude-opus-5-5` judge, with `high` thinking, graded
all eighteen observations together under blinded labels. Five equally weighted
criteria scored 0–4 each: consumer correctness, scope/code shape, fidelity/one
authority, local completion, and instruction following/evidence claims. Response
length was not a criterion. The revealed label map is A = Maple, B = Linden,
C = Slate. The successful packet contained full prompts, final patches,
independent Oracle outputs, every actual tool call, deterministic
250/600-character tool-result excerpts and digests; it was not a full-text copy
of every tool result. Full raw transcripts were retained privately. Two earlier
judge requests exceeded the native one-million-token input limit and were
rejected before inference with zero usage.

## Repairs, errata and limits

1. **Administrative censoring:** 9/18 runs hit the 720-second limit, not 8/18.
   Their artifact Oracles are observed; natural completion and final reporting
   are unknown. The judge's completion scores for these runs are provisional.
   Two zero-token, zero-edit A provider-capacity starts were retained separately
   and each received the same permitted fresh-start retry; they are not quality
   observations. Arms ran in successive cohorts with variable shared-host load
   and overlapping retry/Oracle work. Wall times and cap rates are not clean
   causal performance estimates.
2. **Control and blinding:** C had no injected/global AGENTS, rules or skills,
   but manually read repository `AGENTS.md` and verification source. Automatic
   context being off did not prevent these reads. The required scratch ancestor
   contained the word `mistystack-eval`; neutral candidate leaf names shared
   that ancestor in all arms. Historical prompts retained words such as
   “test” rather than altering the user's original request. Blinding and
   instruction isolation were therefore imperfect.
3. **Clustered sample:** one run per task/arm, five tasks from one repository,
   three in the same dispatcher, and a deliberately selected real-failure
   sample. There is no broad cross-repository generalization, confidence
   interval, powered significance test or isolated per-principle effect here.
4. **Oracle compatibility:** the Darwin adapter used GNU stat/date, modern Bash
   launchers and metadata-free USTAR fixtures to remove an unrelated macOS tar
   metadata threshold failure also observed at accepted dispatcher heads.
   Production source and assertions were not changed for that adaptation.
   Carry calibration repaired fake-gh to apply the caller's `--jq` filter and
   used the same 30,000ms per-test deadline for bases, accepted heads and
   candidates. Selected-read calibration replaced four synthetic non-UUID IDs
   with the native OpenAPI example UUID, preserving malformed-ID, path,
   response and size assertions. Original incompatible outcomes are retained,
   not silently scored as product failures. The stopped-allowlist stronger
   exact-subset assertion and its separate consumer probe remain disclosed,
   with no headline regrading.
5. **Judge errata:** the narrative's 8/18 censor count is wrong; the measured
   flags total 9/18. Its instruction to wait for B is stale because the single
   grading pass already included A/B/C. Thread-ID provenance deductions for
   `carry-bases`/B and `live-result`/C were disproved by full raw tool results
   and matching engine session IDs, recorded in `thread-id-provenance.json`.
   The raw scores and means above remain unchanged; they were not privately
   hand-rescored after unblinding.
6. **Authority and completion:** disposable runtime state was the intended
   boundary, not proof that every candidate stayed inside it. Leaked fixture
   commits, manual Git repair and transient outside-HOME writes remain actual
   instruction-following evidence. Source diffs/LOC were captured before final
   independent-test overlays. Native Hermes, factory effects, real Boat network
   traffic, live publishing and production rollout were not established by
   fixture success.
7. **Evidence access:** the public closing comment contains the aggregate
   report, and the public PR comments document task selection. They do not
   expose the full replay. `report-A-B-C.txt`, `report-A-B-C.json`, inventories,
   prompts, candidate transcripts/patches, Oracle outputs, rubric, blind packet,
   judge answer and errata are private local artifacts, not published downloads.
   The `run-record` source repository/review is also private. No public raw
   artifact bundle or independently reproducible public runner is claimed.

## Interpretation and recorded decision

**Measured in the imported record:** B has the most strict Oracle passes and
highest all-observed mean score in this sample. It still fails one task, shares
capped and incomplete proof with other arms, and has authority incidents. C's
stronger uncensored stopped-allowlist result is material contrary evidence, not
an outcome to discard because it loses the aggregate comparison.

**Interpretation:** this was directional support for retaining the kernel, not
proof that every principle helps, that native adapters load correctly, or that
the method improves every repository. The blind judge ranked B first with high
uncertainty. The [closing initiative record](https://github.com/misty-step/mistystack/issues/533#issuecomment-6476093437)
reports the kernel shipped. This report preserves that decision and its evidence
boundary; it does not manufacture public artifacts, rerun the trial, or claim a
production Foundation pass for the documentation site.
