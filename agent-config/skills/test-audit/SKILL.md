---
name: test-audit
description: Write, change, review, or prune tests while preserving independent consumer contracts.
---

# Test audit (US-021)

Adapted from [OpenClaw test-audit](https://github.com/openclaw/openclaw/blob/80930af448ebabc84174146b56bc106d37fab3b4/.agents/skills/test-audit/SKILL.md);
[LICENSE](LICENSE) preserves its MIT notice.

Give each contract one primary proof at its strongest useful owner boundary.
Another layer needs a distinct risk. Whole-subsystem commissions use
[CAMPAIGN.md](CAMPAIGN.md); ordinary edits stay focused.

Name the consumer-visible regression and gap in existing proof before adding a
test. Extend a keeper instead of replaying its path. Exercise production
boundaries; delete obsolete test-only seams. For bugs, show the intended pre-fix
failure where practical, then the repaired result.

Delete implementation/wording pins, copied inventories, source greps, mock echoes,
supplied receipts/order, bare not-throw/nonempty checks, tautologies, and duplicate
same-contract layers. Negative controls must reach their claimed guard.

Preserve independently expected API, protocol, configuration, migration, storage,
security, platform, release, package, architecture, and artifact contracts.
Snapshots, fixtures, mocks, static checks, or exact public bytes can prove them.
Judge the failure detected, not test shape, runtime, or coverage count.

Before deletion, read the complete candidate, owner/callers, history, overlap,
relevant dependencies, and CI route. Identify its actual failure, production seam
users, remaining keeper or absent contract, risk, and focused proof. Keep uncertain
candidates. Repair baseline product failures rather than pruning symptoms.

Move valuable assertions first, then remove redundant tests/support in owner
batches. Preserve genuine access/security boundaries. Run owner checks and
distinct consumer paths; report removals, retained false positives, production
simplification, observed evidence, and limits. `skill://story-qa` owns real-path proof.

Harness fact: `./scripts/verify [selection]` reads working unit files but checks
installers from committed HEAD. Exercise a changed source installer separately
in a disposable destination; reuse applicable evidence between handoffs.
