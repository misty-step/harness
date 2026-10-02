# Review, merge, and publication

## Normal merge path

Use one independent exact-head model review plus observed affected proof.
Repositories not yet migrated to lean CI retain their existing observed green CI;
migrated repositories use explicit pre-main scans and main/preprod candidate proof,
not automatic PR CI or an unrelated nightly-green requirement. No human
approval gates or server-required checks; do not bypass or ignore a real failure.
System One diff review and CodeRabbit are advisory, not extra approval rounds.
Review blocks on a supported defect in the changed path, not doubt, preference,
or missing unrelated infrastructure.

```sh
pass-env run \
  -e KAYLEE_GITHUB_APP_ID=workstation/KAYLEE_GITHUB_APP_ID \
  -e KAYLEE_GITHUB_APP_PEM=workstation/KAYLEE_GITHUB_APP_PEM -- \
  bun /trusted/harness/agent-config/bin/agent-review.ts \
  --repo misty-step/NAME --pr N --author-model PROVIDER/MODEL
```

Give the model that actually authored the change. The dispatcher selects an
independent family and records native identity/completion; failure posts no
approval. Resolve demonstrated blocking findings and refresh after head changes.
The App is misty-step-only. For r90group/moomooskycow, record the cross-family
model's verdict and exact head using the existing account; where the checker
expects it, start with `foundation-review: approved FULL_SHA`.

Exercise affected behavior through the existing path. Use `pr-preview` where
already adopted; readiness is not a story pass. Inspect all applicable CI:
```sh
gh pr checks N --watch
gh pr merge N --match-head-commit FULL_SHA --squash
```
Use the allowed merge method, never `--admin`. Check current base and head before
merge; base changes that invalidate evidence need affected verification again.
Do not rerun unchanged proof just to issue a new receipt.

If old server approval/check requirements prevent normal merge, reconcile them
with the standing no-required-gates policy at their repository/org owner. Preserve
deletion/force-push protections; no bypass actors or repo exclusions.
`session-close` owns landing/resources, not another review.

## Operator review pages

Only when a review page is requested: preserve each round under `~/review` and
publish the exact page to its existing board item:
```sh
glass review publish --item ITEM --page FILE
```
Keep private context in its owning tools; R90 data stays in R90's tools. An
ordinary code PR does not need an HTML review page.
