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
touched. Expect eight passing cases:

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

`$HERMES_HOME/.kaylee-seeded` records completed identity/learning config seeding;
without it, the next install seeds that config once, even on an existing host.
Existing files/skills are kept independently of the marker, except an unmodified
Hermes-default SOUL. The installer generates a pristine SOUL using the installed
Hermes in a temporary HERMES_HOME and compares exact bytes; no prefix matching
or hardcoded template. Future default text is detected automatically when it
matches that installed Hermes; older or otherwise differing text is kept
conservatively. SOUL symlinks are never followed by this comparison.

Personality, prompts, memory and skill-learning settings belong to Kaylee after
seeding. First-boot toolset defaults merge into existing lists. Every run adds
`delegation` to `agent.disabled_toolsets` if absent and removes it from every
`platform_toolsets.*` list, preserving all other entries, including custom
platform choices. Other toolsets, including `file` and `code_execution`, are
Kaylee-owned after seeding. The always-enforced keys remain
`delegation.backend`, `delegation.backends`, `plugins.enabled`, `plugins.disabled`,
`kanban.dispatch_in_gateway`, `kanban.review_dispatch`, `kanban.auto_decompose`,
`kanban.dispatch_profiles`, `gateway.allow_all_users`,
`platforms.discord.unauthorized_dm_behavior`, `discord.allow_bots`,
`approvals.mode`, `approvals.cron_mode`, `approvals.single_query_mode`,
`approvals.unattended_mode` and `command_allowlist`. Do not remove the marker to
refresh defaults.

Also drive a real installed Hermes in a throwaway HOME/HERMES_HOME, with Boat,
Daybook, sudo and systemctl stubbed as in the regression fixture. Leave live
homes, services and credentials untouched. Run `hermes -p default config set
display.personality ''` first; confirm it creates the Hermes-default SOUL, then
run the installer and compare SOUL with Kaylee's seed. Run `hermes -p default
tools enable --platform discord delegation`, add another platform choice such
as `browser`, clear `agent.disabled_toolsets`, and rerun the installer. Native
`hermes -p default config get agent.disabled_toolsets --json` must contain
`delegation`; `hermes -p default config get platform_toolsets --json` must show
no delegation on any platform and retain the other choice. No model call or
gateway restart is needed.

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
