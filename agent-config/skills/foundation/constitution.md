# Foundations

Build less and build it well: the smallest change that solves the original
problem, simple interfaces, one owner per fact, and no obsolete replacement path.
Split new work rather than widening the ticket. Speed beats ceremony.

1. **Reproduce the whole product before trusting a change.**
   Each PR's exact head runs on its own private exe.dev VM with privacy-safe,
   production-like seeded data. Walk touched stories before merge; destroy the
   preview VM at merge or close. No persistent QA.
2. **Only proven changes may alter access or accepted state.**
   The release script ships only a proven head and reads back what shipped.
   Failed health triggers automatic rollback to a compatible release, preserving
   accepted writes. Kaylee owns orchestration; these outcomes remain required.
3. **A lost promise or silent check creates owned repair work.**
   Real failures go to the native tracker for triage and repair. Restore service
   before investigation; keep repair bounded to the failure.
4. **Every check earns its keep, or it goes.**
   Name the real failure and the smallest proof that rejects it. Delete prose
   hashes, duplicate gates and report rituals; preserve independent safety
   contracts. Tests prove behaviour on the real path, not paperwork.
