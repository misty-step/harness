# Lean agent guidance (US-048)

The 2026-09-30 commission is a harness-only cut: positive principles and local
facts at startup, procedures on demand. The actual Kaylee operating skill belongs
to Hermes; the operator explicitly excluded it rather than create a duplicate here.

## Measured footprint

Whitespace-delimited words, including Markdown/frontmatter, against baseline
`73469d82cc22600fb4a71bd9c21127c6bdb946ff`:

| Surface | Before | After | Reduction |
|---|---:|---:|---:|
| Installed OMP global guidance | 3,907 | 643 | 83.5% |
| Installed Pi global guidance | 2,996 | 527 | 82.4% |
| Three component maintainer AGENTS files | 133 | 39 | 70.7% |
| Homegrown skill entrypoints | 9,970 | 3,552 | 64.4% |
| Complete homegrown skill Markdown | 20,419 | 12,456 | 39.0% |
| All selected skill Markdown, including vendors | 25,039 | 17,076 | 31.8% |
| Selected skill packages | 21 | 18 | 14.3% |

The 80% cut applies to always-loaded guidance, not the entire skill library.
Fixed constitution/standard text and five vendor packages remain unchanged.
Shared composition now selects `engineering` and `workstation`, replacing eight
rule collections. Configuration, selectors, credentials and executable skills
retain their existing enforcement contracts.

## Knowledge and caller cutover

| Knowledge formerly in startup text or a retired skill | On-demand owner |
|---|---|
| Kickoff, durable findings; `agent-ergonomics`, `capture` | `engineering-operations` |
| Exact-head review/merge, Glass publication | `engineering-operations/review.md` |
| `ws`, desktop guard, audio, fleet/resource facts | `engineering-operations/workstation.md` |
| Credential locations and safe migration | `authenticated-commands` |
| `decide` | `sachstand/decisions.md`, quiet unless speech requested |
| `check-cadence`, `verification-infrastructure` | `story-qa` references |
| Direct UI fixes and deterministic copy checks | `visual-state-review` |
| Model/account discovery, Linear/Host commands | OMP `OPERATIONS.md` sidecar |
| Agent architecture and post-training source links | `agent-design` |

Retirement follows successful deployment of each selected replacement. A narrow
launcher/authentication install preserves unselected legacy procedures. Full
skill migration removes all five owned retired packages; foreign packages remain.
The component installers share `PI_CODING_AGENT_DIR` for isolated target selection.
Use the normal full installers for the guidance/skill cutover; a guidance-only
selection does not update skill packages.

## Five authentic first-turn comparisons

Original engineer requests from September 27–29 were replayed unchanged. Each
pair uses native OMP 18.4.4, Anthropic Claude Sonnet 5.5, high effort, subscription
OAuth and distinct staged agent profiles. The baseline guidance is byte-identical
to the captured deployed file. Candidate composition is byte-checked against
source. Prompt hashes, profile paths, cwd, actual provider/model and stop reason
are recorded. All ten final runs exited 0 with the requested model and normal stop.

The common preamble asks for an initial response, first action and relevant skill,
with tools disabled. `--no-session --no-title --no-tools --no-rules
--no-extensions` keeps the probe read-only; native skill discovery stays enabled.
An initial additive-context attempt and the intermediate 639-word candidate were
excluded from the final comparison. Raw prompts, responses and receipts stay
private; no transcript contents or credential values are committed.

| Task; original message/timestamp (UTC) | Response words before/after | Input tokens before/after | Observed final planning behavior |
|---|---:|---:|---|
| Fleet cap; `ba365614`, Sep 29 20:43:27 | 456 / 449 | 14,334 / 6,845 | Finds launch owner/status schema; gate before overlay, working-only boundary; owns live refusal proof. |
| Credential hook; `ce04fd89`, Sep 29 02:54:20 | 593 / 390 | 14,594 / 7,105 | Rejects prose guessing; inspects named cases privately; no sibling edits or live install; stops at PR/report. |
| Agile guidance; `e67cf2ee`, Sep 28 23:09 | 372 / 398 | 14,605 / 7,116 | Audits shared sources, one doctrine owner, net subtraction; deploys and inspects each landed slice; excluded profile stays untouched. |
| Release gate; `3df0897`, Sep 27 23:50 | 476 / 383 | 14,352 / 6,863 | Fetches close contract/log; root-cause regression and postmortem; no live deployment; closes issue only on evidence. |
| Model routing; `4d709dc2`, Sep 29 19:24 | 547 / 438 | 14,570 / 7,081 | Native catalog discovery, unsupported-half stop, no fork/catalog invention; excluded seats/spend preserved; fresh OMP/Pi footer proof. |

Measured input is provider input plus cache-read/write tokens: mean 14,491 →
7,002, a 51.7% reduction. This is context-volume evidence, not billed-cost or
latency proof. Response length is not a quality score.

### Limits and counterexamples

These are planning comparisons, not five completed engineering tasks or proof
of spontaneous compliance. Tools were disabled, so proposed skills were not
loaded during the pairs. Fixed canonical cwd displaces historical worktree
context: both model-routing responses propose another worktree. The candidate
also guesses `origin/main`; the actual default is discovered during real kickoff.
It omits an explicit Astra-out-of-all-recovery promise despite preserving the
other routing exclusions. Agile guidance proposes a new issue/per-PR worktrees;
those are not required by the operating procedure. Several responses postpone
session-close while selecting `engineering-operations`, whose body requires
tracking before branch/resource changes. Record these weaknesses rather than
claiming delivery parity or treating first turns as permissions controls.

## Exercised owner paths

The actual narrow shared installer reproduced deletion of all five legacy
procedures before repair, and preserved all five afterward. The 11 bounded
installer tests pass, including all three replacement-retirement mappings and
foreign-state preservation. The exact documented Linear GraphQL fallback ran
against the real issuer: authenticated viewer and `MIS` team returned, with the
header supplied over stdin rather than secret-valued argv. Staged OMP/Pi
composition and full skill deployment produced the measured files above.

Required pre-merge/full checks and post-merge live native-consumer evidence are
published with the exact candidate/landed revision on the PR and board review
round; this document does not substitute installer bytes for native loading.
