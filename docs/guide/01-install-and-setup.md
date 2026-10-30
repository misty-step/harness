# 1. Install and setup

Use a harness's native adapter to load the shared method from this repository;
there is no custom installer and no separate content tree per harness.

Start with [setup-mistystack](../../skills/setup-mistystack/SKILL.md). It identifies
the destination harness, follows its native reference, assigns applicable rigor
roles in native configuration and requires fresh-session proof:

- [OMP](../../skills/misty/harnesses/omp.md)
- [Claude Code](../../skills/misty/harnesses/claude.md)
- [Codex](../../skills/misty/harnesses/codex.md)
- [pi](../../skills/misty/harnesses/pi.md)
- [Grok Bot runtime](../../skills/misty/harnesses/grok-bot.md)
- [Hermes status](#hermes)

Grok Build CLI is not a target. Each harness needs its own native installation
and loading evidence; an OMP pass does not prove another adapter. Native
installation, file inventory and hook/extension registration are not proof that
a model received the core in a fresh session. Follow the matching reference's
consumer path and report every skipped or unproved part separately. Fleet
machinery remains in private `misty-step/workstation`.

Misty Step's operator develops locally in Tern+OMP
([OMP note](../../skills/misty/harnesses/omp.md)); every harness runs isolated
execution on [Boat workers](../../skills/boat-workers/SKILL.md)
([ADR 0017](../decisions/0017-tern-omp-and-boat-workers.md)).

## Hermes

Kaylee and Hermes are being decommissioned.
[ADR 0017](../decisions/0017-tern-omp-and-boat-workers.md) supersedes
[ADR 0016](../decisions/0016-harness-agnostic.md)'s former Hermes consumer
statement: no adapter, dispatcher or consumer role remains for them.

This public repository does not supply a general Hermes installer or a
standalone Hermes native-loading reference. No install command or continuing
Hermes integration is established here; do not substitute an OMP command or
claim Hermes support from an OMP pass.

Next: [Misty](02-misty.md).
