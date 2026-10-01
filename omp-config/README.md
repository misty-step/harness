# omp-config

Omp harness configuration for Phaedrus / Misty Step. Source of truth for how
agents run on this machine: model roles, global policy, skills, themes.
`./install` deploys owned components. Publishing checks do not install.

Standing guidance lives in `global/AGENTS.md`. It is philosophy, authority,
and evidence calibration—not a SYSTEM override, sticky RULES file, or second
canon. Local repository conventions and explicit requests outrank it.

The guidance favors outcome-driven autonomy: continue routine authorized work
through acceptance, ask about material choices or authority, and honor explicit
stops. Verification resolves plausible failure rather than demonstrating effort;
instruction-only edits need meaning, reference, and relevant loading checks,
not model runs or synthetic applications by default. After a class of error,
pokayoke it: make that class impossible (shape, type, ownership, a missing
affordance, or a failing-closed check), not merely documented. The standing
prompt is: how can I pokayoke this so this kind of error never happens again?

## Layout

| Path | Purpose |
| --- | --- |
| `install` | Ownership-aware deployment into `$(omp config path)` |
| `bin/omp-merge-config.ts` | Overlay source-owned YAML keys and remove retired owned keys while preserving foreign config entries |
| `bin/omp-grievances.ts` | Manual grievance inbox CLI |
| `bin/omp-roster.ts` | Launch an OMP engineer only on a board ticket's model roster and check a session stayed on it (US-046); installed as `~/.local/bin/omp-roster` |
| `bin/omp-engineer.py`, `units/omp.slice` | Serialized live memory admission and per-engineer containment (US-043); explicit `engineer-cage` activation |
| `bin/pass-env.ts` | Moved to `agent-config`: pass-backed launcher, installed as `~/.local/bin/pass-env` |
| `bin/design-check.ts` | Moved to `agent-config`: player-surface copy checker, installed as `~/.local/bin/design-check` |
| `bin/tmp-health.py`, `references/dev-exec.md` | Opt-in workstation execution limits, pressure notifications, and rollback workflow |
| `config.yml` | Model roles, fallbacks, theme/TUI, providers, task/LSP settings |
| `models.yml` | Local Ollama discovery and command-resolved OpenRouter key; cloud models remain in omp's bundled catalog |
| `mcp.json` | Global MCP inventory; Linear is deliberately absent |
| `workspace-mcp.json`, `bin/omp-install-scopes.ts` | Linear directory scopes, native project-local imports, owned skill retirement |
| `global/AGENTS.md` | OMP-specific guidance; `./install` composes it with shared sections from `agent-config` |
| `global/WATCHDOG.md`, `global/WATCHDOG.yml` | One read-only Steward advisor |
| `themes/` | TUI themes (`tokyonight`, `everforest`, `everforest-light`) |
| `skills/` | Moved to `agent-config`: portable skill packages, clean-replaced when selected |
| `../.githooks/pre-push` | Root scanners; wired by `../scripts/bootstrap`, not runtime deployment |
| `extensions/loc/` | Session-resident LOC status and commands |
| `extensions/credentials/` | Names-only pass inventory at agent start by default; opt-in discovery pointer. Neither agent prose nor tool results inject credential reminders (MIS-161, US-019) |

`config.yml` selects the Omarchy-generated `omarchy-system` theme for both
terminal background modes. On this workstation,
`~/.config/omarchy/hooks/theme-set.d/20-sync-omp-theme` invokes the host-owned
`~/.config/omarchy/bin/sync-omp-theme` after a theme change; it generates
`~/.omp/agent/themes/omarchy-system.json` from the current Omarchy palette.
The installer preserves that generated file but does not generate or ship it.
On a host without this hook and generator, select an installed theme before
deploying config.

## Install

This is a component of [harness](../README.md), not a standalone checkout.
Repository setup and releases belong to the root. `./install` rejects positional
arguments (including `--check`); use `../scripts/verify omp` for isolated checks.

```sh
./install   # requires jq, bun, Python 3, and omp
```

Preflight validates every selected input, then writes. Unset selection means
`all`: owned config overlay, guidance, MCP, scopes, agents, skills, themes,
extensions, `omp-grievances`, `omp-roster`, `omp-engineer`, `pass-env`, `openrouter-key`,
`design-check`, `foundation-check`, and `ws`. Staging the cage CLI does not activate
it on an unactivated host. It does not delete foreign skills
or agents and does not import live secrets into this checkout. Skills, shared
guidance sections, and those shared launchers deploy from the sibling
`agent-config` checkout (default `$repo_dir/../agent-config`; override with
`AGENT_CONFIG_DIR`); the installer fails closed when it is missing.

```sh
OMP_INSTALL_COMPONENTS=guidance ./install
OMP_INSTALL_COMPONENTS=config ./install
OMP_INSTALL_COMPONENTS=agents ./install
OMP_INSTALL_COMPONENTS=secrets ./install
OMP_INSTALL_COMPONENTS=mcp ./install
OMP_INSTALL_COMPONENTS=audio-sandbox ./install
OMP_INSTALL_COMPONENTS=cli ./install             # stage/refresh owned OMP launchers
OMP_INSTALL_COMPONENTS=engineer-cage ./install   # explicit live rolling activation
OMP_INSTALL_COMPONENTS="guidance mcp scopes skill:engineering-operations" ./install
```

Supported components are `guidance`, `config`, `mcp`, `scopes`, `agents`,
`secrets`, `audio-sandbox`, `cli`, `engineer-cage`, and `skill:<source-directory-name>`.
`all` cannot be combined with another component. Empty, unknown, missing-skill, invalid-name, and invalid YAML
selections fail before any writes. The retired `OMP_INSTALL_GUIDANCE_ONLY`
variable fails with migration instructions rather than silently triggering a
full install.

`engineer-cage` retains the owned native ELF at `~/.local/lib/omp-engineer/omp`
and makes `~/.local/bin/omp` the relative `omp-engineer` symlink. Every new,
direct, continued or resumed invocation passes live admission and enters a
verified 4-GiB, zero-swap, group-OOM scope below the standalone 36-GiB
`omp.slice`. Existing processes stay in their original cgroups until natural
exit; activation does not restart Herdr or any engineer. Never prepend the
retained native directory to ordinary shells or call that ELF directly.
An installed Workbench updater must advertise `harness-engineer-cage-v1` through
its inert `omp-install-layouts` query before explicit activation writes anything.
Deploy that reviewed consumer first; source-only compatibility is insufficient.

`omp-roster memory --json` is read-only preflight, not a reservation.
On an unactivated host, staging the CLI reports `activated: false`, no capacity
measurement and explicitly inactive enforcement; roster launch retains its
existing uncaged behavior without requiring a Linux user manager. A retained
native binary, local slice unit or owned stable alias is activation evidence:
partial/broken activation still requires full inspection and fails closed.
This read-only distinction never bypasses admission in the cage launch path.
Actual `omp` launch serializes inspection through verified scope registration, counts
idle/lingering populated cages at their full limits, measures uncaged engineers
and mixed legacy groups, and uses the 20-GiB `MemAvailable` scale-up floor.
Unused cage/heavy headroom is diagnostic, not added to that floor; full cage
reservations still constrain the 36-GiB aggregate and effective ancestors. Refusal exits
75. Native arguments, cwd, environment, stdio and exit status are preserved.
Only a mutating native `omp update` receives an updater-local PATH pointing at
the retained ELF; normal/nested/resumed launches and `update --check` do not.
See the [rolling activation and recovery runbook](../docs/desktop-memory-guard.md).

Owned skill packages are replaced, not overlaid, so obsolete files cannot
survive inside a selected package. Foreign packages in the live skills or
agents directories are left in place. `guidance` copies AGENTS and WATCHDOG
and deletes the retired live `RULES.md`. `config` overlays keys present in
source `config.yml` / `models.yml`, removes retired owned keys, and preserves
foreign undeclared live keys such as runtime consent; it does not copy auth
stores. MCP deployment still uses the
declared server inventory and preserves live `auth`/`oauth` metadata for those
servers only. OMP's managed OAuth tokens remain in its auth storage, never in
this repository.

