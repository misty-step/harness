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
- Sound: see Sound below. Ship licences for fonts, GSAP and audio with the source.

## Sound

Agents cannot hear. Measurements reject bad music; only a person's ear approves
it, and no film ships on music nobody has listened to. The family-firm films
shipped one unscreened, unheard Stable Audio 3 Medium take each: hiss and noise
bursts 24 dB under the guitar and piano, clipped at the source. Loudness was fine.

1. **Source.** Record model, endpoint, prompt and seed, or the official download
   URL and licence, in `NOTICE.md`.
   - fal (`FAL_API_KEY` through `pass-env`; model page says "Commercial use"):
     MiniMax Music 2.6 `fal-ai/minimax-music/v2.6` (`is_instrumental`, $0.15,
     ignores length and tempo, takes vary widely), Lyria 3 Pro `fal-ai/lyria3/pro`
     ($0.08, refuses some prompts), Stable Audio 2.5
     `fal-ai/stable-audio-25/text-to-audio` ($0.20, set `seconds_total`).
     OpenRouter's only music models are the same Google Lyria 3; skip it.
   - Cleared library, official download only, never a preview or scrape: CC0, or
     CC BY with the credit line in the note that goes with the film (never NC).
     Kevin MacLeod: `https://incompetech.com/music/royalty-free/pieces.json`
     lists tracks, bpm and instruments. Open Goldberg Variations (CC0):
     archive.org item `OpenGoldbergVariations`.
   - Never: Stable Audio 3 Medium for acoustic music, ElevenLabs on a free plan,
     unofficial gateways to any service.
2. **Candidates.** Per film, three takes from each of two models plus a library
   track. The brief names instruments, tempo and mood, says "no drums, no vocals"
   and asks for a final chord that rings out. A model that won one listening is
   not a default.
3. **Screen.** `uv run --no-project --python 3.12 --with numpy --with scipy --with
   librosa --with soundfile --with pyloudnorm python scripts/music.py screen TAKE...`
   rejects hiss (8-16 kHz energy over -40 dB under the 0.1-2 kHz body, or within
   30 dB of it in over 25% of 0.1 s frames) and clipping. Real recordings and
   clean takes sit at -44 to -70 dB; electronic briefs are exempt from the hiss rule.
4. **Fit and master.** `scripts/music.py fit TAKE OUT.wav --len FILM_SECONDS` keeps
   the opening, joins the take's own ending at beats with matching harmony, fades
   only when the take has none, and masters to -16 LUFS with the limiter at -2 dBTP
   so AAC stays under -1 dBTP. Check each join in a spectrogram. Mux with the
   picture's video stream copied; never single-pass `loudnorm` in the render. A
   calm bed without a pulse needs no beat alignment; a pulsed track is stretched
   so the main scene changes land on bar lines.
5. **Listen.** Publish three or four mastered candidates per film on a page that
   works on a phone: plain labels, a 30 s sample and the whole track each, the film
   with it, licence and credit line, screen numbers marked measured, not heard.
   A named person picks by ear; record the pick; re-score at the same paths.
   Say in the report that no agent listened.

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
