---
name: verify-mistystack
description: "When verifying a mistystack change, plugin installation, fresh-session loading or delivery-method behavior."
metadata:
  owner: phaedrus
  prevents: "Installer and file-byte checks reported as loaded method proof; method-plugin cutover #533."
  source: "misty-step/mistystack #533, docs/decisions/0015-omp-method-plugin.md; scripts/verify-plugin.ts owns the native proof."
  sunset: 2026-11-27
---

# Verify mistystack

The consumer is an OMP operator: install the method plugin, start a fresh session,
observe its core and skill discovery, then use its delivery procedures. There is
no product account or QA sign-in. OMP provider authentication is execution access,
not proof that the plugin loaded.

1. **Identify.** Record the candidate commit, any working-tree changes, Bun and
   OMP versions, affected story IDs and exact commands. The checks read the
   working tree. Keep run output outside the checkout and state whether that
   source matches the recorded commit.
2. **Gate.** From the repository root, run:
   ```sh
   ./scripts/check
   ```
   Require exit 0 for plugin structure, skill behavior, protected-release and
   trufflehog-gate tests. Confirm ship-loop's behavioral tests ran, including its
   native PR-ledger and bounded-fix-round contracts. CI runs this same bounded
   gate; lint-only output explicitly leaves installation unproved. When
   `LANDMARK_BIN` is available, retain the real release-replay result separately
   from any skipped optional replay.
3. **Install and load.** With native OMP available, run:
   ```sh
   ./scripts/check plugin
   ```
   The maintained helper creates a disposable home and project, checks that
   `omp config path` resolves inside that home, installs the candidate through
   its native marketplace, and starts a fresh RPC session without inference.
   Require the observed system prompt to contain the installed always-on core
   and list `misty`. Require `skill://misty` to read the candidate body and an
   indexed principle leaf to remain readable while hidden from the model's
   automatic skill list. File presence or a model's self-report alone is not
   loading proof. The helper removes only its own scratch tree on exit.
4. **Walk the changed contract.** For role or setup changes, follow
   `skill://setup-mistystack` in an isolated profile and distinguish config
   persistence, fresh-session agent discovery and authorized inference. For
   routing or playbook changes, inspect an affected real task's brief and its
   Oracle result. For ship-loop changes, drive its native ledger behavior and
   retain the affected behavioral test output. The gate alone does not prove
   provider access, model quality or a completed shipping journey.
5. **Publish.** Put the checked source and runtime identities, command, exit
   status, observed postcondition and reviewer-open output on the PR. Label each
   claim measured, inferred or guess; list every skipped or unproved criterion.
   Preserve output outside Git. The private workstation repository owns host,
   audio, credentials, backups and Kaylee proof.

Completion means the relevant consumer path passed on the stated candidate,
with its evidence accessible. An explicit lint-only run is useful CI evidence,
not a substitute for an affected installation or fresh-session proof.
