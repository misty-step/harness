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
| `bin/pass-env.ts` | Moved to `agent-config`: pass-backed launcher, installed as `~/.local/bin/pass-env` |
| `bin/jev-verdict.ts` | Moved to `agent-config`: advisory child-summary verdict command, installed as `~/.local/bin/jev-verdict` |
| `bin/tmp-health.py`, `references/dev-exec.md` | Opt-in workstation execution limits, pressure notifications, and rollback workflow |
| `config.yml` | Model roles, fallbacks, theme/TUI, providers, task/LSP settings |
| `models.yml` | Local Ollama discovery; cloud models come from omp's bundled catalog |
| `mcp.json` | Global MCP inventory; Linear is deliberately absent |
| `workspace-mcp.json`, `bin/omp-install-scopes.ts` | Linear directory scopes, native project-local imports, owned skill retirement |
| `global/AGENTS.md` | OMP-specific guidance; `./install` composes it with shared sections from `agent-config` |
| `global/WATCHDOG.md`, `global/WATCHDOG.yml` | One read-only Steward advisor |
| `themes/` | TUI themes (`tokyonight`, `everforest`, `everforest-light`) |
| `skills/` | Moved to `agent-config`: portable skill packages, clean-replaced when selected |
| `../.githooks/pre-push` | Root scanners; wired by `../scripts/bootstrap`, not runtime deployment |
| `extensions/loc/` | Session-resident LOC status and commands |

## Install

This is a component of [harness](../README.md), not a standalone checkout.
Repository setup and releases belong to the root. `./install` rejects positional
arguments (including `--check`); use `../scripts/verify omp` for isolated checks.

```sh
./install   # requires jq, bun, and omp
```

Preflight validates every selected input, then writes. Unset selection means
`all`: owned config overlay, guidance, MCP, scopes, agents, skills, themes,
extensions, `omp-grievances`, `pass-env`, and `jev-verdict`. It does not delete
foreign skills or agents, and it does not import live secrets into this
checkout. Skills, shared guidance sections, `pass-env`, and `jev-verdict`
deploy from the sibling `agent-config` checkout
(default `$repo_dir/../agent-config`; override with `AGENT_CONFIG_DIR`); the
installer fails closed when it is missing.

```sh
OMP_INSTALL_COMPONENTS=guidance ./install
OMP_INSTALL_COMPONENTS=config ./install
OMP_INSTALL_COMPONENTS=agents ./install
OMP_INSTALL_COMPONENTS=secrets ./install
OMP_INSTALL_COMPONENTS=mcp ./install
OMP_INSTALL_COMPONENTS="guidance mcp scopes skill:capture" ./install
```

Supported components are `guidance`, `config`, `mcp`, `scopes`, `agents`,
`secrets`, and `skill:<source-directory-name>`. `all` cannot be combined with another
component. Empty, unknown, missing-skill, invalid-name, and invalid YAML
selections fail before any writes. The retired `OMP_INSTALL_GUIDANCE_ONLY`
variable fails with migration instructions rather than silently triggering a
full install.

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

Configuration preservation is semantic, not preservation of YAML comments or
formatting. Package preflight checks syntax and local imports; native loading
must still be confirmed.

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

## Linear

