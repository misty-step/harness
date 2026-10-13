# KAF-05 plan

Add a recap module with pure render, offline Mermaid validation, and byte-preserving
marker upsert functions. Reuse policy::Risk and expose nested clap render/upsert/apply
commands. Keep recap gh process invocation in one helper; apply reads JSON and uses
a temporary body file cleaned up after editing.

Split: validation agent owns mermaid.rs and tests; upsert agent owns upsert.rs and
tests; docs agent owns README.md and SKILL.md. Lead owns render, CLI, integration,
native checks, and summaries. An independent agent reviews shipped code after integration.

Tests: accepted headers, empty/invalid header, bracket and quote balance, forbidden
fences/markers; insert/replace/idempotence/exact outside bytes/duplicate and unmatched
markers; rendering all policy tiers, summary and primitives; clap parsing and local
render/upsert real CLI paths. Run cargo fmt/check/test using available toolchain.

Commit only shippr sources/docs and summary.md; leave PLAN.md and CREW_SUMMARY.md
uncommitted. No push or live PR mutation during verification.
