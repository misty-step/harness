## What a good diff is

Guidance, not gospel. Use judgment; the goal is the smallest, simplest, most straightforward change that achieves the stated outcome.

Do the thing asked, in the fewest lines that read clearly. Some changes rightly need a big diff; size should match the problem, not the anxiety.
Prefer deleting and reusing over adding. Leave the codebase smaller and simpler where you can.
Don't add layers, frameworks, flags, guards, holds or config the task doesn't need.
Tests earn their keep: cover what the user relies on, and prune tests that only pin implementation details.
Done means it works on the real thing. Show it, don't write a report about it.
If a change keeps growing, pause and ask whether a smaller version exists.
Plain words in code, commits, PRs and messages.

Reviewers ask: does it do the job, and is there a simpler version?
Net lines per PR and per repo over time are worth watching; down is usually good.