Use the [official Linear MCP server](https://linear.app/docs/mcp) for access and
the existing `/skill:capture` for capture judgment. The connector is not a
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

Maintained engineering and visual preferences live in `global/AGENTS.md`. Vision
documents are optional context, not a mandatory first read or a higher authority
than current requests. The unchanged `show-me` skill provides diagrams and
code-shape explanations; choose evidence for the actual change rather than
requiring a fixed artifact packet.

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
font licenses. The external `frontend-design` and `show-me` packages stay verbatim.

## Skills and agents

Eight homebrew skills are explicitly invoked:

| Command | Outcome |
| --- | --- |
| `/skill:foundation` | Recommend a coherent project direction and practical transition without changing the project |
| `/skill:agent-ergonomics` | Synthesize grounded findings into prioritized improvements in the project's existing backlog and roadmap |
| `/skill:verification-infrastructure` | Create or repair repository-owned runnable verification and its discoverable skill, preserving existing interfaces |
| `/skill:capture` | Save durable findings to project notes, or the required tracker, without duplicating or claiming work |
| `/skill:pokayoke` | Make a class of error impossible (shape, type, ownership, missing affordance, or a failing-closed check) instead of warning about it |
| `/skill:decide` | Synthesize current context, tradeoffs, and candidate paths into an executive decision brief |
| `/skill:user-stories` | Draft, extend, or reconcile a repository's root user stories |
| `/skill:visual-state-review` | Capture every named UI state as screenshots, organise them, and look before claiming frontend work verified |

`disable-model-invocation: true` hides these descriptions from the automatic
skill index. It does not prevent an explicit `skill://` read or grant authority
to act. Read-only requests remain read-only. These skills are owned by
`agent-config` and deployed through its contract; this repo no longer carries a
`skills/` directory.

`authenticated-commands` is a portable homebrew skill for API tokens,
authenticated scripts, pass entries, `.env.pass`, and migrated project execution.
OMP automatically discovers it when installed together with `pass-env` by the
`secrets` component (or `all`), without a global AGENTS secret policy.

`foundation` is a first-principles investigation and design proposal, not an
implementation pass or an infrastructure checklist. It distinguishes an ideal
destination from a practical transition; preserving a sound system is a valid
conclusion. Its [operating reference](../agent-config/skills/foundation/operating-foundations.md)
is conditional context when verification, hosting, deployment, or operation
could change the recommendation. Invoke `/skill:foundation` with context or
constraints the repository cannot supply; select the model separately. Backlog
changes and implementation remain separately authorized work.

Use `/skill:agent-ergonomics [optional scope or focus]` to consider the project
from the agent driver's seat: accurate understanding and effective control at
the least total cost. By default, it synthesizes and prioritizes grounded findings
into the existing backlog and roadmap, reconciling work rather than duplicating
it. Documentation supports those improvements only where needed. Existing scope
and authority govern writes; otherwise it proposes updates. Use `review-only` for
no writes.
Repeated use should converge, not accumulate instructions or speculative work.

Use `/skill:pokayoke [optional error class or incident]` after a defect,
incident, or near-miss. The outcome is a mechanism that makes that class of
error impossible—not a warning, comment, or extra instruction layer. A reminder
is not pokayoke. `postmortems/TEMPLATE.md` requires the same close.

Use `/skill:decide [optional fork, question, or decision topic]` to request a
dense, high-context executive brief in ASD-STE100 style when facing a technical
decision point. It is read-only analysis. It leads with facts, root causes,
invariants, viable candidate paths, and a structured tradeoff matrix across
reversibility, blast radius, effort, operational cost, and primary risk. It
states a clear technical recommendation with an explicit decision boundary, and
ends with the exact next action to take upon approval.

Use `/skill:user-stories [optional repository, capability, or story id]` to
keep a repository's root `USER_STORIES.md` honest: draft stories from observed
behavior, extend them with the feature PR that ships the change, or audit gaps
read-only. Stories are the root artifact; downstream work cites the story id.

Five vendored packages remain unchanged except by whole-package refresh:
`frontend-design`, `herdr`, `show-me`, `wrangler`, and `using-exe-dev`.
Wrangler is refreshed from [cloudflare/skills](https://github.com/cloudflare/skills)
at `d924cd8` with its Apache 2.0 license. `using-exe-dev` is the
[official skill](https://exe.dev/docs/agent-skill.md), vendored unchanged from
[`boldsoftware/exe.dev` at `9af0789cf2417fc16cab7684cc401967a17060d0`](https://github.com/boldsoftware/exe.dev/blob/9af0789cf2417fc16cab7684cc401967a17060d0/skill/SKILL.md)
(skill blob `5c3018342ee964c0c5384772e42e30256e10def8`).
Update them from upstream or remove the whole package; use a distinctly named
homebrew skill for different behavior. These packages are owned by
`agent-config`; provenance and refresh live there. Omarchy's `omarchy` and
`diagnose-crash` retain their own owners and discovery paths; this installer
does not replace them. Todoist is owned by Daybook and is not shipped here.

### Repository verification

From the product checkout, invoke:

```text
/skill:verification-infrastructure
```

The [authoring skill](../agent-config/skills/verification-infrastructure/SKILL.md) discovers
existing setup, fixtures, smoke commands, CI, and specialized skills before
creating anything. It establishes or repairs a capability; it does not require
a new CLI, a particular browser vendor, or a uniform receipt schema. Keep a
sufficient existing skill rather than generating a competing one.
Its [runtime](../agent-config/skills/verification-infrastructure/runtime.md) and
[journey](../agent-config/skills/verification-infrastructure/journeys.md) references are read
when those concerns are in scope, not as a mandatory packet. Selected skill
installation copies the complete package, including these adjacent references.

`foundation` assesses whether a fresh agent can exercise the core outcome,
distinguish success from failure, and clean up. It recommends missing capability
without implementing it. Ordinary executable work uses the product's skill and
updates affected procedures and checks in the same change. Use the authoring
skill again for a substantial repair, not for every feature edit.

Repository onboarding and a wider adoption pass need an explicit scope.
Recurring drift checks belong to an authorized execution system, not a timer
installed by this skill. Explicit-resource workers need their own skill-loading
integration; installing a global package does not override disabled discovery.
This harness change does not provision workspaces, start repository rollouts,
or activate factory work.

To deploy only this capability and its guidance:

```sh
OMP_INSTALL_COMPONENTS="guidance skill:foundation skill:verification-infrastructure" ./install
```

Start a fresh OMP session after installation to discover the new slash command.

### Persistent workspaces and exe.dev

`using-exe-dev` is advertised automatically for exe.dev and `*.exe.xyz` work.
Refresh the whole upstream skill package and update this provenance together.
Local workspace, authorization, hosting, and recovery policy lives in
`global/AGENTS.md`. `foundation` examines the practical transition and
`WATCHDOG.md` challenges missed ownership or recovery risks. No extra SYSTEM
prompt, scheduler, or automatic migration is installed.

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

### Model routing

Daily work runs on the cheap triad: GLM-5.3 plans and strategizes, DeepSeek V4.1
Flash builds, and Gemini 3.8 Flash verifies. Frontier models (Astra, Opus) are
strategic and occasional, never the default. The native roles and retry fallback
chains live in `config.yml`; this is a default-and-role policy, not a prompt
classifier or automatic mid-session switch.

| Entry point or role | Primary selection |
| --- | --- |
| Fresh `omp`, `@default` | `openrouter/z-ai/glm-5.3:high` |
| Ordinary `task` workers, `@task` | `openrouter/deepseek/deepseek-v4.1-flash:max` |
| `@smol`, `@tiny`, `@commit`; bundled `scout` and `sonic` | `openrouter/z-ai/glm-5.3-flash:max` |
| `@plan`, `@advisor` | `openrouter/z-ai/glm-5.3:high` |
| `@slow` (explicit thorough pass) | `openai-codex/gpt-6-astra:high` |
| `@extreme` (rare unconstrained reasoning) | `openai-codex/gpt-6-astra:max` |
| `security-reviewer` | `openai-codex/gpt-6-astra:max` |
| `reviewer`, `@vision` | `google-antigravity/gemini-3.8-flash:high` |

GLM-5.3 high is the default planner and strategist. DeepSeek V4.1 Flash max is
the builder for dispatched `task` workers. Gemini 3.8 Flash high verifies and
inspects; the catalog offers no `max` thinking level for it, so high is the
ceiling. Astra is strategic and rare: `@slow` is an explicit thorough pass, and
`@extreme` plus `security-reviewer` are reserved for unconstrained reasoning
and security review. When a frontier model reviews, give it the repository
itself; do not substitute a cheap model's summary. The cheap tier (`smol`,
`tiny`, `commit`) runs on the smallest model that works. A configured role does
not create an agent. Native OMP bundles `task`, `scout`, `sonic`, `reviewer`,
and `security-reviewer`, not `designer`. Main uses the session model.

For a new session:

```sh
omp                         # ordinary work: GLM-5.3 high
omp --model @slow           # explicit thorough pass: Astra high
omp --slow                  # shorthand for @slow: Astra high
omp --model @extreme        # rare unconstrained reasoning: Astra max
omp --model @smol           # explicitly choose the cheap model
omp --model @vision         # visual inspection: Gemini 3.8 Flash high
```

An already-open or resumed session retains its selected model; installing a
new default does not switch it. Inside OMP, `Ctrl+P` cycles the configured
`smol`, `default`, and `extreme` roles, in that `cycleOrder`. `Alt+P` opens the temporary session-model
picker; select a concrete model without rewriting the default.
`/model` (or `Alt+M`) opens model/role configuration instead. These are the native
default keybindings; local bindings can override them. Explicit CLI selections,
project config, and one-run `--config` overlays can override the global default.

Task dispatch selects an **agent**, not a per-item model. Native precedence is
`task.agentModelOverrides` → agent frontmatter → parent/default fallback.
Explicit `scout`/`sonic` overrides use `@smol`; its `:max` suffix takes precedence
over their bundled `medium` thinking defaults. New task/eval dispatches reload
persisted routing settings, but changing Main's model alone does not remap
workers. Ordinary workers use DeepSeek V4.1 Flash; Gemini Flash serves `vision`
and `reviewer`; the cheap tier serves `smol`, `tiny`, `commit`, and
`scout`/`sonic` through `@smol`. Git commit, rebase, push, and similar
mechanical ship steps must use bundled `sonic` (`@smol`). Omitting `agent`
selects `@task`/DeepSeek. Choose agents for their roles, not as differently
priced implementation workers. Do not add delegation just to save tokens.

The five explicit retry chains are `default`, `vision`, `smol`, `tiny`, and
`commit`. Each leads with the cheap triad (GLM 5.3 Flash max, DeepSeek V4.1
Flash max, then Grok xhigh), followed by Muse Spark 1.3 Contributor max, and
ends with exactly one frontier link, Astra low on Codex. No chain leads with
Opus max or Astra. They remain explicit because native fallback inheritance
uses `default`, not `smol`. Gemini, Grok, Muse, and DeepSeek use
catalog-maximum reasoning effort: Flash high, Grok xhigh, Muse max, and
DeepSeek max.

Fallbacks recover provider failures, with guardrails and usage limits being common
causes, rather than difficult prompts, and still require available credentials.
Cheap links lead so recovery stays cheap; the xAI subscription follows, and the
single frontier link covers the case where every cheap route is unavailable.
Opus max stays out of the automatic chains; it remains reachable by explicit
selection.

Muse Spark 1.3 Contributor is the preferred cheap OpenRouter hop, but it can
stop serving. It uses the same 1.3 checkpoint at $0.10/$0.20 per million
input/output tokens; the training-data trade is accepted. Astra low is the
final recovery link. Fugu stays out of automatic fallback chains.
Exa search, approval mode, and the local title-model setting are unchanged.

Use `omp models find openrouter/z-ai/glm-5.3 --json` to inspect the
exact catalog entry and supported thinking levels. After routing changes, deploy
the changed owned components and inspect the effective settings:

```sh
OMP_INSTALL_COMPONENTS="config guidance" ./install
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
