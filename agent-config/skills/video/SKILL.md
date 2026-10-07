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
it, and no film ships on music nobody has listened to. Two ways it went wrong: the
family-firm films shipped one unscreened, unheard Stable Audio 3 Medium take each
(hiss and noise bursts 24 dB under the instruments, clipped at the source); the
replacement round was clean but ballads, the wrong brief. A promo film wants a bed
that drives the cut and sits under on-screen text, not a piece to be listened to.

1. **Brief the job, not a mood.** Write down the film's length, scene-change times,
   whether there is a voice or only text, and the emotional arc (hook, steady
   middle, one lift near the end, resolve). Editors' rule for a bed: instrumental,
   steady pulse, medium energy, no lead melody competing with the words, midrange
   left open, dynamics even, movement kept for the section changes, and a real
   ending. Tempo by job: 60-85 BPM calm and weighty, 85-115 the explainer range,
   115-140 energetic; a text-only promo can take the top (we used 125). Library
   tags for these beds: corporate, upbeat, inspiring, with guitar or piano, claps,
   soft kick.
2. **Prompt each model the way its maker says.** One prompt per direction:
   [genre and style] + [mood] + [named instruments] + [tempo and rhythm], then the
   use ("an instrumental bed for a 72 s business promo with text on screen"), then
   the negatives (no vocals, no dominant melody, no big drops, risers or trailer
   hits) and the arc.
   - Lyria 3 Pro (`fal-ai/lyria3/pro`, $0.08; Google's guide): timed sections
     work, so write `[00:00]` ... `[01:10]` lines for the intro, the groove, the
     lift and the final chord at the film's times. It held the asked tempo in every
     125 BPM take but started the groove later than asked. Some prompts are
     refused by the content filter at random; do not rephrase to dodge it.
   - Stable Audio 2.5 (`fal-ai/stable-audio-25/text-to-audio`, $0.20; Stability's
     guide): style, then instruments, mood, details; say the use ("perfect for a
     business promo") and the BPM in plain text; set `seconds_total`; no section
     tags. 6 of 8 takes passed the screen; no timeline control, so the groove
     structure is left to the model.
   - MiniMax Music 2.6 (`fal-ai/minimax-music/v2.6`, $0.15; MiniMax's guide):
     sentences like a brief to a musician, BPM and a scene in them,
     `is_instrumental`, section tags in `lyrics`. It ignores tempo and length and
     was noisy or unfittable on these briefs (1 of 16 takes fitted); not a default.
   - Stable Audio 3 Medium adds hiss to acoustic and beat music alike; never use it.
     OpenRouter's only music models are the same Lyria 3; fal is the route.
3. **Directions, not takes.** Per film, four directions that differ in instruments
   and feel (for example strummed-acoustic groove, clean electronic pulse, hand
   percussion with almost no melody, half-time beat), two or three takes of each
   from the model that follows that direction best. Five takes of one mood is not a
   choice. Add a cleared library track only when it matches a direction. Library:
   official download only, never a preview or scrape; CC0, or CC BY with the credit
   line in the note that goes with the film (never NC); Kevin MacLeod
   (`incompetech.com/music/royalty-free/pieces.json` lists bpm, instruments), Open
   Goldberg Variations (CC0). Record model, endpoint, prompt and seed or the
   download URL and licence in `NOTICE.md`. Never ElevenLabs on a free plan or an
   unofficial gateway to any service.
4. **Screen.** `scripts/music.py screen [--beat] TAKE...` (needs `uv`, `ffmpeg`,
   `rubberband`; `uv` installs the Python dependencies) rejects hiss (8-16 kHz
   energy over the limit relative to the 0.1-2 kHz body) and clipping. Quiet music
   must sit at -40 dB or lower; `--beat` allows -30 dB for hats and shakers. Noisy
   takes measured -8 to -27 dB; clean ones -34 to -75.
5. **Fit to the cuts and master.** `scripts/music.py fit TAKE OUT.wav --len SECONDS
   --cuts T1,T2,...` takes the scene-change times, sets the tempo to 60 n / spacing
   (n whole beats between cuts; a take within 6% of it is stretched, otherwise
   refused), measures the take's beat and downbeat from its kick and bass (refused
   when they fall as strongly half a beat away, as with eighth-note piano or
   bass), aligns it so the cuts land on beats, keeps the take's own intro so the
   groove comes in where it does, and
   joins its own ending on bar lines at matching harmony. It reports the tempo
   change, where the groove enters, the cuts' distance from the nearest bar line
   and whether the ending is natural (otherwise a 3 s fade). Without `--cuts` it
   only trims, joins and fits the length. It masters to -16 LUFS under a -2 dBTP
   ceiling and refuses a take it cannot hold there or that exceeds -1 dBTP after
   AAC. Verify the beat on the final file, not the report. Mux with the picture's
   video stream copied; never single-pass `loudnorm` in the render.
6. **Listen.** Publish the directions on a page that works on a phone: a short
   plain label per direction (instruments and feel), a 30 s sample, the ending, the
   whole track and the film with it, the prompt, licence and credit line, numbers
   marked measured, not heard. A named person picks by ear; record the pick;
   re-score at the same paths. Say in the report that no agent listened. If the
   listener rejects them all, change the brief (step 1), not just the seed.

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
