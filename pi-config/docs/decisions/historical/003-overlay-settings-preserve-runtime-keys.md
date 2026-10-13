# ADR-003: Overlay settings, preserve runtime keys

Accepted 2026-09-14.

`bin/pi-merge-settings.ts` lets source keys win while keeping foreign live keys
such as `lastChangelogVersion`. Alternative (copy the file wholesale) rejected:
it resets runtime state and clobbers unknown keys.
