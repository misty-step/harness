---
name: dev-exec
description: Bound heavy local builds, tests, and verification to dev-exec.slice so one job fails alone instead of taking the desktop down. Use before running full suites, coverage, Electron/browser verification, or image builds on the workstation.
---

# dev-exec

Bound heavy local execution to `dev-exec.slice`. Full suites, coverage runs,
Electron/browser verification, and image builds run off-host by default
(`skill://using-exe-dev`); run them locally only with an explicit per-job
budget. The slice is opt-in, has no admission control, and its cap does not
reserve desktop memory. This skill is an operating procedure, not automatic
resource enforcement. Machine-specific setup, containment evidence, and rollback
live in the [workstation runbook](https://github.com/misty-step/harness/blob/main/omp-config/references/dev-exec.md),
not in this deployed package.

## Budget

| Boundary | MemoryHigh | MemoryMax | MemorySwapMax |
| --- | ---: | ---: | ---: |
| `dev-exec.slice` aggregate | 48 GiB | 60 GiB | 8 GiB |
| Per job | 6 GiB | 10 GiB | 1 GiB |

All three per-job properties are required for an individual boundary; the slice
alone applies only the shared aggregate cap. `MemoryHigh` throttles and
reclaims; `MemoryMax` can OOM-kill the job.

## Launch

Interactive scope that preserves the current directory and environment:

```sh
systemd-run --user --scope --slice=dev-exec.slice --unit=job-build-001 \
  -p MemoryHigh=6G -p MemoryMax=10G -p MemorySwapMax=1G \
  bun run build
```

Noninteractive job whose whole process group stops on OOM:

```sh
systemd-run --user --slice=dev-exec.slice --unit=job-test-001 \
  --service-type=exec --wait --pipe --working-directory="$PWD" \
  -p MemoryHigh=6G -p MemoryMax=10G -p MemorySwapMax=1G \
  -p OOMPolicy=kill -p LimitCORE=0 \
  "$(command -v bun)" test
```

Pick a unique unit name. Resolve tools with `command -v`; services inherit the
user manager's environment, not the invoking shell's. Pass only needed
non-secret values with `--setenv`; never put secrets in unit names or metadata.
`--pipe` is incompatible with `--remain-after-exit`.

## Account and stop

```sh
systemctl --user show dev-exec.slice \
  -p MemoryCurrent -p MemoryPeak -p MemorySwapCurrent -p MemoryHigh -p MemoryMax -p TasksCurrent
systemctl --user show job-test-001.service \
  -p ActiveState -p Result -p ExecMainStatus -p MemoryPeak -p MemorySwapPeak -p CPUUsageNSec
journalctl --user -u job-test-001.service --no-pager
systemd-cgls --user-unit=dev-exec.slice
```

Record peak and result before a transient unit resets or collects. Stop only
your own unit (`systemctl --user stop job-test-001.service`); never stop a
populated slice—review `systemd-cgls` first.

## Escapes

Docker-daemon containers, daemon-launched services, and detached children can
leave the caller's cgroup. Bound and place them explicitly; a client wrapper
does not contain what it launches.
