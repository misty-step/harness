---
name: pr-preview
description: Deploy an exact-head private exe.dev PR preview, walk its affected stories from the agent session, attach native PR evidence, and remove the owned VM after merge or close.
---

# PR previews

CI owns preview deployment/teardown; the agent exercises the actual private HTTPS
surface. Readiness is not acceptance. Reuse existing fixtures and authentication.

Run the colocated controller from trusted code, never candidate code:
```sh
PR_PREVIEW_CHECKOUT=/trusted/base PR_PREVIEW_OUTPUT_DIR=/fresh/output \
bun --no-env-file --no-install /absolute/skill/pr-preview.ts \
  up --repo OWNER/REPO --pr N --sha HEAD
bun --no-env-file --no-install /absolute/skill/pr-preview.ts down --repo OWNER/REPO --pr N
```
Pin SSH host keys against exe.dev's published fingerprint. Controller GH/model
credentials stay local. Forks are no-execution; trusted account integrations may
be inherited, so do not claim zero model authority. Failed deploys retain the
tagged VM for diagnosis until retry or close. Serialize operations per repo/PR.

The candidate's `.exe/preview HTTPS_ORIGIN` serves port 8000, builds production
and seeds disposable QA data. It atomically writes `PREVIEW_STATUS_FILE` with
`{schema:1,sha,url,state:"ready"|"failed",data,
readiness:{productionBuild:true,health:true}}` within 30 minutes.
Env includes `PREVIEW_REPO`, `PREVIEW_PR`, `PREVIEW_SHA`, `PREVIEW_BASE_SHA`.
`data`/optional `reason` are nonempty and at most 2,000 chars, never login state.

CI uses a trusted pinned controller on `pull_request_target`, default checkout
with `persist-credentials:false`, scoped permissions and serialized close jobs;
never run candidate code on that controller. Recheck head/state before posting.

Use signed-in `gh` 2.101+ for sanitized screenshots/video:
```sh
gh pr comment N --repo OWNER/REPO --body-file QA.md --attach '/local/state.png#Observed result'
```
Installation tokens cannot upload native attachments. Do not put uploads in CI,
on the preview VM, or in a new receipt scheme. Attach only task-relevant proof;
merge/close removes only the owned VM, not native PR assets.
