---
name: sachstand
description: Produce spoken status using the workstation speech path; decision-only briefs stay quiet unless requested.
disable-model-invocation: true
argument-hint: "[session, repo, initiative, portfolio, or decision <question>] [quiet]"
---

# Sachstand

Give the consequential result, evidence, remaining risk and next action in your
own words. Status is spoken unless `quiet`; decisions are quiet unless requested.
Speech deliberately bypasses the silent agent sink.

Pipe an ear-friendly script into:
```sh
pass-env run -e GEMINI_API_KEY=workstation/GEMINI_API_KEY -- bun /absolute/skill/dir/scripts/speak.ts
```
The colocated `.env.pass` supplies the same mapping. Provider interaction storage
is disabled; output is private under `~/.cache/tts-play/`, with detached playback
on the operator's default device. Report the returned path/cost or actual error;
on failure still deliver the written result. Do not execute an unresolved decision.
