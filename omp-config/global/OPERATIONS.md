# OMP operating facts

Load this reference for OMP tool configuration, ticket access or host privileges.
The installed copy lives beside global `AGENTS.md`, under `omp config path`.

## Models and accounts

`config.yml`, `models.yml` and `omp-model-policy` own model selectors, recovery
chains and role enforcement. `omp usage` reports current native account capacity;
the configured account policy includes the eligible r90.dev Anthropic and Codex
accounts. A route label and available capacity are different facts. Binary/catalog
updates take effect in fresh processes.

For image questions, `read <image>?q=<question>` invokes the configured vision
role; `designer` owns design work.

## Work records

Glass owns Misty Step/personal work; R90 uses Habitat and R90's own tools.
Resolve the existing item's id and scope before updating a record. Scope is
`misty-step/repository` or `moomooskycow/repository`, not a tracker team/project.
Parlor's skill is repository-imported and Parlor-owned.

Read the authoritative Glass service:

```sh
glass ticket show "$item"
glass query items --scope misty-step/harness
```

OMP engineers receive `glass-read.sock`, not the live commitments store. Relay
proposed updates to the desk or parent with item id, scope, title, description,
why, its actual author and evidence links. Do not use an empty/private store,
change `--store` to evade the boundary or request another write socket.

Only the authorized live-store owner runs mutations. New backlog items use
`later`, no explicit rank, and plain title, description and why:

```sh
glass item add --scope "$scope" --kind task --status later --relaying none \
  --title "$title" --description "$description" --why "$why" \
  --why-attribution quoted --why-source "$author" --notes "$links"
glass item update "$item" --append-notes "$evidence" --note "$summary"
```

`quoted` names the actual author in `--why-source`; use `phaedrus` only for his
words and `kaylee` only for hers. Preserve a migrated issue's old URL in notes as
historical evidence. Rank remains Kaylee/Phaedrus-owned. Keep procedures and
version-bound knowledge in the repository, not a duplicate tracker document.

Use a descriptive owned branch and conventional commits; include the Glass id
in the PR for traceability. `Fixes` means the merge satisfies the work item;
partial work uses `Refs` or `Relates to`.

## Host administration

`sudo -n` checks an existing unattended grant. When desktop approval is needed,
use `pkexec`; when an operator-accessible interactive terminal or SSH session is
available, use interactive `sudo`. A private agent PTY is a different surface.
Keep a pending privileged action explicit until the actual approval succeeds,
then read back the requested state. Tool/config/credential scope owns authority;
a role label or a Tailscale connection describes identity and reachability.
