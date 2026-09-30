# Review, merge, and publication

## Normal merge path

Model review plus green required checks is the merge gate (operator decision,
2026-09-28). Run System One diff review (`bun ~/development/misty-step/harness/omp-config/bin/omp-diff-review.ts` or `/diff-review`)
before commit/PR. Obtain the independent Misty Step PR review separately:

```sh
pass-env run \
  -e KAYLEE_GITHUB_APP_ID=workstation/KAYLEE_GITHUB_APP_ID \
  -e KAYLEE_GITHUB_APP_PEM=workstation/KAYLEE_GITHUB_APP_PEM -- \
  bun ~/development/misty-step/harness/agent-config/bin/agent-review.ts --repo misty-step/NAME --pr N
```

`agent-review` starts a fresh model session on the PR title, description, and diff;
the `kaylee-agent[bot]` App's exact-head approval is the independent signal
`foundation-review` recognizes. Confirm the review ran successfully and refresh
it when the head changes. CodeRabbit is advisory.

With review and required CI green on that head:

```sh
gh pr merge N --match-head-commit <sha> --squash
```

Use the repository's allowed method (`--squash`, `--merge`, or `--rebase`).
For a strict base that moved, run `gh pr update-branch N`, review the updated head,
and merge with `--auto` so GitHub waits for checks. `foundation-review` names
missing signals; resolve them through the normal gate. Route a human-only
approval rule to Kaylee with the repository/rule details.

R90 private repositories are on GitHub's free plan and R90 has no reviewer App;
checks there are advisory but still run and are awaited. Foundation review
obligations remain in `skill://foundation/foundation-standard-v1.md`; this
procedure does not replace them.

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
