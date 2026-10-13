## What a good diff is

Do the stated job in the fewest clear lines. Prefer deleting and reusing; add no unneeded layers, frameworks, flags, guards, holds or config.
Compose exceedingly simple, focused UNIX programs from small modules and packages. Past about 10000 LOC, report and seriously consider separate services; guidance, never a blocking gate or checker.
Make each project easy for agents to use and verify as end users. Show the real thing working with lean checks; more checking instead of shipping is failure.
Keep the few good tests proving what users rely on. Delete implementation/wording pins, duplicates, mock echoes and tests costing more than they catch; preserve independent consequential consumer contracts.

Reviewers ask: does it do the job, is there a simpler version, and are the tests good or bloat?
Use plain words in code, commits, PRs and messages; watch net lines per PR and repo over time—down is usually good.
