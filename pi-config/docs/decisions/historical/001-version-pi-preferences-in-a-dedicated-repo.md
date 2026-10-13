# ADR-001: Version pi preferences in a dedicated repo

Accepted 2026-09-14.

Live edits to `~/.pi/agent` are unauditable. `pi-config` mirrors `omp-config`
conventions so both harnesses have a reviewed source of truth. Alternative
(edit live files) rejected: no history, no review, no rollback.
