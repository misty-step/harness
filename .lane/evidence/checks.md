# Summon pi-durable WIP checks

The [terminal transcript](crash-resume.txt) captures Node 24.21.0 and pi-durable
1.0.2, with an offline provider fixture. All four Node tests pass. The process
receives SIGKILL while its tool executes, then another process reopens the same
SQLite file. Safe tools replay; unsafe tools retain an interrupted error without
repeating their effect. Conversation and submission identities survive, and
concurrent/serial duplicates retain one input and receipt. A binding without
admission remains uncertain. The bridge also refuses changed loadouts/inputs,
missing storage, empty files and legacy JSONL without replacing their bytes.

Commands and results:

| Command | Result |
| --- | --- |
| `npm ci --ignore-scripts` in `agent-config/candidates/summon/pi-runtime` | Passed with the committed lockfile, using a run-scoped npm cache. |
| `TMPDIR=/tmp/summon-durable-run npm test` in that package | 4 passed, 0 failed. |
| `npm exec --yes --cache /tmp/summon-durable-run/npm-cache --package typescript@5.9.3 -- tsc --noEmit --strict --skipLibCheck --allowImportingTsExtensions --module nodenext --target es2023 durable.ts durable-rpc.ts pilot-tools.ts` in that package | Passed. |
| `HOME=/tmp/summon-durable-run/gate-home TMPDIR=/tmp/summon-durable-run bun test --max-concurrency=1 agent-config/candidates/summon/` | 61 passed, 0 failed. |
| `HOME=/tmp/summon-durable-run/gate-home ./scripts/check shared` | Root tests: 15 passed, 1 Landmark replay skipped. Shared Bun tests: 449 passed, 23 failed. The gate stopped before its Python/installer checks. |
| `HOME=/tmp/summon-durable-run/gate-home ./scripts/check pi` | Root tests: 15 passed, 1 Landmark replay skipped. Pi unit tests: 102 passed. Both installer compositions ran; 2 OMP invariants failed. |

The broader failures occur outside the changed runtime. Review-helper timeout
fixtures exceed Bun's five-second default and leave scratch assertions failing.
The sandbox's read-only `/tmp/.git` affects host-scope checks, and the process-owner
fixture also fails here. Installer staging lacks `slirp4netns`; its personal
billing-scope check refuses the sandbox ancestry. These gates remain red and need
an unrestricted host rerun; this lane does not claim a clean baseline.

The sandbox cannot write `~/.cache/tmp` or this checkout's `.git`. Scratch uses
`/tmp/summon-durable-run`. Commits and pushes use an isolated Git metadata/source
checkout, with the root hooks enabled and both secret scanners intact. Gitleaks
passes; TruffleHog's official 3.97.9 download was checksum verified before use.
Missing advisory hook outcome/credential capabilities do not count as review.

No Rust build, live deployment, runner-01 install, paid model call, Codex reset,
or merge occurred. Rust process-owner/DO composition, native host account binding
and SQLite evidence-reader support remain unverified follow-ups in
[setup.sh](../setup.sh). Private `misty-step/summon` has not been inspected.
The external factory audit schema update is reviewable in
[audit-schema.patch](../audit-schema.patch); its historical correction is appended
to the factory audit rather than rewriting the nine original rows.
