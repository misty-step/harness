# Private note sync

Run `verify-harness daybook` from the candidate checkout. The helper installs
`daybook-sync` and its canonical shared skill into a private HOME, then runs the
same executable its users receive. Git uses disposable local bare remotes.
The CLI journey supplies synthetic private-host metadata and a native SSH
transport to those remotes. It sends no data to GitHub or another provider.

Expect PASS for the canonical skill and PATH command installation, then PASS
for publication, rejection and recovery. The journey prepares a worktree,
changes a named file, publishes it, reads exact remote bytes and agent identity,
and finishes by removing the clean worktree and local branch. Other cases cover
simultaneous writers, overlapping conflicts, three real push races, retry after
lost success, denied pushes, staged/foreign work, symlinks and traversal, journal
creation/edit/rename/deletion, upstream renames into forbidden or unselected paths,
ignored scratch preservation before rebases and pending retries, and real gitleaks
rejection. The human root retains
its original files, staged index, branch and unpublished commit.

Proof is `transcript.txt`, `daybook-install.txt` and `daybook-tests.txt` under the
external evidence directory. Cleanup removes only test-owned temporary trees.
No product sign-in exists; native GitHub execution authentication is distinct
from an AgentMail QA account. Tests neither create credentials nor change roles,
allowlists, Access or production data. Real host rollout and provider loading
remain separate claims: on each selected host, confirm `daybook-sync --help`,
read the canonical skill through repository AGENTS.md in each provider, and
perform an authorized note journey. Timers follow the note repository's own
merge protocol and verification skill.
