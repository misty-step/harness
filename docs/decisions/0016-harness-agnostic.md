# 0016: One harness-neutral method, thin native adapters

Status: accepted, 2026-10-28. Part of
[#591](https://github.com/misty-step/mistystack/issues/591).

## Context

Phaedrus, 2026-10-28, in
[#591](https://github.com/misty-step/mistystack/issues/591):

> we want mistystack to be agent and harness agnostic. should work with grok bot, should work with codex, should work with claude and pi and omp

This reverses [#533](https://github.com/misty-step/mistystack/issues/533) Q2 and
the OMP-only clause of [ADR 0015](0015-omp-method-plugin.md), including its
rejection of multi-client adapters. The method must not depend on one harness's
tool names, URI schemes or runtime configuration to describe the work.

## Decision

Keep one content tree in the open Agent Skills format,
`skills/<name>/SKILL.md`, with supporting files beside their entry points. Shared
rules, mode, playbooks, principles and skills use harness-neutral text and
relative Markdown links or named skills.

Provide thin native adapters from this repository. Each adapter uses its
harness's native installation and loading mechanisms; there is no custom
installer and no duplicated method content per harness. Harness-specific
mechanics live in a disclosed reference for that harness, not shared procedures.
Model and runtime choices belong in harness-native configuration.

OMP shipped first; the Claude Code, Codex and pi native adapters and their proofs
are in progress in [#591](https://github.com/misty-step/mistystack/issues/591),
not claimed as shipped here. Their mechanics and proof boundaries live in the
[harness references](../../skills/misty/SKILL.md). The Grok target is the
[Grok Bot runtime](../../skills/misty/harnesses/grok-bot.md): Maren
and Shipwright install Mistystack themselves from a brief and establish the
runtime's loading contract. Phaedrus, 2026-10-28: "i don't think we'll ever use
grok build". Grok Build CLI is not supported and no `.grok-plugin` is shipped.
Kaylee's Hermes already consumes the shared tree; its private runtime does not
need a second method copy.

## Consequences

- One content tree, private machinery and native integration without a custom
  installer remain the boundaries. Fleet runtime, hosts, credentials and Kaylee
  stay in private `misty-step/workstation`; that repository consumes the method
  without owning a second copy.
- ADR 0015's references-not-packs and Foundations-redirect decisions remain
  accepted. Its body stays unchanged as the historical record of the earlier
  OMP-only decision.
- Strict lint checks relative links, named skills, URI isolation and native
  manifests. The full gate reports isolated native installs per available
  harness and OMP's inference-free loaded-session proof. Hook registration is
  not live core loading: each runtime needs its own fresh-session evidence.
- Revisit this boundary if a real harness cannot consume the shared Agent Skills
  tree through a thin native adapter. That failure calls for an explicit
  decision, not a silent content fork or replacement installer.
