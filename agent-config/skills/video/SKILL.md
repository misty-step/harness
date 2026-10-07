---
name: video
description: Make a short explainer or intro video for any project as code (GSAP timeline, deterministic frames, real footage, fresh-critic loop, measured quality bar).
argument-hint: "[project, audience, length]"
---

# Video

Videos are first-class project material: README, docs and launch pages each get
one. Goal: a short film a viewer understands with the sound off, built as code so
any frame re-renders identically and a fix is a diff. Method: the open-source kit
[echris6/motion-video-kit](https://github.com/echris6/motion-video-kit) at commit
`255562b04b1e5ecaa4ba98e5c9aa191d5ba7f6fa` (MIT; `business-motion-film/SKILL.md`
and its `references/`, read as you reach each step; re-pin if you update it). Its
rules, critic prompts and quality bar win over defaults.

Effort: hours, not one pass. The 80 s Tach and Nopalito film took four parallel
builders about 75 minutes, a 27-minute critic round, a 40-minute revision and a
polish; the first build of every act failed the frozen-time bar.

## Facts that bite

- Every on-screen word or number comes from a `FACTS.md` line citing the run or
  file it came from. Unshipped capability is shown as "Next, in progress". Label
  synthetic people, pre-production and sped-up footage on screen.
- Real footage: record the real product, extract frames, pick them as a pure
  function of time, upscale at most 1.6x. Scan every frame for secrets, tokens,
  hostnames, internal rows and error pages; crop or mask them.
- Determinism: every value is a function of timeline time; no timers, `Date`,
  random, rAF, CSS animations or video elements. Set `gsap.config({force3D:false})`,
  repaint after each seek, never overlap two tweens on one property of one target.
- `film.html` sets `window.__built = true` and exposes `window.__seek(t)`.
  `bun scripts/render.ts FILM_DIR OUT FROM TO [workers] [query]` screenshots each
  frame (run full renders under `desktop-guard run --` with a worker cap; test a
  5 s range first), then `scripts/encode.sh OUT FIRST_FRAME film.mp4`.
- Sound: music at the film's tempo (generated with model, prompt and seed recorded,
  or a cleared track from its official download, never scraped previews), scene
  changes on the beat, master near -16 LUFS with true peak under -1 dB. Ship
  licences for fonts, GSAP and audio with the source.

## Verify

`bun scripts/determinism.ts FILM_DIR "" "1,3.3,0.2"` must print `deterministic`.
The builder never grades its own pixels: each round, brief a fresh visual critic
(`designer` subagent or the `vision` role, never a `task` agent; stop rather than
fall back to another model family) with what to judge (the render, brief, facts
and the kit's critic prompts), the bar (no still stretch over about 0.5 s, frozen
time near 1 s per 30 s, kit contrast and loudness scripts) and that it measures
its own frames. Record the resolved model, findings and before/after numbers in
a ledger; the next critic checks each finding and hunts regressions.

Deliver a 1920x1080 60 fps MP4, a music-only MP4, a contact sheet, the critic
ledger, `FACTS.md` and the source on one review page that separates what was
measured from what a human must still watch or hear.
