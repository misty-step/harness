# Gate

`./scripts/check` is the fixed gate, and CI runs it. It runs the native unit tests and `scripts/verify-installers`, which clones committed HEAD and runs every installer in disposable homes.

## Sub-features

- `gate-all`: `./scripts/check` with no argument runs every suite.
- `gate-selection`: `./scripts/check shared|pi|omp|workspace` runs one component's suites and the installer checks.
- `gate-installers`: the installer section prints a `PASS` or `FAIL` line for each isolated install assertion.

## How to get to it (user POV)

- Run `./scripts/check [selection]` from the repository root.
- Open a PR. CI's `verify` check runs the same command.

## Driving it with verify-harness

Preconditions:

- The change is committed.
- `/proc/loadavg` is noted, because heavy load slows the launcher-bundling tests.

- **Run the gate.** Run `verify-harness check`. Expect `PASS scripts/check all in <n>s`, `Verification complete: all`, and `installer assertions: <n> PASS, 0 FAIL`.
- **Run one component.** Run `verify-harness check shared`. Expect the same lines for `shared`.
- **Proof.** Keep `check.log` and the check section of `transcript.txt`.

## Gotchas

- `scripts/check` exits at the first failing suite, so an early unit-test failure leaves `installer assertions: 0 PASS`. Read `check.log` for the first `(fail)` line.
- Under heavy load, `agent-config/bin/install.test.ts` cases can exceed Bun's 5-second default timeout and report `Received: null` for the exit code. Rerun that file alone with `cd agent-config && bun test --max-concurrency=1 bin/install.test.ts` before calling it a regression.
- Unit tests read working files, and the installer checks read committed HEAD. A dirty tree passes tests against code the installers never see.
- Display tests need bubblewrap and slirp4netns. Host-boundary tests need `/dev/net/tun`, which is missing inside an isolated engineer namespace. Report that limitation instead of calling those boundaries verified.
