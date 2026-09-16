## Host resources

Sessions run on a live desktop that also needs its RAM.

Heavy execution — full suites, coverage, browser/Electron verification —
runs off-host by default or in a bounded local scope with an explicit
worker budget. Cap runner concurrency in repo config, never the host
default: an uncapped two-project run once fanned out to 16 workers at
~4 GiB each.

Scratch and evidence belong on disk, in a run-scoped `TMPDIR` under
`~/.cache/tmp`, never `/tmp` (a 46 GiB RAM tmpfs). Artifacts are scoped
to the run that made them, not accumulated.

Never run a second fleet: check for a live run before starting one, and
stop only the scope this session owns.
