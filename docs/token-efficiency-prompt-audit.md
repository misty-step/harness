# Standing-prompt and credential-context audit

Baseline source: `4a2eb5888dcae5dabd96226eecef429e38da2a64`. Line numbers below refer to that revision, not the changed extension. This audit is a disposition proposal, not an instruction change. The only prompt change implemented is the off-by-default inventory experiment described below.

## Scope, evidence, and boundaries

Read-only audit of the requested source files, the three installer/composition paths, and relevant local skill-source references. The semantic `find` attempt returned no hits (Jev unavailable); exact `glob`, `grep`, and bounded `read` calls located and read the targets. No files were edited; no build, test, formatter, runtime, live credential inventory, or transcript was read. The reported 90-entry inventory and token measurements below were provided by the parent agent, not re-run here. No entry names or transcript content are reproduced.

The requested `integration/` directory is absent at this checkout. The actual repo-owned integration points are `omp-config/install`, `pi-config/install`, `agent-config/install`, and OMP's credentials extension. Upstream OMP/pi prompt assembly and model/tokenizer behavior beyond those repo contracts are out of scope.

## Baseline: lines, bytes, and measured tokens

Line counts are exact physical/nonblank counts from the source line ranges. The static file reader exposes sizes rounded to 0.1 KB for files over 1 KB; smaller files show byte values. Those listings do **not** expose exact byte counts for the larger files, so their size entries are explicitly listing precision, not claimed exact bytes. No character-to-token estimate was used.

| Source | Listed size | Physical lines | Nonblank lines |
|---|---:|---:|---:|
| `omp-config/global/AGENTS.md` | 4.7 KB (rounded listing) | 89 | 72 |
| `pi-config/global/AGENTS.md` | 345 B | 9 | 7 |
| `agent-config/guidance/communication-and-verification.md` | 3.4 KB (rounded listing) | 13 | 12 |
| `agent-config/guidance/credentials.md` | 1.8 KB (rounded listing) | 33 | 28 |
| `agent-config/guidance/design-routing.md` | 1.6 KB (rounded listing) | 22 | 20 |
| `agent-config/guidance/effective-verification.md` | 728 B | 6 | 5 |
| `agent-config/guidance/host-resources.md` | 1.5 KB (rounded listing) | 18 | 16 |
| `agent-config/guidance/pokayoke.md` | 306 B | 3 | 2 |
| `agent-config/guidance/session-close.md` | 506 B | 11 | 8 |
| `agent-config/guidance/user-stories.md` | 445 B | 3 | 2 |
| `omp-config/extensions/credentials/index.ts` | 5.8 KB (rounded listing) | 135 | 120 |

All eight shared guidance sources are 109 physical / 93 nonblank lines. The seven selected sections are 103 physical / 88 nonblank lines. Their listed-size sum is about 9.6 KB at the reader's coarse precision; it is not an exact byte sum.

The composer copies the harness source through the marker, writes each selected section in declared order, and adds a blank separator after each. Based on that source contract, the composed static guidance is 198 physical / 159 nonblank lines for OMP and 118 physical / 94 nonblank lines for pi (including the added section separators). The OMP source-plus-selected-section file sizes are roughly 14.3 KB by rounded directory metadata; pi is roughly 9.9 KB. Exact composed bytes were not exposed by the read-only interface.

Parent-reported measured context baselines:

- The current OMP 90-entry dynamic inventory: **1,124 `o200k_base` tokens / 2,354 `claude-v5` tokens**.
- The composed global AGENTS context: **3,130 / 5,032 tokens**, respectively.

These are measured tokenizer counts from the parent, not estimates from character counts. No completed-task quality or price-weighted completion result was supplied in this slice, so these counts alone do not establish quality parity or dollar savings.

## Rendered composition and selection

- Both default installers select, in order: `pokayoke`, `communication-and-verification`, `host-resources`, `credentials`, `user-stories`, `session-close`, `design-routing`.
- `agent-config/install` replaces the marker with exactly the selected `guidance/<name>.md` files and a blank separator after each. Guidance text is therefore always part of the rendered global AGENTS file when that component is installed; it is not a conditional skill invocation.
- The OMP source has the marker at line 40; pi's source is a short intro ending with the marker at line 9. Repo-local AGENTS files add to these global files, as both intros state.
- `effective-verification.md` is not named by either installer. The corresponding `agent-config/candidates/effective-verification/SKILL.md` is explicitly outside automatic skill deployment. It is not part of the measured default prompt baseline.
- OMP defaults `OMP_INSTALL_COMPONENTS` to `all`; the `all` path installs guidance, `--skill all`, and all extension directories. Pi defaults `PI_CONFIG_COMPONENTS` to `all`; it selects the same seven guidance sections and `--skill all`. Skill **availability** is deployed separately from global guidance; actual skill invocation/loading follows the native harness and is bounded as upstream behavior.
- OMP's `extensions/credentials/index.ts` uses the native `before_agent_start` event to append the inventory. The same extension adds matching-entry advice only on auth-looking bash results and matching unavailable-credential claims. Pi has the shared static `credentials.md` guidance but no corresponding credentials extension in the inspected installer selection.

