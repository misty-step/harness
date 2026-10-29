# 0017: Tern+OMP locally, Boat workers for isolated execution

Status: accepted, 2026-10-28.

## Context

Phaedrus, 2026-10-28:

> we are decommissioning kaylee and hermes. we are moving to tern+omp locally,
> and then grok bots.

> consolidate onto tern+omp for local development, and lean into boat
> dispatched workers.

Kaylee commissioned engineering from a shared exe.dev coordinator through a
private dispatcher. Local agents had no direct isolated-execution path, and the
method named no default for where commands run. A comparison of native
execution, Boat, Fly.io Sprites and exe.dev found that platform fidelity, data
and credential boundaries, interaction and environment continuity decide
placement. Cloud placement alone is neither isolation nor proof.

## Decision

- **Local development** runs in Tern+OMP on the operator's machine: Tern hosts
  the terminal sessions and OMP is the local harness.
- **Isolated execution** defaults to Boat workers dispatched by the working
  agent: portable builds, full suites, browser QA, untrusted code, parallel
  experiments and long jobs. The agent loop and credentials stay with the
  dispatcher. The [boat-workers](../../skills/boat-workers/SKILL.md) skill owns
  placement, lifecycle and cleanup.
- **Native execution** remains for native-platform, device, signed-in-session,
  private-network and non-transferable-data checks, and for quick trusted
  inner-loop work.
- **Cloud coordination** for unattended work moves to Grok Bots. Kaylee and
  Hermes are retired: no adapter, dispatcher or consumer role remains for them.
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

- The core names the placement default and points to `boat-workers`. The
  procedure lives in this public tree, so every adapter and Grok Bot receives
  it; the private workstation plugin keeps machine facts only.
- Boat workers are x86_64 Linux without GPUs; native acceptance checks stay
  local.
- Herdr pane control and Kaylee machinery in private repositories retire through
  their own live cutovers.
- Revisit when Boat cannot meet a measured workload need, or when Grok Bots need
  workers their runtime cannot dispatch.
