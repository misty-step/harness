# Verification

The maintained recipe is
[verify-mistystack](../.agents/skills/verify-mistystack/SKILL.md).

```sh
./scripts/check
./scripts/check plugin
```

The default gate runs release-protection and secret-scanner tests, skill tests
and plugin structure checks sequentially. CI runs
`./scripts/check plugin --strict --lint-only`: tests and strict manifest/link
lint, with installation explicitly skipped and no model call.

The full `plugin` selection installs the candidate in disposable homes through
each available OMP, Claude Code, Codex and pi CLI. It reports a missing CLI by
name as skipped, never passed. Each available adapter must list installed skills
and register its core hook/extension; OMP additionally exposes the loaded core
and skill list through a fresh inference-free RPC session. Registration is not
proof that a model received the core. Follow each
[harness note](../skills/misty/SKILL.md) for that fresh-session proof.

Use Git, Bun and Python 3 for the maintained checks. `LANDMARK_BIN` enables the
existing real Landmark release replay. Secret scanning remains in repository
hooks. All proof writes stay outside the checkout and live harness profiles;
credentials are never copied into isolated homes.

For an authored PR, name the affected story, the exact revision and command,
the observed result and any evidence gap. Preserve the complete output outside
Git and publish the relevant result on the PR. Internal changes need composition
proof; user-facing changes also walk the real consumer path.
