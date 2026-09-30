---
name: sachstand
description: Give an executive status or decision brief; status is spoken unless quiet, decision-only briefs stay quiet unless requested.
disable-model-invocation: true
argument-hint: "[session, repo, initiative, portfolio, or decision <question>] [quiet]"
---

# Sachstand

Orient the operator in a minute: identify project, task, repository/branch, and
scope, then lead with the consequential outcome or bad news. Default scope is
this session; name a wider scope explicitly. Use primary evidence from the
request, Git/PR/CI, active agents/jobs/leases, and relevant work records. This is
status gathering, not another build or implementation pass.

Write in your own voice. Keep a session brief near 250 words, portfolio near 500.
Separate delivered evidence, in-flight ownership/blockers, critical changed
context, genuine decisions, and what happens next. Explain names cold; use
absolute dates, measured numbers, and labeled inferences. For a decision-only
brief, read [decisions.md](decisions.md); keep it quiet unless playback is
requested. No fixed message template or invented choice is needed. Briefing
does not execute an unresolved operator decision.

## Spoken playback

For status briefs unless `quiet` (or explicitly requested decision playback),
author a script for the ear, under 150 words: greet the reader (first name from
`git config --global user.name`), identify project/task,
give the verdict and consequential choices, then next action. Plain sentences,
rounded numbers, no Markdown/paths/IDs; `<short pause>` separates thoughts.

Pipe that script into:

```sh
pass-env run -e GEMINI_API_KEY=workstation/GEMINI_API_KEY -- bun /absolute/skill/dir/scripts/speak.ts
```

In this harness, `pass-env run -f .env.pass -- bun
agent-config/skills/sachstand/scripts/speak.ts` uses the committed Gemini reference.
The request disables provider interaction storage. Requested playback starts
detached on the operator's default device, deliberately outside `agent-sandbox`,
with a private unique audio file under `~/.cache/tts-play/`.

Report audio path, length, and returned estimated cost (or cost unavailable).
On speech failure, deliver the written brief and the actual error.
