# Pi global guidance

Loads into every pi session on this machine, in every repository. Source of
truth: `global/AGENTS.md` in [pi-config](https://github.com/misty-step/pi-config),
deployed to `~/.pi/agent/AGENTS.md` by `./install` — do not edit the deployed
copy. Repository `AGENTS.md` files add to this, never replace it.

## Pokayoke

After a class of error, change the system so that class cannot recur. Prefer
shape, type, ownership, a missing affordance, or a failing-closed check over a
warning. The standing prompt after a mistake or near-miss: how can I pokayoke
this so this kind of error never happens again?

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