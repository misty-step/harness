# Review fix proof at 1c4a371

For [PR #419](https://github.com/misty-step/harness/pull/419), fixing
[review 5594063871](https://github.com/misty-step/harness/pull/419#pullrequestreview-5594063871).
Builder evidence, not an independent QA or judge verdict. Owner sign-in is n/a
for installed guidance; native owner logins were checked by the verification skill.

Candidate `1c4a371` includes one normal merge of master `7bd5f6a`, including
[#413](https://github.com/misty-step/harness/pull/413) at `848f51a`. The parent
checkout and pending [#410](https://github.com/misty-step/harness/pull/410) were
not edited. Earlier proofs A/B/B2/C/D and the earlier transcript remain unchanged.

## What ran

- Repository `verify-harness`: doctor, `check shared`, private install, fresh
  Claude/Codex sessions plus skill registration, live comparison, private Home
  inbox/readback and pool dry run. [Transcript](transcript.txt), [gate log](check.log).
  All affected shared/installer checks passed (174 installer assertions).
- Both installers installed the candidate skill byte-for-byte into a private
  HOME. Fresh native consumers listed it; Claude's InstructionsLoaded event
  identifies the private global guidance. See `claude-isolated-*`,
  `codex-isolated-summary.txt` and `registration-*`.
- A fresh native Claude Code Haiku consumer with only `Read` exposed actually
  read that installed skill and applied it to 33 bounded scenarios. No T3 or
  shell effects were available in the probe. [Input](consumer-prompt.txt),
  [cases/expectations](probe-cases.json), [actual read and decisions](consumer-result.json).
  Cases cover authorized roots, children (including an accidentally listed
  child), unnamed/parked work, duplicate claims/markers, partial pagination,
  concurrent dispatch, missing remote filesystem access, idempotent own claim,
  missing roster readback, tracked failed preparation, fallback dedupe/delivery,
  failed inbox reads, all eight allowed effort mappings and five refused values.
  All required effects matched. `parallel-dispatch` said WAIT rather than the
  fixture's DENY label, explicitly prohibiting the concurrent launch; that
  harmless label difference is preserved in the evidence. Allowed mappings
  returned only the exact target effort option, stripping provider-only options.
- The installed skill's actual `jq` roster expression was run through 10 cases:
  valid unique/empty arrays and rejection of duplicates, blank/non-string IDs,
  missing key/file, non-array/null and malformed JSON. [Results](roster-results.json).
- Read-only cloud-to-mirrodin T3 calls worked through existing `fleet-t3`,
  including the named Process lane's project, options/modes and this worktree.
  [Route receipts and missing filesystem prerequisite](route.md).

## What did not pass

**Live is not PASS.** The live step exits 1 with ten failures: eight source/live
DRIFT entries (both global guidance files plus lage, heartbeat and lane-succession
in each consumer) and both live consumers lacking lane-succession. These are
observed differences from unmerged source, not permission to deploy. The fresh
live guidance loading checks passed; that does not erase drift.

**H1 remains BLOCKED.** Cloud Home has a supported working T3 read route, but
not a validated route for reading handoff/fallback files and maintaining and
reading back source/installed roster. No top-level succession was launched.
The complete new Home-dispatched journey and its roster/claim ordering remain
UNPROVEN live. Native application probes establish instruction behavior for
those inputs; they do not prove remote dispatch or concurrent runtime safety.

**[Pool #420](https://github.com/misty-step/harness/pull/420) remains a separate
prerequisite.** The live installed roster still has no `wipRoots`; no roster
was enabled or edited. Review at `708d37c` found child requests sharing the
succession marker; this PR rejects them on both dispatcher and successor sides
regardless of the producer's repair. No approval of #420 is implied.

Timer remains disabled/inactive and native auto-resume false
([readback](runtime-state.txt)). No nested agents, top-level proof threads,
real Home posts, merges or deployments were performed. The private install and
session scratch state was cleaned up.

## Finding dispositions

| Finding | Disposition at this revision |
| --- | --- |
| B1 | Fixed in dispatcher steps 0–3 and successor step 1: fresh exact roster/root/current authorization, complete duplicate reconciliation, one serialized Home dispatch, idempotent claim and abort before effects on another claim. Native consumer rejects each scoped negative case. |
| H1 | BLOCKED: working cloud→mirrodin T3 reads documented; filesystem route fails. Needs validated authorized handoff/fallback/source/installed roster access. No invented access or full journey claim. |
| M1 | Fixed in Inbox evidence, predecessor/reporter/pointer/self-check and Heartbeat: both stores, unknown read fails closed, fallback dedupes without pretending delivery, no repeated append. Existing #418 owns transport repair. |
| M2 | Fixed: failed/stalled/unlisted succession goes to Home; Process receives optional recurring diagnostics. |
| M3 | Fixed: only low/medium/high/xhigh map exactly both ways; missing/other values retain provider; mapped options strip provider-only values. |
| M4 | Fixed: preparation-only launch, pending successor tracked through failure/recovery, source plus installed readback precedes adoption, and Continued/Heartbeat reject absent roster replacement. Live execution remains unproven. |
| Minor | Duplicate child paragraph removed; discovery list distinguished from authorization; PR body refreshed while retaining Story and earlier evidence. |
