---
name: test-audit
description: "Write, change, review or prune tests while preserving independent consumer contracts."
metadata:
  owner: phaedrus
  prevents: "Redundant test layers and lost independent coverage: US-021, introduced by mistystack commit 3b94e77 (MIS-166); lean proof refined in PR #279."
  source: "misty-step/mistystack@0ccc1a308cdeefa29e991d3b7c1dbab016cfea03/agent-config/skills/test-audit; openclaw/openclaw@80930af448ebabc84174146b56bc106d37fab3b4/.agents/skills/test-audit; cursor/plugins@c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/skills/principle-test-behavior-not-implementation"
  sunset: "2026-11-27"
---

# Test audit

Name the consumer failure before adding or deleting a test. Inspect existing
proof at its owner boundary: one primary proof per contract; another layer needs
a distinct consequential failure. Use history only for concrete uncertainty.

Keep independent access, data, migration, package and protocol contracts.
Negative cases reach the guard; behavior through the real path beats assertion
shape; a test that survives a behavior-preserving refactor tests behavior. Remove implementation/wording pins, copied inventories, mock echoes,
tautologies and duplicate layers, not the contract they accidentally protected.

Run affected checks and the actual consumer path through the `verification` skill.
Report deleted proof, retained contracts and residual risk in the existing PR,
not a per-test ledger. A subsystem audit groups by contract only when commissioned.
For installers reading committed HEAD, distinguish that run from working-source
composition smoked in a disposable destination.

The adapted OpenClaw material retains its [MIT notice](LICENSE).
