# ADR-020: A small Linear CLI instead of an MCP bridge

Accepted 2026-09-16.

Linear ships no official CLI. Its official agent surface is a
hosted MCP server (`https://mcp.linear.app/mcp`). Pi has no built-in MCP, and
this repo already omits an MCP bridge. Iron Forest's `.iron-forest/linear.py`
is a read-only eligibility gate for autonomous work — a different program's
adapter, vendored into other repos, with no mutation path. Community CLIs exist
and would still leave the workspace's authority-label hazard unencoded.

So: `bin/linear.ts`, a bun script deployed to `~/.local/bin/linear`. One
GraphQL primitive (`gql`) and thin porcelain (`ls`, `show`, `create`, `update`,
`comment`, `projects`, `labels`, `states`). Project, team, state, and label
names resolve to ids at call time, so a rename upstream is not a code change.
`--json` always prints a parseable object, including
`{"error":{"kind","message"}}` on failure. Adding any `Agent: *` label
requires `--authorize-agent-work`, because those labels enroll an issue in Iron
Forest's 300 s builder poll; removing them is always allowed. The credential
comes from the environment or `pass show workstation/LINEAR_API_KEY` and is
never printed.

`./install` refuses to replace a non-regular `~/.local/bin/linear` or a regular
file that is not this client. Classification: behavioral.

*Amended 2026-09-16:* the client moved to its own repo,
[linear-cli](https://github.com/misty-step/linear-cli). It is a host tool, not
pi configuration, and releases independently; `pi-config` no longer carries or
deploys it, and `./install` lost the `linear` component. The client's own
`./install` owns the destination.
