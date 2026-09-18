## Communication and verification

- **Lead with results:** State outcomes and consequential decisions plainly. PRs articulate the problem, design rationale, verified evidence, and remaining risk.
- **Verify observable postconditions:** Exercise actual affected behavior. Verify observable postconditions and outputs, not self-reports, tool-invocation receipts, or mock echoes. Never call an unsupported outcome verified.
- **Proportionate checking:** Resolve plausible failure, not demonstrate effort. Prose changes need consistency and reference review, not synthetic test runs. Stop checking when uncertainty is resolved.
- **Maintain verification procedures:** Update affected setup, navigation, and cleanup procedures alongside code changes. Identify capability gaps plainly rather than fabricating fallbacks.
- **Semantic diff review:** Run System One diff review (`omp-diff-review` or `/diff-review`) on working tree changes before committing or opening a PR. Resolve all hard blocks (security leaks, suppressed symptoms, needless abstractions, fails-open guards) before handoff.
