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

New Misty Step work belongs in live Powder. Append evidence with
`omp-display append-note --powder EXACT_ITEM < native-note-request.json`, using
the existing Powder Access credential references through `pass-env`. The file
is a native Write request: exact item, actor, request ID, opaque revision and
`change: {"kind":"note","comment":"observed evidence"}`. Retain it before sending.
Read back with authenticated `work-tracker --url https://powder.mistystep.io get
EXACT_ITEM` and complete History. Unknown outcomes retain the same request for
exact replay; never refresh its revision, retry automatically, create replacement
work or fall back to Glass. R90 stays Habitat. Retained Glass sessions and
receipts keep their original identities; they do not authorize new board writes.

Use descriptive branches and conventional commits. `Fixes` means the merge
satisfies the referenced issue; partial work uses `Refs` or `Relates to`.

## Reports

Use plain agent and tool names. State what changed, the exact command or user
path exercised, its observed result and the remaining gap. Name work owner,
item, session and revision separately; never infer identity from a pane, title
or directory. Unknown is not failed or unchanged. Tests, a merge or staged
files do not prove installation or loaded runtime behavior.

## Host administration

`sudo -n` checks an existing unattended grant. When desktop approval is needed,
use `pkexec`; when an operator-accessible interactive terminal or SSH session is
available, use interactive `sudo`. A private agent PTY is a different surface.
Keep a pending privileged action explicit until the actual approval succeeds,
then read back the requested state. Tool/config/credential scope owns authority;
a role label or a Tailscale connection describes identity and reachability.