## Complete nonblank source-line audit

Disposition key: **keep** = preserve; **rewrite** = candidate concise/corrected wording; **move** = retain the policy but put procedural detail in the existing conditional skill/section. Every proposed change below is proposal-only unless separately identified as the selected opt-in experiment. No global guidance change is part of that experiment.

### `omp-config/global/AGENTS.md`

| Original lines | Disposition | Reason |
|---|---|---|
| 1 | keep | Identifies the OMP global source. |
| 3–7 | keep | Deployment/source boundary and repo-local additive authority; required for safe source ownership. |
| 9 | keep | Working-together section heading. |
| 11–14 | rewrite (proposal only) | Preserve autonomy on routine in-scope work, material-choice escalation, and explicit review stops; the phrasing can be shorter and overlaps the decision-context section. |
| 16–18 | rewrite (proposal only) | Preserve “skills inform judgment, not scope” and smallest coherent outcome while consolidating overlap with shared guidance line 5. |
| 20–29 | keep; model/routing changes proposal-only | Model roles, fallbacks, cost, and current-session boundary are explicit routing policy. Do not alter for this prompt-cost slice. |
| 31–34 | keep | Repository truth, work-record role, minimal interfaces, and deleting unnecessary coordination are harness-specific engineering policy. |
| 36–38 | keep | Operator-owned infrastructure preference and durable-state/backup constraint. |
| 40 | keep | Required insertion marker; structural, not prose. |
| 42 | keep | Execution-environments heading. |
| 44–46 | rewrite (proposal only) | Repeats the shared Host resources mandate and local carve-outs. A short pointer can preserve it; do not delete the shared mandate or local exceptions. |
| 48–49 | keep | Provisioning account/capability/spend/lifetime check is OMP-specific and remains useful; retain the local-execution cross-reference. |
| 51–56 | keep; delegation changes proposal-only | Isolated/disjoint delegation rules, PR checkout boundary, and long-runtime routing protect the canonical checkout and resource ownership. |
| 58 | keep | Authority-and-operations heading. |
| 60–67 | keep | Tracker boundaries, operator authority, privacy scope, and ownership of Parlor's skill. |
| 69–75 | keep | Linear access workflow and secret-safe fallback; concrete instructions must remain available when MCP is not mounted. |
| 77–80 | keep | Branch, commit, PR-link, and status workflow. |
| 82–89 | keep | Privilege/approval constraints and completion verification are security/authority policy. |

### `pi-config/global/AGENTS.md`

| Original lines | Disposition | Reason |
|---|---|---|
| 1 | keep | Identifies the pi global source. |
| 3–7 | keep | Per-harness deployment and additive-repo-guidance boundary; keep even though the wording parallels OMP. |
| 9 | keep | Required shared-guidance insertion marker. |

### `agent-config/guidance/communication-and-verification.md`

| Original lines | Disposition | Reason |
|---|---|---|
| 1 | keep | Shared section heading. |
| 3 | keep | Outcome-first reporting and PR evidence/risk context. |
| 4 | rewrite (proposal only) | Keep the full decision rights: define names/options, explain timing and prior outcomes, compare consequences/costs, recommend, and state when the alternative wins. Current single line is unusually long. |
| 5–9 | keep | Small real outcome, real-path verification, meaningful test design, independent expectations, and bounded evidence are core quality requirements. |
| 10 | move/rewrite (proposal only) | Keep that named UI states must be captured/inspected and screenshots do not prove backend behavior; the state-matrix procedure duplicates the existing `visual-state-review` skill and can be routed there. |
| 11 | keep | It judges cost by outcomes and explicitly rejects cheap-token/visible-activity optimization; it does **not** ask models to save tokens. Preserve reasoning quality, security, access boundaries, and productive long runs. |
| 12–13 | keep | Maintain procedures and semantic-review hard-block policy. |

### `agent-config/guidance/credentials.md`

