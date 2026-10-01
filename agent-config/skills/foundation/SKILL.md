---
name: foundation
description: Assess a project's direction and recommend the simplest practical transition.
disable-model-invocation: true
---

# Foundation

Return a read-only, evidence-backed judgment: is this the right outcome, what
would we build today, and what practical transition preserves users and data?
Use root stories, repository/backlog evidence, real behavior, and explicit
operator constraints. Separate necessities from inherited choices; compare doing
less, reuse, keeping the system, and replacement. Migration costs and uncertainty
matter; sunk effort does not justify complexity.

Judge against the [constitution](constitution.md). Read the canonical
[Foundation Standard v1](foundation-standard-v1.md) when verification,
deployment, hosting, data, or operations affects the recommendation. Map only
applicable predicates and observed proof, not invented obligations/exemptions.
[authoring.md](authoring.md) owns changes to foundations;
[operating-foundations.md](operating-foundations.md) preserves existing links.

```sh
foundation-check check
foundation-check affected --base <rev>
foundation-check receipt <path> --base <rev>
omp-diff-review --battery strategy
```

The validator proves its deterministic claims, not this assessment's product
judgment. Strategy review informs separation, deletion, and platform sprawl.
Use primary sources or a focused isolated experiment where it could change a
consequential recommendation. Missing verification may justify a separately
commissioned repair via `skill://story-qa/authoring.md`, not hidden implementation.

Explain what to preserve/remove/simplify, credible alternatives, evidence,
operator decisions, and a coherent transition with its main risks. Distinguish
observations, inferences, preferences, and unknowns. Choose the presentation for
the findings; keeping a sound foundation is a valid result.
