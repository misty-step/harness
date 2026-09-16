# Verification

Canonical entry point: `./scripts/verify [all|shared|pi|omp|workspace]` from any cwd.
Requires Git, Bun >=1.4.2, jq, Python 3, and a POSIX shell. Bootstrap and provider
credentials are not required to test. Stage newly added fixture inputs before
checking: the sandbox copies tracked candidate bytes, excluding ignored runtime
state. Dirty edits are allowed and printed with the source revision.

## Resource boundary

Tests run sequentially, with Bun test concurrency capped at one. On the workstation,
check for an existing run first; run full checks in a bounded scope:

```sh
systemctl --user list-units 'harness-verify-*' --state=running
systemd-run --user --scope --slice=dev-exec.slice \
  --unit=harness-verify-$(date +%s) \
  -p MemoryHigh=2G -p MemoryMax=4G -p MemorySwapMax=1G \
  ./scripts/verify all
```

CI uses one job, the same command, and a 15-minute timeout. No browser, Electron,
model, cloud resource, or installed harness is needed.

## Observable contracts

- Existing shared, pi, and OMP unit suites exercise their owning behavior.
- Workspace checks reject nested repositories/gitlinks.
- Real installers run in a disposable monorepo copy with sanitized environment,
  synthetic HOME, agent directories, and development scopes.
- Unknown positional arguments (including --check) fail before destination writes.
- Foreign credentials, skill packages, and config sentinels survive installation.
- Both harnesses consume the sibling base and compose guidance without its marker.
- Repeated installs preserve bytes/modes; installers leave Git hooks untouched.
- OMP imports Linear into the synthetic authorized scope, not the synthetic r90
  tree. This establishes filesystem scoping, not OAuth validity or MCP loading.

All scratch, including test-created temporary paths, uses a unique directory under
`~/.cache/tmp`; successful and ordinary failed runs clean it up. Interrupted runs
may leave a run-owned directory; remove only that directory after its process ends.
Never pipe a verification command through tail without preserving its exit status.

These checks do not prove native extension loading, provider calls, rendering, or
live auth. Changes to those behaviors require component-specific fresh-session
checks described in their READMEs. This migration does not redeploy live runtime
config or call models. For prose, review meaning/links and inspect composed guidance
when affected rather than rerunning model work.

## Git hook setup

`./scripts/bootstrap` checks scanner availability and selects `.githooks` as this
repository's hook directory. It refuses a foreign local hooksPath rather than
silently taking ownership. The pre-push hook scans outgoing commits with gitleaks
and the worktree with trufflehog; neither check is bypassed for migration.
