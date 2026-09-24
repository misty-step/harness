# Token efficiency: measured baseline and controlled changes

Observed 2026-09-24. Stories: **US-018**, **US-019**. Related credential policy:
[MIS-161](https://linear.app/misty-step/issue/MIS-161/make-credential-availability-unmissable-in-global-agent-guidance).
Baseline source: `4a2eb5888dcae5dabd96226eecef429e38da2a64`; native capture: OMP
18.3.0. No live deployment or model/routing/effort change is part of this work.

## Result and decision

The five archived harness sessions have **$157.3163 of recorded catalog-valued
usage**. Advisor sidecars account for **56.82%**; cached input across the whole
tree accounts for **77.31%**. Optimizing only the parent or uncached prefix would
miss the largest measured costs.

This is not an invoice or a verified cost-per-completed-task baseline. Sessions
contain multiple user requests, corrections and resumptions; none has an
independently recorded task outcome. All five cohort labels are `unknown`.
The new accounting command therefore returns `recordedCostPerCompletedTask:
null`, not a misleading dollars-per-session success metric. No quality-neutral
percentage saving or production A/B result is claimed.

Changes:

- **Direct:** offline whole-task/tree accounting from existing per-response
  usage, with explicit scope, outcome labels, billing categories and evidence
  hashes. No additional model prompt or runtime telemetry stream.
- **Direct:** fix credential claim deduplication. A previously reminded matching
  entry no longer falls through to a second generic follow-up/model turn.
- **Off by default:** `OMP_CREDENTIAL_CONTEXT=on-demand` substitutes a discovery
  pointer for the full startup inventory. Normal sessions retain the inventory.
- **Proposal only:** advisor scheduling, model mix/routing/effort, delegation,
  broad prompt edits, compaction changes and upstream request-layout work.

## Harness map and ownership

| Layer | Owner and evidence | Relevant behavior / change boundary |
|---|---|---|
| Shared instructions | `agent-config/guidance/*.md`, `agent-config/install` | Seven selected sections are composed at the harness intro's marker. Skills deploy separately. `effective-verification.md` is inactive; deleting it saves no default prompt tokens. |
| OMP policy/deployment | `omp-config/global/AGENTS.md`, `config.yml`, `install` | Repo owns roles, fallback chains, MCP scope, extension selection and composed guidance, not the OMP provider clients. |
| OMP credential injection | `omp-config/extensions/credentials/index.ts` | `before_agent_start` appends inventory; `tool_result` adds auth recovery; `message_end` can schedule a follow-up. This is the implemented experiment/fix boundary. |
| OMP requests/tools | Installed `omp` 18.3.0; native `before_provider_request` hook | Final Responses payload observed with `input`, `tools`, `prompt_cache_key`, `include`, `reasoning`. Extension hook can inspect/replace payload; no replacement was shipped. Tool schemas and upstream system instructions are outside this repo. |
| OMP history/compaction | Archived JSONL `message`, `compaction`, `model_usage`, `session_init`; upstream runtime | Real archives retain provider payloads/encrypted reasoning and remote compaction replacement history. No evidence justified removing/rebuilding them. |
| OMP delegation | `config.yml` task overrides/isolation; child JSONL and advisor sidecars | Child headers carry `parentSession`; nested files record billed worker/advisor messages. Include these and `model_usage`, not only main responses. |
| pi | `pi-config/settings.json`, `extensions/failover/`, `extensions/openrouter-live/` | Pi default is OpenRouter DeepSeek V4.1 Flash; failure extension advances to Mercury 2.5 after stock recovery and asks for resend. Cloud request serialization belongs to installed pi 0.86.0. Pi changes are not shipped here. |
| Existing accounting | Assistant `usage.{input,output,cacheRead,cacheWrite,cost}`; `model_usage`; foreign usage-outbox | Per-request billing categories already exist. Outbox also includes reasoning and 1h cache-write fields. Do not duplicate or replace the foreign telemetry extension. |
| Existing aggregate DB | `~/.omp/stats.db` | A scoped query found no harness rows although the transcripts exist. It is not the authority for this baseline; direct archive parsing avoids silently omitting recent work. |
| Verification/evals | `scripts/verify`, component suites, `docs/semantic-quality.md` | Deterministic checks exist; no fixed, independently labeled coding-task quality/cost corpus was found in this repo. |

The [provider appendix](token-efficiency-providers.md) records exact routes,
primary documentation, API prices, TTLs, minimum prefixes and catalog conflicts.
OpenAI/Codex and xAI/OAuth subscription routes are not API invoices. In particular,
pi's cached DeepSeek prices disagree with OpenRouter's current model page; do not
replace recorded historical costs with a guessed current quote.

Upstream source map is pinned to
[OMP v18.3.0](https://github.com/can1357/oh-my-pi/tree/v18.3.0), matching the
installed version string (not a binary reproducibility attestation):

- [system-prompt.ts](https://github.com/can1357/oh-my-pi/blob/v18.3.0/packages/coding-agent/src/system-prompt.ts)
  builds ordered instructions from customization, rules, skills, tools and setup.
- [agent-loop.ts](https://github.com/can1357/oh-my-pi/blob/v18.3.0/packages/agent/src/agent-loop.ts)
  `prepareProviderCall` transforms history, normalizes model messages/tool schemas
  and applies provider-context transforms before adapter serialization.
- [sdk.ts](https://github.com/can1357/oh-my-pi/blob/v18.3.0/packages/coding-agent/src/sdk.ts)
  connects `onPayload` to the extension runner's `emitBeforeProviderRequest`;
  [runner.ts](https://github.com/can1357/oh-my-pi/blob/v18.3.0/packages/coding-agent/src/extensibility/extensions/runner.ts)
  chains hooks. RPC `get_state` exposes logical prompt/`dumpTools`, not a final
  wire-body renderer. `before_provider_request` is the actual capture point.
- [session-stats.ts](https://github.com/can1357/oh-my-pi/blob/v18.3.0/packages/coding-agent/src/session/session-stats.ts)
  includes task-result usage rollups. The new analyzer instead counts raw child
  messages and does **not** add `toolResult.details.usage` a second time.
- [task/executor.ts](https://github.com/can1357/oh-my-pi/blob/v18.3.0/packages/coding-agent/src/task/executor.ts)
  owns child prompt/context construction and sidecars; children get the supplied
  shared context, not the parent's entire conversation.
- Provider clients under
  [packages/ai/src/providers](https://github.com/can1357/oh-my-pi/tree/v18.3.0/packages/ai/src/providers)
  own Responses history/delta replay, encrypted reasoning and Anthropic cache
  markers. There is no justification to add redundant cache controls here.
- [request-debug.ts](https://github.com/can1357/oh-my-pi/blob/v18.3.0/packages/ai/src/utils/request-debug.ts)
  can record raw request/response bodies **and headers** with `PI_REQ_DEBUG`.
  It is live transport logging, not safe aggregate telemetry; it was not enabled.
- [blob/artifact architecture](https://github.com/can1357/oh-my-pi/blob/v18.3.0/docs/blob-artifact-architecture.md)
  documents `OutputSink` mirroring at 50 KB and full sanitized artifact retention
  when spill succeeds. Existing spooling is reused, not replaced with truncation.

Pi 0.86.0's installed `docs/extensions.md`, `docs/rpc.md` and
`docs/session-format.md` expose analogous live payload hooks and JSONL context
reconstruction. Its `examples/extensions/provider-payload.ts` dumps full payloads
and headers; it is not a privacy-safe telemetry template. No pi request or
installed runtime source was modified.

### Request inspection, not just templates

Three real archived `session_init` snapshots were rendered and inspected. They
are **pre-provider worker prompts**, not complete final wire captures:

| Worker snapshot | System tokens, o200k_base | First billed API input including cache | Tool names |
|---|---:|---:|---:|
| ProtectedReleaseCode | 11,043 | 26,004 | 84 |
| HarnessDesign | 7,316 | 10,597 | 74 |
| MistyBranchAudit | 7,386 | 11,929 | 74 |

The first snapshot's rendered sections include 2,393 tokens of inline device
schemas, 2,417 of integration descriptions, **another 1,158 of integration route
mappings**, 2,231 of upstream policy, 1,181 of worker setup and 613 of skill
metadata. These are separately tokenized sections; boundaries can change a few
BPE tokens. `o200k_base` is a model-family measurement, not an exact tokenizer
claim for the GLM-selected worker. Its snapshot selection may also precede a
fallback. Provider API totals remain billing truth.

Two additional **actual native pre-dispatch Responses payloads** were captured
with the modified source extension, synthetic HOME/store/cwd and one synthetic
credential name. The capture hook exited before provider dispatch:

| Native capture | Tool schema tokens | Serialized input tokens | Result |
|---|---:|---:|---|
| Full inventory | 4,323 | 2,876 | Name present |
| On-demand | 4,323 | 2,808 | Name absent; discovery pointer present |

Both use `o200k_base`. All 11 tool schemas were byte-equivalent as parsed JSON;
both payloads requested `reasoning.encrypted_content`. Input contains developer
instructions followed by the user setup/prompt. OS, architecture and model are
still in developer instructions in this isolated run. This verifies native
loading and prompt behavior, not provider caching, multi-turn reasoning replay
or task success. It uses the public `openai/gpt-6-sol` adapter, not the production
Codex subscription transport. Current native device descriptions are already
on-demand in this stripped run; the older inline-schema observation is not a
claim that the latest runtime still needs that cutover.

Aggregate measurements: [request sections](measurements/token-efficiency-requests.json).
Raw prompts, provider payloads, user text and credential names are not committed.

## Baseline: whole recorded trees

Scope: the five top-level sessions in the harness-only archive folder dated
2026-09-17, 2026-09-18 and 2026-09-23, plus their nested transcript trees. Today's
active sessions and all other repository folders are excluded. There are
**21 files, 3,889 recorded model responses, 34 user-attributed root messages**.
No duplicate recorded response/entry identities were found in this cohort.
All attempts, including recorded failures, are counted; it is not the active
conversation branch alone.

### Cost by observed execution source × billing type (recorded USD)

| Source | Uncached input | Output | Cache read | Cache write | Total |
|---|---:|---:|---:|---:|---:|
| Parent | 9.3360 | 5.1224 | 33.8219 | 3.2236 | 51.5039 |
| Advisor | 9.3152 | 1.6865 | 77.0018 | 1.3816 | 89.3850 |
| Workers | 3.9689 | 1.6107 | 10.8041 | 0 | 16.3836 |
| Parent auxiliary calls | 0.0107 | 0.0031 | 0 | 0 | 0.0138 |
| Worker auxiliary calls | 0.0229 | 0.0070 | 0 | 0 | 0.0300 |
| **Total** | **22.6537** | **8.4298** | **121.6277** | **4.6052** | **157.3163** |
| Share of recorded cost | 14.40% | 5.36% | 77.31% | 2.93% | 100% |

Token totals: 17,794,764 uncached input; 1,054,761 output; 603,258,136 cache-read;
541,106 cache-write. Reasoning tokens are not added again to output.

**Requested content-source attribution has a real gap:** the API usage fields
cannot split these input/cache charges among system prompt, tool schemas,
skill/rule/integration descriptions, user messages, file reads, search results,
command/other tool output, replayed history and summaries. Each is **unmeasured
in billed dollars**, not zero. Saved section token counts above are useful for
ranking but cannot be allocated proportionally across cached/uncached billing
without final per-request prefix/provenance information. Worker/advisor costs
are measured separately; adding their input contents again as separate costs
would double count.

### Cache and turns

- Cached fraction of recorded input tokens: **97.05%**
  (`cacheRead / (input + cacheRead + cacheWrite)`).
- Responses with nonzero cache reads: **94.55%** (3,677 / 3,889).
  This is not a full-prefix hit rate or a count of TTL misses.
- Parent response turns by root: **168, 396, 486, 63, 212**; median **212**.
  Whole-tree model responses: **275, 773, 2,169, 201, 471**.
- Recorded error/abort model responses: **66**. Hidden transport retries and
  unrecorded calls are not recoverable from these files.
- Static tokens vary by model/tool/extension selection. Observed worker system
  text spans **7,316–11,043 o200k_base tokens**. The composed live global guidance
  alone measured **3,130 o200k_base / 5,032 claude-v5 tokens** (14,520 bytes).
  Neither is the full static wire prefix.

### Tool use and reported errors

Denominator is five observed root groups, not verified completed tasks. Counts
use `toolResult` records across the tree; starts are not added again. Errors are
`isError=true`, not a semantic classification of output text.

| Tool | Roots using it | Results | Flagged errors | Error rate |
|---|---:|---:|---:|---:|
| read | 100% | 2,010 | 34 | 1.69% |
| bash | 100% | 731 | 68 | 9.30% |
| grep | 100% | 214 | 4 | 1.87% |
| edit | 100% | 152 | 7 | 4.61% |
| advise | 100% | 116 | 0 | 0% |
| eval | 60% | 104 | 5 | 4.81% |
| write | 100% | 93 | 3 | 3.23% |
| glob | 80% | 86 | 6 | 6.98% |
| hub | 60% | 50 | 0 | 0% |
| todo | 60% | 28 | 1 | 3.57% |
| find | 40% | 16 | 0 | 0% |
| yield | 20% | 15 | 3 | 20.00% |
| web_search | 40% | 11 | 0 | 0% |
| ask | 20% | 10 | 0 | 0% |
| task | 20% | 4 | 0 | 0% |

`find` demonstrates the limit: its result can report zero hits and `isError=false`
while auxiliary model calls failed with provider 403. This audit encountered
that failure and used exact search instead; it was reported through OMP's
native issue channel. Unknown/uncategorized tool failures remain explicit in
the output. No classifier invents invalid-argument/environment/provider/timeout/
user-abort categories where the archive has no structured distinction.

Full per-model, per-tool, per-group totals and file hashes are in the
[baseline JSON](measurements/token-efficiency-baseline.json).

## Ranked opportunities

Rank reflects observed spend × plausibly removable fraction ÷ quality risk;
there is insufficient quality evidence to manufacture a numeric risk score.
Prerequisite measurement and a reproduced duplicate-turn fix rank ahead of
larger speculative cuts.

| Rank / layer | Action | Savings estimate and basis | Quality risk / validation | Rollback |
|---|---|---|---|---|
| 1 / accounting | Ship scoped whole-task analyzer | 0 direct model-token saving; prevents optimizing the wrong denominator or dropping 56.8% advisor cost | Low: read-only. Reconcile independent totals; reject unknown outcomes, overlaps, corrupt/unpriced inputs | Revert analyzer commit; no live state written |
| 2 / recovery | Stop the second generic credential follow-up after a matched-entry reminder | One avoidable model turn per repeated named-credential claim. Regression observed 2 scheduled follow-ups before, 1 after; zero such reminder events in this historical cohort, so no observed cohort dollar saving claimed | Low: first targeted recovery remains. Test repeated known, unmatched and newly matched services | Revert deduplication commit |
| 3 / advisor workload | Proposal: evaluate lower-frequency/event-driven advisor consultation with the same model before considering model changes | Advisor share 56.82%. Removing 25–50% of its billed work would remove 14.20–28.41% of this cohort's recorded cost **if** parent effort and quality stayed fixed. Scenario, not prediction | High: missed interventions or more parent work can erase it. Same real tasks, whole-tree billing, blinded review of missed defects | Leave current `advisor.enabled` and model roles unchanged; restore baseline schedule in any future experiment |
| 4 / injected credentials | OFF-by-default on-demand inventory pointer | 1,124→74 o200k_base tokens (−1,050; 93.42% of section); 2,354→126 claude-v5 (−2,228; 94.65%). At recorded Sol catalog rates, 1,000 affected requests save $0.21 if cached or $2.10 if uncached, before lookup/extra-turn cost | Medium: lookup may add turns or miss a credential. Pair authenticated and unrelated tasks; require real authorized online operations for authenticated acceptance | Unset `OMP_CREDENTIAL_CONTEXT`, restart; no store or policy migration |
| 5 / integration metadata | Proposal: single server pointer, remove redundant route inventory; retain first-turn core tools | Older worker's duplicate mapping alone is 1,158 tokens, 10.49% of its system text, not 10.49% of task cost. Current complete wire impact unmeasured | Medium: discovery/tool-name errors can cost more than prompt savings. Test first-turn integrations, re-auth state, absent tools | Upstream feature flag off; do not remove current callable tools |
| 6 / cache layout | Upstream proposal: stable tools/system then separately bounded setup and append-only conversation | No defensible cohort estimate. Cached input already 97.05%; request-level prefix hashes needed to distinguish changed prefix, expiry and cold starts | Medium despite semantic intent: role/authority and provider-specific boundaries matter. Capture consecutive real payloads, preserve reasoning and compare hit/latency/cost | Revert provider-specific layout only |
| 7 / prompts, output, compaction | Keep broad changes proposed/off. Preserve existing artifact spooling and lossless history; audit sparse numbering only with hashline-edit safety | No defensible whole-task estimate; do not import another team's 7%, 46.9% or other magnitudes as a target | Medium/high: citation/edit failures, lost task state, extra retrieval. Use matching-format consumer journeys, compaction continuation, exact artifact retrieval | Existing format/prompts remain the control |

Full original instruction dispositions and the implemented rendered prompt diff:
[line audit](token-efficiency-prompt-audit.md). No instruction asks the model to
save tokens, work less, lower ambition, truncate output or discard reasoning.

## Running the analyzer (US-018)

```sh
bun omp-config/bin/omp-task-usage.ts \
  --sessions "$HOME/.omp/agent/sessions/-development-misty-step-harness" \
  --manifest docs/measurements/token-efficiency-cohort.json
```

The committed cohort intentionally labels all roots unknown. For an actual task
experiment, provide a separate manifest with task identity, outcome and independent
evidence. Group retries/resumptions under the same task, including failed work.
Split a multi-task session using ISO timestamps, `[from, until)`:

```json
{
  "version": 1,
  "tasks": [{
    "id": "credential-operation",
    "outcome": "success",
    "evidence": "local acceptance receipt for the authorized online operation",
    "sessions": [{
      "file": "session.jsonl",
      "from": "2026-09-24T09:00:00Z",
      "until": "2026-09-24T10:00:00Z"
    }]
  }]
}
```

The example describes the schema, not an observed successful task. Paths resolve
inside the explicitly selected archive directory, including symlink resolution.
Each worker tree belongs to its launch span, including responses after the span
ends; the persistent advisor is allocated by response event time. Record boundary
uncertainty for simultaneous user work. Put all sessions involved in a task in
its `sessions` array. Overlapping spans/double-counted records fail closed.
Both nested directories and flat `Parent.Child.jsonl` sidecars retain that
ancestry. Copied fork history with repeated response/entry identity is rejected;
select only the fork's new interval rather than billing inherited history twice.

The primary metric is **all cohort recorded cost / successful task count**, not
successful-task cost alone. It is unavailable when any outcome, usage or price
is missing, or there are no successes. Positive-token/zero-price records are
conservatively unpriced: the archive cannot distinguish free from unknown.
Unknown outcome evidence is never guessed from `stopReason=stop` or a final
message. The analyzer reads local data only and writes JSON to stdout; raw
messages, arguments and command output are not emitted. File hashes make the
particular archived input reproducible, not universally complete.

## Validation and promotion plan

### Exercised paths

- `bun test --max-concurrency=1 omp-config/bin/omp-task-usage.test.ts
  omp-config/extensions/credentials/credentials.test.ts`: **12 pass, 0 fail**.
  Covers tree/auxiliary aggregation, failed-task denominator, unknown/unpriced
  records, late and flattened nested workers, copied fork history, scope escape,
  corrupt archives, tool errors and transcript non-disclosure.
- Source CLI exercised on the real 21-file cohort, reconciling the independently
  calculated 3,889 responses and $157.316340723 recorded cost. Primary metric
  correctly remains unavailable.
- Credential regression first failed: repeated known-service claims scheduled
  **two** follow-ups. After the state split, the recovery checks pass in both
  startup modes. No reminder message wording or auth-result trigger was removed.
- Native OMP 18.3.0 loaded the actual source extension in disposable HOME/cwd,
  captured each variant at `before_provider_request`, and exited before inference.
  Synthetic store names were present only in the default payload. No credentials
  were decrypted and no task-quality or cache-hit claim follows from this smoke.
- `./scripts/verify omp`: **8 workspace tests and 59 OMP tests pass**; both
  isolated installers pass. Unit tests exercised working files; installer checks
  exercised committed baseline HEAD. No installer source changed in this work.
- Root story structure check passes. `check-stories.sh . --tests` fails because
  it scans the existing `.worktrees/jev-qa-walk/.../walk.test.ts` and encounters
  that other checkout's `US-007`. No unrelated checkout was changed or removed.
- Authenticated System One diff review ran before committing: **passed, no hard
  blocks**, six advisory warnings. The broad relevance/test-defense/complexity
  warnings were considered against the requested report scope and the observed
  failing-before/passing-after consumer regressions; they are not a quality score.

Exercised implementation fingerprints (SHA-256):

```text
228e3c7da7e9275e603530feb9df498deb60c0b8b1b3201579647635479622e5  omp-config/bin/omp-task-usage.ts
abe6b74617f4e0da42a1eb328129fd7489d4317e6d1491582b40d1afefde2f90  omp-config/extensions/credentials/index.ts
```

Native capture setup: disable ambient extension/skill/rule discovery, LSP, title
and persistence; disable advisor/GitHub/secrets in a temporary config; load the
source credentials extension and a capture-only extension explicitly. The latter
writes the hook's payload with mode 0600 and synchronously exits before dispatch.
Use dummy API credentials and synthetic store files, not production auth. Run one
process at a time under `~/.cache/tmp`; remove capture files and isolated HOME
when finished. Initial cold-start exceeded the first 30-second bound; the next
bounded launch and the control launch both exited 0 at the capture hook.

Exact native command, with `repo` pointing to this checkout and `scratch` to the
run-scoped directory (isolated HOME, `work/`, config and capture hook as above):

```sh
HOME="$scratch/home" PI_CODING_AGENT_DIR="$scratch/home/.omp/agent" \
XDG_CONFIG_HOME="$scratch/home/.config" TMPDIR="$scratch" TERM=dumb \
OMP_CREDENTIAL_CONTEXT=on-demand CAPTURE_FILE="$scratch/request.json" \
omp --cwd "$scratch/work" --model openai/gpt-6-sol \
  --api-key fixture-not-a-secret --config "$scratch/capture-config.yml" \
  --no-session --no-title --no-extensions --no-skills --no-rules --no-lsp \
  -e "$repo/omp-config/extensions/credentials/index.ts" \
  -e "$scratch/capture-provider.ts" --max-time 15 -p "Report the current directory."
```

The capture hook's only handler is `before_provider_request`: synchronously
write `JSON.stringify(event)` privately, print `{captured:true}`, and
`process.exit(0)`. Clear the credential-context variable for control. No raw
request log is retained after inspection, and no synthetic model response is
used as acceptance evidence.

### Flagged credential experiment

1. Control is flag unset; treatment is `OMP_CREDENTIAL_CONTEXT=on-demand` at
   fresh process start. Hold runtime version, model, reasoning effort, tools,
   repo revision, task phrasing and account route fixed. Randomize order to
   avoid giving only one arm warm caches. Never switch models mid-conversation.
2. Use short real-user tasks spanning read-only questions, bug fixes, edits with
   tests, native-auth operations, pass-only service credentials, project-specific
   references, real missing/rejected credentials, resumed work and compaction.
   Preserve their ambiguity; independently specify observable acceptance before
   running. Full/heavy model suites belong on approved exe.dev capacity.
3. Record every request and full tree: billing categories, recorded/reported
   cost provenance, attempts, turns, tool outcomes, latency, cache reads/writes,
   completion, correction/rework and code retained after review. Capture only
   provenance/section token counts and stable prefix hashes by default; raw
   payload capture is private, opt-in, short-lived and redacted before sharing.
4. For auth tasks, a stored name is not acceptance. Verify the actual authorized
   online read/write and postcondition with native auth/pass-env. Do not invent
   a credential, rotate a key, or widen access to make the experiment pass.
5. Paired success review is blinded to variant. Block promotion on any missed
   authorization/security requirement, new false-unavailable claim, unfinished
   task, or attributable task-success regression. Compare whole-cohort cost per
   independently successful task; inspect paired uncertainty rather than saying
   a small nonsignificant test proves equivalence. Predeclare the acceptable
   cost/latency/turn/error/cache guardrail noise from the control distribution;
   do not choose margins after seeing results. Collect more evidence if bounds
   cannot rule out the smallest operationally meaningful quality loss.
6. If offline results pass, run task-randomized online control/treatment with the
   same guardrails. Review user corrections/move-on signals and retained code;
   neither is sufficient alone. Promote only when cost improves and quality is
   non-inferior within the predeclared measurement resolution. Otherwise leave
   the flag off and record the null/regression, including lookup overhead.

No task corpus run, online A/B or quality-parity result was performed here. The
flag stays off. Existing model/routing/effort and work-split policy stays intact.

## Measurement gaps and intentionally unchanged behavior

- No independent success labels, invoice/subscription allocation or task-quality
  corpus. Consequently no verified dollars-per-completed-task or savings claim.
- Historical final wire payloads/tool schemas are not persisted in the scoped
  roots; `session_init` captures worker prompt text/name lists before provider
  transformation. Fine-grained source × billing attribution remains unavailable.
- Two synthetic native captures prove request formation, not production cache
  performance. Multi-turn encrypted reasoning replay, cache TTL/key stability
  and warm/cold latency were not exercised.
- Hidden retries, external model calls and missing/unattached worker logs can
  escape archived accounting. Tool `isError` misses semantic failure text.
- The cohort spans runtime/model changes and is small, old and harness-specific;
  it is not a representative quality benchmark or current fleet cost forecast.
- No pi transcript corpus was selected. Pi runtime clients, OMP upstream request
  ordering, schema serialization, output spooling and compaction are not owned
  by this repository. They are mapped/proposed, not patched in installed binaries.
- No live install, provider setting change, billing-plan change, model switch,
  credential modification or permanent raw-payload logger was performed.
