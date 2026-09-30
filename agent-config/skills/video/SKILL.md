---
name: video
description: Make a short explainer or intro video for any project as code (GSAP timeline, deterministic frames, real footage, fresh-critic loop, measured quality bar).
argument-hint: "[project, audience, length]"
---

# Video

Videos are first-class project material: README, docs and launch pages each get one. Build them as code so any frame
re-renders identically and a fix is a diff. Method: the open-source kit
[echris6/motion-video-kit](https://github.com/echris6/motion-video-kit) (MIT, `business-motion-film/SKILL.md` and its
`references/`; read the reference for each step as you reach it). Its rules, critic prompts and quality bar win over defaults.

## Do this

1. **Facts first.** Write `FACTS.md` from real runs: each line cites the recording or repo file it came from and says whether it may appear on screen. Only those lines become words or numbers. A capability that is not shipped is shown as "Next, in progress", never implied. Label synthetic people, pre-production and sped-up footage on screen.
2. **Brief, then storyboard.** `BRIEF.md` (viewer, one action, length, brand tokens and fonts, assets); one table of compositions: time, picture, job, how it leaves, what carries on. About 1.4 to 3.5 s each, frame 0 a finished picture, one carried object across scenes, the film reads with sound off. Send it to a fresh critic and fix what it finds before building.
3. **Real footage as image sequences.** Record the real product or agent; extract frames (`ffmpeg ... -q:v 2 seq/%05d.jpg`) and pick frames as a pure function of time (`FILM.clip`). Scan every window for secrets, tokens, hostnames, internal rows and error pages before using it, and crop or mask them. Do not magnify numbers you would not stand behind. Prefer code-built type and graphics around crops; upscale real footage 1.6x at most.
4. **Shared pieces, then parallel builders.** Copy `starter/` (renderer, `shared.js` timeline helpers, determinism test, encoder); put palette, fonts and the exact pixel of every scene handoff in shared code. One builder per act owns its scene files; each renders its range and checks determinism before handing back.
5. **Deterministic by construction.** Every value is a function of timeline time: no timers, `Date`, random, rAF, CSS animations or video elements. Set `gsap.config({force3D:false})`, repaint after each seek, and never overlap two tweens on the same property of the same target. Prove it: `bun starter/determinism.ts FILM_DIR "" "1,3.3,0.2"` seeks forward then backward and must print `deterministic`.
6. **Fresh critic every round.** The builder never grades its own work. Give a new agent only the render, the brief, the facts file and the kit's prompts; it cuts its own frames and measures frozen time, contrast and loudness with the kit scripts (frozen-time, loudness, contact-sheet). Fix the biggest problem first; the next critic checks each item fixed, partly fixed or still there and hunts regressions. Keep a ledger: round, findings, changes, numbers before and after. Keep a still stretch under about 0.5 s and frozen time near 1 s per 30 s by pushing every hold slowly and continuously.
7. **Sound last.** Music at the film's tempo (library or generated, instrumental), every scene change on a beat, one soft short whoosh per scene change, small clicks only on real on-screen actions, levels solved per effect in its own band against the music, master near -16 LUFS with true peak under -1 dB. Always export a music-only version.
8. **Deliver** a 1920x1080 60 fps MP4, the music-only MP4, a contact sheet, the critic ledger, the facts file and the editable source, on one review page that separates what was measured from what a human must still watch or hear.

## Render

`bun starter/render.ts FILM_DIR OUT FROM TO [workers] [query]` seeks the paused timeline at frame/60, screenshots each frame (about 45 frames/s with 10 workers; 80 s in under 2 minutes), then `starter/encode.sh OUT FIRST_FRAME film.mp4`. Test a 5 s range first.

## Model and budget

This is visual work: drive the build and the polish on the approved visual route and stop rather than fall back to another model family. Plan for time, not a single pass: an 80 s film with real footage took four parallel builders about 75 minutes, four parallel act critics about 27 minutes, a 40 minute revision, then one whole-film critic and polish pass. Frozen time fell from 22 s to under 1 s in that loop; the first build of every act failed the bar.
