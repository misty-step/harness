# Execution safety

Both focused and full audits inspect source read-only. Target-controlled builds,
tests, processes, browsers, emulators, fuzzers and fixture processing run only in
an OS-enforced sandbox with every control below:

- no external network; isolated loopback only for a local fixture;
- empty explicitly allowlisted environment; scratch-local HOME, temp and caches;
- read-only target/toolchain; writes confined to the assigned `scratch/`;
- explicit low CPU, memory, process, file-size, disk and wall-clock limits.

A parent may prepare a disposable source copy in scratch for builds writing beside
source. Use present local tools/dependencies; no fetching/installing. Exclude host
HOME, credentials, sockets, retained artifacts, peers' paths and shared services
from the target process. Missing any control blocks execution, not source review.
Return the exact capability as `needs_validation` with a safe resolution plan.

Use dummy principals, fixtures and secrets. Stop at the minimum local boundary
result. Live/deployed endpoints, real accounts/data, shared services/control
planes, availability stress, publishing, release changes and paid API calls are
outside this audit. Unknown provider/proxy/browser/deployment controls remain
unknown; name the decisive fact for owner observation instead of probing it.

The parent alone writes shared metadata, architecture, ledger, findings and
reports. Each worker writes only its unique scratch directory. Agent IDs are
lowercase `^[a-z0-9][a-z0-9_-]{0,63}$`, excluding Windows device names. Its retained
`artifacts/` is parent-owned and never mounted into the sandbox. No host temp/home
fallback expands the writable scope. Focused reviews retain no target output.

Record exact commands/inputs/limits and only allowlisted names plus safe values
needed to reproduce. Start empty rather than capturing then redacting ambient
environment, authentication state or unrelated host paths.

## Artifact promotion block

Include this whole block in each hunter and candidate-verifier brief. These are
trusted parent-side operations, never worker or target-controlled operations.

```text
Before execution, retain trusted non-inheritable descriptors for the assigned
scratch/ and artifacts/ roots. Record expected scratch-relative files with
per-file and cumulative byte bounds. Keep descriptors outside the sandbox.
After the sandbox and every child terminate, promote allowlisted files separately:

1. Reject absolute, empty, dot, parent-traversal or symlinked relative components.
2. Walk scratch parents from the retained root with no-follow directory-relative
   operations; never reopen them by path.
3. Open the leaf no-follow and nonblocking.
4. fstat: regular file, link count exactly one, within both byte bounds.
5. Enforce bounds again while reading from that descriptor.
6. Copy exactly the verified size; repeat fstat and reject changed identity,
   type, link count or size.
7. Walk destination parents from its retained root with no-follow directory-relative
   operations. Existing parents must be real directories; create missing parents
   exclusively and reopen/verify them no-follow.
8. Create the leaf exclusively/no-follow; verify a regular single-link file and
   copy from the verified source descriptor without reopening either path.
9. Use equivalent race-safe APIs on non-POSIX systems.
10. Never recursively copy/glob scratch, extract an archive into artifacts, or
    promote symlinks, FIFOs, sockets, devices, directories, hard links, changing
    files or over-bound files.
11. If any check fails or cannot be enforced, discard the entry. Decisive evidence
    that cannot be promoted leaves an exact needs_validation blocker.
```
