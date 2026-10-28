# Kaylee chief and Boat OMP workers

Use this scoped recipe for `agent-config/chief/`: Kaylee's first-boot identity,
manual, skills and config seed, and OMP workers that each run on their own Boat
VM. Legacy Claude/Codex `doctor` prerequisites and the `all` helper are not
prerequisites for this path.

Run on the chief's exe.dev host from the installed source worktree
`~/workspace/kaylee-src`. Retain the checked source revision and secret-free
results outside the checkout. Never print gateway, Boat, GitHub or Discord tokens,
`.env` files or resolved provider configuration.

## Isolated first-boot and rerun proof

From the candidate checkout, run:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s agent-config/chief -p 'test_install_kaylee.py' -v
./scripts/check
```

The regression drive runs the real installer and its worker/cron installers in
temporary HOME and HERMES_HOME directories, with stub Hermes, Boat, Daybook,
sudo and systemctl commands. No real Hermes home, credentials or services are
touched. Expect eleven passing cases:

- An absent HERMES_HOME gets SOUL, a regular copied AGENTS.md, every skill,
  memory/profile enabled, both nudges at 10, memory tools on CLI/Discord, skill
  authoring enabled, the seed marker, tooling and both cron jobs.
- A populated rerun preserves edited SOUL, manual and all skill bytes (including
  learned files), every seeded non-boundary config value and an edited routine.
  It restores every boundary config value, parks a legacy profile even if gateway
  stop fails, and supplies a missing job without replacing the existing one.
- An unmarked home preserves existing files, skills and symlinks, logging each
  kept path, while supplying absent seeds.
- An existing Hermes-default SOUL is replaced by Kaylee's seed, including when
  the installed Hermes generates different default text. A customised default
  and both working and dangling SOUL symlinks stay byte-identical and log `kept`.
- With or without the seed marker, toolset choices survive the delegation
  boundary merge. On rerun, an emptied disabled list gains `delegation`; CLI,
  Discord, cron and a custom platform lose only `delegation`, retaining other
  entries in their original order.
- A home with the exact base installer's (`c7041c1`) toolset config and no marker
  gains memory on CLI/Discord and loses `memory` from `agent.disabled_toolsets`.
  Conflicts with every other seeded-enabled toolset are removed too; unrelated
  disabled entries retain their order and duplicates.
- A marked home with `platform_toolsets` removed still restores boundaries and
  disables delegation without recreating the removed key. Only exit 1 with
  `Config key not set: platform_toolsets` counts as absent; other read failures
  must abort.

`$HERMES_HOME/.kaylee-seeded` records completed identity/learning config seeding;
without it, the next install seeds that config once, even on an existing host.
Existing files/skills are kept independently of the marker, except an unmodified
Hermes-default SOUL. The installer generates a pristine SOUL using the installed
Hermes in a temporary HERMES_HOME and compares exact bytes; no prefix matching
or hardcoded template. Future default text is detected automatically when it
matches that installed Hermes; older or otherwise differing text is kept
conservatively. SOUL symlinks are never followed by this comparison.

Personality, prompts, memory and skill-learning settings belong to Kaylee after
seeding. First-boot toolset defaults merge into existing lists, then every
toolset enabled by the platform seeds is removed from `agent.disabled_toolsets`.
On a base-built, unmarked host this removes the old `memory` disable and makes
the memory tool usable, rather than only enabling its config. Unrelated choices
and their order survive. Once marked, even Kaylee's decision to disable memory
is preserved. Every run adds `delegation` to `agent.disabled_toolsets` if absent
and removes it from every `platform_toolsets.*` list, preserving all other
entries, including custom platform choices. Other toolsets, including `file`
and `code_execution`, are Kaylee-owned after seeding. The always-enforced keys remain
`delegation.backend`, `delegation.backends`, `plugins.enabled`, `plugins.disabled`,
`kanban.dispatch_in_gateway`, `kanban.review_dispatch`, `kanban.auto_decompose`,
`kanban.dispatch_profiles`, `gateway.allow_all_users`,
`platforms.discord.unauthorized_dm_behavior`, `discord.allow_bots`,
`approvals.mode`, `approvals.cron_mode`, `approvals.single_query_mode`,
`approvals.unattended_mode` and `command_allowlist`. Do not remove the marker to
refresh defaults.

Also drive a real installed Hermes in a throwaway HOME/HERMES_HOME, with Boat,
Daybook, sudo and systemctl stubbed as in the regression fixture. Leave live
homes, services and credentials untouched. Use Hermes v0.22.5 for the base-built
cutover: initialise config, run the `c7041c1` base installer from a disposable
source checkout, confirm no `.kaylee-seeded`, then run the candidate installer.
Retain actual output from `hermes -p default tools list --platform discord`
(memory enabled) and `hermes -p default config get agent.disabled_toolsets
--json` (no memory, delegation present).

In another throwaway home, run `hermes -p default config set display.personality
''`; confirm it creates the Hermes-default SOUL, then run the installer and
compare SOUL with Kaylee's seed. Repeat with a customised SOUL and working/dangling
SOUL symlinks; expect unchanged bytes/targets and `kept`. Run `hermes -p default
tools enable --platform discord delegation`, add another platform choice such
as `browser`, clear `agent.disabled_toolsets`, and rerun the installer. Native
`hermes -p default config get agent.disabled_toolsets --json` must contain
`delegation`; `hermes -p default config get platform_toolsets --json` must show
no delegation on any platform and retain the other choice and its order. Repeat
without the marker, allowing only the documented first-boot merges/conflict
removals. Tamper approvals, allowlist, owner-only gateway, delegation backend and
Kanban dispatch; rerun and read back their enforced values. No model call or
gateway restart is needed.

On a marked home, `config unset platform_toolsets`, tamper approvals, owner-only
gateway, command allowlist and the disabled list, then rerun once. Verify every
boundary above, `delegation` disabled on native CLI/Discord tool listings, legacy
parking, the Daybook timer and cron. The removed key must remain absent. Inject
a different `config get platform_toolsets` failure and confirm nonzero exit.

## Installation and loading

1. Inspect the source revision and native versions (`hermes --version`,
   `omp --version`, `boat --version`). Install only under the owner's deployment
   authorization: `KAYLEE_DELIVER=discord:<owner DM> agent-config/chief/install-kaylee.sh`,
   then restart `hermes-gateway.service` at an idle moment. Never test against
   the live home; use the isolated proof above.
2. On a fresh install, read back SOUL and the workspace's regular copied
   AGENTS.md against the seed, and confirm `.kaylee-seeded`. Native
   `hermes -p default config get` shows memory/profile on, memory and skill
   creation nudges at 10, memory tools on CLI/Discord, native delegation/Kanban
   dispatch off and owner-only Discord. On a rerun, Kaylee's files and learning
   config may differ from source and must stay unchanged; do not call that
   drift. Existing symlinks are kept rather than migrated. Legacy role profiles
   carry `gateway.parked`, and `hermes -p default cron list` shows
   `kaylee-workers` and `kaylee-legacy-fleet` (existing routines keep her edits).
   `journalctl -u hermes-gateway` shows `[Discord] Connected as kaylee` after the
   restart.
3. Fresh chief readback, bounded:

       hermes -p default chat -Q --max-turns 1 -q 'Without tools: who are you, who do you serve, how does engineering work get done, and where does shared context live?'

   Kaylee answers in her own voice: chief engineering officer, OMP workers on
   their own Boat VMs, Hermes working memory and shared context in Daybook. A
   generic Hermes identity fails.

## Actual dispatch

4. Rebake only when worker guidance or tooling changed:
   `agent-config/chief/worker/boat/build-snapshot.sh`, then
   `check-snapshot.sh` proves no credential files are baked in.
5. `kaylee-dispatch start` a bounded read-only brief on a private repository.
   Wait for `kaylee-dispatch list` to show it finished, read `result`, confirm the
   gateway journal attributes the inference to the worker client, then `finish`
   and confirm the VM and its tunnel unit are gone. A launch or exit code alone is
   not proof.
6. Through Discord or the web workspace, ask Kaylee to commission a real ticket.
   Observe her own `kaylee-dispatch` use, its Boat VM, and her follow-through to a
   reviewed PR. Her claim alone is not proof.

## Evidence and cleanup

Publish a concise source-revision, command and result summary on the PR; keep
private account, channel and conversation details out of public reports. Delete
only sandboxes you created; preserve Kaylee's sessions, cron jobs, credentials and
the owner's other sandboxes.
