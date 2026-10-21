# Canonical native startup proof

The native loading blocker is resolved through Claude's supported user-settings
`SessionStart` hook. `AGENTS.md` remains the only instruction file; there is no
legacy file or symlink. Native CLI subscription authentication is execution
context, not a product QA account.

## Root cause and integration

Automatic AGENTS discovery follows project ancestors, rather than loading
`~/.claude/AGENTS.md` from outside HOME. Both native builds failed that path in the
[earlier proof](../canonical-agents-qa/README.md). The official
[memory documentation](https://code.claude.com/docs/en/memory#when-claude-code-reads-agentsmd)
describes that project scope. A version number did not establish global loading.

The installer now owns a small native SessionStart adapter in user settings.
It reads the canonical file into bounded context parts, each below the native
10,000-character spill threshold described in the
[hook documentation](https://code.claude.com/docs/en/hooks#add-context-for-claude).
There is no instruction-file CLI argument, policy added to the SDK system prompt,
shell alias, T3 configuration change or extra instruction-content file.

[Installed T3 source](t3-native-startup.txt) shows its ordinary Claude query uses
the preset system prompt, native executable, environment and cwd, without excluding
user settings or disabling hooks. The maintained SDK drive uses the same official
SDK version, 0.3.276, and those startup settings, including additionalDirectories.
It adds hook-event observation and disables tools for the readback. The SDK module
was extracted from the official npm tarball into private scratch.

## Results

The complete installed file is 12,570 characters, delivered in four parts.
The native consumer's actual hook events reconstruct its bytes exactly, with
SHA-256 `2e250ebdece158a4b4d23cadc050c14ef6722c9bf0d54ed82463dbcc0d91724d`.
The file includes the AgentMail setup exception and Process-only shared-auth rule.

| Native consumer | Startup delivery | Authenticated consumption |
| --- | --- | --- |
| Installed 2.1.303 CLI | [complete context](claude-isolated-context.json), preserved foreign hook, selected skills | [canonical and QA policy](claude-candidate-result.json) |
| Installed 2.1.303, T3 SDK startup | [complete context](claude-sdk-context.json), preserved foreign hook | [first heading, final line and Process writer](claude-sdk-result.json) |
| Private 2.1.305 CLI | [complete context](native-2.1.305/claude-isolated-context.json), preserved foreign hook, selected skills | no model authentication in this startup-only call |
| Private 2.1.305, T3 SDK startup | [complete context](native-2.1.305/claude-sdk-context.json), preserved foreign hook | [first heading, final line and Process writer](native-2.1.305/claude-sdk-result.json) |

Every cwd is outside both real and private HOME. The SDK uses the default user
settings location, without a config-directory override. The published
`*-hooks.jsonl` files retain only native SessionStart outputs and outcomes;
`claude-context.py` revalidates them against canonical AGENTS.md. InstructionsLoaded
is a leakage check, not fabricated evidence of native hook context delivery.

- [Six adapter tests](unit-tests.log) cover full Unicode context, foreign settings
  and hooks, mode preservation, owned upgrades, stable reruns, malformed settings,
  reserved collisions, symlinks and explicit hook disabling.
- [178 installer assertions](installers.log) pass, including whole-installer
  refusals for malformed native settings and an unowned reserved hook.
- [The real install transcript](transcript.txt) records both installers in private
  HOME, the repeated Claude install with byte-identical settings, exact guidance
  composition, preserved foreign hooks, no legacy entries, and no timer activation.
- [The policy probe](policy-probe.log) passes. Codex's
  [rendered candidate input](codex-candidate-summary.txt) carries the composed file
  and selected skills. Earlier unchanged migration and shared suites remain linked
  in the historical evidence; they were not rerun for this focused native fix.
- [Isolation](isolation.json), [host preservation](host-preservation.json) and
  [provenance](provenance.json) record credential-copy removal, source revisions,
  native versions and unchanged live host files. `gitleaks dir` passes on this
  evidence directory.

The transcript retains two initial verifier failures. Reinstall legitimately
recorded two daemon reloads while the old assertion expected one; the corrected
assertion still forbids activation. The first SDK model answer stripped the heading's
Markdown prefix, failing strict readback despite complete native delivery. That
[answer](claude-sdk-initial-formatting-result.json) remains recorded. A clarified
verbatim-source-line request passed on a new authenticated session. Neither failed
run was relabeled PASS.

## Limits

This verifies real native CLI and SDK consumers, not a newly opened T3 UI lane.
Live host deployment, host sync, skill evaluation, independent critical-tier review
and merge remain outside this implementation run. Explicit safe mode, disabled hooks
or settings-source exclusions are preserved and can suppress this adapter. Resume,
clear and compaction use the same native SessionStart handler but were not walked
individually. Private run state and the comparison native installation were removed;
the real native build remains 2.1.303.

No shared auth membership, credentials, Access configuration or application accounts
were changed. The Process-only HOUSEHOLD_MEMBERS procedure is a guidance change;
its actual auth update and QA login are obligations of the lane performing that work.
