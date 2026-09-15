# pi-config

Pi coding-agent configuration for Phaedrus / Misty Step. Source of truth for
how this machine's pi runs: settings, the custom composer chrome, and the LOC
status extension. `./install` deploys owned components.

Sister repository to [omp-config](https://github.com/misty-step/omp-config),
which owns the same preferences for the OMP harness. Pi and OMP discover their
configuration differently, so the two repos share intent and conventions rather
than files. One shared convention is pokayoke: after a class of error, change
the system so that class cannot recur. Prefer shape, type, ownership, a missing
affordance, or a failing-closed check over a warning. The standing prompt is:
how can I pokayoke this so this kind of error never happens again?

## Layout

| Path | Purpose |
| --- | --- |
| `install` | Ownership-aware deployment into `$PI_CODING_AGENT_DIR` (default `~/.pi/agent`) |
| `settings.json` | Owned pi settings: theme, default model/thinking, editor padding, markdown |
| `bin/pi-merge-settings.ts` | Overlay source-owned settings keys while preserving foreign live keys such as runtime changelog state |
| `extensions/pi-chrome.ts` | Composer-centered status chrome: right-aligned identity on the top rail, empty bottom rail, single footer |
| `extensions/loc/` | Session-resident LOC status (`/loc`, `/loc-trend`) plus the worktree delta and optional git hook |
| `.githooks/pre-push` | Secret scanners; installed into this repo's git dir by `./install` |

## Install

```sh
./install   # requires bun
```

Unset `PI_CONFIG_COMPONENTS` means `all`: settings and every owned extension.
Select a subset with a space-separated list:

```sh
PI_CONFIG_COMPONENTS=config ./install
PI_CONFIG_COMPONENTS="pi-chrome loc" ./install
```

Supported components are `config`, `pi-chrome`, and `loc`. Preflight checks
bun availability, source presence, and configuration validity before writing.
The `config` component overlays owned keys and preserves foreign live keys;
`loc` is clean-replaced so obsolete files cannot survive. The installer never
touches `auth.json`, sessions, telemetry, or herdr-managed integration files.

Restart pi after deploying so extensions reload.

## Composer chrome

`extensions/pi-chrome.ts` keeps the composer's bottom border empty. Session
identity (model + reasoning) is right-aligned on the top border, next to pi's
built-in working spinner. Everything else is one footer below the composer:

```
  ─── <working spinner> ───────────────────  deepseek-v4.1-flash · ◆ xhigh ─
   type here
  ──────────────────────────────────────────────────────────────────────────
     ~/r90/olympus (  main* +2 ~1 ↑1 ) · ◆ 43% · 3.7k LOC · 40 files · +412   ctx 12%/200k · $0.06 · ↑162k ↓48k
```

Left of the footer is location (cwd, git branch, dirty counts, ahead/behind)
followed by extension status. Right is session economics: context window, cost,
and token/cache counters. Remove the file to restore pi's stock editor/footer.

## LOC extension

The ported OMP extension provides `/loc`, `/loc-trend`, and a status row:
top-language share, committed code lines, file count, and live net working-tree
line movement vs `HEAD`. `analyze.ts` counts committed code at `HEAD` and caches
per commit; the delta adds staged, unstaged, and untracked line movement, so it
moves as you edit and resets when you commit.

For instant cache updates on commit, link the hook into a repository:

```sh
ln -sf ~/.pi/agent/extensions/loc/git-hook.sh .git/hooks/post-commit
ln -sf ~/.pi/agent/extensions/loc/git-hook.sh .git/hooks/post-merge
ln -sf ~/.pi/agent/extensions/loc/git-hook.sh .git/hooks/post-checkout
```

## Pokayoke

This harness already error-proofs several classes of mistake. Name them so
future changes keep the same shape:

- Unknown `PI_CONFIG_COMPONENTS` values fail before any write.
- `config` overlays owned keys and preserves foreign live keys, so a deploy
  cannot clobber `auth.json` or runtime state.
- `loc` is clean-replaced so obsolete files cannot survive inside the package.
- The installer never touches sessions, telemetry, or herdr-managed files.

When a new failure mode appears, add a shape, check, or missing affordance
before adding a warning. A comment is not pokayoke.

## Verification

```sh
sh -n install
bun test extensions/loc/loc.test.ts
bun bin/pi-merge-settings.ts --source settings.json --dest /tmp/pi-settings.json --check
```

Restart pi and confirm the chrome and `/loc` load. Extension loading is proved
by a fresh session, not by the files being present.

## Ecosystem

Release automation is [Landmark](https://github.com/misty-step/landmark);
conventional commits become semantic versions, changelogs, and release notes.
`origin` is `misty-step/pi-config`.
