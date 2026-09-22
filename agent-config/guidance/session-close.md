## Session close

Yielding a finished session is incomplete until `skill://session-close` exits 0.

Creating a git worktree or exe.dev VM in-session MUST record a lease in the
same turn (`session-close.ts add`). Close fails while any lease remains. Destroy
the resource, or keep it as standing ownership, then `drop` the lease. Close
does not scan the workstation for other sessions' trees or untagged VMs.

An unleased create is a defect close cannot see. Do not invent a tag convention
to paper over it.