| Original lines | Disposition | Reason |
|---|---|---|
| 1 | keep | Shared credentials section heading. |
| 3–6 | rewrite (proposal only) | “Every credential needed for any project” is an absolute availability guarantee not supported by the source workflow. Replace with task-scoped, evidence-based access language; do not imply unrestricted authority. |
| 8 | rewrite (proposal only) | Preserve ordered source checks but scope them to the credential needed for the authorized task rather than making every session exhaust every location. |
| 10–11 | rewrite (proposal only) | Native authentication is a useful first check, but “already signed in” is an unsafe universal assumption. Say to check the relevant native login. |
| 12–16 | keep | Names-only pass listing, pass-env bindings, and the `authenticated-commands` route preserve the secure workflow. |
| 17–18 | rewrite (proposal only) | Preserve project-local lookup only when relevant and authorized; avoid a standing instruction to search every dotenv-like file. |
| 19–21 | rewrite (proposal only) | Same scope/privacy issue for other consumers; keep the “already holds the value” recovery path task-relevant. |
| 23–27 | rewrite (proposal only) | Preserve migration into pass, stdin-only insertion, no transcript/argument secret values, names-only inventory, and exact project references. Narrow the blanket “every repo” mandate to relevant authorized work. |
| 29–33 | rewrite (proposal only) | Preserve the no-rotation-until-diagnosis rule and update-all-consumers requirement; scope “all four sources” to relevant authorized sources rather than requiring broad machine-wide searches. |

### `agent-config/guidance/design-routing.md`

| Original lines | Disposition | Reason |
|---|---|---|
| 1 | keep | Shared section heading. |
| 3–6 | keep | Trigger boundary and concept/critique/recombination/spec route for substantive UI design. |
| 7–10 | keep | Explicit trivial-change exception, no implicit live-product approval, and mockup-versus-real-rendered QA distinction. |
| 12–22 | keep | Design-check, accessibility, supported detector, type-size/background checks, and finding-location requirements are concrete quality gates not fully duplicated in the design-studio skill. Do not drop as token-only cleanup. |

### `agent-config/guidance/effective-verification.md`

| Original lines | Disposition | Reason |
|---|---|---|
| 1 | keep (inactive in default composition) | Heading for a source not selected by either harness installer. |
| 3–6 | keep (inactive in default composition) | Evidence/test-quality and child-context requirements are useful source policy but contribute **zero** tokens to the current default composed prompt. Do not claim deleting this file saves runtime tokens. |

### `agent-config/guidance/host-resources.md`

| Original lines | Disposition | Reason |
|---|---|---|
| 1 | keep | Shared section heading. |
| 3 | keep | Establishes shared desktop RAM constraint. |
| 5–7 | keep | Off-host heavy execution, bounded local work, runner caps, and scratch-resource policy are safety/resource constraints. |
| 8–12 | keep | Existing-run/worktree hygiene and ownership/delegation boundaries. |
| 13–18 | move (proposal only) | Lease/create/close details substantially overlap the simultaneously injected `session-close.md` and the existing session-close skill. Consolidate only if the same-turn lease, inspect-before-remove, owned-resource-only, and empty-store limitation remain in the canonical session-close route. |

### `agent-config/guidance/pokayoke.md`

| Original lines | Disposition | Reason |
|---|---|---|
| 1, 3 | keep | Error-class structural prevention; concise and outcome-relevant. |

### `agent-config/guidance/session-close.md`

| Original lines | Disposition | Reason |
|---|---|---|
| 1, 3, 5–8, 10–11 | keep | Fail-closed completion, same-turn create-time lease, resource ownership, and unleased-create limitation. This is the canonical global route for the matching session-close skill. |

### `agent-config/guidance/user-stories.md`

| Original lines | Disposition | Reason |
|---|---|---|
| 1, 3 | keep | Root artifact, falsifiable criteria, unique IDs, and operator authority. Compact enough to keep globally; do not move the core user-story boundary out of standing guidance. |

### `omp-config/extensions/credentials/index.ts`

This table includes all nonblank source ranges in the file so implementation comments and hook behavior are not mistaken for prompt text. “Not injected” means source code/comments, not a live prompt instruction.

