---
name: pr-preview
description: Deploy an exact-head private exe.dev PR preview, walk its affected stories from the agent session, attach native PR evidence, and remove the owned VM after merge or close.
---

# PR previews

CI owns deployment and teardown. The agent owns the QA walk and evidence, using
its existing `gh` sign-in. No upload PAT/OAuth token goes into CI, no evidence is
hosted on the preview VM, and no Actions artifact substitutes for native evidence.
Use `skill://using-exe-dev` for access and `skill://story-qa` for the live walk.
The application owns production setup, existing privacy-safe fixtures, and stories.

## Deploy the exact candidate

The colocated [pr-preview.ts](pr-preview.ts) is the trusted lifecycle controller.
Requires Bun, Git, authenticated `gh`, and pinned exe.dev SSH. Run from a trusted
full-history checkout, never candidate code. Flags disable ambient dotenv loading
and package auto-installation, not Bun preloads: the working directory stays trusted.

```sh
PR_PREVIEW_CHECKOUT=/absolute/base-checkout \
PR_PREVIEW_OUTPUT_DIR="$(mktemp -d)" \
bun --no-env-file --no-install /absolute/skill/pr-preview.ts \
  up --repo OWNER/REPO --pr NUMBER --sha EXACT_HEAD_SHA

bun --no-env-file --no-install /absolute/skill/pr-preview.ts \
  down --repo OWNER/REPO --pr NUMBER
```

Omit `--sha` to use the API head. Closed/obsolete events cannot deploy. The full
repo+PR hash and two ownership tags scope replacement/deletion. Up starts fresh
fixtures, processes and private shares. Down is idempotent, refuses open/reopened
PRs, and never connects to the VM or executes candidate code. Serialize repo/PR
operations; metadata rechecks do not coordinate independent operators.

Pin reviewed lobby/VM-gateway `known_hosts`; verify against
[exe.dev's fingerprint](https://exe.dev/docs/faq/host-key.md), not unverified
`ssh-keyscan`. The controller disables forwarding and strips GH/model credentials
from SSH's environment. Key material stays controller-side. Keep the approved
account policy: trusted same-repo previews may inherit `notify`, `llm`, and
`reflection`; do not claim zero inherited model authority. Add only preview and
ownership tags, not `work`. Forks remain the approved no-execution exception;
state that exception on the PR without changing account-wide policy.

## Application-owned boot adapter

The exact head contains executable `.exe/preview`. The controller streams its
Git archive and head/base bundle, verifies remote HEAD/tree, and launches the
adapter in a foreground service. No candidate package/script runs on the controller.

`.exe/preview HTTPS_ORIGIN` serves port **8000**, installs pinned dependencies,
builds production, and seeds disposable data with the application's existing QA
approach. No customer data unless explicitly approved for existing QA. Cookies,
API origins, redirects and realtime must work through private HTTPS without auth
bypasses or changes to production authentication.

Env: `PREVIEW_REPO`, `PREVIEW_PR`, `PREVIEW_SHA`, `PREVIEW_BASE_SHA`,
`PREVIEW_STATUS_FILE` (absolute path outside the clean checkout).
Atomically write `{schema:1, sha, url, state:"ready"|"failed", data,
readiness:{productionBuild:true,health:true}}` after actual build/health
assertions within 30 minutes. Failures may include `phase`/`reason`. Readiness is
deployment only, not a story pass. The controller emits `facts.json`,
`status.json` when available, and fenced machine-only `comment.md`; it does not
collect or publish media.

`data` and optional `reason` are nonempty deployment metadata, at most 2,000
characters each. Do not put login links, credentials or session state in CI
status; the agent retrieves synthetic login through existing QA access on the VM.

## Walk and attach from the agent session

Wait for the exact-head deployment, then inspect the real private HTTPS surface.
Use the PR diff, request and root stories to select affected criteria. Walk every
story the PR touches through every adapter it claims, including actual CLI/MCP
consumers. Corroborate persistence and consequential outcomes independently.
Fix affected failures or unwalkable criteria before completion; no accepted gaps.
Untouched stories/criteria are **not affected**, not unverified. Tests alone do
not replace this walk. Re-walk after a head change; obsolete proof is not current.

Capture sanitized screenshots or a short video locally during the walk. Use the
agent's existing authenticated GitHub CLI **2.101+**, not an Actions installation
token, to attach them directly. GitHub's native endpoint
[does not support installation tokens](https://github.com/cli/cli/issues/14309).
No new credential is required or provisioned in CI.

```sh
gh pr comment NUMBER --repo OWNER/REPO --body-file /local/agent-authored-qa.md \
  --attach '/local/ready.png#Observed candidate state' --attach /local/walk.mp4
```

The agent writes the rationale and observed interpretation: exact revision,
preview link, fixture/identity, affected criteria and adapters, concrete actions
and postconditions, and not-affected scope. Attach only sanitized media: no session
state, raw traces, private logs, credentials or customer data. Native assets remain
on the PR after VM deletion. Keep commands to at most 50 attachments per invocation.

## CI deployment and cleanup

Use a repository-writer-trusted `pull_request_target` workflow for opened,
synchronize, reopened and closed events, without path filters. Checkout default
with `persist-credentials:false` and use a reviewed pinned controller from trusted
`RUNNER_TEMP`. YAML comes from the target base; allowed repository-writer bases
are trusted, including nondefault targets. No upload token or agent QA execution
belongs in this workflow. The ordinary scoped `github.token` may read PR metadata
and post deployment/teardown facts, never native media.

Use `contents:read`, `pull-requests:write`, pinned actions, controller-only SSH and
reviewed host pins. Serialize `pr-preview-${repository}-${pr}` with
`cancel-in-progress:false`, including close jobs. Recheck state/head before posting
facts; do not convert deployment failure to success. Merge/close removes only the
owned VM. Verify disappearance and surviving native PR attachments before calling
the first loop complete.

Failed deployment attempts retain the tagged VM for private SSH diagnosis until
retry replaces it or merge/close removes it. This also covers provisioning
failures before the application starts; the PR's deployment remains failed.
