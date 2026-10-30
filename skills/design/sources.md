# Sources and cut decisions

This is Misty Step's rewrite, not an installation of upstream skills. The local
files are the operating method; pinned sources explain provenance. Upstream
persona, greeting, report-format and harness-specific instructions are not part
of this skill. [ATTRIBUTION.md](../../ATTRIBUTION.md) owns third-party notices.

## Standards

- [Foundation article 10](../foundation/checklist.md#article-10): finished-face
  rules in `SKILL.md`; UX/DX/AX outcomes and regression checks in `review.md`.
- [Design defaults and method](SKILL.md): current home of the former Foundation
  Way of working design procedure, including neutral professional defaults,
  expert-lens debate and subtraction first. These are Misty Step's rules, not
  upstream endorsements.

## Emil Kowalski — MIT

[emilkowalski/skills@2d228630ba1446365f614a108cb8252f1feda202](https://github.com/emilkowalski/skills/tree/2d228630ba1446365f614a108cb8252f1feda202),
Copyright (c) 2026 Emil Kowalski. All source paths below are under `skills/`.

| Folded source | Surviving content or cut reason |
| --- | --- |
| `emil-design-eng/SKILL.md` | `motion.md`: frequency/purpose, trigger origin, interruption, motion tokens and real-device observation. Component-library lore and broad craft exhortations cut. |
| `animation-vocabulary/SKILL.md` | `motion.md` vocabulary: precise terms and distinctions. Generic transform definitions, exhaustive effect lists and verbatim-response rules cut. |
| `animate/SKILL.md` and `RECIPES.md` | `motion.md` ordered gate, tool choice, timing, interruption and inclusive input. Stack-specific recipe code cut; reuse the target product's components. |
| `animation-performance/SKILL.md` | `motion.md` frame budget and diagnostic order. Acceleration claims qualified by actual browser/driver behavior; blanket property substitutions cut where they change layout correctness. |
| `review-animations/SKILL.md` and `STANDARDS.md` | `motion.md` review/removal order and observed playback checks. Duplicated tables and automatic preference-based blockers cut. |
| `improve-animations/SKILL.md`, `AUDIT.md`, `PLAN-TEMPLATE.md` | `motion.md` scoped inventory and audit/plan-only boundary. Parallel-audit ceremony, generated plans tree and mandatory stop for selection cut. |
| `find-animation-opportunities/SKILL.md` | `motion.md` feedback/state/spatial seams and gate; zero suggestions is valid. Mandatory suggestion quotas and decorative recipes cut. |

## Impeccable — Apache-2.0

[pbakaus/impeccable@5adaee704634e9031ec8943721c4ffa1a3c22221](https://github.com/pbakaus/impeccable/tree/5adaee704634e9031ec8943721c4ffa1a3c22221),
Copyright 2025 Paul Bakaus. Adapted and shortened by Misty Step; source paths
below are under `.agents/skills/impeccable/reference/`.

| Folded source | Surviving content or cut reason |
| --- | --- |
| `critique.md` | `review.md`: judge hierarchy and the actual task, evidence-backed findings, distinguish visual judgment from deterministic checks. Scores, personas, detector/overlay and persistence machinery cut. |
| `polish.md` | `review.md`: preserve identity, prioritize blocked tasks before cosmetics, inspect the whole path and real states. CLI dependencies and snapshot lifecycle cut. |
| `audit.md` | `review.md`: accessibility, theming, responsive/input and stability checks. Detector wrapper and numeric health scores cut; browser evidence owns claims. |

## Misty Step — retained tools

[misty-step/mistystack@0ccc1a3](https://github.com/misty-step/mistystack/tree/0ccc1a3/agent-config/skills)
is the source revision for these existing repository files.

| Folded source | Surviving content or cut reason |
| --- | --- |
| `design-studio/SKILL.md` | `SKILL.md`: structurally distinct alternatives, product materials, mockup limitations and private-data boundary. Long anti-style catalog, dated model/price leaderboard and redundant defaults cut. |
| `design-studio/scripts/imagine.py` and `imagine.test.ts` | Not retained: paid-provider image machinery is not the method plugin's job; authorization still applies to any generation. |
| `design-studio/scripts/contact_sheet.py` | Not retained: the named-state gallery supplies comparison without a second tool. |
| `visual-state-review/SKILL.md` | `review.md`: affected routes, named states, sizes, themes, scroll positions and inspection of each capture. |
| `visual-state-review/scripts/gallery.py`, `gallery.test.ts`, `templates/manifest.json` | Moved intact into this skill: optional gallery and file-presence check, with existing tests. Neither is a design verdict; skipped coverage remains unverified. |
