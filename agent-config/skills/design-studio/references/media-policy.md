# Generated media

Use software-screen mockups for cheap breadth: layout/content models, type,
hierarchy, visual language, exact-label exploration, and supported reference edits.
Moodboards are supporting artifacts. Raster proposals do not prove UX,
accessibility, behavior, or final UI; rebuild promising pieces in the real stack
and inspect labels, cloned rows, invented charts, and contrast.

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

## Choose and run

Resolve current model IDs, capabilities, access, and official prices at use time.
Evaluate layout/text fidelity, edit adherence, coherence, cost, and latency
separately; available credentials are not a quality recommendation. Matched,
repeated task comparisons support stage-specific choices, not a universal winner.
Label unevaluated selection provisional and retain failures as well as successes.

Current-profile adapters/native tools own credential resolution; another
profile's OAuth is not implied. Record confirmed provider/model, settings,
prompt, hash, latency, and cost for each artifact. Separate returned charges,
estimates, and reserves for subscription paths without billing.

Bundled [imagine.py](../scripts/imagine.py) supports an xAI batch path:

- Jobs JSON supplies `id`, `prompt`, aspect/resolution, optional model override,
  and `price_usd`; alternatively provide `--price-per-image`.
- Price evidence is required; unknown pricing exits 3. The adapter caps retries
  at two per job and writes `<id>.provenance.json` sidecars.
- Default cap is $3 per substantial round (`--budget-usd` or
  `DESIGN_STUDIO_BUDGET_USD` overrides it). Size the batch against current prices.

Compare outputs in a contact sheet, critique, and graft what serves the job.
Blocked access/quota/outage can still permit text/diagram/HTML exploration;
report actual attempts, never invented images or charges.

Keep media and provenance together in the task's retained artifact location,
outside Git. The evidence manifest distinguishes generated images from real
screenshots. Prompts contain no secrets or sensitive product data; use anonymous
figures rather than named likenesses and avoid brand logos.