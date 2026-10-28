# Verification

The maintained recipe is
[verify-mistystack](../.agents/skills/verify-mistystack/SKILL.md).

```sh
./scripts/check
./scripts/check plugin
```

The default gate runs release-protection and secret-scanner tests, skill tests
and plugin structure checks sequentially. CI runs that gate without a model
call. The explicit `plugin` selection also uses the installed OMP binary to
install the candidate in an isolated home and inspect a fresh session's loaded
core and discovered skills. Missing OMP fails that proof; lint alone does not
prove loading.

Use Git, Bun and Python 3 for the maintained checks; full plugin proof also
requires OMP. `LANDMARK_BIN` enables the existing real Landmark release replay.
Secret scanning remains in repository hooks. All proof writes stay outside the
checkout and the operator's live OMP profile.

For an authored PR, name the affected story, the exact revision and command,
the observed result and any evidence gap. Preserve the complete output outside
Git and publish the relevant result on the PR. Internal changes need composition
proof; user-facing changes also walk the real consumer path.
