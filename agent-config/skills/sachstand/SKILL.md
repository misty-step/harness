---
name: sachstand
description: Synthesize text as speech only when the operator explicitly requests it, using the workstation's small TTS helper.
disable-model-invocation: true
argument-hint: "[text to speak] [--no-play]"
---

# Requested speech

Ordinary status and decisions stay in chat. Use this helper only for explicitly
requested speech; audible playback deliberately leaves the silent agent sink.
For a file without playback, pass `--no-play`.

Bind the existing `GEMINI_API_KEY` through `pass-env` as described by
`authenticated-commands`, then pipe the requested text into:
```sh
bun /absolute/skill/scripts/speak.ts
```
Provider interaction storage is disabled. Output stays private under
`~/.cache/tts-play/`; requested playback uses the operator's default device.
Report the returned path/cost or actual error, and still deliver the written
result if synthesis fails. Speech does not authorize a decision or external action.
