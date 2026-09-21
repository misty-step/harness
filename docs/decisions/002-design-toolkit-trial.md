# ADR-002: Design toolkit integration from the exercised trial

Proposed 2026-09-21. This record becomes accepted when its change merges.

The research baseline (`recommendation.md`, `design-brand-copy.md` in the Kaylee
research reports) found that the three games shipped with zero brand artifacts, and
that `design-studio` alone did not prevent it. Task t_2a376f19 ran a bounded trial:
one Kindred redesign brief, three guidance payloads (existing guidance; Impeccable,
pinned f2c70518; taste-skill, pinned 5217fb45), one render pipeline, one host.

Trial label: sequential exploratory comparison, not blinded, not independent. One
executor ran all three arms after reading all three payloads, so cross-arm
contamination is possible. Critique came from vision-model passes and the fleet CoS
(an AI reviewer); no human designer and no player testing. Observed results, stated
without causal claims:

- Identical briefs produced divergent directions. The payload shaped the outcome;
  the divergence is observed, not causally isolated.
- Only the Impeccable arm carried mechanical verification, and it caught real
  defects in that arm's own output (gray-on-color text, sub-floor type sizes,
  contrast nodes). The existing-guidance arm shipped copy contradictions that only
  external review caught.
- All three arms produced player-safe copy decks once a copy rule set applied.
- Small-icon usability separated the arms: one mark lost its detail at 16px and
  needed an optical variant; the letterform and solid-shape marks survived 16px.
- No image-generation tool was exercised in the trial. The arm that expected
  photography left a labeled placeholder instead of a fake image.

Decision, bounded:

1. Retain `design-studio` exploration routing as-is. No vendor replaces the loop.
2. Adopt detection: the verification step now names Impeccable's detector when its
   skill is installed from the supported Hermes build, and `design-check` always.
3. Compact copy checks: `agent-config/bin/design-check.ts` (dash, vocabulary,
   placeholder) is deterministic, dependency-free, tested, and gate-able.
4. Marks are 16-first with an optical variant and browser-context proof before
   acceptance.

What deliberately does not change: no mandatory vendor install, no profile
replacement, no numeric taste scores, no second capture stack (`visual-state-review`
keeps that job), and no gate on taste. The objective checks gate; taste stays
advisory.

Adoption recipe:

- Product repos: wire `design-check` (deployed by the harness installer to
  `~/.local/bin/design-check`; `agent-config/bin/design-check.ts` when working inside
  this repository) into the repo's checks over player-surface paths; keep the brand
  artifact contract from the research report (`brand/` assets plus `DESIGN.md`);
  pins and licenses recorded per repo.
- Profiles: install Impeccable only through its supported Hermes mechanism
  (pinned revision), never as a blind global install; rollback is deleting the
  installed skill directory.
- Cards that touch a public surface pin `design-studio` and `visual-state-review`.

Evidence: task t_2a376f19 on the factory-quality-rollout tenant, its comparison
report and render evidence, and the pinned sources above. Reopen this decision if a
future trial shows the detector or checks produce false confidence.
