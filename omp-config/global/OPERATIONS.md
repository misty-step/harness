# OMP operating facts

Load this reference for OMP-specific routing, trackers or host administration.
The installed copy lives beside global `AGENTS.md`, under `omp config path`.

## Models and accounts

`config.yml`, `models.yml` and `omp-model-policy` own model selectors, recovery
chains and role enforcement. `omp usage` reports current native account capacity;
the configured account policy includes the eligible r90.dev Anthropic and Codex
accounts. A route label and available capacity are different facts. Ordinary task
children resolve their own configured model/thinking; inspect the result badge.
Tagged model choices and explicit thinking remain caller choices. An installed
binary update takes effect in fresh processes, including its model catalog.

For image questions, `read <image>?q=<question>` invokes the configured vision
role; `designer` owns design work.

## Work records

Linear owns Misty Step/personal work; R90 uses Habitat. Resolve workspace, team,
project and the existing issue before updating a record. Team `MIS` is Misty Step.
The Linear connector is scoped to `~/development/misty-step` and
`~/development/moomooskycow`; R90 context stays in R90's own tools. Parlor's skill
is repository-imported and Parlor-owned.

Use mounted Linear MCP tools first. The native GraphQL fallback is:

```sh
pass-env run -e TOKEN=workstation/LINEAR_API_KEY -- sh -c '
  printf "header = \"Authorization: %s\"\n" "$TOKEN" |
    curl -fsS https://api.linear.app/graphql --config - \
      -H "Content-Type: application/json" -d @query.json
'
```

A read-only auth check is `{ viewer { name } teams { nodes { key } } }`.
Existing issue branches use `phaedrus/mis-<number>-<slug>` and conventional
commits include `(MIS-xx)`; otherwise use a descriptive branch. `Fixes` means the
merge satisfies the issue; partial work uses `Refs` or `Relates to`. Update one
`### Agent Execution Scratchpad` comment with current evidence and blockers.

## Host administration

`sudo -n` checks an existing unattended grant. When desktop approval is needed,
use `pkexec`; when an operator-accessible interactive terminal or SSH session is
available, use interactive `sudo`. A private agent PTY is a different surface.
Keep a pending privileged action explicit until the actual approval succeeds,
then read back the requested state. Tool/config/credential scope owns authority;
a role label or a Tailscale connection describes identity and reachability.
