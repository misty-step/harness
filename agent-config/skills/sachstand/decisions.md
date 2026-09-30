# Material decision brief

Present a read-only recommendation the operator can act on without another
context round trip. Explain every named system, ticket, and option in the same
message; a bare ID is not context. Code provides facts, the model writes prose.

Read primary evidence: request/conversation, source interfaces and ADR constraints,
actual diagnostics/runtime results, and relevant Git/work-record state. Separate
observations from inference and identify missing evidence that could change the
choice. Briefing does not start implementations or test suites.

Explain why a decision is needed now, the cost of inaction, and what already
happened including rejected approaches. Compare credible alternatives, including
status quo/revert when useful, by mechanism, compatibility, reversibility,
blast radius, immediate and continuing cost, and failure consequences. Preserve
explicit constraints rather than inventing options around them.

Recommend one path and state when another wins. Give the next action after the
choice; do not execute unresolved material decisions. Choose the presentation
for the evidence, not a fixed tradeoff table or message template. Decision-only
briefs are quiet unless playback is requested.
