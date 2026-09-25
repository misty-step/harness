# ADR-017: Session card replaces the stock header; the working row names the tool

Accepted 2026-09-15.

pi's stock header spends four lines on a logo,
keybinding hints, and two prose sentences, and its working row says only that
something is running. We restyle both from `pi-chrome.ts` without touching the
rails (ADR-004):

- **Session card.** `setHeader` replaces the stock banner with the pi mark,
  version, session name, and the compact keyhints. ctrl+o still expands it to
  the full startup help, because the card implements the same `setExpanded`
  interface pi already drives for tool-output expansion. On a resumed session
  the card also shows prior tokens and cost.
- **Tool-aware working message.** `tool_execution_start` rewrites the working
  row to a present-tense verb plus a bounded target ("reading src/foo.ts",
  "running cargo test"); `tool_execution_end`, `agent_start`, and
  `agent_settled` restore pi's default.
- **Stock spinner.** (Amended · 2026-09-15.) We first replaced pi's braille
  spinner with a four-frame accent pulse via `setWorkingIndicator`. It read as
  motion competing with the working message and the theme's own thinking
  colour, and custom frames render verbatim — they bake their colour and drift
  after a mid-session theme change. Reverted: pi's stock spinner is better
  here.

We keep `quietStartup` off. The `[Context]/[Skills]/[Extensions]/[Themes]`
listing below the header is the load-proof for foreign extensions
(`agent-usage-telemetry.ts`, `herdr-agent-state.ts`), and the extension API
exposes no way to enumerate extensions, so hiding it would trade proof for
polish. Classification: aesthetic.