OpenRouter auth (US-028): `models.yml` resolves `openrouter-key --personal
workstation/OPENROUTER_OMP_HARNESS_API_KEY` on first use. The shared launcher
chooses `workstation/OPENROUTER_R90_HARNESS_WORKSTATION_INFERENCE_API_KEY` when the process directory
or its Git common directory is under `~/development/r90group` (linked
worktrees included). A failed pass lookup, damaged Git metadata or timeout
emits a fixed invalid token rather than exiting without a key: OMP omits
failing command keys and would otherwise fall through to a stored personal
credential or `OPENROUTER_API_KEY`. The launcher caps Git discovery at 1.5 s
and pass lookup at 5 s, inside OMP's 10 s command deadline. This deliberately
keeps existing `agent.db` credentials untouched, while a broken R90 entry
receives an OpenRouter 401 instead of personal billing. Explicit runtime
`--api-key` overrides remain higher priority and are outside this policy.
`OMP_INSTALL_COMPONENTS=config ./install` deploys both the override and the
launcher. Restart OMP after installation; see root verification guide for
real-path billing checks.

Configuration preservation is semantic, not preservation of YAML comments or
formatting. Package preflight checks syntax and local imports; native loading
must still be confirmed.

`audio-sandbox` keeps agent audio out of the operator's ears (US-026). It
writes an owned block into the agent `.env`, which OMP loads before any tool
runs, so the bash tool is routed to the silent `agent-sandbox` sink without
extension code. It clean-replaces `extensions/audio-sandbox`, materializing the
shared contract over its repo shim, so JavaScript eval, browser, MCP, and LSP
children inherit it too, and each Python eval cell is revised through
`tool_call` to apply the contract first (OMP's Python runner drops the keys
from its environment). It also runs the shared host step (sink drop-in, Claude Code env, live
routing proof); see the agent-config README for listening, residuals, and revert.
New sessions pick it up; running sessions keep their environment.

`secrets` deploys the shared `pass-env` launcher and the
`authenticated-commands` skill through
`agent-config`: `pass-env` as
`~/.local/bin/pass-env` (mode `700`), and only that skill package in the agent
directory. It preserves other packages, guidance, and configuration. Preflight
checks Bun availability, standalone launcher syntax/imports, skill discovery
metadata, and owned destinations before writing. Installation does not require
a pass store or decrypt credentials; `pass` and GPG are runtime dependencies.
Foreign binaries and symlinks at the launcher destination cause preflight to
fail rather than being overwritten or deleted; an earlier
`misty-step/omp-config` launcher header is accepted and upgraded in place.

`scopes` installs Linear only under `~/development/misty-step` and
`~/development/moomooskycow`, retires the owned global `parlor`, `ast-grep`,
and `now-next` packages, and retires global `todoist-cli` only after
`$OMP_DEVELOPMENT_ROOT/moomooskycow/daybook/.agents/skills/todoist-cli/SKILL.md`
exists (override with `OMP_TODOIST_OWNER`). It does not mutate `~/.claude` or
`~/.codex`; those live aliases are Main-owned. Redirecting
`PI_CODING_AGENT_DIR` does not isolate hook, scope, or `~/.local/bin` writes.
Use a disposable HOME, development root, and checkout copy for installer
checks.

## Privilege and approval

The standing routing policy lives in `global/AGENTS.md`. On a Linux workstation,
use the channel where the operator can approve the actual operation:

| Situation | Route |
| --- | --- |
| Operator can approve on the local desktop; agent has no accessible terminal | `pkexec` for the explicit executable and arguments |
| Operator can authenticate in a real terminal, including an SSH terminal | Normal `sudo` in that terminal |
| Job must run with nobody available to approve | `sudo -n` under an existing explicit host grant; otherwise retain the pending action |

For example, `pkexec /usr/bin/id -u` is a harmless approval-path check; a
successful invocation prints `0`. For real work, request the intended operation
instead of repeatedly probing privileges. Announce why it needs root. In OMP,
supervise an approval-waiting process with `hub`, then check its exit and the
requested system state. Process creation alone is not completion.

