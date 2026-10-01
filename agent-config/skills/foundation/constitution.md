# Foundations

Build less and build it well: the smallest change that solves the original
problem, simple interfaces, one owner per fact, and no obsolete replacement path.
Split new work rather than widening the ticket. Speed beats ceremony.

1. **Reproduce the affected product path before trusting a change.**
   Use the exact candidate and representative, privacy-safe data. A prose or
   internal change needs its owner-path check, not an invented product journey.
2. **Protect access and accepted state.**
   Read back what shipped; recovery must keep accepted writes. Use the product's
   existing release path, not another release framework for an unrelated fix.
3. **A lost promise or silent check creates owned repair work.**
   Real failures go to the native tracker for triage and repair. Restore service
   before investigation; keep repair bounded to the failure.
4. **Every check earns its keep, or it goes.**
   Name the real failure and the smallest proof that rejects it. Delete prose
   hashes, duplicate gates and report rituals; preserve independent safety
   contracts. Tests prove behaviour on the real path, not paperwork.
