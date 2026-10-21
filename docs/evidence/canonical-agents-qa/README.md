# Canonical instructions and QA setup evidence

Historical checkpoint: the automatic-discovery failure below is retained as
observed. The subsequent [native SessionStart proof](../canonical-native-hook/README.md)
resolves global loading through the maintained adapter, without a legacy alias.

Implementation revision: `a86cb0299eed19aa755e2afea5f921b1e6c63e81`, based on
`f947793`. Evidence added afterward changes no implementation files.

Claude user-scope loading is blocked. The installed native 2.1.303 and a private
native 2.1.305 comparison did not load `~/.claude/AGENTS.md` from a fresh cwd
outside HOME. Both authenticated model calls returned `MISSING_POLICY`, with no
user instruction event. No prompt injection or legacy alias substituted for native
loading. These results do not establish behavior for cwd ancestry inside HOME.

The passing checks cover these results:

- [Shared gate](check.log) at the implementation revision passed, including nine
  migration tests, three policy-probe tests and 175 installer assertions.
- [Full gate](check-all-96d4dcb.log) passed at `96d4dcb`, before the final reverse
  alias tests and scoped QA permission clarification. The affected shared gate
  above covers those changes. The full gate retains 20 optional release-test
  skips and three offline Pi-test skips.
- [Installed state](installed-state.json) shows regular `AGENTS.md` files and no
  legacy file or symlink in either private Claude or Codex directory.
- [Codex policy input](codex-policy-summary.txt) contains the canonical filename,
  AgentMail account creation, generated credential storage in pass, production QA
  owner/admin grants and Access authorization, plus the mandatory generator override.
- [Skill registration](registration-claude.json) and
  [Codex registration](registration-codex.txt) passed. Native execution logins,
  private Home readback and pool dry-run state preservation also passed in the
  [transcript](transcript.txt).
- [Invariants](invariants.txt) cover unchanged US-048 criteria 1–8, the narrow QA
  setup exception, installed filename state, credential-copy cleanup and unchanged
  live host guidance and native launcher.

The failed Claude loading evidence is retained directly:

- Actual [2.1.303 version](actual-native-version.txt),
  [instruction events](claude-candidate-instructions.jsonl) and
  [authenticated result](claude-candidate-result.json) at the implementation revision.
  The empty event file is the observed absence, not missing capture.
- Private [2.1.305 version](comparison-native-version.txt),
  [instruction events](native-2.1.305/claude-candidate-instructions.jsonl) and
  [authenticated result](native-2.1.305/claude-candidate-result.json) at `96d4dcb`.
  The newer binary was installed into a separate scratch HOME and removed afterward.

The legacy migration tests exercise the production migration functions using
`AGENTS.md` fixtures in separate directories. This covers owned standalone files,
reverse links, owned aliases, foreign content, broken links, backup conflicts,
interrupted upgrades and repeat runs without creating a legacy instruction name.
The probe's forbidden-name test supplies directory entries in memory.

The transcript includes attempted commands and their failures. Public artifacts
exclude credentials and unrelated T3 thread identifiers. `gitleaks dir` passed.
All private run state was removed after capture. Live deployment and live drift
proof remain deferred. No application QA account is needed for this CLI/config
repository. No machine synchronization or skill-evaluation work was started.
