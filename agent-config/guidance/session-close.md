## Session close

Sessions close only **landed** or explicitly **parked**, never merely committed
or pushed. At the start, run `session-close.ts track [--repo PATH]` for each
repository you own, including inherited worktrees; record before switching
branches or deleting resources. `check` auto-enrollment is a safety net, not a
substitute. Run `skill://session-close`'s `check` before yielding.

Done means merged through green required CI and model review of the exact head,
deployed to the repository's actual targets with production sanity evidence,
local and origin feature branches deleted, own worktree removed, and the
canonical checkout clean on the fetched origin default head. Keep the PR and
relevant existing ticket current with status, context, revision and evidence:
Habitat for projects routed there; Misty Step/personal work stays on Linear.
Do not invent tickets or impose Habitat on projects that do not use it.

Judgment about review, deployment, production behavior and ticket completion
remains the engineer's duty; the checker proves deterministic Git/GitHub facts,
not those outcomes. For unfinished work, use
`park --repo PATH --note TEXT`; the meaningful note records reason, owner and
resume steps. Report **parked/unfinished**, retained resources and ticket/PR
status, never done. `unpark --repo PATH` resumes the obligation.

Creating a local worktree or non-standing exe.dev VM in-session MUST record a
create-time lease with `session-close.ts add`; `ws up` leases its task worktree.
Standing project VMs created by `ws init` are not session leases. Parking
preserves matching owned worktree leases, not a waiver for live VM leases.
Before removal or `drop`, inspect owned changes, ignored files and evidence;
run `ws pull` before `ws down`. Never force removal of uncertain work.

The check fetches origin's authoritative default branch and checks all recorded
owned landing work even after its original worktree disappears. For unparked
work, dirty owned or canonical checkouts, unmerged work, remaining
branches/worktrees or open PRs block. For unparked work, GitHub authentication,
command or malformed-API failures fail closed; corrupt storage always fails
closed. Parked facts remain unverified. Foreign records/resources are
informational, never a cleanup target.
Expired, orphaned and legacy ownerless leases require manual `review`; expiry
does not erase owned landing obligations. No global scan certifies unleased work.
