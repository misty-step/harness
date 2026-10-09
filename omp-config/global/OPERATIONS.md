# OMP operating facts

Load this reference for OMP tool configuration, work records or host privileges.
The installed copy lives beside global `AGENTS.md`, under `omp config path`.

## Models and accounts

`config.yml`, `models.yml` and `omp-model-policy` own model selectors, recovery
chains and role enforcement. `omp usage` reports current native account capacity;
every signed-in account is eligible and none is pinned. A route label and available capacity are different facts. Binary/catalog
updates take effect in fresh processes.

For image questions, `read <image>?q=<question>` invokes the configured vision
role; `designer` owns design work.

## Work records

Use the project's existing work authority and resolve the existing record before
updating it. Keep R90 context in R90's tools. Parlor's skill is repository-imported
and Parlor-owned.

Caged engineers append evidence to an existing canonical Glass item with
`omp-display append-note K-YYYYMMDD-item-slug < evidence-note.txt`, then
`glass query item K-YYYYMMDD-item-slug --json` for readback. This is append-only;
`glass item update` writes a direct local store and is not the cage route.
On an uncertain response, read before retrying: no automatic retry or fallback.

Use descriptive branches and conventional commits. `Fixes` means the merge
satisfies the referenced issue; partial work uses `Refs` or `Relates to`.

## Host administration

`sudo -n` checks an existing unattended grant. When desktop approval is needed,
use `pkexec`; when an operator-accessible interactive terminal or SSH session is
available, use interactive `sudo`. A private agent PTY is a different surface.
Keep a pending privileged action explicit until the actual approval succeeds,
then read back the requested state. Tool/config/credential scope owns authority;
a role label or a Tailscale connection describes identity and reachability.
