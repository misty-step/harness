# ADR-006: No permission or sandbox gates

Accepted 2026-09-14.

We run
pi with full permissions on a trusted workstation, matching pi's default and our
OMP posture. This is explicit, not accidental: gates are omitted, not
misconfigured. Revisit before running pi on untrusted code.
