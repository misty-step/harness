# ADR-018: Tune pi's palette in the Omarchy template override, by rule not by eye

Accepted 2026-09-15.

`~/.config/omarchy/themed/pi.json.tpl` overrides
Omarchy's built-in pi template for every theme, so one edit covers both the day
(`thegreek`) and night (`tokyo-night`) themes. We keep the theme's own hues and
change only how pi's tokens map onto them:

- **Readable ink.** Headings, tool titles, extension labels, and function names
  move from raw palette slots to `accentInk` (accent mixed 50% toward
  foreground). On `thegreek` the accent as text is 2.17:1 against the
  background and `accentText` is 2.99:1 — both below the 3:1 floor — while
  `accentInk` is 4.70:1 on the light theme and 7.3:1 on the dark one. More
  colour must not cost legibility.
- **Accent-derived thinking ramp.** `thinkMid`/`thinkWarm`/`thinkHot` stop
  reusing `magenta`/`orange`, which in `thegreek` resolve to olive and made
  `high` (our default level) the muddiest state on the rail. The ramp is now
  accent → deeper accent → red, monotonic in both themes.
- **Deeper surfaces.** Panel mixes rise from 6/11/13% to 10/14/18%, so user
  messages and tool boxes read as cards instead of blending into the
  transcript.
- **Cross-harness coupling.** `sync-omp-theme` resolves this file's `vars` and
  `colors` into the OMP theme, and `omarchy-theme-set-pi` copies the rendered
  file to `~/.pi/agent/themes/omarchy-system.json`. Every value must stay a hex
  or a resolvable var name; a var that does not resolve fails the OMP sync.
- **Contrast is a gate, not a preference.** Any token that carries text clears
  3:1 on the theme background (4.5:1 preferred). The shipped values were checked
  with the same mix arithmetic the template engine uses, not by eye.

The file is hand-managed for now, like the `~/.bashrc` hook. It is not part of
`./install`. Classification: aesthetic.