| Original lines | Disposition | Reason |
|---|---|---|
| 1–2 | keep (not injected) | Extension API and process helper imports. |
| 4–14 | rewrite only if implementing flag (comment, not injected) | Documents the three behaviors; line 9 currently states every start includes all names, so qualify it as the default and document the on-demand branch. |
| 16–17 | keep | Idempotence marker and reminder type; the proposed compact section can reuse the marker. |
| 19–24 | keep (not injected) | Generic-name filter used for entry matching. |
| 26–35 | keep (not injected) | Loads names via `pass-env list`; cache remains useful for conditional reminders. |
| 37–43 | keep (not injected) | Service-token normalization. |
| 45–50 | keep (not injected) | Entry matching. |
| 52–57 | keep (not injected) | Auth-failure detection. |
| 59–64 | keep (not injected) | Unavailable-claim detection. |
| 66–79 | rewrite only in opt-in mode; default keep | Startup inventory prompt strings. Replace the full list only when `OMP_CREDENTIAL_CONTEXT=on-demand`; with the flag unset, retain the current inventory text unchanged. |
| 81–89 | keep | Conditional result/claim reminder strings. They preserve targeted lookup and distinguish a rejected entry from an absent one. |
| 91–96 | keep (not injected) | Tool/message text extraction. |
| 98–107 | rewrite only for opt-in branch; default path unchanged | Existing `before_agent_start` hook supports this experiment. Short-circuit to a compact pointer when explicitly enabled; keep the existing inventory path as the default. |
| 109–118 | keep | Preserve the existing auth-looking bash-result trigger and matching-entry reminder. |
| 120–135 | keep | Preserve unavailable-claim matching, once-per-service/session deduplication, and follow-up delivery. |

## Implemented prompt diff (US-019)

Global guidance and upstream system/tool templates are unchanged. With
`OMP_CREDENTIAL_CONTEXT=on-demand` at extension load, the following replaces
only the startup inventory section. The default still emits the original.
The inventory had 90 names when measured; names are not reproduced here.

```diff
 ## Credential inventory (pass)
 
-These pass entries exist on this machine (names only; values stay encrypted). A credential
-listed here is available: bind it with `pass-env run -e NAME=entry -- <command>`, or use a
-project's `.env.pass` with `pass-env run -f .env.pass -- <command>`. Before saying any
-credential is unavailable, check this list and `pass-env list <term>`, and check native
-logins (`gh auth status`, `wrangler whoami`, `~/.convex`). Public values such as a Sentry
-DSN can be read from the issuer's API with the stored token.
-
-[90 individual pass-entry name lines]
+Credential names are discoverable with `pass-env list [prefix]` (names only; no decryption).
+Check native tool auth first, then the pass inventory and the project's `.env.pass`.
+`skill://authenticated-commands` describes lookup and selective binding; the standing
+credential guidance covers the remaining sources before concluding a credential is unavailable.
```

| Original rendered line | Disposition | Reason |
|---|---|---|
| 1: heading | keep | Same marker preserves idempotence. |
| 2: blank | keep | Section structure, no instruction. |
| 3: inventory exists/names encrypted | rewrite | Describe discoverability without enumerating the changing inventory; keep names-only access. |
| 4: available/bind command | move | Binding syntax already belongs to the authenticated-commands skill; preserve access path. |
| 5: project binding/claim preamble | rewrite/move | Keep project references in the compact pointer; detailed binding stays discoverable. |
| 6: list/term/native check | rewrite | Preserve lookup, using the actual literal-prefix interface rather than an apparent substring search. |
| 7: native examples/public DSN preamble | move | Native-first order stays; command examples and service details remain in standing guidance/skill. |
| 8: DSN retrieval | move | Existing authenticated-commands and source-ordered recovery remain available; no issuer call is removed. |
| 9: blank | delete | No expanded list remains in this variant. |
| 10–99: every pass entry name | move | All 90 names remain discoverable via names-only `pass-env list`; no store entry is deleted. |
| New 3 | rewrite | Names-only discovery pointer; no request to reason less. |
| New 4 | keep/rewrite | Native-first lookup and project reference, condensed from existing policy. |
| New 5–6 | move | Explicit pointers to binding instructions and the remaining credential-source checks. |

The flag is sampled once per extension instance, not on each request. Changing
the environment of a running session does not rewrite its prefix. Restart with
the flag unset to restore the inventory. Auth-failure result text is unchanged.

A focused regression found the old claim-reminder implementation violated its
own once-per-entry intent: after filtering already-reminded entries, an empty
list was treated as an unmatched claim and sent a second generic follow-up.
The direct fix separates matched-entry state from unmatched-claim state. The
prompt wording is unchanged; the unnecessary second generated turn is removed.
This supersedes the audit table's assumption that the old deduplication worked.

Measured section size: 1,124 → 74 `o200k_base` tokens and 2,354 → 126
`claude-v5` tokens. These are tokenizer measurements, not billed task savings.
The native pre-dispatch smoke used one synthetic entry, not the live 90-entry
store. See the [report and promotion plan](token-efficiency.md).
