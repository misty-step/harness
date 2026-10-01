# Review, merge, and publication

## Normal merge path

Model review plus green observed CI is the agent's merge decision (operator
decisions, 2026-09-28/30). The policy is uniform across `misty-step`, `r90group`,
and `moomooskycow`: no human approval gates and no server-required CI checks.
CI informs the decision; removing a GitHub requirement is not permission to
ignore a failed or unfinished job. No per-repository exemptions or plan upgrade.
Run System One diff review (`bun ~/development/misty-step/harness/omp-config/bin/omp-diff-review.ts` or `/diff-review`)
before commit/PR. Obtain the independent PR model review separately:

```sh
pass-env run \
  -e KAYLEE_GITHUB_APP_ID=workstation/KAYLEE_GITHUB_APP_ID \
  -e KAYLEE_GITHUB_APP_PEM=workstation/KAYLEE_GITHUB_APP_PEM -- \
  bun ~/development/misty-step/harness/agent-config/bin/agent-review.ts --repo misty-step/NAME --pr N
```

The launcher defaults to Sonnet 5.5 high; that is cross-family for an OpenAI
author, not an Anthropic author. The reviewing agent selects an approved model
from a different family with `AGENT_REVIEW_MODEL` and `AGENT_REVIEW_THINKING`
before launch when needed. The current source has no author-model dispatcher;
do not pass an unsupported `--author-model` flag and assume it enforces independence.
Reviewer failure stops review: no model fallback is allowed and an incomplete
review cannot satisfy the merge decision.

`agent-review` starts a fresh model session on the PR title, description, and diff;
the `kaylee-agent[bot]` App's exact-head approval is the independent model signal
`foundation-review` recognizes, not a human approval requirement. Confirm the
review ran successfully, resolve its blocking findings, and refresh it when the
head or reviewed PR state changes. CodeRabbit is advisory.

That App is installed only on `misty-step`; the launcher refuses other owners.
For `r90group` and `moomooskycow`, obtain the same independent, cross-family,
no-fallback model review and record its completed model identity, verdict and
exact head in a PR comment under the existing account. Where the pinned
foundation checker uses recorded decisions, its first line is
`foundation-review: approved <full-head-sha>`. A second human identity is not
needed; the shared account records a different model's judgment, not self-review.
The merge obligations are identical for all owners.

For repositories with a PR-preview adapter, use `skill://pr-preview` before
merge: CI deploys/tears down; the agent walks every affected criterion/adapter
and attaches native evidence from its own signed-in session. Fix verification
gaps; deployment readiness is not QA proof.

Check the prospective merge against the current base, not only the head branch.
If the base moved since verification, update the branch and rerun affected
verification and CI; refresh model review for the resulting head/state. Await
and inspect all applicable jobs on that candidate, not just checks listed as
required by GitHub:

```sh
gh pr checks N --watch
```

With independent model review and observed CI green, re-read the PR head and
current base immediately before merging. If either changed, refresh the evidence.
Merge the exact reviewed head normally:

```sh
gh pr merge N --match-head-commit <sha> --squash
```

Use the repository's allowed method (`--squash`, `--merge`, or `--rebase`).
Do not use `--admin` or rely on `--auto` to wait for advisory jobs.

If GitHub still demands a human approval or a required check, remove that gate
through supported settings instead of bypassing it or asking Kaylee to supply
an approval. Inspect classic branch protection and all applicable repository
and inherited organization rulesets; change an inherited rule at its owner.
GitHub's [branch-protection API](https://docs.github.com/en/rest/branches/branch-protection)
supports deleting `required_pull_request_reviews` and `required_status_checks`;
its [ruleset API](https://docs.github.com/en/rest/repos/rules)
supports updating the owning ruleset. Remove approval conditions (including
code-owner and last-push approval) and `required_status_checks` rules; retain
unrelated protections, including deletion and force-push guards. A PR-only
ruleset may remain with zero required approvals and no human approval conditions.
Read back effective settings before retrying the normal merge. Do not add bypass
actors or repository exclusions.

Foundation review obligations remain in
`skill://foundation/foundation-standard-v1.md`; this procedure does not replace
them with a human approval gate.

Landing, deployment sanity, branch/worktree removal, and canonical-checkout
proof belong to `skill://session-close`.

## Operator review pages

Publish each round as a separate file under `~/review`; preserve published
rounds. Register one exact page on its existing Glass board item:

```sh
glass review publish --item <board-item-id> --page <file-under-~/review>
```

Ask Kaylee to create a missing board item first. Glass links the exact page and
marks earlier rounds old. `~/review` is storage, not an index site. Name one page.
Publish redacted context; private text (including pile words) stays in approved
private storage, and R90 data in R90's own tools. The model writes the rationale,
observed evidence, and remaining risk.
