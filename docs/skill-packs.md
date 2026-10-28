# Skill packs and the ship loop

2026-10-20. Which upstream skills the lanes use, how they chain, and what this
repository adds. The `skills` CLI installs upstream packs into `~/.agents/skills`
and records each source in `~/.local/state/skills/.skill-lock.json`.
`claude-config/install` deploys ours.

## Packs

| Pack | Upstream | Router | Use it for |
| --- | --- | --- | --- |
| Pocock | [mattpocock/skills](https://github.com/mattpocock/skills) `skills/` | `/ask-matt` | The main flow: grill → spec → tickets → implement (tdd, code-review) → pr → retro |
| pstack | [cursor/plugins](https://github.com/cursor/plugins/tree/main/pstack) `pstack/skills/` (Lauren Tan) | `/poteto-help` | Principles, `create-verification-skill`, `interrogate`, `blast-radius`, and the shipping, autopilot and orchestrate playbooks as method |
| Emil Kowalski | [emilkowalski/skills](https://github.com/emilkowalski/skills) | none | UI polish and motion |

pstack's workflow assumes Cursor: cloud agents, `/loop`, Bugbot and `.cursor/`
paths. Use the current client's native collaboration and automation tools. Most Pocock and pstack skills are user-invoked, so an
agent reads `~/.claude/skills/<name>/SKILL.md` rather than calling the Skill tool.

## The loop

```text
intent     grilling + domain-modeling → user-stories → to-spec → to-tickets   (principal confirms the spec)
round      builder ─────────── implement (tdd, code-review), pr
           ├─ QA ───────────── story-qa + verify-<app>          ┐ same head SHA,
           └─ reviewer ─────── code-review + blast-radius        ┘ fresh agents
           judge ───────────── judge: blocker | file | skip  →  SHIP | FIX | REVERT | SPLIT
merge      gate at the judged SHA; self-merge (misty-step, moomooskycow) or team review (r90group)
release    release-watch: deploy, live identity, smoke, 30 min of signals → restore, incident, pokayoke
oversight  heartbeat (hourly sweep, unsticks lanes) · lage (executive brief)
```

`ship-loop` conducts all of it; its `roles.md` holds the four role briefs.
Global guidance `autonomy` holds the policy every step runs under.

## What we wrote, and why upstream didn't cover it

| Ours | Closest upstream | Gap it fills |
| --- | --- | --- |
| `lage` | `ketchup`, `recall` (one chat each) | One brief across every lane, initiative and agent |
| `judge` | `interrogate`'s lead judgment | An independent product owner that files follow-ups and rules SHIP |
| `ship-loop` | Pocock main flow, pstack `autopilot-full` | The conductor with self-merge gated on the judge |
| `release-watch` | none | Watch after merge, with restore, incident and postmortem triggers |
| `heartbeat` | pstack `orchestrate` audit tick | A sweep across authorized current work |
