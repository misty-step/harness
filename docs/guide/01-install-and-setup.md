# 1. Install and setup

Use a harness's native adapter to load the shared method from this repository;
there is no custom installer and no separate content tree per harness.

OMP is the first shipped adapter. Follow the
[OMP reference](../../skills/misty/harnesses/omp.md) for installation, refresh,
configuration and consumer proof. Its current
[setup skill](../../skills/setup-mistystack/SKILL.md) is OMP-specific, not proof of
setup support elsewhere.

Claude Code, Codex, pi, Grok Build and Hermes integration work is tracked by
[#591](https://github.com/misty-step/mistystack/issues/591). Their native loading,
configuration and proof must be established separately; an OMP installation
does not establish support for another harness. Fleet machinery remains in
private `misty-step/workstation`.

Next: [Misty](02-misty.md).
