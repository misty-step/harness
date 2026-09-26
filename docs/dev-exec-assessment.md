# dev-exec: reference repair and enforcement assessment

Historical assessment. The approved [native desktop memory guard](desktop-memory-guard.md)
now owns the replacement design and operator-only activation (US-043): an
inherited fleet backstop plus explicit two-slot local exceptions, with portable
heavy work off-host. Staging is not activation; the claims below describe the
earlier opt-in boundary.

## Reference incident

A shared skill referenced `references/dev-exec.md`, which existed only in the
OMP source component and was never packaged for deployment. OMP global guidance
also referenced two undeployed local runbooks. Extraction/migration retained
source-relative assumptions that fail in an arbitrary agent working directory.

The shared skill now links the canonical workstation runbook; its launch,
inspection, and cleanup instructions remain usable offline. OMP guidance uses
canonical runbook/design URLs. Component navigation points to the actual shared
sources; the unavailable historical pressure report is explicitly identified as
unavailable rather than given a fabricated destination. Legacy changelog links
remain historical archive links. Machine-specific files stay with their existing
implementation; linking them does not require copying or redeploying them.

**Pokayoke:** `scripts/references.test.ts`, run by every `scripts/verify` selection
and CI, checks tracked Markdown file targets and deployed shared skill/guidance
references. A fixture recreates the original backticked missing path, a broken
Markdown link, and a source-only package escape. Before remediation, the check
failed on five source links and two composed OMP references; after repair all four
tests passed. This blocks regressions in the supported reference conventions in
CI, not direct deployment: installer preflight is unchanged. External web uptime,
anchors, free-form prose, and semantic freshness remain outside this guard.

## Do we need the skill?

**Temporarily useful operating knowledge; not the safety mechanism.** The systemd
cgroup is a real resource boundary when selected. The skill compensates for a
missing default execution route: the agent must remember it, choose limits,
construct a unit, pass scratch explicitly, and retain results. Removing the skill
now removes useful instructions without replacing that gap. Adding more prose
would not close it either.

The workstation runbook records a small-scale OOM containment proof, not proof of
fleet safety. The live slice was inspected during this audit: 48 GiB high,
60 GiB max, 8 GiB swap, zero tasks. No new stress test or resource deployment was
performed. A slice aggregate cap neither admits jobs nor reserves desktop RAM.
Scopes may leave sibling processes alive after one process is OOM-killed. Docker
and separately launched managers need their own placement/limits; ordinary
process detachment alone does not change cgroup membership.

## Recommended next boundary (not implemented here)

Prefer an existing job supervisor/launcher if it can own these contracts. Otherwise
build one small shared execution entry point, integrated at the harness's command
launch boundary—not merely an optional CLI that agents can forget:

1. Default agent command execution into bounded per-job units; explicit exceptions
   for work that genuinely needs another manager or the desktop. Avoid trying to
   classify arbitrary shell text as “heavy.” A bounded session parent can be a
   backstop, but is not a substitute for per-job failure isolation.
2. Check effective parent/child memory, swap, and task limits before launch; refuse
   missing containment rather than silently executing unbounded.
3. Own bounded local admission, cancellation, and descendant cleanup, with one
   authority across both harnesses. Keep test-worker budgets in repository config.
4. Own run-scoped disk-backed scratch and explicit environment forwarding. Keep
   secrets out of unit metadata and record minimal job result/peak/exit identity.
5. Route approved portable workloads off-host; remote placement still requires
   resource budgets, lifecycle ownership, and authorized data/credentials.

Acceptance: a representative job succeeds; an intentionally small bounded failure
kills only its job; excess concurrent work waits/refuses; cancellation cleans only
owned descendants; scratch and result retention behave on failure; manager-created
work is contained or explicitly excluded. Never prove this with an unbounded host
stress run. Once enforced routing covers actual launch paths, shrink the skill to
usage/troubleshooting or retire it, migrating callers and owned installed packages.

This audit does not authorize deployment of that supervisor, host-wide limits,
admission values, remote infrastructure, or new credential/exposure policy.
