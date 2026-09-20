# Media policy — generated images inside the design loop

Generated images buy **breadth cheaply** — above all as software-interface mockups. They
never replace structural thinking, real HTML, or rendered-state QA. This policy is
provider-neutral: access is a separate question from quality, cost, latency, and availability.

## What generation is for

- **Software-screen mockups for early exploration**: IA and layout proposals, navigation and
  content-model sketches, typography studies, component and content-hierarchy compositions,
  visual language, and iterative reference-conditioned edits of a mockup. Include exact
  labels and copy when the evaluation target is legibility or IA — and record that mode.
  Radical variants must still be recognizable, useful software, not decorative dioramas.
- Reference-image edits and multi-screen coherence studies when the backend supports edits.
- Moodboards, styleframes, and palette/material studies as optional supporting artifacts.

A mockup is a **visual proposal**: it may propose exact text and layout; rendered UI on the
actual stack must verify them. Generated images are never proof of UX, accessibility,
behavior, or final UI, and screenshots of raster mockups are not interaction evidence.
Critique generated mockups like any artifact — they often show cloned rows, invented charts,
and low-contrast details; graft what serves the job and rebuild the good parts in HTML.

## Evaluated evidence (2026-09-19, dated)

An independent preregistered bake-off evaluated backends on the software-mockup target:
34 provenance-backed samples across 11 models / 6 provider families, with a corrected
protocol addendum written before the final round and two blind visual reviews. Headline
findings, with corrected accounting:

- **Best mockup generation by blind visual score** (2 trials each): `openai/gpt-5.4-image-2`
  (OpenRouter chat, ≈$0.14/image returned) top-tier; GPT-image-2 via Codex OAuth top-tier
  (subscription path — no per-call billing returned, entitlements unverified); Grok
  Imagine 2.0 (xAI OAuth) strong. `google/gemini-3-pro-image` (Nano Banana Pro) transcribed
  exact strings and was the best reference-edit backend; one of its two trials was sparse.
  `meta/muse-image` is cheap (≈$0.01) but missed a required project label in 1 of 2 trials —
  verify outputs. Do not use `bytedance-seed/seedream-5-0-pro` for label-critical mockups
  (both corrected trials corrupted required strings). Label-risk elsewhere (MAI, FLUX,
  GPT-5-mini string failures) is recorded in the study.
- **Edits**: Nano Banana Pro best; GPT-image-2/Codex most literal row replacement.
- **Cheap iteration / breadth**: Muse, FLUX 2 Pro, MAI-2.5, NB2 — inspect labels.
- **Spend for the study** (corrected): 24 calls returned $1.973932 total; 10 samples
  returned no billing (5 Codex + 5 xAI) and are carried as labeled reserve estimates of
  $1.20 at $0.20/$0.04 per-image upper bounds; $0.0894 delegated-review cost — within its
  $10 cap.
- **Caveats**: small samples (2 blind-scored trials in the final round); blind review judged
  by a vision model (judge bias disclosed); raster-only — navigation and selection behavior
  unproven by any image; subscription-path costs are unverified reserves; no universal
  winner — route per phase.

Treat this section as dated evidence, not policy constants. Re-resolve exact model IDs and
prices from official sources at use time, and version this section when a newer evaluation
lands instead of overwriting silently.

## Provider-neutral selection

Judge separately, and never collapse into "the one we have credentials for":

1. **Access** — which backends this session/profile is actually authorized to use.
2. **Quality (task-specific)** — layout fidelity, exact text/typography, reference
   adherence, radical composition, edit consistency, multi-screen coherence.
3. **Cost** — per-image pricing from official sources at time of use; distinguish
   estimated cost from returned charges and reserves.
4. **Latency and reliability** — observed per-call times; retry behavior; failure modes.

Survey the current credible contenders (e.g. OpenAI/ChatGPT image generation — API model vs
consumer feature are different products; Google Gemini image models; Microsoft MAI; xAI
Imagine; other current SOTA). Resolve exact model IDs, capabilities, and prices from
official sources at use time — never from memory or marketing. Community sentiment and
independent benchmarks guide the shortlist; matched, repeated design-task evaluations
decide per-stage recommendations. Prefer blind comparison; record all outputs and failures,
not just the best sample. Until an evaluation is incorporated for your task, selection is
**provisional** and must be labeled as such. Recommend by design stage (breadth vs
label-critical mockup vs edit) rather than declaring a universal winner.

## Access rules (Hermes and beyond)

- Use only backends the current profile is authorized for. In Hermes profiles, an
  authenticated adapter may exist (e.g. an authorized xAI resolver); a native image tool
  may also be available. Credential availability is **not** a quality recommendation.
- Never print, copy, or export credentials; resolve them inside the runtime's own helper.
- Never borrow another profile's credentials without authority. No specialist assumes an
  OAuth provider exists — verify access first, record what was verified.
- Record per artifact: provider, model (as returned/confirmed by the API), settings,
  prompt, file hash, latency, and cost accounting (estimate vs returned vs reserve, labeled).

## Workflow

1. Write a jobs file (JSON list) — one job per mockup artifact, with `id`, `prompt`,
   aspect/resolution, optional model override, and `price_usd` (price evidence for the cap).
2. Run the batch through an adapter with the budget cap enforced and bounded retries (max 2
   per job). The bundled adapter [../scripts/imagine.py](../scripts/imagine.py) is one
   practical backend (xAI path); add adapters per the evaluation findings — do not hardwire
   a default. It requires caller-supplied price evidence (`--price-per-image` or per-job
   `price_usd`), enforces the cap against it, and fails closed (exit 3) when price is unknown.
3. Each artifact gets a provenance sidecar (`<id>.provenance.json`). Keep generated images
   and their provenance together.
4. Build a contact sheet (simple HTML grid from the sidecars) for comparison.
5. Critique the artifacts; graft only what serves the job.

## Budget and accounting

- Default exploratory cap: **$3.00 per substantial round** (adapter default; override with
  `--budget-usd` or `DESIGN_STUDIO_BUDGET_USD`). Size the batch to the cap using current
  official pricing recorded at use time.
- Distinguish **returned charges** (provider reports an amount), **estimates** (labeled
  arithmetic), and **reserves** (subscription paths that return no billing — carry an
  explicit per-image upper bound). Never fabricate costs or usage.
- If generation is blocked (access, quota, outage), record the exact attempts and continue
  with text/diagram/HTML breadth — do not stall the loop and do not invent results.

## Handling

- Do not commit binary outputs into repositories. Keep run artifacts in the declared
  durable location for the task (e.g. a reports directory), with the evidence manifest
  distinguishing generated images from real browser screenshots.
- Prompts must not contain secrets or sensitive product data. Do not use brand logos or
  named people's likenesses; anonymous figures only.