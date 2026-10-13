---
name: test-audit
description: Write, change, review, or prune tests while preserving independent consumer contracts.
---

# Test audit (US-021)

Adapted from [OpenClaw test-audit](https://github.com/openclaw/openclaw/blob/80930af448ebabc84174146b56bc106d37fab3b4/.agents/skills/test-audit/SKILL.md);
[LICENSE](LICENSE) preserves its MIT notice.

Keep the few good tests proving what users rely on. Inspect existing consumer
boundary proof first: one primary proof per contract, another layer only for a
distinct consequential failure; history resolves concrete uncertainty.
Delete implementation/wording pins, inventories, duplicates, mock echoes,
tautologies and tests costing more than they catch. Preserve independent
access/data/migration/package/protocol contracts; negative cases reach the guard.

Make end-user verification easy and lean: run affected checks and the actual
consumer; show the real thing working, not more checking instead of shipping.
Report deletions and risk in the PR, not a ledger. Installers read committed HEAD;
smoke working-source composition in a disposable destination.
