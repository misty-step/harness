# Master integration and N1–N3 consumer proof

Story: US-050

Tested source: `912165a074b5c0bb80dd3a9aa7e347c28bb49ed4`, an ordinary merge of PR #419 head `d6baa94a42f97e404252fc36f3262dc6466f1b06` and master `20951b17fa40cdff45787ae60a7d11de561da5d9`. The following evidence commit changes no maintained source. This builder used its allocated checkout `t3-53414b65`, detached at the expected PR head before merging. No source was edited in the parent's `t3-8dde1e45` checkout.

The only conflict was the fresh-session feature description. The resolution keeps master's native SessionStart delivery of AGENTS.md and adds #419's `lane-succession` discovery entry. Both installers still select that skill. The canonical installer, migration library, native hook, canonical global instructions and verification helper are byte-identical to master. The succession skill is byte-identical to `d6baa94`; this integration changes no succession policy. [Preservation receipts](integration-preservation.json) record those comparisons and both merge parents.

## What passed

- [Native verification transcript](transcript.txt): `verify-harness doctor`, private `install HEAD`, `session both` and `session-auth` all completed with zero failures. Claude Code was 2.1.303 and Codex was 0.163.0. Native subscription authentication is execution authentication; product sign-in and an owner/admin product role are n/a for installed guidance.
- Both private installers completed, repeated installation kept settings byte-identical, foreign settings and the foreign startup hook survived, and all selected skill bytes matched source. No tracked or private installed `CLAUDE.md` file or symlink exists.
- Fresh native Claude [loading](claude-isolated-context.json), [startup hooks](claude-isolated-hooks.jsonl) and [skill discovery](claude-isolated-init.json) passed. The unauthenticated model result is retained as expected, not described as a successful answer. A separate [authenticated native candidate](claude-candidate-result.json) returned `CANONICAL_QA_OK`, with [complete canonical context](claude-candidate-context.json) and preserved foreign hook. Fresh [Codex loading and discovery](codex-candidate-summary.txt) and repository verification-skill registration passed.
- [Installer checks](installers.log) passed all 181 `PASS` assertions, including both consumers' skill selection. [Canonical migration tests](canonical-tests.log), nine tests, and [native hook tests](hook-tests.log), six tests, passed. [Policy probe](policy.log) and affected shell syntax checks passed. [Exact commands and scope](checks.json) are recorded.
- A fresh native consumer with only the Read tool read the actual private installed skill and matched all [28 expected boolean decisions](consumer-comparison.json). Its [Read receipt, returned skill content and reasons](consumer-result.json), [command](consumer-command.json), [prompt](consumer-prompt.txt) and [cases](consumer-cases.json) are retained.

The consumer cases cover N1's boundary at adoption authorization, including no transfers yet, transferred schedules/watches, unknown authorization and recovery of the same successor. N2 covers explicit fresh Home authority, predecessor restoration before roster reinsertion, absent or withdrawn authority, parked or unrelated lanes and unexpected claims. N3 covers a complete reopened dispatch, readable receipts and fresh referenced state, summary-only or unreadable evidence, unread attachments, missing installed readback, dropped unrelated roots and an unsettled abandoned successor. Additional cases retain child rejection, complete pagination, duplicate/claim exclusion, serialization and the installed-readback adoption gate.

These are bounded instruction decisions. They execute no launch, claim, abandonment, task transfer, roster change or actual succession, and are not independent QA.

## Reproduction and cleanup

From the repository root, set a unique `VH_DIR` and `VH_EVIDENCE`, then run:

```sh
.agents/skills/verify-harness/bin/verify-harness doctor
.agents/skills/verify-harness/bin/verify-harness install 912165a074b5c0bb80dd3a9aa7e347c28bb49ed4
.agents/skills/verify-harness/bin/verify-harness session both
.agents/skills/verify-harness/bin/verify-harness session-auth
```

Run `python3 probe.py --private-home <VH_DIR>/run/claude-home --cwd <fresh-cwd-recorded-in-VH_DIR/cwds>` from this evidence directory to regenerate the cases, prompt and consumer results. The probe temporarily copies existing native CLI authentication into the private HOME, removes that copy in `finally`, and permits only Read. The helper's cleanup removes only its marked private run and recorded scratch directories. [Live preservation](live-preservation.json) compares the selected live credential, guidance, settings, roster and timer files without publishing their contents or hashes.

## Retained evidence and limits

Earlier evidence directories are unchanged. The [ff13321 independent QA](https://github.com/misty-step/harness/pull/419#issuecomment-6306775501) and [review](https://github.com/misty-step/harness/pull/419#pullrequestreview-5594354806) precede N1–N3; this author-run consumer proof does not replace independent delta QA, review or judge. The original 49 scenarios and later 69-case evidence remain historical and byte-unchanged. Prior live drift/loading failures were not rerun or relabeled as passing.

The [Home-owned cross-host route proof](https://github.com/misty-step/harness/pull/419#issuecomment-6306715874) exists and resolves the former missing-route prerequisite. It does not prove an actual succession. [Canonical #426's independent SHIP](https://github.com/misty-step/harness/pull/426#issuecomment-6307743846) and [deployed native loading evidence](https://mirrodin.tail5f5eb4.ts.net/process-canonical-agents-release/README.md) remain evidence for that unchanged source. This integration did not rerun the full shared battery; the single documentation conflict did not change its canonical code, so the affected installer, native loading, policy and hook checks were run instead.

At this run, [#420](https://github.com/misty-step/harness/pull/420) remained open at `12581cc9e88a216ab6b2ff3553b21dfd4410e67d`. Installed `wipRoots` has six entries, while this branch's maintained pool source still has no `wipRoots`. The current authorized set is Tach, Process 2, Overmind, Marmalade and Upkeep active, with Voice draining; Habitat is done and excluded. Activation still requires #420 merged and deployed and fresh installed roster readback. Timer remains disabled/inactive and native auto-resume false.

No Home post, actual succession, new top-level thread, delegated child, host/access/trust/config/auth/roster write, #425 work, live install, merge of an open PR, deployment, watcher or CI polling occurred. Only this checkout, private verification state and public PR metadata were changed. Independent delta QA/review/judge and exact-head CI remain the parent's responsibility. No SHIP or end-to-end succession claim is made.
