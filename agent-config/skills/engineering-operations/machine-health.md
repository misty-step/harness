# Machine health

## Reclaiming disk space

1. Measure the candidate before touching it:

   ```bash
   du -x -d1 -B1 <dir> | sort -rn | head -20
   ```

   Read the ages with `stat -c %y`. **Done when** you can name the gigabytes and
   the day each was last written.

2. Delete in one quiet pass:

   ```bash
   sudo rm -rf --one-file-system <dir> 2>/dev/null
   ```

   Old containers leave root-owned files, so run the privileged delete when
   `sudo -n true` succeeds. A bare `rm` over a large tree prints tens of
   thousands of permission errors, buries the result, and can outlive the
   command timeout.

3. Capture a receipt: `df -h /` before and after is the reclaimed figure. A
   second `du` crawl of the volume costs minutes and answers nothing new.

GNU `find` truncates to whole days: `-mtime +0` means older than 24 hours and
`-mtime +1` older than 48, so a sweep written against `+1` silently skips
yesterday's scratch. Before deleting a scratch tree, skip anything holding a
live working directory:

```bash
for p in /proc/[0-9]*/cwd; do readlink "$p" || true; done | grep "^<dir>/"
```

**Done when** the reclaimed space is reported as a `df` delta and every process
that was running still has its working directory.

## Reading what is running

Count processes by executable:

```bash
ps -eo comm= | sort | uniq -c | sort -rn | head -25
```

`pgrep -f pi` matches every command line that mentions `pi` — agent wrappers,
editors, the session itself — and overstates a census by an order of magnitude.
The same trap makes twenty rootless Docker containers read as `dockerd`. For
footprint, use cgroup memory (`/sys/fs/cgroup/**/memory.current`) and the
operator's units (`systemctl --user list-units --type=service`).

**Done when** every number you report comes from `comm`, a cgroup, or a unit
list.
