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

Grok Build CLI is not a target. Each harness needs its own native installation
and loading evidence; an OMP pass does not prove another adapter. Fleet
machinery remains in private `misty-step/workstation`.

Misty Step's own local development environment is Tern+OMP; isolated execution
runs on [Boat workers](../../skills/boat-workers/SKILL.md)
([ADR 0017](../decisions/0017-tern-omp-and-boat-workers.md)).

Next: [Misty](02-misty.md).
