# Media policy — generated images inside the design loop

Images buy **breadth cheaply**. They never replace structural thinking, real HTML, or
rendered-state QA. This policy is provider-neutral: access is a separate question from
quality, cost, latency, and availability.

## What generation is for

- Moodboards, styleframes, palette/material studies, radical visual compositions.
- Typography and label studies **when the evaluation target is typography** (include exact
  strings deliberately; record that mode). Otherwise keep prompts abstract of legible text.
- Reference-image edits and multi-screen coherence studies when the backend supports edits.

Not for: proof of UX, accessibility, behavior, or final UI. A generated dashboard image is
evidence of a mood, nothing else — and generated images often show cloned rows, invented
charts, and low-contrast details; critique them like any artifact and rebuild the good
parts in HTML. Never present a styleframe as validation.

## Provider-neutral selection

Judge separately, and never collapse into "the one we have credentials for":

1. **Access** — which backends this session/profile is actually authorized to use.
2. **Quality (task-specific)** — layout fidelity, exact text/typography, reference
   adherence, radical composition, edit consistency, multi-screen coherence.
3. **Cost** — per-image pricing from official sources at time of use; distinguish
   estimated cost from returned usage/charges.
4. **Latency and reliability** — observed per-call times; retry behavior; failure modes.

Survey the current credible contenders (e.g. OpenAI/ChatGPT image generation — API model
vs consumer feature are different products; Google Gemini image models; Microsoft MAI;
xAI Imagine; other current SOTA). Resolve exact model IDs, capabilities, and prices from
official sources at use time — never from memory or marketing. Community sentiment and
independent benchmarks guide the shortlist; matched, repeated design-task evaluations
decide per-stage recommendations. Prefer blind comparison; record all outputs and
failures, not just the best sample. Until an independent evaluation is incorporated,
selection is **provisional** and must be labeled as such. Recommend by design stage
(moodboard vs typography vs edit) rather than declaring a universal winner.

## Access rules (Hermes and beyond)

- Use only backends the current profile is authorized for. In Hermes profiles, an
  authenticated adapter may exist (e.g. an authorized xAI resolver); a native image tool
  may also be available. Credential availability is **not** a quality recommendation.
- Never print, copy, or export credentials; resolve them inside the runtime's own helper.
- Never borrow another profile's credentials without authority. No specialist assumes an
  OAuth provider exists — verify access first, record what was verified.
- Record per artifact: provider, model (as returned/confirmed by the API), settings,
  prompt, file hash, latency, and cost accounting (estimate labeled as estimate).

## Workflow

1. Write a jobs file (JSON list) — one job per concept artifact, with `id`, `prompt`,
   aspect/resolution, and optional model override.
2. Run the batch through an adapter with a bounded budget and bounded retries (max 2 per
   job). The bundled adapter is [../scripts/imagine.py](../scripts/imagine.py) (one
   practical backend; add adapters per the evaluation findings — do not hardwire a default).
3. Each artifact gets a provenance sidecar (`<id>.provenance.json`). Keep generated
   images and their provenance together.
4. Build a contact sheet (simple HTML grid from the sidecars) for comparison.
5. Critique the artifacts; graft only what serves the job.

## Budget and accounting

- Default exploratory cap: **$3.00 per substantial round** unless the operator sets one.
  Check current official per-image pricing before a batch and size the batch to the cap.
- The API may not return charges; record observable facts (requests, bytes, latency) plus a
  labeled estimate. Never fabricate costs or usage. If generation is blocked (access,
  quota, outage), record the exact attempts and continue with text/diagram/HTML breadth —
  do not stall the loop and do not invent results.

## Handling

- Do not commit binary outputs into repositories. Keep run artifacts in the declared
  durable location for the task (e.g. a reports directory), with the evidence manifest
  distinguishing generated images from real browser screenshots.
- Prompts must not contain secrets or sensitive product data. Do not use brand logos or
  named people's likenesses; anonymous figures only.
