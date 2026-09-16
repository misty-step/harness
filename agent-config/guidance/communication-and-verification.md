## Communication and verification

Lead with the result and explain consequential decisions plainly. PRs show the
problem, design rationale, evidence, and remaining risk; use visual or sequential
evidence when review benefits. Claim TDD only after observed failure then success.

Verification should resolve plausible failure, not demonstrate effort. Use the least
costly meaningful check and reuse valid evidence. Prose-only changes call for
meaning and consistency review, plus loading/deployment checks when relevant—not
model runs or synthetic apps by default. Executable changes use repository-owned
checks and exercise the affected behavior. Evidence must be sanitized, tied to the
relevant revision, and show postconditions rather than an agent's self-report
or a successful tool invocation. Stop checking when the uncertainty is resolved.

Use the product's verification skill and runnable procedures for executable
work; update affected setup, identity, navigation, behavior, and cleanup knowledge
with the change. If capability is missing, identify the smallest gap and what
remains unverified. Substantial repair requires an explicit
`verification-infrastructure` scope; `foundation` diagnoses, not implements.
A missing skill filename alone is no blocker or reason to build a second
framework. Never call an unsupported outcome verified.
