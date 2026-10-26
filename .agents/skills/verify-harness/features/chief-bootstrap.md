# Chief and OMP bootstrap

Use this scoped recipe for `agent-config/chief/` guidance. It exercises the
installed native chief and worker; legacy Claude/Codex `doctor` prerequisites
and the legacy `all` helper are not prerequisites for this path.

Set `VH_CHIEF_CWD` to the approved chief workspace, `VH_WORKER_CWD` to a separate
repository checkout, and `VH_HERDR_SESSION` to an explicitly authorized dedicated
session. Set `HERMES_BIN` to the installed native Hermes command. Retain the
checked source revision and secret-free results outside the checkout. Use native
execution logins; product QA account/owner-role proof is n/a.

## Installation and loading

1. Inspect the source revision, installed AGENTS.md targets and native versions.
   Read back the composed/linked files and confirm chief context is outside the
   worker repository's ancestor chain. Install only under the commissioning
   owner's deployment authorization; do not run an installer as a test.
2. Run a fresh native chief readback, bounded and without tool execution:

       "$HERMES_BIN" chat --in "$VH_CHIEF_CWD" -Q --max-turns 1 --run-budget 90 \
         -q 'Without tools, identify your role, required worker harness, handoff references and completion-evidence rule from the loaded guidance.'

3. Run a fresh native worker readback in the separate repository:

       omp --cwd "$VH_WORKER_CWD" -p --no-tools --no-title --no-session \
         --no-extensions --no-skills --thinking low --max-time 90 \
         'Identify your role, required nested-worker harness, work authority and completion-evidence rule from the loaded guidance.'

Inspect the native results: the chief identifies its chief role and local handoff;
the worker identifies its commissioned worker role, including OMP-only nested
workers. Both require real consumer proof. A listed skill, matching bytes or a
model's success claim alone does not prove this whole factory. These readbacks
prove delivery and consumption, not a blind skill-quality experiment.

## Actual execution and access

4. Through the existing authenticated chief web client, create a new conversation
   and request a read-only orientation from the installed handoff. Observe actual
   file/tool use and the resulting answer, then reopen the saved conversation.
   Verify the handoff distinguishes working access from unfinished architecture.
5. Inspect `herdr --session "$VH_HERDR_SESSION" status server`. Create a disposable
   workspace with `workspace create --cwd "$VH_WORKER_CWD" --label verify --no-focus`.
   Parse returned pane/workspace IDs rather than predicting them. Start an OMP
   agent in that pane with an explicitly supported model and reasoning setting.
   Prompt it to run `pwd` and `omp --version`, wait for real activity and read its
   native response with `agent read --source recent-unwrapped`. An idle state or
   successful prompt submission alone is not proof. If startup opens OMP's
   first-run wizard, finish native setup before commissioning work; a prompt in
   its provider-search field is a failed drive, not a model response.
6. Verify authorized GitHub access through `gh api` against a required private
   repository and native issue reads. Confirm clone remotes contain no tokens.
   Use `omp usage accounts --json` for registered identities and `omp usage --json`
   for fresh provider observations. A registration list does not prove an account
   currently serves inference: retain a bounded native provider response for each
   route claimed as exercised, and name unavailable or untested routes precisely.
   Check OpenRouter key validity through its native authenticated key endpoint
   without printing the key; distinguish key authorization from inference proof.
7. Read only safe native configuration keys for reset redemption, recovery chains,
   model roles and delegation. Inspect file permissions without reading credential
   values. Provider browser refusals remain account-specific setup gaps, not proof
   that the entire environment is broken or that setup is complete.

## Evidence and cleanup

Keep private account/provider details and handoff content outside public reports.
Publish a concise generic source-revision, command/journey and result summary on
the PR; use the approved private evidence route for private captures. Never dump
auth exports, token commands, secret configuration, environment values or raw
provider error bodies into evidence. Record requested versus configured accounts
and unfinished access separately from source guidance verification.

Close only the disposable Herdr workspace created for this drive after its worker
finishes. Stop only exact probe processes you started. Preserve the owner's chief
conversation, persistent worker service, credentials and unrelated sessions.
