# 0017: Tern+OMP locally, Boat workers for isolated execution

Status: accepted, 2026-10-28; amended 2026-10-29 (working environments per
harness, below).

## Context

Phaedrus, 2026-10-28:

> we are decommissioning kaylee and hermes. we are moving to tern+omp locally,
> and then grok bots.

> consolidate onto tern+omp for local development, and lean into boat
> dispatched workers.

Kaylee commissioned engineering from a shared exe.dev coordinator through a
private dispatcher. A direct Boat procedure for local OMP agents existed only in
the private workstation plugin, which other adapters and Grok Bots do not
install, and the method named no default for where commands run. An assessment
of native execution, Boat, Fly.io Sprites and exe.dev in Phaedrus's session
(unpublished) concluded that platform fidelity, data and credential boundaries,
interaction and environment continuity decide placement. Cloud placement alone
is neither isolation nor proof.

## Decision

- **Local development** runs in Tern+OMP on the operator's machine: Tern hosts
  the terminal sessions and OMP is the local harness. Other harnesses work where
  they run unless their harness note says otherwise.
- **Isolated execution** defaults to Boat workers dispatched by the working
  agent. The agent loop and credentials stay with the dispatcher. The
  [boat-workers](../../skills/boat-workers/SKILL.md) skill owns the worker and
  own-environment cases, lifecycle and cleanup.
- **Own-environment execution** remains for platform, device,
  signed-in-session, private-network and non-transferable-data checks, and for
  quick trusted inner-loop work.
- **Cloud coordination** for unattended work moves to Grok Bots. Kaylee and
  Hermes are being decommissioned: no adapter, dispatcher or consumer role
  remains for them.
- **Allowance.** Phaedrus's direction to lean into Boat workers authorizes
  workers inside the plan's included VM time. Anything that charges the wallet,
  purchases, plan changes, provider connections and new keys still follow the
  core's ask-first rule.
- **Other providers.** Sprites, exe.dev and other sandboxes are neither defaults
  nor fallbacks. Adding one needs a recorded decision with a measured need Boat
  cannot meet.

[ADR 0016](0016-harness-agnostic.md) stands: the content tree stays
harness-neutral and its Claude Code, Codex, pi and Grok Bot integrations remain.
This decision sets Misty Step's operating default, not the harnesses the method
supports. Only 0016's statement that Kaylee's Hermes consumes the tree is
superseded.

## Consequences

- The core names only Boat placement and points to `boat-workers`, so it stays
  harness-neutral; a harness note states where its work happens when that
  differs. The procedure lives in this public tree, so every adapter and Grok
  Bot receives it; the private workstation plugin keeps machine facts only.
- Boat workers are x86_64 Linux without GPUs; macOS, device and GPU acceptance
  checks stay off workers.
- Herdr pane control and Kaylee machinery in private repositories retire through
  their own live cutovers.
- Revisit when Boat cannot meet a measured workload need, or when Grok Bots need
  workers their runtime cannot dispatch.

## Amendment, 2026-10-29

Phaedrus:

> grok bot should probably be encourage to use boat but probably not tern+omp

The original core line, "Tern+OMP is the local development environment",
loaded into every harness. In simulated Grok Bot sessions on v0.3.8, all four
that chose a working environment adopted Tern+OMP; one planned to install Tern,
OMP and mistystack on the operator's Mac through approval-gated local execution.
Every session still sent heavy tests to Boat. The core now carries only Boat
placement. Tern+OMP lives in the OMP note, and the Grok Bot note names the bot
computer, its shared credentials and the Boat credential prerequisite.
