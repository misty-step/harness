# Chief and role guidance layout

`AGENTS.md` here is the chief contract, `worker/AGENTS.md` the shared worker
contract and `roles/<role>/AGENTS.md` each role. Role profiles read their role
through native `agent.coding_instructions`.

## Chief layout

Native delegation hands every helper the parent's terminal working directory
and injects that directory's project context (`.hermes.md`/`HERMES.md`,
`AGENTS.md`, `CLAUDE.md`, `.cursorrules`) into the helper's system prompt,
including profile-routed helpers. The chief contract therefore never lives in
the chief workspace. It loads as the chief profile's identity: the chief
`$HERMES_HOME/SOUL.md` links to this directory's `AGENTS.md`. Profile-routed
helpers load their own profile's `SOUL.md`; unrouted helpers load no `SOUL.md`.
The chief workspace keeps `FACTORY.md` and `ENVIRONMENT.md` and no project
context file.

## Install or migrate

Installation mutates the live chief; run it only under deployment
authorization. `CHIEF_HOME` is the chief profile home (`~/.hermes` for the
default profile), `CHIEF_WS` its `terminal.cwd`, `SRC` the installed harness
checkout and `BACKUP` a private directory outside Git.

```sh
mkdir -p "$BACKUP"
cp -P "$CHIEF_HOME/SOUL.md" "$BACKUP/chief-SOUL.md"
ln -sfn "$SRC/agent-config/chief/AGENTS.md" "$CHIEF_HOME/SOUL.md"
if [ -L "$CHIEF_WS/AGENTS.md" ]; then
  cp -P "$CHIEF_WS/AGENTS.md" "$BACKUP/chief-workspace-AGENTS.md"
  rm "$CHIEF_WS/AGENTS.md"
fi
ls -A "$CHIEF_WS"   # no .hermes.md, HERMES.md, AGENTS*.md, agents.md, CLAUDE.md, .cursorrules or .cursor
```

Update the chief's `ENVIRONMENT.md` note to say its contract loads through
`SOUL.md`. The change takes effect in new chief conversations; no service
restart is needed. Prove it with the
[verification recipe](../../.agents/skills/verify-harness/features/chief-bootstrap.md).

Rollback restores the previous files exactly:

```sh
rm "$CHIEF_HOME/SOUL.md"
cp -P "$BACKUP/chief-SOUL.md" "$CHIEF_HOME/SOUL.md"
[ ! -e "$BACKUP/chief-workspace-AGENTS.md" ] || cp -P "$BACKUP/chief-workspace-AGENTS.md" "$CHIEF_WS/AGENTS.md"
```
