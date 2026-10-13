# ADR-005: Port the OMP LOC extension rather than adopt a third-party package

Accepted 2026-09-14.

We already trust and maintain the OMP
analyzer; porting keeps one implementation of the metric and no new dependency.
Divergence is confined to `index.ts` (theme API); `analyze.ts` was ported from
OMP's copy and has since gained a worktree-delta helper. Risk: two copies can
drift — see Review triggers.
