# omp-config

Edit harness sources here. Run `./install` to deploy owned components to
`$(omp config path)`; keep live deployed files out of manual edits. The
installer overlays source-owned config keys and removes retired owned keys
without deleting foreign config entries, merges matching MCP authentication,
and clean-replaces selected owned agent packages without deleting foreign
packages.

## Shared primitives

Skill packages, shared global-guidance sections, and the `pass-env` launcher are
owned by `agent-config`, checked out
as the sibling `../agent-config` (override with `AGENT_CONFIG_DIR`). This repo
declares its selection in `install` and keeps only OMP-specific guidance (model
roles, execution vehicles, tracker routing) in its own file. Add a
harness-neutral primitive there, not here.

## Skill provenance

Skill provenance lives in `agent-config` now. External skills
(`frontend-design`, `show-me`, `wrangler`, `herdr`, and `using-exe-dev`) stay
verbatim there; Wrangler is the Cloudflare package at
`cloudflare/skills@d924cd8`. Update from upstream or remove the whole package.
Use a distinctly named homebrew skill when different behavior is needed.

Homebrew skills explain non-obvious knowledge or a distinct outcome, favoring
why over a prescribed itinerary. Keep interactive assistance separate from
scheduled review and delivery systems. When replacing a skill, migrate callers
and remove obsolete directories in the same change.
