---
name: test-audit
description: Write, change, review, or prune tests while preserving independent consumer contracts.
---

# Test audit (US-021)

Adapted from [OpenClaw test-audit](https://github.com/openclaw/openclaw/blob/80930af448ebabc84174146b56bc106d37fab3b4/.agents/skills/test-audit/SKILL.md);
[LICENSE](LICENSE) preserves its MIT notice.

Give each real consumer contract one primary proof at its owner boundary.
Another layer needs a distinct failure. Before adding/deleting, inspect that
boundary and existing proof; use history only to resolve concrete uncertainty.

Delete wording/source pins, copied inventories, mock echoes, tautologies and
duplicate layers. Preserve independently expected access, data, migration,
package and protocol contracts, regardless of test shape. Negative cases must
reach the guard; behavior on the real path beats paperwork.

Run affected checks and the actual consumer. Report deletions and remaining risk
in the existing PR, not a per-test ledger. Harness installer verification reads
committed HEAD; smoke working-source composition in a disposable destination.
