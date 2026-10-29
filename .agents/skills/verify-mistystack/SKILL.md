---
name: verify-mistystack
description: "When verifying a mistystack change, plugin installation, fresh-session loading or delivery-method behavior."
metadata:
  owner: phaedrus
  prevents: "Installer and file-byte checks reported as loaded method proof; method-plugin cutover #533."
  source: "misty-step/mistystack #533, docs/decisions/0015-omp-method-plugin.md; scripts/verify-plugin.ts owns the native proof."
  sunset: "2026-11-27"
---

# Verify mistystack

The consumer installs the shared method through a native harness, starts a fresh
session, observes its core and skill discovery, then uses its procedures. There
is no product account or QA sign-in. Provider authentication is execution access,
not evidence that the method loaded.

1. **Identify.** Record the candidate commit, working-tree changes, Bun and
   exercised harness versions, affected stories and exact commands. Checks read
   the working tree. Keep output outside the checkout and state whether that
   source matches the recorded commit.
2. **Gate.** From the repository root, run:
   ```sh
   ./scripts/check
   ```
   Require exit 0 for plugin structure, skill behavior, protected-release and
   trufflehog-gate tests. Confirm ship-loop's behavioral tests ran, including its
   native PR-ledger and bounded-fix-round contracts. CI runs
   `./scripts/check plugin --strict --lint-only` for strict references and the same
   maintained tests; its explicit install skip is structural evidence only. When
   `LANDMARK_BIN` is available, retain the real release-replay result separately
   from any skipped optional replay. `./scripts/check --help` identifies the
   plugin-only flags.
3. **Install and load.** Run:
   ```sh
   ./scripts/check plugin --strict
   ```
   The helper creates disposable homes and projects for each available OMP,
   Claude Code, Codex and pi CLI, refuses escaping native configuration paths
   before installation, and reports missing CLIs by name as skipped. It installs
   through each native lifecycle and checks installed skills plus core hook or
   extension registration. An available-harness failure fails the gate; a skip
   is not a pass. CI's lint-only selection explicitly skips every install.

   OMP additionally starts a fresh RPC session without inference. Its selector
   comes from the existing `smol` role read before isolation; `--model SELECTOR`
   supplies an override. Require the observed system prompt to contain the
   installed core and list Misty, the installed skill body to match the candidate,
   and a principle leaf to remain readable but hidden from the automatic list.
   Other adapters' no-model inventory checks prove installation and registration,
   not that a model received the core. Follow the matching
   [harness note](../../../skills/misty/SKILL.md) for fresh-session proof: use an
   existing subscription only if it works without copying credential files;
   quote the core's first bullet and retain the actual loaded/read events.
   Otherwise record the no-model result and leave live proof explicitly
   unverified for the authorized runtime cutover. The helper removes only its
   own scratch trees; no proof writes to live harness profiles.
4. **Walk the changed contract.** For roles or setup, follow
   [setup-mistystack](../../../skills/setup-mistystack/SKILL.md) in an isolated
   destination; separate native assignment persistence, fresh-session discovery
   and authorized inference. For routing or playbook changes, inspect an
   affected real task's brief and Oracle result. For ship-loop changes, drive its
   native ledger and retain the affected behavioral output. The gate does not
   prove provider access, model quality or a completed shipping journey.
5. **Publish.** Put the checked source and runtime identities, command, exit
   status, observed postcondition and reviewer-open output on the PR.
   Follow the core's claim rule; list every skipped or unproved criterion.
   Preserve output outside Git. The private workstation repository owns host,
   audio, credential and backup proof.

Completion means the relevant consumer path passed on the stated candidate,
with its evidence accessible. An explicit lint-only run is useful CI evidence,
not a substitute for an affected installation or fresh-session proof.
