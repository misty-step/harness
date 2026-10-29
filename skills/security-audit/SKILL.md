---
name: security-audit
description: "Review a security boundary or finding; run a full source-first codebase audit only when commissioned."
metadata:
  owner: phaedrus
  prevents: "Unsupported vulnerability claims and unsafe target execution: Cloudflare's source/local-only candidate gates and validator regression suite, retained from mistystack PR #520."
  source: "cloudflare/security-audit-skill@c1c8a8c1471069fb0e188eeaff69b8e8db6564a8/skills/security-audit; misty-step/mistystack@0ccc1a308cdeefa29e991d3b7c1dbab016cfea03/agent-config/skills/security-audit"
  sunset: "2026-11-27"
---

# Security audit

A finding names the lower-trust principal, accepted input/action, failed control,
crossed boundary, affected resource and concrete result. A checklist deviation,
self-impact or guessed deployment is not a confirmed vulnerability.

For a focused question/review, read only the relevant boundary reference; loading
this skill does not start a full audit or create reports. Explicit codebase audit,
pen-test, comprehensive review or report-artifact requests use the full workflow.
Both modes first read [execution safety](references/safety.md). Source stays
read-only; target execution needs every OS-enforced sandbox control. Missing
controls produce an exact `needs_validation` blocker, not an unsafe live probe.

## Full audit

1. [Plan](references/workflow.md): target/revision, scope/profile, external output,
   prior evidence, invocation budget and one parent-owned ledger. Use your harness's
   subagent mechanism for read-only reconnaissance/critics and security specialists
   for source/local candidate investigation and verification.
2. [Reconnaissance](references/RECONNAISSANCE.md): map principals, source-to-sink
   paths and deterministic coverage units; select [attack classes](references/ATTACK-CLASSES.md)
   and companions from observed boundaries, not dependency names.
3. [Hunt](references/HUNTING.md): assign units and receive structured candidates;
   reserve critics and validation before hunters. Every unit has an explicit
   disposition; every candidate has a stable root-cause fingerprint.
4. [Validate and report](references/VALIDATION-AND-REPORTING.md): independent
   candidate validation, schema output, independent final record verification and
   target-neutral reports. Validators live at the skill root, not in references.

Only `confirmed` records receive severity, bounded by demonstrated impact.
`needs_validation` is a source-grounded hypothesis with a decisive missing fact;
`rejected` preserves a refuted claim. The audit describes the smallest effective
source fix and regression case; it does not change the target.

Done when all reports exist and both validators pass, or run metadata records
`incomplete` with exact unresolved candidates/coverage. A partial profile/budget
never implies whole-target safety. Follow the core's claim rule.
[LICENSE](LICENSE) preserves Cloudflare's MIT notice.
