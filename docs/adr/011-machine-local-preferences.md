# ADR-011: Portable defaults with machine-local preferences

Status: accepted (2026-10-06)

## Context

Serenity (macOS) cannot use Mirrodin’s Omarchy theme or account inventory.
A source-owned OMP email policy can prevent startup when that account is absent.
Shared defaults should install on both hosts without copying credentials or
requiring Linux workstation packages.

## Decision

Keep portable defaults in Git. Each consumer applies an optional, untracked
machine-local mapping during installer preflight and deployment: Pi reads
`~/.config/harness/pi.json` (`PI_CONFIG_LOCAL_SETTINGS` override), OMP reads
`~/.config/harness/omp.yml` (`OMP_CONFIG_LOCAL_CONFIG` override). Local values
win over shared defaults; unrelated runtime settings remain preserved.
Missing local files are allowed; invalid mappings fail before live writes.

Local preferences select desktop themes, account policies and native skill
paths. OS-specific skills remain locally owned native path entries or symlinks;
installers preserve unmanaged skills. Credentials stay in native runtime storage.
The existing explicit component selections continue to control deployment of
workstation helpers; a local mapping does not activate services or install skills.

## Consequences

OMP automatically selects an installed generated Omarchy palette for both
backgrounds (US-017); explicit local theme preferences still win. Pi hosts select
their generated theme locally. OMP no longer assumes a particular account email exists. The merger retires only the exact
former source-owned account pins, preserving foreign and locally declared policies.
Harness-specific config formats and merge implementations remain with consumers.
