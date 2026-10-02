# Foundations

Build less and build it well: the smallest change that solves the original
problem, simple interfaces, one owner per fact, and no obsolete replacement path.
Split new work rather than widening the ticket. Speed beats ceremony.

1. **Prove the real candidate before shipping it.**
   In the lean cadence, main builds once and runs the exact artifact in isolated
   production-like preprod with privacy-safe representative data. Walk affected
   stories and consequential boundaries there; the complete suite and every
   live story run nightly and on demand. Failed or absent preprod proof cannot
   authorize production. Existing pins migrate explicitly (ADR-007).
2. **Only proven changes may alter access or accepted state.**
   The release script promotes the tested bytes automatically and reads back
   their identity and a critical journey; an older slow run cannot replace newer.
   Failed health triggers automatic rollback to a compatible release, preserving
   accepted writes. Kaylee owns orchestration; these outcomes remain required.
3. **A lost promise or silent check creates owned repair work.**
   Real failures go to the native tracker for triage and repair. Restore service
   before investigation; keep repair bounded to the failure.
4. **Every check earns its keep, or it goes.**
   Name the real failure and the smallest proof that rejects it. Delete prose
   hashes, duplicate gates and report rituals; preserve independent safety
   contracts. Tests prove behaviour on the real path, not paperwork.
