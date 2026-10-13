# ADR-002: Own a declared subset with an allowlist `.gitignore`

Accepted 2026-09-14.

The repo ignores everything and re-includes named paths. This makes
accidental inclusion of secrets (auth, telemetry config) impossible by default.
Cost: every new owned file must be allowlisted.
