# ADR-019: Cap inline image bytes per request, and shrink large images at ingest

Accepted 2026-09-16.

A long visual-QA session in `cyoa-video`
read screenshots and contact sheets for every playtest iteration. The session
reached 34 MB on disk; the request that carried its history to
`openrouter/deepseek/deepseek-v4.1-flash` (the failover link) was refused with
HTTP 413, "Downloaded image content cannot exceed 30MB". The limit was on the
whole conversation, not on one tool result, so the session could not recover:
every later prompt re-sent the same history and failed the same way. Retry and
failover cannot help — the request is malformed, not the link.

Pi already caps image *dimensions* (`images.autoResize`, 2000 px), but it keeps
the PNG lossless: a Chromium screenshot of a story node costs 1–2.5 MB, and
forty of them are enough to break any session. Two layers, each with the
authority it can carry:

- **A per-request budget, fail-closed.** The `context` hook sees the messages
  before every LLM call; `enforceImageBudget` measures decoded image bytes and
  replaces the oldest images over 15 MB with a one-line omission placeholder.
  Decoded bytes are what the provider counts and 4/3 smaller than the base64 pi
  sends, so a 15 MB budget is conservative on both readings, and it sits well
  under the smallest ceiling we know of. Oldest first keeps the screenshots a
  live diagnosis needs. The hook's copy is request-scoped and non-destructive,
  so the budget can never corrupt the session file — and a session that is
  already broken is repaired by its next request.
- **Compression at ingestion, fail-open.** The `tool_result` hook shrinks an
  image over 600 KB before it is stored: ffmpeg, longest edge 1536 px, mjpeg
  quality 5. Measured on the `cyoa-video` artifacts: 1.6 MB → 121 KB (7.4%),
  0.83 MB → 92 KB (11.1%), both fully legible. The budget is then rarely
  reached and the session file stops growing by megabytes per screenshot. No
  ffmpeg (or any failure) leaves the image untouched and the budget holds.

Alternatives rejected: `images.blockImages` (drops vision entirely — the
project needs it); trimming whole messages (loses the transcript text with the
images); a bigger budget (the next provider's ceiling is not ours to set);
fixing it only in the `cyoa-video` playtest scripts (the failure is a property
of every pi session that reads many images, not of one repo). The extension is
behavioral: it changes what the model receives. Classification: behavioral.
