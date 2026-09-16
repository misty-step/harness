# Migration record

## Source identity

The monorepo imports the original histories without rewriting commits:

| Component | Imported HEAD |
| --- | --- |
| agent-config | 454c7cc |
| pi-config | 7590ad2 (includes the concurrent openrouter-live change) |
| omp-config | 67159dd |

All three component trees matched their original Git trees immediately after
import. Historical tags are namespaced under `legacy/<component>/`; original
release pages and retired branches remain in the legacy GitHub repositories.
There were no open GitHub issues or pull requests in any of the three at migration
preflight. The initial histories remain reachable through subtree merge parents.

## Changed behavior

- Root AGENTS.md is tracked for the first time. Root bootstrap, verification,
  hooks and CI replace per-component repository automation.
- Component paths remain unchanged; sibling base discovery needs no override.
- Runtime installers no longer install repository Git hooks, including OMP's
  LOC convenience symlinks. Runtime LOC extensions still populate their caches.
- Both harness installers reject positional arguments. Previously `--check`
  could silently perform live deployment; the base's explicit --check is unchanged.
- One release stream begins at v0.1.0. Legacy tags cannot collide with root SemVer.

## Evidence and boundaries

`cc0610d` passed `scripts/verify-installers` from a fresh local clone: actual pi
and OMP installer exits, exact guidance composition, launcher bytes/executable bit,
foreign skill preservation and synthetic auth preservation. Disposables were
removed on exit. Earlier unit checks passed 19 shared, 53 pi, and 9 OMP bin tests.
The final workspace verification additionally includes OMP extension tests.

No native model calls, provider auth checks, UI loading claims, or intentional live
runtime deployment are part of this migration. During an earlier diagnostic, a pi
installer ran with a disposable agent directory but without a HOME override; its
shared launcher destination was therefore live. The launcher source was unchanged.
The committed verification script uses a sanitized environment and disposable HOME
for both consumers so that isolation error cannot recur on that path.

## Cutover and recovery

The canonical remote is `https://github.com/misty-step/harness.git`, default branch
`main`. Publish and observe successful CI before adding destination notices and
archiving the three legacy repositories. Archival is reversible via GitHub and
does not delete releases or history. Existing clones can remain historical; use a
fresh harness clone for further work and run `scripts/bootstrap`.

Local rollback copies, Git bundles and original Git metadata were captured in the
run-scoped disk cache before cutover (operator handoff records the absolute path).
Do not restore an old full runtime directory: source migration rollback and owned
runtime-file rollback are separate operations. Do not delete active worktrees or
unrelated runtime state when retiring old checkout metadata.
