---
name: foundation
description: "When working on any project, run every Foundation checklist item and make the project adhere; use for a whole-project audit or reassessment."
metadata:
  owner: phaedrus
  prevents: "Unexamined project foundations and SDK-only proof; the owner requires every article checked (2026-10-27 ruling)."
  source: "misty-step/foundations@d96c99ce1152ab1d6ae4a0eed0b22cbac93897b7/{index.md,way-of-working.md}; misty-step/omp-config@1c6c749e70dfe11975a8622b2d5fd45104ba74e1/skills/foundation/SKILL.md; #533 Q6"
  sunset: "2026-11-27"
---

# Foundation

1. Read [the complete checklist](checklist.md) first. It is the one home of the twelve articles. Run every item whenever working on a project; make the project adhere. A deviation is a decision recorded in the repo; unverified is not a pass. For the article's verification-generator references, use `skill://verification`; for QA accounts, use that skill's account procedure.
2. Establish the intended users, promised outcome, linked backlog initiative and actual-use evidence. Read the real `SPEC.md` and repo decision records. Separate obligations from inherited assumptions. Ask what deserves to exist if starting today; preserving sound foundations is a valid result.
3. Check each article against the repository and running product: release identity, PostHog journeys, Sentry alerts, recovery and data evidence. Exercise a meaningful journey's success and failure; confirm privacy-safe events arrive and support useful analysis. Trigger an actionable error or uptime alert through the owned response path, attributed to environment and release. Exercise telemetry failure without stalling the product; check bounds on volume, retention, retries and cost. Installed SDKs are not acceptance. Use `skill://verification` for real-path proof and state-model checks.
4. Inspect committed verification output and oversized captured fixtures too. Move useful proof to external artifacts, update its links, then remove repository copies in focused cleanup PRs. Keep small deterministic fixtures that checks consume.
5. Record every article as pass, violation, recorded deviation or unverified, with its stable checklist anchor and evidence under the core's claim rule. Rank observed violations by user impact: exact location, failure and smallest repair. Check purpose, architecture, dependencies, delivery and operation together; a simpler module that burdens its callers is not a simpler system. Compare keeping the system with materially different alternatives; migration, compatibility and data safety are real costs.
6. Repair authorized violations through the project's delivery loop. File findings in its owned tracker with article and evidence; its owners repair. Keep blocked work explicitly unverified, name the missing evidence or owner decision, and finish unblocked repairs. Record justified deviations beside the code, linked from `SPEC.md`; report adherence only when all twelve articles have evidence or a recorded decision.

## Stack defaults

Misty Step defaults to full-stack Rust on Cloudflare: Workers via workers-rs, UI compiled to WebAssembly, and Cloudflare D1, R2, KV, Durable Objects and Queues. Hosting is Cloudflare only: new work starts there; remaining hosting moves there. Model calls use OpenRouter, typed decisions use Jev, product analytics use PostHog, errors and uptime use Sentry.

These are defaults, not quality evidence. An exception records the story's needs, alternatives and tradeoff in a repo decision record linked from `SPEC.md`. The SPEC owns observable behavior; every checklist outcome still applies on any stack.
