# Evidence

One proof record connects claim, real scenario, fixture, source revision and dirty
state, runtime identity, exact actions/command, observed result and artifact.
Runtime identity is measured, inferred or unavailable; unknown is not proof.
Fixes, comparisons, state changes and performance need comparable baselines. A
new surface need not invent one. Tests protect future behavior; a green unit
test alone does not show the current runtime.

| Surface | Minimum useful artifact |
| --- | --- |
| Static UI / responsive layout | Before/after screenshots at the same viewport and crop |
| Interaction / motion / focus / loading | Short real-surface video, action and result, with driver assertions/event log |
| Accessibility | Keyboard behavior and relevant accessibility-tree/diagnostic result |
| CLI / TUI | Exact invocation, exit status, output/transcript and resulting state; terminal recording for temporal behavior |
| API / protocol | Real request, response and effect at its owner |
| Persistence / migration | State before/after restart or direct readback |
| Ordering / concurrency | Original ordering, with event sequence or timestamps |
| Performance | Complete before/after measurements under equal workload, data, warm-up and method |
| Infrastructure | Applied change, operator's health probe and visible result |

Capture only the changed path with sanitized fixtures; wait for observed states,
not arbitrary delays. Preserve stderr when it explains failure. Screenshots prove
appearance, not persistence or delivery. Visual acceptance also needs an
independent design review through `skill://design`; give a fresh critic the
artifact/surface without the implementer's explanation when priming could hide
the defect.

Open each saved artifact before claiming it: legible scenario, correct revision
and identity, no secret, unrelated tab or customer/operator data. Disclose failed
attempts, stand-ins and unproved scope. Hashes and byte readbacks belong where
integrity is the feature; neither substitutes for a behavior observation.

## Retain and deliver

Keep generated output outside the checkout and evidence outside Git. Prefer
native GitHub PR/issue media attachments with a concise revision, command,
scenario and result summary. Use an appropriate release's assets for retained
non-media bundles. Proof that must stay private after a repo becomes public uses
an existing independently Access-protected object store. Use stable canonical
links, not expiring signed bearer URLs.

Actions artifacts are temporary diagnostics. Tailnet serving supports active
review only with an owner retaining proof through review and the relevant
release, moving it before its link/host expires. Existing proof is referenced,
not ingested again. Gists and committed evidence branches/repos are not archives.
Foundation audits move old bulky proof through focused cleanup, preserving useful
artifacts and updating links before removal; this run does not widen into cleanup.

Update one Evidence section on the PR: claim/scenario, before/after links,
revision/runtime identity, commands/results and exact gaps. Open delivered links
as a reviewer with repository access. Local paths and hashes alone do not deliver
PR proof; a failed upload leaves readiness blocked, with local proof preserved.
Without a requested PR/public write, return inspected local paths as unpublished.
