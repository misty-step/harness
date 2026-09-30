## Session close

Yielding a finished session is incomplete until `skill://session-close` reports
no live leases owned by this session (`check` exits 0). Creating a local worktree
or non-standing exe.dev VM in-session MUST record a create-time lease with
`session-close.ts add`; `ws up` leases its task worktree. Standing project VMs
created by `ws init` are not session leases.

The check prints foreign leases for information, not as a blocker. Expired,
orphaned, and legacy ownerless leases need manual `review`; never delete their
resources automatically. Before `drop`, inspect owned changes and evidence,
including `ws pull` before `ws down`. A corrupt lease store fails closed. No
global scan can certify unleased resources.
