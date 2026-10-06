# Postmortem: stale release candidates could pass the merge gate

- **Incident date:** 2026-09-25; reported again 2026-09-27
- **Status:** Prevention implemented; production recovery tracked in MIS-177
- **Operational owner:** Harness release automation / Misty Step
- **Historical issue:** MIS-177

## Summary

A generated protected-release changelog could pass required PR verification
without being validated against the commit set that would actually land.
Release PR #100 was prepared before a documentation commit reached master,
then merged with a stale candidate fingerprint. Landmark correctly refused
publication. Because preparation depends on publication succeeding, every
subsequent release run encountered the same invalid candidate before it could
prepare a replacement. PR #113 exposed the existing blockage; it did not cause it.

## Impact

Observed: `v0.1.49` remained unpublished while master advanced; `v0.1.48` was
the latest published version when investigated. The reported run's code
verification succeeded, its publish job failed, and preparation was skipped.
There is no evidence of an invalid tag or release being published. This incident
and its repair did not deploy harness configuration to the live workstation.

## Timeline

| Time (UTC) | Observation |
| --- | --- |
| 2026-09-25 22:38:42 | GitHub published `v0.1.48`. |
| 2026-09-25 23:45:58 | Release PR #100 candidate commit `cd5b306` was prepared against `36e23c3`. |
| Before #100 merged | Documentation PR #99 added `65df07c` through merge `dcbd746`. |
| 2026-09-25 23:46:42 | #100 landed as `1959b17`, retaining the earlier fingerprint. |
| 2026-09-27 23:44 | PR #113 landed as `4ec7ab4`; run `36359677369` again failed publication. |
| Investigation | Landmark v0.28.9 reproduced the identical rejection at both `1959b17` and `4ec7ab4`. |
| Repair | Required CI gained native candidate validation; ruleset 23779166 gained strict up-to-date checks. The stale, unpublished section was withdrawn for normal regeneration through a release PR. |

## Evidence and mechanism

- [Reported production run](https://github.com/misty-step/harness/actions/runs/36359677369):
  `verify / verify` succeeded; `Publish only a landed, verified changelog`
  failed with `protected release changelog differs from classified candidate commits`.
- [Release PR #100](https://github.com/misty-step/harness/pull/100) passed its
  required check, but that check only exercised code/configuration suites and
  semantic review. It did not execute Landmark's candidate validator.
- Landmark v0.28.9 fingerprints every non-merge commit's id and subject except
  `chore(release):` commits. Documentation commits do not appear in release notes
  but do belong to that fingerprint. The marker at `36e23c3` was
  `4665095ebfeff64528caf8d44ed3ede08de0454f287f3cf68a7d195b0894e42b`.
  The actual candidate at `1959b17`, with the intervening documentation commit,
  hashes to `d9669102ef953a159374457f9a9f7a2c8f5977a019263c7f5255d6241caeb3e6`.
- [Master ruleset](https://github.com/misty-step/harness/rules/23779166) required
  `verify`, but `strict_required_status_checks_policy` was false. Thus even
  adding a validator alone would leave a check-to-merge race.
- Reproduction used the checksum-verified published Linux x86-64 Landmark
  v0.28.9 binary (SHA-256
  `7a22cba7d99aa6d05ef113a8ff95ca5ca6098c6bf4a8af213f85370fa30e65d2`),
  a disposable clone checked out at each incident revision, and:

  ```sh
  "$LANDMARK_BIN" prepare-protected-release \
    --repo-root "$REPRO" --repository misty-step/harness
  ```

  Both exited 1 with the production mismatch. This native command performs the
  same local candidate validation as publication, without publishing anything.

## Pokayoke

How can we pokayoke this so this kind of error never happens again?

The failing-closed check now sits **before merge**, not only after it:

1. The required `verify` job runs native Landmark `prepare-protected` on the
   prospective merge checkout with full history. Producer, pre-merge validator,
   and publisher use the same pinned Landmark revision. There is no second
   changelog classifier and no error suppression. Any generated file remains
   in the disposable CI checkout; CI has read-only repository permissions.
2. The existing required-check ruleset now requires an up-to-date base, with
   no bypass actors. A base advance invalidates previous green evidence. The
   release automation refreshes its PR after verified master pushes; stale
   candidates cannot merge merely because their old checks passed.
3. `scripts/protected-release.test.ts` guards that required-check configuration
   and replays the exact docs-only race with the real Landmark binary. It proves
   a valid candidate is accepted, a docs-only base advance is rejected without
   rewriting it, regeneration repairs the marker without changing visible
   notes, and work after a tagged release can prepare the next version.
   Before the workflow fix, the configuration regression failed because required
   `verify` had no candidate validator; after it, both tests passed (20 assertions).

Together these close the class **a stale generated candidate can pass the
required merge gate and first be discovered by publication** (US-015). The
publish-time check remains defense in depth. No tag is moved and no protected
publication check is bypassed. Withdrawing only the never-published `0.1.49`
section repairs the poisoned state; the normal owner generates the replacement
from all accumulated commits, including #113, for fresh verification and merge.

Residual classes: GitHub/API outages, release-bot authentication failures, and
an administrator changing the required-check rules are not eliminated by this
fix. They must fail visibly rather than be described as a successful release.
This mechanism does not claim arbitrary release infrastructure cannot fail.

## Follow-up

MIS-177
owns the fix PR, actual master run, replacement release PR/tag, and final closure
evidence. It stays open until those online postconditions are observed. The
[verification procedure](../verification.md#protected-release-walk-us-015)
records the repeatable checks, recovery path, and read-only ruleset inspection.
