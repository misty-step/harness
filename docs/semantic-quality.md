# Semantic quality checks

Status: The shared engine is merged. Profile enablement and project adoption are
separate, scoped actions. Existing sessions do not reload the adapter on their own.

The shared engine evaluates test evidence and completion claims. It uses fixed Choice
outcomes. It returns advisory records. It never changes the real index, worktree, or
refs. Worktree snapshots may add non-excluded blobs and trees to the local object database.
It never replaces deterministic checks.

## Source layout

- `agent-config/system-one/semantic-quality.ts` defines questions and three initial rules.
- `agent-config/system-one/semantic-git.ts` freezes Git snapshots and selects anchored evidence.
- `agent-config/system-one/semantic-cache.ts` stores versioned content judgments without source text.
- `agent-config/system-one/semantic-run.ts` emits human and machine records.
- `agent-config/bin/semantic-check.ts` is the CLI entrypoint.
- `agent-config/candidates/effective-verification/SKILL.md` contains the review procedure and child mandate.
- `agent-config/guidance/effective-verification.md` is the short shared guidance candidate.
- `hermes-config/candidates/plugins/semantic-quality/` is the source-only Hermes adapter candidate.

`test-audit` owns test authoring, consolidation, and pruning. This unselected
candidate judges whether test or execution evidence supports a claim; its
advisory model never becomes a second test policy.

The three rules are `circular_oracle`, `source_only_behavioral_proof`, and
`unsupported_completion`.
Source inspections use the source-only rule. They do not also trigger the runtime-oracle rule.

## Provider and result contract

Use the existing OpenRouter Decisions credential. Do not add another provider or key.
The requested model is `typesafe/jev-1.13`. The approved resolved revision is
`typesafe/jev-1.13-20260917`.

Machine records keep expected provider, actual provider, requested model, and resolved
model identities separate. An unexpected provider route, requested alias, or resolved
revision suppresses findings and produces an explicit abstention. Update approved
metadata only after a scoped evaluation.

Each rule returns one status:

- `finding`: inspect the fixed message and local anchors.
- `no_finding`: the rule found no concern. This is not correctness proof.
- `abstained`: required context was missing, truncated, or outside a bound.
- `unavailable`: transport, quota, timeout, parser, or typed-answer validation failed.

The CLI exits zero for advisory outcomes. Invalid invocation exits two. Provider
failure never becomes `no_finding`.

## Foundation assessment pilot

`bun agent-config/bin/foundation-assess.ts --repo DIR --pack all --json`
reads only tracked Git content at `origin/HEAD` (falling back to `HEAD`).
Use `--ref REF`, `--pack sentry|postmortems|ledger`, `--provider heuristic|openrouter`,
and `--timeout-ms N` to scope a run. The OpenRouter run uses the existing
`pass-env run -f .env.pass -- bun ...` credential path. Results are
`foundation-assessment-1` advisory evidence: neither a gate nor a change to
foundation disposition, and never a replacement for a drill or walk. Uncertain
answers escalate to a frontier agent; outages are unavailable, not clean results.
The offline heuristic is uncalibrated for these rules and abstains, rather than
reporting a clean pass. Sentry alert routing in the Sentry API is outside
repository evidence. Sentry answers come from static code excerpts, which can
show that a setting exists but never that it does not, so any Sentry answer that
would conclude an absence abstains. A confident Sentry answer can still be wrong
when the excerpts miss a later override; the coverage manifest lists what the
distiller knows it skipped and is not a proof of completeness. The ledger pack
asks about rules written one per bullet or numbered item; prose under an
invariants heading is listed as not assessed, because line breaks do not mark
where one rule ends.

Admit any pilot rule only after naming its failure and valid counterexample,
checking whether deterministic code can decide it, and reviewing labeled
held-out examples, misses, abstentions, latency, and resolved model identity.
The pilot stays advisory (US-042, ADR-006): a finding reaches a gate only when
a deterministic check replaces it, and any other move off advisory-only use
needs an operator-approved amendment to ADR-003, which keeps Jev off required
checks.

## Build and exercise an installed entrypoint

Do not modify the shared installer during the candidate stage. Build one bundled
entrypoint into a disposable prefix:

```sh
prefix=/path/to/disposable-prefix
mkdir -p "$prefix/bin"
bun build agent-config/bin/semantic-check.ts \
  --target=bun --outfile "$prefix/bin/semantic-check"
chmod 700 "$prefix/bin/semantic-check"
"$prefix/bin/semantic-check" --help
```

The bundle retains the shared engine. It does not duplicate rule prompts.

Run an immutable index snapshot:

```sh
OPENROUTER_API_KEY=... "$prefix/bin/semantic-check" \
  --repo "$repo" --staged --json
```

Run a frozen working tree, including untracked shell-created files:

```sh
OPENROUTER_API_KEY=... "$prefix/bin/semantic-check" \
  --repo "$repo" --worktree --json --no-cache
```

Run outgoing ref updates by passing the exact pre-push input on standard input:

```sh
"$prefix/bin/semantic-check" --repo "$repo" --outgoing --json <ref-updates.txt
```

Assess a completion claim only with immutable receipt paths from the selected snapshot:

```sh
"$prefix/bin/semantic-check" --repo "$repo" --staged --json \
  --claim "The focused test passed." \
  --receipt reports/focused-test.txt
```

`--fixture` is only for deterministic tests and offline evaluation. It is never the
production provider fallback.