`pkexec` uses the registered authentication agent. Without one it can fall back
to a text agent; `--disable-internal-agent` disables that fallback when no text
prompt is usable. It does not make authentication unnecessary. Do not redirect
an SSH user's request into a desktop dialog they cannot see. Its environment is
sanitized, so use absolute paths and explicit inputs rather than relying on
shell exports or launching graphical applications as root. See the
[pkexec manual](https://www.freedesktop.org/software/polkit/docs/latest/pkexec.1.html).

Being physically away is not the same as being unattended: an operator can
approve through an SSH terminal. However, `sudo -v` in that terminal does not
necessarily authorize an agent's separate PTY or background process. Do not
copy passwords into chat, `sudo -S` payloads, environment variables, or files.

Genuinely unattended administration needs an explicit OS policy, not another
prompt wrapper. Account-wide `NOPASSWD` provides full administration to every
process under that account, not only a trusted agent. A narrower policy needs
root-owned helpers with constrained actions and arguments; allowlisting a
general shell or arbitrary package installation is not narrow privilege.
This repository documents routing, but does not install sudoers or polkit
grants. Such a change needs a separate decision, syntax validation, an
independent execution check, and a rollback path.

## LOC extension

The globally deployed LOC extension provides `/loc`, `/loc-trend`, and a
committed-`HEAD` status row across repositories. When `.git/loc_cache` is missing
or stale relative to `HEAD`, an in-process async worker populates it in the background
without blocking interactive turns. Explicit LOC commands also populate the cache on demand.

Disable only LOC for a large repository with project-local configuration:

```yaml
# .omp/config.yml
disabledExtensions:
  - extension-module:loc
```

## Grievance inbox

`omp-grievances` treats OMP's grievance database as a read-only inbox. Its
acknowledgement ledger defaults to
`$XDG_STATE_HOME/omp-config/grievances.sqlite3` or
`~/.local/state/omp-config/grievances.sqlite3`.

```sh
omp-grievances status
omp-grievances inbox --limit 20
omp-grievances show 294
omp-grievances ack 294 --outcome ticketed --ref HAB-123
omp-grievances ack --through 250 --outcome historic --note "pre-ledger backlog"
omp-grievances unack 294
```

Outcomes are `ticketed`, `no-action`, and `historic`. `ticketed` requires an
opaque external reference such as a Linear or Habitat item. The ledger stores
grievance IDs, outcomes, references, and notes; raw reports remain owned by
`~/.omp/autoqa.db`. A salted source fingerprint prevents acknowledgements from
silently attaching to a replaced or rewritten grievance history.

## Authenticated commands

`pass-env` is a standalone Bun executable for scripts needing environment values
from [`pass`](https://www.passwordstore.org/)/GPG. It uses ordinary cwd,
environment, and stdio, with no OMP SDK, authentication, or session dependency.
Keep working native tool authentication as usual; the launcher does not replace
it. The operator configures the store and GPG key. A dedicated passwordless key
is practical for noninteractive local use; a passphrase-protected key also works
from an existing GPG cache. A locked key fails rather than prompting.

### Installation and harness portability

With Bun, pass, and GPG installed, run the source directly from this checkout:

```sh
bun ../agent-config/bin/pass-env.ts --help
```

For a standalone installation, first check `command -v pass-env` and the
destination below. Stop if either belongs to another tool; do not overwrite it.
For a fresh destination, these commands require no `omp` invocation:

```sh
install -d -m 700 "$HOME/.local/bin"
install -m 700 ../agent-config/bin/pass-env.ts "$HOME/.local/bin/pass-env"
export PATH="$HOME/.local/bin:$PATH"
```

The repository's `OMP_INSTALL_COMPONENTS=secrets ./install` is specifically an
**OMP deployment adapter**: it installs this same executable and clean-replaces
the owned `authenticated-commands` skill in OMP's agent directory. Neither route
installs credentials, keys, or store configuration.

The neutral [authenticated-commands skill](../agent-config/skills/authenticated-commands/SKILL.md) uses Agent Skills-style
metadata and ordinary Markdown. OMP discovers it automatically after deployment.
Other harnesses can import/copy the skill through their supported mechanism, or
read it as ordinary Markdown and invoke the CLI. This repository does **not**
automatically install into other harnesses or require their support for OMP's
`skill://` URI or slash commands.

### Selective command execution

```sh
pass-env list
pass-env list projects/example --json
pass-env run -e API_TOKEN=services/example/api-token -- ./scripts/sync
pass-env run -f .env.pass -- bun run dev
```

`list [prefix] [--json]` reports entry names only, without decrypting. It is the
current store index. `run` needs at least one mapping and a command after `--`.
Repeat `-e` / `--env` for `NAME=entry` mappings or `-f` / `--env-file` for reference
files. A project's `.env.pass` might contain:

```text
# References, not credential values
API_TOKEN=services/example/api-token
DATABASE_URL=projects/example/database-url
```

Reference files are literal data: blank lines and full-line comments are allowed;
no shell evaluation, quoting syntax, or interpolation. Files apply in order,
then explicit `-e` mappings override file mappings. Duplicate names within one
file are errors. Mapped values override inherited variables; other environment
variables, cwd, and interactive stdio are preserved. Exit status and signals
propagate. Changes affect **newly launched children**, not already running
processes or the parent shell. Restart callers after replacing a value.

Workstation entries conventionally use `workstation/ENV_NAME`. The local
`~/.config/pass-env/workstation.env.pass` is a names-only, static inventory, not an
authoritative live index or a default environment for every command. Update its
references when entries change. Select needed entries or a narrow project file;
do not bulk-export the store or pass the full workstation inventory to unrelated
commands. Names can still describe private services; review before committing.

### Human credential management

Each encrypted entry contains **only the exact value bytes**: no `NAME=`, wrapping
quotes, or notes. The entire UTF-8 plaintext, including every newline, becomes
the variable; empty values work, invalid UTF-8 and NUL bytes do not. This differs
from pass's first-line-password-plus-notes convention.

```sh
pass-env list workstation/                 # names only; safe inventory
pass show workstation/API_TOKEN            # reveals plaintext: private terminal only
pass show --clip workstation/API_TOKEN     # copies the first line; not a multiline export
EDITOR=nvim pass edit workstation/API_TOKEN
```

`pass edit` edits an existing entry or creates a new one. In nvim, enter just the
value. For a single-line token that must have **no trailing newline**, run
`:setlocal nofixeol noeol` and then `:wq`. Do not apply that recipe to a value whose
final newline is intentional. Nvim normally adds a final newline; that newline
would be a real credential byte. Clipboard use also exposes the value to the
desktop clipboard and potentially its history; use only in a trusted session.

Default interactive `pass insert` is not byte-exact for newline-free tokens:
the installed `/usr/bin/pass` encrypts `echo "$password"` in its normal and
`--echo` branches, adding a newline. Its `--multiline` branch sends stdin directly
to GPG. Prefer the editor recipe above or `pass insert -m` with exact private
input; do not use `echo` to supply a newline-free token.

```sh
pass mv workstation/OLD_NAME workstation/NEW_NAME
pass rm workstation/UNUSED_NAME
```

Rename/remove only intentional targets (pass normally asks before deletion or
overwriting). Update `.env.pass`, the static workstation inventory, scripts, and
native consumer references together. An environment variable's name can stay
the same while its mapped entry changes. Removing a local entry does **not**
revoke the credential at its issuer, remove a copy held by an already running
process, or rotate other copies. Issuer revocation/rotation is separate,
explicitly authorized work.

### Agent credential management

First list names; then use selective `run` mappings for the authorized command.
Do not reveal values to inspect whether they exist. For explicitly authorized
insertion, stream **exact bytes** from a private source into
`pass insert -m workstation/API_TOKEN`; add `--force` only for an intentional,
authorized replacement. Do not put values in arguments, shell history, tool
transcripts, logs, or generated reference files. Redirect a private file or use
the execution tool's private stdin mechanism; never copy opaque secret text
through the model. A newline belongs in that stream only if intended.

Verify without displaying plaintext: list the entry name and run a child that
checks the required property or performs the authorized operation, returning
only success/failure. A presence check verifies injection, not issuer validity:

```sh
pass-env run -e SECRET_CHECK=services/example/api-token -- \
  bun -e 'process.exit(Object.hasOwn(process.env, "SECRET_CHECK") ? 0 : 1)'
```

Use ordinary `pass mv` / `pass rm` only for authorized renames/removals; update
callers and reference inventories as above. `pass-env` deliberately has no
additional secret-management subcommands.

### Migration and security boundaries

Migrate the application's launch path first: `.env.pass` does not automatically
replace an app-consumed `.env`. Confirm the app accepts injected values, then
launch through `pass-env run -f .env.pass -- …` before removing its old dotenv
file. Native consumers using pass directly need no launcher migration.

The existing workstation names-only configuration moved from
`~/.config/omp-secrets` to `~/.config/pass-env` without changing its mappings.
Historical migration receipt and dotenv inventory files intentionally remain at
`~/.local/state/omp-secrets`; their paths and observations are historical evidence,
not live configuration. New verification receipts belong under
`~/.local/state/pass-env`. The store remains `~/.password-store` (or
`PASSWORD_STORE_DIR`), the key home remains `~/.gnupg`, and entry names/values are
unchanged by the launcher rename.

Missing entries fail before the child starts. Decryption uses noninteractive GPG
(`--batch --pinentry-mode error`); unlock with ordinary pass/GPG outside the
launcher. It adds no daemon, key cache, rotation, or native-auth repair.
Recovery needs encrypted entries **and** the matching private key. A local copy
of both is not an independent backup, and removing files is not secure erasure.

The launcher never prints plaintext, but child output is unfiltered and the child
can disclose its environment. Processes running as the same user can read the
store. This prevents accidental launcher output; it is not credential isolation
or sandboxing.

### Focused verification

```sh
../scripts/verify shared
```

Tests use disposable stores, HOME, agent directories, and source fixtures; no
live credentials are needed. For a deployed smoke check, use a disposable real
pass/GPG store with synthetic values, check `pass-env list`, inject into a
success/failure-only child, and verify lookup failure does not start it.

In a fresh OMP session, `authenticated-commands` should appear in the automatic
skill index. OMP supports `skill://authenticated-commands` and
`/skill:authenticated-commands`. A no-model check can launch
`omp --mode rpc --no-extensions --no-session --no-title` and request
`{"type":"get_available_commands"}`: the response should contain
`skill:authenticated-commands` with source `skill`. Discovery does not decrypt a
credential or call a model. Other harnesses use their own import/read mechanism.

### Credential-context experiment and task accounting (US-018, US-019)

After deploying the source extension, `OMP_CREDENTIAL_CONTEXT=on-demand omp`
uses a compact discovery pointer instead of listing every pass entry at startup.
This experiment is off by default and fixed for each extension instance. Unset
the variable and start a fresh session to restore the full inventory. The
extension does not react to tool results or assistant prose or inject turns.

`bun bin/omp-task-usage.ts --sessions DIR --manifest FILE` reads explicitly
selected local task trees and reports separate input/output/cache costs, including
workers and advisors. It requires outcome evidence for known labels and reports
cost per completed task as unavailable for unknown outcomes or missing prices.
It does not call a provider or replace foreign runtime telemetry.

See the [baseline, prompt diff, scope and promotion procedure](../docs/token-efficiency.md).
No live deployment or task-quality parity is implied by the offline checks.

## Linear

Use the [official Linear MCP server](https://linear.app/docs/mcp) for access and
the shared `/skill:engineering-operations` for durable capture and handoff judgment. The connector is not a
scheduler, authorization to start work, or a second system-documentation store.

`workspace-mcp.json` owns `https://mcp.linear.app/mcp`. `install` deploys it only
under `~/development/misty-step/.omp/mcp.json` and
`~/development/moomooskycow/.omp/mcp.json`; global `mcp.json` does not declare it.

OMP's native MCP discovery is cwd-local, not ancestor-inherited. The `scopes`
installer adds a relative `.omp/.mcp.json` import in each existing direct-child
Git checkout under those two roots. It leaves a primary `.omp/mcp.json` untouched,
refuses conflicting fallback files or symlinked configuration directories, and
adds its local import to Git's `info/exclude`. R90 and other development trees
receive no definition or import. Re-run `OMP_INSTALL_COMPONENTS=scopes ./install`
after adding a checkout. Launch OMP from the repository root; an arbitrary nested
working directory does not inherit its MCP definition. `OMP_DEVELOPMENT_ROOT`
exists for alternate local layouts and isolated installer checks.

After deployment, run these **inside OMP**, not in the shell:

```text
/mcp reload
/mcp test linear
```

New sessions discover the local definition. Already-running sessions retain their
loaded tools until reloaded or restarted. Authorize only from an approved scope:

```text
/mcp reauth linear
```

Select the intended workspace. OAuth credentials remain in OMP's managed auth
storage, not in this repo. Directory scoping prevents normal connector discovery;
it is not a credential sandbox against another process under the same account.
Use separate OMP profiles when credential isolation is required.

### Authentication recovery

`/mcp reload` rediscovers configuration; `/mcp reconnect linear` reconnects an
existing binding. If an existing session reports `HTTP 401 invalid_token` after
authorization completed in another OMP process, use `/mcp reauth linear` in the
failing session. That recovery was observed during setup; the underlying runtime
cause is unconfirmed. Do not repeat a reported failure merely to confirm it or
add a hard-coded token-header workaround. Team creation is not exposed by the
current server; use Linear's settings for that administration.

Work conventions and project navigation live in the
[Misty Step work tracking guide](https://linear.app/misty-step/document/misty-step-work-tracking-guide-d3a627ae6395),
[Misty Step Issue Templates and Work Conventions](https://linear.app/misty-step/document/misty-step-issue-templates-and-work-conventions-d976aa9e94e8),
and [omp-config project](https://linear.app/misty-step/project/omp-config-47a74679f980).
Keep procedures and version-bound knowledge here; link them from work records.
Check [current plan limits](https://linear.app/pricing) before changing a plan or
inviting collaborators. No paid plan or GitHub integration is enabled here.

## Review explanations and ASCII assets

Maintained engineering and visual preferences live in `global/AGENTS.md`.
`VISION.md` is retired (harness ADR-004): a repository's purpose and non-goals
live in its README, and authorized direction in Linear. Diagrams are optional
explanations of the actual change, not a required artifact packet.

ASCII support is currently **aesthetic guidance and browser-based asset authoring**,
not a dedicated conversion tool, skill, or automatic asset pipeline.
[ASCII Magic](https://www.ascii-magic.com/app) is an optional editor. From the
supplied product context, start with Characters or Block Characters for technical
imagery, or Dither with Atkinson/Bayer for limited-palette artwork. Tune in the
browser, export an asset, and keep the selected source rights, recipe and output
with the consuming project's assets. Its recipe link/code can preserve settings;
there is no documented public automation API, and video exports are silent.

Keep controls and essential text accessible. Referencing
[U.S. Graphics](https://usgraphics.com/) or Berkeley Mono does not grant asset or
font licenses.

## Engineering skills

OMP selects engineering craft and non-obvious tool knowledge, not every shared
package. The startup [engineering page](../agent-config/guidance/engineering.md)
is the philosophy: smallest fix today; good taste, deep modules and simplicity;
question, delete, simplify; checks earn their place; never widen a ticket.

On-demand owners: `design-studio`/`visual-state-review` for rendered design,
`test-audit`/`story-qa` for real consumer proof, `foundation` for commissioned
assessment, `user-stories` for its checker grammar, `agent-design` for prompt
loading/cache traps, `authenticated-commands` for pass/native auth,
`cloudflare-workers`/`remote-execution` for platform traps, `system-one` for Jev
wiring, `engineering-operations` for workstation tools, and `pokayoke` for the
existing incident template. No generic process manuals or required concept rounds.

The existing todo phase carries ticket why/victory and its link. Native state
restores it on resume; engineers read `todo view` after compaction before changing
course. Child assignments carry the same intent because they do not inherit
parent todos. No daemon, extra queue, intent file or repeating reminder.

Kaylee owns dispatch, fleet, review choreography and approvals. OMP does not
install `herdr`, `pr-preview`, `sachstand`, `session-close` or the `agent-review`
launcher. Full deployment retires their old skill copies, preserves foreign
packages, and rejects explicit management-skill selections. Review source and its
gate template remain under `agent-config/review/` for the owner to evaluate;
their presence is not an engineering obligation.

`frontend-design` and `show-me` are removed whole. The old Wrangler/exe.dev manuals
are replaced by distinct short homebrew skills; Cloudflare attribution/license
remain. Omarchy's `omarchy`/`diagnose-crash` retain their independent owner.

Missing verification infrastructure is separate work unless it prevents proving
this change. Use the existing product commands; docs/internal changes get
composition or real owner-path checks, not a pretend product journey.
Start a fresh session after deployment to discover current skills.

### Persistent workspaces and exe.dev

`remote-execution` distinguishes the exe.dev lobby from a VM shell; `ws` owns
project workspaces. No scheduler or automatic migration is installed.

Before first SSH access, verify the
[published host key](https://exe.dev/docs/faq/host-key.md). Read current
[origin routing](https://exe.dev/docs/cnames.md),
[VM authentication](https://exe.dev/docs/https-tokens-for-vms.md), and
[integration](https://exe.dev/docs/integrations.md) contracts for the selected
deployment rather than assuming Cloudflare proxying or credential isolation.

### Bounded local execution

The workstation's opt-in user slice and delivered pressure alerts are documented
in [Development execution](references/dev-exec.md), including 48/60/8 GiB
aggregate limits, 6/10/1 GiB per-job launch examples, accounting, containment
evidence, exclusions, and rollback. These workstation settings are not installed
by `./install` and do not move existing processes.

### Repository-local Parlor

Parlor owns its skill in `parlor/skills/parlor/SKILL.md` and its import command
in `parlor/scripts/import-skill.mjs`. It is not part of this harness's global
skill inventory. From the Parlor checkout:

```sh
node scripts/import-skill.mjs --target ../poppycock
node scripts/import-skill.mjs --target ../linejam --guidance-only
```

Both destinations are `.agents/skills/parlor` in the consuming repository.
Poppycock's reference follows its pinned installed source; Linejam's import is
explicitly guidance-only, not a framework installation or selected migration.
The importer records provenance, leaves identical imports unchanged, and refuses
to overwrite differing copies. Follow the owner procedure when refreshing;
do not maintain another skill copy in omp-config or install it globally.

## Interactive and recurring work

### Model routing (US-014)

OMP follows the operator's lower-spend model policy (US-014, updated
2026-10-01): Sonnet 5.5 medium handles ordinary work and orchestration;
GPT-6.1 Sol defaults to xhigh for Codex work and recovery; explicit high
remains allowed, with Astra only by explicit selection. Visual work stays on
Opus at high or above. Ordinary `task`
children use their configured agent routes rather than the live parent's model.
Grok 4.7 is allowed only for read-only advisory recovery, never as a
builder fallback. Gemini 3.8 Flash is the last resort where cross-model
recovery is allowed; Opus has none. Native roles and provider-failure
chains live in `config.yml`; changing them does not switch the selected model
in an existing session. A running OMP process also retains its in-memory model
catalog across binary updates: an old process can fuzzy-resolve a new model ID
to a different, retired model. Restart that process after a catalog upgrade.

For a model-routing deployment, run
`OMP_MODEL_PROBE=1 OMP_INSTALL_COMPONENTS=all ./omp-config/install`
from the repository root. Before writing live config, the installer overlays
the source onto a disposable copy of the effective config and rejects retired
or unapproved chat selectors in every role, task agent override, and fallback,
including model-key chains. The online probe then requires an exact OMP catalog
match and a successful provider response for each distinct selector and
effort, including preserved foreign routes. Existing provider logins are
required; offline `./scripts/verify` invokes the same policy without a
network probe. An installed config cannot update the in-memory catalog in
already-running engineers; restart only after preserving each session and
confirming it is idle or complete.

The `web` role is a search route rather than a chat model. Its recovery chain
keeps the existing `web/*` search providers but drops older chat models; the
policy check rejects any chat selector added back to that chain.

| Direct selection or configured agent route | Primary selection |
| --- | --- |
| Fresh `omp`, `@default` (orchestrator) | `anthropic/claude-sonnet-5-5:medium` |
| `@task` | `anthropic/claude-sonnet-5-5:medium` |
| `@smol`, `@commit`; `scout` and `sonic` | `openai-codex/gpt-6-luna:max` |
| `@tiny` | configured `openai-codex/gpt-6-luna:max` |
| `@plan` (system design, architecture) | `openai-codex/gpt-6.1-sol:xhigh` |
| `reviewer`, `security-reviewer` | Author-family selection in `extensions/subagent-inheritance`; no recovery |
| `@advisor` | `anthropic/claude-sonnet-5-5:medium` |
| `@slow` (explicit thorough pass, hard problems) | `anthropic/claude-sonnet-5-5:high` |
| `@extreme` (rare unconstrained reasoning) | `anthropic/claude-opus-5-5:xhigh` |
| `@vision`, `designer` (visual and design work) | `anthropic/claude-opus-5-5:high` minimum |

Sonnet medium orchestrates; use `@slow` or `@extreme` for harder problems.
Visual work runs on Opus high or above, raising to xhigh or max for design
and visual-language work. Delegate it to the owned `designer` agent
(`agents/designer.md`), never to `task`. Luna max serves the cheap tier,
including `tiny`; the local LFM selector is disabled to keep every configured
chat role within the approved model set. All shared subscription accounts
are authorized for any work. Native `auth.accountPolicies` gives priority 1
to `phaedrus@r90.dev` for Anthropic and OpenAI Codex. Priority boosts eligible
accounts; blocked-account and reserve rules still govern selection. It is not
exclusive account pinning, proof of remaining quota, or a promise that each
request will use that account. See native [policy resolution](https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/ai/src/auth/policy.ts)
and [account ranking](https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/ai/src/auth/rank.ts).
A configured
role does not create an agent. Native OMP bundles `task`, `scout`, `sonic`,
`reviewer`, and `security-reviewer`; this repo adds `designer`. Main uses the
session model.

For a new session:

```sh
omp                         # ordinary work and orchestration: Sonnet 5.5 medium
omp --model @plan           # system design, architecture: GPT-6.1 Sol xhigh
omp --model @slow           # hard problems, thorough pass: Sonnet 5.5 high
omp --slow                  # shorthand for @slow
omp --model @extreme        # rare unconstrained reasoning: Opus 5.5 xhigh
omp --model @smol           # explicitly choose Luna max
omp --model @vision         # visual inspection and design: Opus 5.5 high
```

An already-open or resumed session retains its selected model; installing a
new default does not switch it. Inside OMP, `Ctrl+P` cycles the configured
`smol`, `default`, and `extreme` roles, in that `cycleOrder`. `Alt+P` opens the temporary session-model
picker; select a concrete model without rewriting the default.
`/model` (or `Alt+M`) opens model/role configuration instead. These are the native
default keybindings; local bindings can override them. Explicit CLI selections,
project config, and one-run `--config` overlays can override the global default.

Task dispatch selects an **agent**, not a direct model selector. Native
precedence is `task.agentModelOverrides` → agent frontmatter → parent/default
fallback. Ordinary children retain their configured agent routes rather than
being overwritten by the live parent's model and thinking.
`extensions/subagent-inheritance` uses the supported `before_subagent_spawn`
hook to select reviewers and preserve the `designer` Opus 5.5 high minimum: a non-Opus parent
or an Opus parent below high selects Opus high; Opus high/xhigh/max parents
retain their thinking level. A task's `agent` can name a model tagged with
`^` in the composer (`m1`, `m2`, …); that remains an explicit model choice.
`task.enableEffort` exposes per-item `effort: "lo" | "med" | "hi"`, mapped
to the selected model's supported range. Designer `lo` and `med` are refused
before spawn. Designer routing applies to `task`, not eval `agent()` or direct
role selection.
Designer dispatch also resolves Opus credentials before spawn. Missing models,
missing credentials, lookup failures, and lookups exceeding five seconds return
an explicit block; otherwise native startup can silently select the authenticated
parent before retry chains apply. This checks authentication, not remaining quota.

Reviewer and security-reviewer routing also covers eval `agent()` dispatch.
The hook compares native model-family identities against the live author and
blocks unavailable reviewer authentication before native parent-model fallback.
Reviewer `session_start` pins effort and empties every inherited recovery key,
including model, effort-specific and provider-wildcard keys. Registry record
overrides merge keys, so an empty role alone is insufficient. The public
`findScopedSettings` resolver selects the active child's settings;
`pi.pi.settings` is the root singleton and would also change builder recovery.
No parent recovery or persisted config is mutated.
`task.disabledAgents` denies reviewers and designer until the loaded guard
initializes their runtime permission. A missing/unloadable extension therefore
cannot silently expose unguarded specialists. Failed child initialization
aborts before a provider request; isolated extension errors never grant review
permission. Other disabled agents are preserved.
Changing `extensions` or `disabledExtensions` revokes this permission, including
an in-flight spawn's auth result. Public setting listeners survive native hook
suspension; dispatch remains closed until fresh guard initialization.
The caller records its chosen reviewer against native spawn/parent identities
before core resolution; the child consumes that immutable dispatch pin and
persists it as a custom session entry for cold revival. `session_init.resolvedModel`
already includes startup auth substitution and is not authoritative intent.
The reviewer disables model switching in its own scope and checks the pinned
identity before every provider request. Sol medium is a review-only approval
exception; engineer rosters and ordinary config/recovery still allow explicit
high, while harness-selected Sol routes use xhigh.

The native task result already records the actual resolved model identity,
thinking level, and fallback status (`resolvedModelIdentity`,
`resolvedThinkingLevel`, `resolvedModelIsFallback` in
`TaskToolDetails.results[]`); `task.showResolvedModelBadge` displays the
resolved model and thinking on each task row. Read these rather than
inferring the child model from its agent name. Ordinary task workers use
Sonnet 5.5 medium even when the parent is on a more expensive route.
Git commit, rebase, push, and similar mechanical ship steps use `@smol`.

Visual, motion, UX and communications work must start on Opus and stop on an
outage rather than switch models (US-014, operator decision 2026-09-27).
`retry.fallbackChains` has an empty chain keyed by the configured Opus model,
without an effort suffix. Native OMP model-selector keys outrank role chains:
this covers direct selection and role aliases at every reasoning level,
including a main session whose session role is `default`. Normal same-model
retries remain available; exhausting them surfaces the provider error.

This is deliberately a model boundary, not a task-purpose classifier. It also
stops automatic fallback for coding sessions started on that Opus model.
Select a non-Opus primary explicitly when cross-model recovery is appropriate.
Do not use an extension that throws during startup as a substitute: OMP can
isolate extension failures and continue.

The role chains remain in `config.yml` for allowed non-Opus recovery, using
approved subscription providers. Grok is restricted to read-only `advisor`
recovery; `scout` shares the Luna/smol route without Grok. Gemini
3.8 Flash is last where cross-model recovery is allowed. Reviewers have no
recovery chain. The dedicated
`vision` chain also remains Opus-only. Unlike an absent chain, an explicit
empty model chain means no fallback candidates; there is no need to disable
`retry.modelFallback` globally.

The guard is not a universal current-model veto: an Opus entered as a recovery
hop from a non-Opus primary can still follow that original pinned chain.
Nor does it repair a saved session already running DeepSeek, protect other
Opus model/provider identities, or override more-specific local selectors or
project/run settings. An effort-specific key such as
`anthropic/claude-opus-5-5:max` outranks this suffixless guard; installers
preserve foreign keys. Before deployment, inspect effective selectors for
such overrides. Start guarded work on the configured Opus primary, not on a
recovery hop.
Changing the configured Opus version requires updating its model-key guard
and registering the new key in `bin/omp-merge-config.ts`'s owned retirement
list. Keep prior owned keys there so removal from source also removes them
from live config. The regression checks every configured Opus primary and
a successor cutover while preserving an unrelated model guard.

Fallbacks recover provider failures, not hard prompts, and require working
credentials. A main session selected with a role alias still carries the
`default` session role; the model-specific guard is what closes that gap.
The 2026-09-25 forced-outage observation of default Opus moving to Sol described
the old configuration, not the guarded policy. The separate `designer` and
image-question outage checks on that date already stopped on Opus.
Task quality and whole-task cost effects remain unmeasured.

Existing sessions retain their selected model; deployment is not a retrofit
of active fallback state. After installing, restart guarded work on an explicit
Opus primary and verify the selected model before continuing. Pi now defaults
to Sonnet 5.5 medium while preserving its native authentication stores and
boundaries. Missing logins are reported, not replaced with the retired DeepSeek
default. Do not copy OMP OAuth tokens into Pi.
Exa search, approval mode, and the local title-model setting are unchanged.

For outage verification, use the real OMP CLI with disposable HOME/agent state
and a network-disabled synthetic provider extension, not live account exhaustion.
Keep model fallback enabled and every recovery candidate available. Compare
guarded Opus with a control that removes only its model-key guard; the control
must actually reach its final approved recovery candidate. Also walk a non-Opus
recovery and a healthy Opus turn. Preserve the original error, attempted-model
trace and exit status as PR evidence, then remove the disposable state.

Use `omp models find openai-codex/gpt-6.1-sol --json` to confirm the
native catalog entry and supported high/xhigh/max levels before routing changes.
After routing changes, deploy
the changed owned components and inspect the effective settings:

```sh
OMP_INSTALL_COMPONENTS=all ./install
omp config get modelRoles --json
omp config get cycleOrder --json
omp config get task.agentModelOverrides --json
omp config get retry.fallbackChains --json
```

The installer does not touch auth stores. Catalog/config resolution and
fresh-session loading need no model turn; they do not establish provider
reliability or relative quality on real work.

Store concrete selectors in each `modelRoles` value. In installed OMP 18.1.16,
the chained value `plan: "@slow"` failed native resolution and fell through to
Grok; direct values keep `@plan`, `@tiny`, and `@commit` invocation aliases
reliable without depending on nested role expansion.

Security scanning, release automation, and recurring repository work belong to
separately configured systems with their own triggers, scope, credentials, and
evidence. PR explanation and evidence remain part of ordinary interactive work;
there are no review or delivery skill entry points here. The bundled OMP
reviewers remain available for explicitly requested work. Linear is an interactive
provider integration, not a scheduler or an autonomous delivery service.

`Steward` remains a read-only observer, not a release gate. Its native
`advisor.syncBacklog: "off"` setting avoids waiting for catch-up while preserving
background review and ordinary advice delivery. Print-mode can still drain a
final review. Subagents are unadvised unless they opt in.

### Ticket rosters (US-046)

A board item can carry a ranked model roster on its ticket (`ticket.roster`:
`provider`, `model` and `effort`, best first). Left alone, the role chains in
`config.yml` recover a failing model onto models the ticket never named, ending
at Gemini 3.8 Flash. `omp-roster` gives an OMP engineer launched for a ticket
only that roster and stops it when the roster runs out. It extends the
approved routing of US-014 and makes no model call. The installed
`~/.local/bin/omp-roster` uses the sibling `omp-engineer` for memory preflight.

A launch with no ticket goes through the same tool: `--model provider/model
--thinking effort` (no `--item`) builds a one-entry roster, so the engineer stops
when that model fails instead of hopping to Gemini. See "Launch without a
ticket" below.

```sh
omp-roster launch --item K-20260929-example --json
omp-roster launch --item K-20260929-example    # prints: export PI_CONFIG_FILES=…, then --model … --thinking … --config …
omp-roster launch --model anthropic/claude-sonnet-5-5 --thinking medium --json   # no ticket: one route
omp-roster check --item K-20260929-example --session ~/.omp/agent/sessions/<cwd>/<session>.jsonl
omp-roster check --item adhoc-anthropic-claude-sonnet-5-5-20260929T190130Z --session <dir>   # id from the launch
```

`launch [--ticket-json FILE] [--usage-json FILE] [--state-dir DIR] [--harness omp] [--json]`:

Fleet admission (US-047): after validating the requested roster, before reading
usage or writing any overlay, `launch` reads `herdr agent list` for the entire
current session. Only `agent: omp` with `agent_status: working` counts, across
workspaces and including the caller. Other agent kinds (including Kaylee's
Hermes window), `idle`, `done`, `blocked` and `unknown` do not count.
`OMP_ROSTER_ENGINEER_LIMIT` is the sole limit setting, a positive integer,
default **8**. There is no override flag. At or above the limit, exit **5**,
empty stdout (including `--json`), no files written, and one stderr line:

```text
omp-roster: working-engineer limit reached (8/8); working: engineer-a, engineer-b, ...; queue work on the board.
```

Unnamed working agents use their pane ids. Unreadable Herdr state or an invalid
limit refuses with exit 1 and no files written. Below the limit, normal roster
and usage admission continues. This is a snapshot gate, not a reservation or
spawn transaction: simultaneous dispatches below the limit can both pass, and
an overlay does not reserve a future slot. It neither closes agents nor changes
Herdr or the board.

Memory admission (US-043) follows the working-status gate, before usage or
overlay/record writes. `omp-roster memory --json` prints live measurements and
reasons; an unsafe launch exits **6** with empty stdout and no files written.
`--memory-json FILE` supplies a read-only measurement fixture for isolated checks,
not a real-launch override. The final `omp` entrypoint always reinspects live
state under its lock; a successful roster preflight never reserves capacity.


1. Roster: `<board program> query items --item ID --json` (`data.value.ticket.roster`).
   The program is `glass` when it is installed (the board's name after its one-time
   cutover, ADR 0004 of the board repository), else `board`, and
   `OMP_ROSTER_BOARD_BIN` overrides both, so the launcher needs no change at the
   cutover.
   `--ticket-json FILE` replaces the board call with a file holding the
   board's answer document or just the ticket. The board's read socket lags its
   writes by about a second, so a `launch` straight after a roster edit can read
   the roster it just replaced: compare the `roster_sha256` it reports with the
   roster you wrote.
2. Refusal (exit 1, one plain sentence, nothing written): no ticket or an empty
   roster; an entry outside the approved model list (`approvedModels` in
   `bin/omp-roster.ts`, the table `bin/omp-model-policy.ts` holds `config.yml`
   to) or asking for an effort that model lacks; the same model and effort
   twice; a usage view that is not ok or has an unrecognised shape; `--harness`
   other than `omp` (Pi enforcement is a later slice); an overlay path holding a
   colon (`PI_CONFIG_FILES` is a colon-separated list).
3. Usability comes from `ai-usage dispatch --json` (or `--usage-json`): the rows
   for the entry's model on harness `omp`, else the harness `any` rows. When
   several rows name the route, every one must be `usable` or `low`. `usable`
   and `low` can launch; `exhausted`, `blocked`, `unknown` and a missing row are
   skipped with the row's reason and `next_reset`. ai-usage names differ:
   `claude-opus-5-5` is `anthropic/opus`, `claude-sonnet-5-5` is
   `anthropic/sonnet`, `xai-oauth/grok-4.7` is `xai/grok`, and
   `openai-codex/gpt-6-*` keep their ids. Gemini has no row, so it is never
   launched but can be a recovery hop. `openrouter/*` entries are cash routes: a
   roster may name them, but they are never launched or used as recovery until
   a per-ticket cash cap exists, and `check` never counts a turn on one as on
   the roster.
4. The first launchable entry in rank order wins. If none is launchable,
   `launch` exits 3 with "roster exhausted", each entry's skip reason and reset
   time on stderr, and writes nothing; with `--json` stdout also carries
   `{item, launch: null, skipped, roster_sha256}`, without it stdout is empty.
5. Otherwise it writes, in `<state-dir>` (default `$XDG_STATE_HOME/omp-roster/`
   when that is an absolute path, else `~/.local/state/omp-roster/`; files mode
   0600, written atomically):
   - `<item>.<digest>.yml`, the overlay. The digest is the first 8 hex digits of
     the overlay's own SHA-256, which covers the roster and the launch entry, so
     a relaunch that changes either writes a new file and never rewrites the one
     a running session reads. Old overlays are kept.
   - `<item>.<digest>.launch.json`, the launch record, with the same digest as its
     overlay: the roster as launched, `roster_sha256`, the launch selector, the
     overlay path and `launched_at` (ISO). One per launch, so `check` can judge
     each session against its own launch. A relaunch with the same roster and
     launch entry has the same digest and keeps the first record: its earlier
     `launched_at` judges the same roster.
   - `<item>.launch.json`, a copy of the newest launch's record, for people.
     `check` does not read it.

   The overlay sets `modelRoles.default|slow|task|extreme` to the launch entry
   (`provider/model:effort`) and `retry.fallbackChains` for each roster model, for
   those four roles and for each helper role (see Helper roles below). Each
   engineer chain names only the other roster models in rank order, never the
   model itself and never a cash route, so a hop cannot leave the roster. A
   single-model roster gets empty engineer chains, and OMP stops with the provider's
   error. `retry.modelFallback` stays on. `roster_sha256` hashes the roster as
   compact JSON (entries in rank order, keys `provider`, `model`, `effort`) and
   is recorded in the overlay's header comment.
6. Output. Plain: a line `export PI_CONFIG_FILES=OVERLAY`, then `--model
   provider/model --thinking effort --config OVERLAY`, with `skipped` reasons and
   warnings on stderr. The dispatcher exports the variable in the engineer's
   environment so any `omp` the engineer starts from its shell reads the same
   overlay. `--json` prints `{item, launch, overlay, record, env, args, skipped,
   roster_sha256, usage}`: `launch` carries the entry's `verdict` (`usable` or
   `low`), `env` is `{"PI_CONFIG_FILES": OVERLAY}`, and `usage` is `{degraded,
   degraded_reason, oldest_observation, stale_after_seconds}` from the ai-usage
   view and the launch row (`degraded` is true when either says so). `skipped`
   covers only the entries ranked above the launch entry. A `low` verdict and a
   degraded reading are also printed as `warning:` lines on stderr. Launching does
   not act on either: the roster guarantee does not depend on them.

`check --item ID --session DIR|FILE... [--ticket-json FILE] [--state-dir DIR] [--since ISO]`
(`--session` repeatable) reads OMP session JSONL. A file brings its sibling
subagent directory along; a directory is searched recursively.

- Each session file is judged against the launch that started it, not the
  ticket as it is now. `check` reads every `<item>.<digest>.launch.json` in the
  state dir and gives a file the record with the greatest `launched_at` at or
  before the file's first timestamp. A subagent file (scout, reviewer, advisor,
  task agent) takes the start of its session file, the outermost `X.jsonl` whose
  sibling directory `X/` holds it, and the file's own start only when that
  session file is not among the paths. The report names which record judged
  which files, with each record's roster, so a relaunch (or two near-simultaneous
  launches) never changes what an earlier session is judged against. A file that
  started before every record, or whose start cannot be read, is judged against
  the ticket's current roster and the report says so; pass a session file or
  `--since` to keep older sessions in the same directory out.
- Only records at or after the chosen launch's `launched_at` are judged. If the
  board's roster now hashes differently from the record chosen for the newest
  session file, it says `roster changed since launch` and exits 4 even when every
  turn was on the roster. If the board cannot give the roster at all (unreadable,
  invalid, or no ticket) and any launch record exists, that is the same finding:
  every turn is still judged against the records (a file from before every record
  against the earliest one) and the per-turn findings are printed. Without a
  launch record an unreadable roster is an error (exit 1). A file judged against a
  record that has assistant turns of which none was judged (`--since` later than
  all of them) makes the check exit 4 with `nothing was judged in FILE`, not pass.
- `--since ISO` replaces the record's `launched_at` as the time floor for every
  file (which record judges a file is unchanged). A record with no readable
  timestamp is judged, not skipped. With no launch record at all it says so and
  judges every record against the ticket's current roster, and the reported
  `roster_sha256` is only worth comparing with the one `launch` printed.
- The board's read socket follows its store by about a second, so a `check` run
  within two seconds of a roster edit can still see the old roster; a later
  `check` catches the change because the launch record persists.
- It reports every assistant turn on a model outside the roster and every
  `model_change` with `resolvedModelIsFallback: true`, each with its roster
  position or "off roster". A fallback switch to a model off the roster is a
  violation in any file, helper files included. A cash (`openrouter`) turn or hop
  is always off the roster, even when the ticket names it.
- A turn in a helper file that ran on that role's approved primary (see Helper
  roles) is counted as a helper turn and not judged. A helper file is
  `__advisor*` (role `advisor`) or a subagent file whose `session_init` record
  carries a helper `modelRole` (a scout or sonic reports `smol`, a reviewer
  `reviewer`). The designer (`session_init` agent `designer` or `modelRole`
  `vision`) is treated as a helper whose primary is `anthropic/claude-opus-5-5`,
  the model the subagent-inheritance extension forces on it. Every other turn,
  including a task agent's or the main session's, is judged against the roster,
  and a helper turn on neither its primary nor the roster is a violation.
- A last line with no trailing newline (a session still being written) is
  skipped; a corrupt line elsewhere, or a directory with no engineer file (only
  helper files), is an error, not a pass.
- It prints files, timestamps, models and positions, never prompt text.

Exit codes: 0 launched or clean; 1 refused, or unreadable input (a `check` with
no engineer session file, or a line that is not JSON, must not pass); 2 usage
error; 3 roster exhausted; 4 a turn or fallback switch left the roster, or the
roster changed since launch.

Launch without a ticket. `launch --model provider/model --thinking effort
[--usage-json FILE] [--state-dir DIR] [--json]` (no `--item`) makes a roster of that
one entry and runs the ticketed path on it: the approved-model, effort, cash-route
and ai-usage checks, exit 3 with the reason and nothing written when the route is
exhausted, blocked, unknown or a cash route, and otherwise the same overlay, launch
record, `PI_CONFIG_FILES` line and `--json` shape (`launch`, `overlay`, `record`,
`env`, `args`, `usage`). No board call is made. The launch gets a synthetic id
`adhoc-<provider>-<model>-<yyyymmddThhmmssZ>` (the model's slash becomes a dash, so
it names files safely), which is what `check --item` takes. With one route, the
engineer's chains and the model's own chain are empty, so the engineer stops with
the provider's error when its model fails. A helper keeps its US-014 primary and can
recover only onto that one route (for a Sonnet launch, the Luna, Sol and Astra
helpers may hop to Sonnet and never to Gemini or Grok). Refused with a plain sentence
and nothing written: `--item` together with `--model` or `--thinking` (exit 2);
neither `--item` nor `--model` with `--thinking` (exit 2); `--model` with a `:effort`
suffix or without a provider (exit 2, give the effort with `--thinking`); an
unapproved model or an effort it lacks (exit 1); `--ticket-json` (exit 2, it goes
with `--item`). A board item id cannot start with `adhoc-`.

`check --item adhoc-…` reads only the launch records for that id from the state dir
and refuses with a plain sentence when there is none; it reads no board (a fake
`board` that fails on any call is part of the test), reports no `roster changed`
finding because there is no board roster, and judges as usual: each file against
the newest record at or before its start (a file before every record against the
earliest, and the report says so), `--since`, helper and designer primaries, cash
always a violation.

Helper roles. The overlay writes `modelRoles` only for `default`, `slow`, `task`
and `extreme`. Other helpers retain the routes owned by `config.yml` and
`extensions/subagent-inheritance`. Reviewer and security-reviewer role chains
are explicitly empty. Their child-scoped runtime pin also empties inherited
model-key chains, which otherwise outrank those roles.

For other helpers the overlay writes `retry.fallbackChains.<role>` as the
roster in rank order, minus the role's primary model. `HELPER_PRIMARIES` in
`bin/omp-roster.ts` owns that table. The roster checker recognizes both
configured reviewer primaries as helper turns. `omp-roster.test.ts` exercises
the roster-only recovery boundary and the reviewer exception.

Designer and Opus. `vision` is deliberately untouched: its `config.yml` chain is
empty and the designer agent uses it. OMP chains are keyed by model, and a model
key outranks a role key, so a roster that names Opus is authoritative for the
whole ticket: the overlay's `anthropic/claude-opus-5-5` chain (the rest of the
roster) applies to every Opus turn, a designer's included, and the designer may
hop onto the roster. Without Opus on the roster the designer stays on its
Opus-only route and `check` does not flag it.

What the guarantee does not cover. It holds for an engineer launched through
`omp-roster launch`, with a ticket's roster or with `--model`, and with the printed
arguments and `PI_CONFIG_FILES` exported. It does not hold for:

- a Pi lane, and any `omp` not launched through `omp-roster launch` (including one
  an engineer starts without inheriting the environment): those still use the
  deployed `config.yml` chains, whose builder chains end at Gemini 3.8 Flash. An
  item with no ticket is covered only if it is launched with `--model` and
  `--thinking`; a bare `omp` on it is not;
- a model key that is not on the roster: OMP consults model keys before role
  keys, so a model-keyed chain in `config.yml` (today only Opus 5.5, `[]`) or in a
  project's `.omp/config.yml` would still apply; this is why the guard above
  requires them to be empty;
- agent definitions that pin their own model in frontmatter (for example a
  repo's `.omp/agents/*.md`), the `find` judge's `model_usage` calls, and other
  model-kind roles: these are outside both the overlay and `check`, which reads
  assistant turns and `model_change` records only;
- `check` itself, which detects after the fact. A roster guard extension on
  `before_subagent_spawn` (the hook `subagent-inheritance` already uses to block)
  would prevent off-roster spawns instead; it is not built.

Nothing enforces the roster unless the dispatcher runs `omp-roster launch` and
passes the printed arguments and environment.

Forced-outage observation (2026-09-29, `omp` 18.4.3, Codex exhausted): a
Sol-then-Sonnet roster launched Sonnet; `omp -p --model openai-codex/gpt-6-sol
--config OVERLAY` then hopped to Sonnet only, while a Sol-only overlay stopped
with the usage-limit error. `check` was clean for both and flagged the unguarded
run that hopped to Luna and Gemini. A second run (a Sonnet engineer on that
overlay spawning a scout, with `PI_CONFIG_FILES` exported and `--config` given the
same file) put the scout on its Luna primary; Codex was exhausted, so it hopped to
Sol and then Sonnet, never Gemini, and `check` was clean. The chain precedence
above is the behavior of that version: re-run the smoke after an OMP upgrade.

Launch without a ticket, same day and version. `omp-roster launch --model
openai-codex/gpt-6-sol --thinking medium` exited 3 ("exhausted, 5h 0%, weekly 53%;
resets 2026-09-29T19:42:20Z") and wrote nothing. `launch --model
anthropic/claude-sonnet-5-5 --thinking medium --json` wrote an overlay and a launch
record, and `omp -p` with its arguments and `PI_CONFIG_FILES` answered on Sonnet
only; `check --item adhoc-anthropic-claude-sonnet-5-5-<time>` was clean. The
contrast control, `omp -p --model openai-codex/gpt-6-sol` with no overlay, hopped
Sol to Luna to Gemini 3.8 Flash (`model_change` records with
`resolvedModelIsFallback: true`), and `check` against a Sol-only launch record
exited 4 with two off-roster turns and two off-roster switches.

### Evaluations are work records

The bounded Deepsec pilot and its unresolved repository, credential, cost, and
scheduling decisions are tracked in
[MIS-5](https://linear.app/misty-step/issue/MIS-5/evaluate-scheduled-deepsec-security-reviews).
No scan or timer is installed here. A selected service's maintained configuration
and procedure must live with that service, not grow into a proposal manual here.

Memory and shared-component evaluations likewise belong in Linear until a
specific implementation is selected. Memory may be derived retrieval, never a
replacement for source authority. UI source belongs to its owning library and
consumers, not to the harness. Neither evaluation enables a provider, ingests
private data, installs dependencies, or reskins products.

## Isolated installer checks

Run these once after integration against a disposable HOME, agent directory,
development root, and checkout copy. Do not point `PI_CODING_AGENT_DIR` at the
live agent tree. Compare path hashes before and after each case.
For native loader checks, put the disposable agent tree at
`$HOME/.omp/agent` (and point `PI_CODING_AGENT_DIR` there), or use one consistent
native profile. An arbitrary `PI_CODING_AGENT_DIR` redirects skill and runtime
state but not the generic config-directory lookup used by agent discovery.
Exclude copied local MCP imports and credentials from a loading-only fixture.

1. **Foreign package preservation.** Seed `$agent/skills/foreign-cli/SKILL.md`
   and `$agent/agents/foreign.md`. `./install` must keep both and replace only
   owned packages.
2. **Runtime config preservation.** Seed `$agent/config.yml` with source keys
   plus `dev.autoqaConsent: granted`. `OMP_INSTALL_COMPONENTS=config ./install`
   must keep that key, apply source-owned keys, and leave auth stores untouched.
3. **MCP auth vs inventory.** Seed a live `mcp.json` with matching `auth` on
   `openrouter` and an extra undeclared server. MCP install must keep matching
   `auth`/`oauth` for declared servers and drop the extra server. Do not print
   secrets.
4. **Invalid preflight writes nothing.** Record hashes, then try a missing
   guidance file, `OMP_INSTALL_COMPONENTS=skill:not-a-skill`, invalid live YAML,
   and a conflicting `.omp/.mcp.json`. Each must fail before creating or
   changing destinations.
5. **Scope boundaries.** Under a fake `OMP_DEVELOPMENT_ROOT`, only
   `misty-step` and `moomooskycow` receive Linear definitions and relative
   `.mcp.json` imports. An `r90` tree stays untouched. Symlinked `.omp`
   directories and conflicting fallback files are refused with no writes.
6. **Owned retirement.** Live `RULES.md`, `skills/ast-grep`, and
   `skills/now-next` disappear on `guidance`/`scopes`/`all`. `wrangler`
   matches this source package. Global `todoist-cli` remains while
   `OMP_TODOIST_OWNER` lacks `SKILL.md`, and is removed only after that
   owner file exists. Do not delete `~/.claude` or `~/.codex` copies from
   this installer.

Rollback is component-scoped: restore prior owned bytes and modes. Do not use a
historical full-directory skills replacement as rollback.

### Focused config checks

```sh
../scripts/verify omp
```

Covers `sh -n install`, the merge/suite checks, and the installer isolation invariants.

These checks use temporary destinations and cover old-config → new-config
retirement of owned keys without losing foreign config entries, foreign
packages, and preflight failures. They do not prove native SDK behavior.
For runtime changes, use one bounded native OMP run in a disposable workspace:
confirm native delegation, a depth-3 worker result, and real file and process
results rather than an agent's success claim. After deployment, confirm
automatic extension discovery in a fresh session; this loading check needs no
model turn. Prose-only changes do not require repeating the runtime exercise.

## Related repositories

- `agent-config` owns the shared
  primitives this repo deploys.
- `pi-config` is the sister harness.
- [linear-cli](https://github.com/misty-step/linear-cli) is the standalone
  Linear client.

## Ecosystem

- Non-R90 work uses Linear for durable tracking and project notes for design
  knowledge. Current operator requests remain authority; R90 stays in Habitat.
- **Iron Forest** — headless Builder/Verifier/Fixer factory. Mechanical
  enforcement belongs there and in CI, not in prose.
- **Landmark** — release pipeline: conventional commits become semantic
  versions, technical changelogs, synthesized user-facing notes, and
  machine-readable evidence.
