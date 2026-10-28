# Commits, PRs and reports

## Titles

Use Conventional Commits: `<type>(<optional scope>): <change>`. Name the changed behavior with a specific verb. Use `feat` for a new capability, `fix` for a defect, and the repository's existing types for other changes. Mark an actual breaking change with `!` or a `BREAKING CHANGE:` footer. A title is not a verification claim.

## PR body

Use the repository's required headings. Include these fields even when its template differs:

```markdown
## Why

<Who benefits, their observed problem, and why this change solves it.>

## What changed

<The smallest view that explains the diff. Link the initiative or ticket.>

Story: US-###
Rigor: light — <reason, diff size and concrete risk>

## Verification

<Measured: exact checks run, checked revision, observed results and evidence links.>
<Unrun checks and what remains unproven.>

## Risk

<Consumer impact, reversibility and rollback constraints that matter to this diff.>
```

Use `Story: none` when no story changes; list every affected stable story ID otherwise. Generator-only release PRs are exempt. Select the rigor tier through `skill://ship-loop`, not by the initiative's total size. A story link describes intent, not proof that it works.

Show before and after when evidence exists. A failed baseline or defect-injected check and a passing candidate are stronger than an unsupported improvement claim. Say exactly which checks were exercised. A syntax check, screenshot or unit test proves only the behavior it observes.

For a structural change, choose the smallest useful illustration: a shallow file tree for ownership, a call tree for runtime order, a focused diff for a changed shape, or a sequence diagram for interactions. Put it beside the explanation. Include only the relationships needed to understand the change. Use the actual code or observed structure; an illustration is not evidence by itself.

Link large logs and retained artifacts. Keep proof outside the checkout under the project's verification policy. Report the rollback boundary when data or external effects make reversal costly.

## Reports and decision briefs

Lead with the controlling conclusion and its effect on the consumer. Support it with current primary records. Explain the cause and consequence only where they change the decision. End with the decision, recommendation or exact blocker.

Follow the core's claim rule and `skill://misty` for report links and owner-only actions. Keep source observation distinct from your conclusion; describe an unexercised path as unproven, not as working.