## Advisory Git integration

Preserve the exact deterministic exit. Run the semantic check after capturing it:

```sh
set +e
./existing-deterministic-check
deterministic_status=$?
semantic-check --repo "$PWD" --staged || true
exit "$deterministic_status"
```

A pre-push hook must buffer every input line before analysis:

```sh
updates=$(mktemp)
trap 'rm -f "$updates"' EXIT HUP INT TERM
cat >"$updates"
semantic-check --repo "$PWD" --outgoing <"$updates" || true
```

The outgoing adapter handles multiple updates. It reports new refs, deleted refs,
and missing bases as explicit abstentions. It does not guess a branch base.

Do not call the provider from Oxlint callbacks. A later Oxlint adapter may only display
valid cached findings.

## Trusted CI

`.github/workflows/semantic-advisory.yml` runs the pinned checker on same-repository
pull requests. It uses `pull_request_target`, so GitHub reads the workflow from the
default branch. The job never checks out, installs, or runs pull request content.
It fetches the exact head and base commits into a bare repository as data.
Only the checker step receives `OPENROUTER_API_KEY`. The job token has no permissions.
Fork pull requests skip the job. An `unavailable` result fails this non-required job.
It is not a clean result. Required checks stay in their own workflows.
Adopt it in another public repository by copying the file unchanged.
The job fetches anonymously, so a private repository needs a reviewed token change first.
Never give a provider key to a job that runs pull request code.

## Hermes source adapter

The candidate plugin registers the supported `pre_verify` hook. It invokes the same
bundled CLI with `--worktree`. It may request one additional verification turn. It
never blocks completion, and it does not repeat the provider call on later attempts.
Shadow mode writes bounded source-free run metadata. This includes provider and model
validation, snapshot object IDs, counts, and rule identifiers. It caps the active
JSONL file at 256 KiB. It never writes source, paths, reasons, anchors, prompts, or
provider answers.
Advisory messages name each rule, its first path and line, and the fixed rule reason.

The plugin settings are:

- `mode`: `off`, `shadow`, or `advisory`.
- `engine_path`: the installed bundled entrypoint source path.
- `timeout_ms`: the Decisions request timeout.
- `process_timeout_seconds`: the outer process timeout.

The rollout owner must use supported Hermes plugin configuration. The rollout owner
must verify a fresh process load. Existing loaded sessions remain unproven until they
restart or reload.

The Jev skill suggestion source reads `jev_model`. The reserved `model` key is ignored.

## Pilot sequence

1. Build the bundled entrypoint in a disposable prefix.
2. Run labeled synthetic fixtures without network access.
3. Export `OPENROUTER_API_KEY` through the approved secret launcher.
4. Run this command from the repository root:

```sh
bun agent-config/bin/semantic-held-out.ts \
  --fixture agent-config/system-one/fixtures/semantic-quality/held-out-public.json \
  --max-cases 24 --timeout-ms 15000 --json
```

The runner sends candidates without labels. It compares adjudicated labels after inference.
The hard budget is 64 cases. The default uses four cases per batch and two concurrent requests.
The six-case public fixture uses at most two provider requests.

Accept the source-only evaluation only when all conditions hold:

- The resolved model matches the pinned revision.
- All six cases run.
- All ten rule labels match.
- False positives, misses, abstentions, missing outcomes, and unavailable cases are zero.

Exit `0` means pass. Exit `1` means measured failure. Exit `3` means unavailable.
An unavailable run prints `metrics: null`; it never invents scores.
Any nonzero exit or model drift stops rollout. Keep the adapter source-only and inspect evidence.

Continue the pilot only after the held-out report passes:

5. Review every false positive, miss, abstention, and unavailable result.
6. Pilot the same engine in one application repository.
7. Pilot it in one infrastructure repository.
8. Add advisory hooks without changing deterministic exits.
9. Load the Hermes adapter in a fresh process.
10. Record configured, loaded, and observed states separately.

Use the mandate in `agent-config/candidates/effective-verification/SKILL.md` for isolated
children. Include exact behaviors, commands, environment, and acceptance criteria.

## Rollback

1. Set the Hermes adapter mode to `off` with supported configuration.
2. Remove the advisory Git hook lines.
3. Remove the bundled `semantic-check` entrypoint.
4. Remove `.git/semantic-quality-cache` if local cache data is no longer useful.
5. Re-run deterministic checks and confirm their exit remains unchanged.

Rollback needs no provider write. It does not remove deterministic tests or evidence.

## New project onboarding and rule admission

New projects can pin this repository's merged revision, run `semantic-check` in
staged, outgoing, and CI contexts, and load the `effective-verification` skill from
`agent-config/candidates/effective-verification/SKILL.md`. An isolated child needs
the skill's explicit verification mandate; availability alone is not adoption.
Existing projects adopt during a scoped change, not a bulk instruction rewrite.
Record the revision, actual invoked path, one meaningful finding, a valid exception,
and unavailable behavior. Keep project gates authoritative.

Admit a new semantic rule by versioning its question and composition. Name a real
failure, closest valid counterexample, required evidence, and owner. First check
whether deterministic code can prove the fact. Run labeled examples and held-out
cases with the approved provider route. Record false positives, misses, abstentions,
latency, and actual provider usage. Keep the rule advisory until an independent,
task-specific promotion record justifies a narrow block and rollback. Uncertain
findings feed grounded context to a strong agent; a probability is not permission.
