# Grok Bot mechanics

Use this brief for Maren and Shipwright, the Grok Bots on the shared box. This is
a self-install brief for their actual bot runtime, not a Grok Build CLI adapter.
The method remains the repository's shared Agent Skills tree and core; there is
no `.grok-plugin` package or assumed Grok plugin command.

## Established facts and facts to establish

Maren and Shipwright share a box, and each bot has a native runtime `agents.md`
that must point to Mistystack's core and Misty skill. The repository supplies
[`rules/core.md`](../../../rules/core.md) and
[`skills/misty/SKILL.md`](../SKILL.md) as their canonical sources.

The bots must establish the actual runtime version, repository location,
instruction-loading mechanism, refresh/restart operation, model authority,
subagent capability, available browser integration and whether a Boat credential
is provisioned on the bot computer. None of those mechanisms
is established by the existence of this brief. Do not invent a CLI, manifest,
loader API or dispatch tool to fill the gaps.

## Working environment

Your working environment is your hosted bot computer. Tern+OMP is the operator's
local setup; do not install or adopt it. Read, edit, coordinate and run quick
trusted checks on the bot computer. Every Bot on the account shares its files,
browser sessions and command-line credentials, so it isolates nothing: run
builds, test suites, browser QA against running services, untrusted code and long
jobs on [Boat workers](../../boat-workers/SKILL.md).

Boat access needs a credential Phaedrus provisions on the bot computer, which
every Bot there can use. Without one, report that prerequisite and do not run
the work on the bot computer instead.

Orchestrate aggressively: you coordinate unattended work and dispatch it. Send
isolated execution to Boat workers, delegate whole engineering units to
Cursor's cloud-managed agents when your runtime can launch them, and run
recurring coordination as your own native routines. Do not start work on
exe.dev, Hermes Agent or the retired Kaylee dispatcher.

Reach Phaedrus's Mac through Grok Bot local execution only for checks that need
macOS or its devices, one approved command at a time; never for portable builds,
suites or untrusted code.

## Install and refresh brief

Give each bot the [Misty briefing contract](../SKILL.md) with this scope and proof:

1. **Locate.** Inspect your real runtime and existing `agents.md`, then identify a
   maintained checkout of `misty-step/mistystack` and record its revision. Preserve
   unrelated instructions, configuration, credentials and runtime data. Maren and
   Shipwright must name one writer for any shared checkout or shared settings;
   each bot owns its own instruction entry point.
2. **Install.** Obtain the repository through the box's established repository
   workflow. Point your native runtime `agents.md` at the installed
   `rules/core.md` and `skills/misty/SKILL.md`. Establish whether the loader follows
   those pointers automatically; the core must enter standing context and Misty
   must be reachable on demand through real file reads. Keep one content tree,
   not copied rules and skill bodies in each bot's runtime directory.
3. **Refresh.** Use the checkout's established update operation without discarding
   local or foreign changes. Record the new revision and installed-file readback,
   then use the bot's actual reload/restart mechanism. The bots must report that
   exact operation; repository refresh alone is not proof of runtime refresh.
4. **Configure.** Read the [rigor contract](../../ship-loop/roles.md#rigor), then
   establish your runtime's native model/reasoning authority and whether it can
   dispatch independent subagents. Keep any selections in that native authority.
   If subagents are unavailable, execute the tier's work inline and obtain the
   required independent QA/review and judgment in separate authorized runtime
   threads; do not label an inline self-review independent.
5. **Prove.** Start a fresh runtime for each bot and retain its identity, revision,
   actual loading/read events and result. Demonstrate that the installed core is
   in standing context, Misty is reachable, and following Misty's relative
   [bug-fix link](../playbooks/bug-fix.md) reads the installed playbook and quotes
   its first step. Confirm principle leaves are explicitly reachable; report the
   observed discovery/invocation behavior instead of assuming metadata flags are
   enforced. If claiming subagent or model routing, retain the actual native
   dispatch, model identity and result as separate evidence.

Completion requires proof from both Maren and Shipwright. A bot's promise to
install, a checkout's file presence or a response that merely claims to have
loaded the core is not proof. Keep no-model installation/readback classified as
`artifact verified`; call runtime behavior proven only after the fresh-session
consumer path succeeds. Report any missing native capability with the exact
observed reason, not a fabricated fallback.

## Instruction filenames and relative links

Repository standing instructions remain `AGENTS.md`. The bot runtime's native
`agents.md` is a separate, case-sensitive loader filename, not permission to
create a second repository standing-instruction convention. Keep that exact
runtime filename and point at the maintained sources rather than duplicating
policy. Resolve each skill's Markdown links relative to the installed file that
contains them, not the bot's working directory.

## Drive the real UI

No browser integration is established for these bots by this adapter. Each bot
must identify an integration actually available and authorized in its runtime,
read its native contract and drive the real application before claiming UI
proof. OMP's `eval` browser API is not a Grok Bot API. Without a verified route,
report the browser path as unverified. The
[design review procedure](../../design/review.md) owns state selection.
