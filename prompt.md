# Codex lane: Summon pi-durable runtime

You are working in `misty-step/harness` on branch `cursor/summon-pi-durable`. Work as a small, review-ready WIP and never merge.

## Context

`pi-durable` is `@earendil-works/pi-durable` (experimental; source in `packages/durable` of `earendil-works/pi`). It is the durable harness base Summon uses to dispatch an agent from a factory agent node. It is **not** the factory or the state machine: ADR-010's Summon kernel and Glass own state. Today `summon/pi-runtime` uses plain Pi 1.0.1 RPC (README line 16) with no pi-durable dependency.

## Task

- Add the dependency.
- Make Summon's Pi runtime dispatch each agent as a pi-durable conversation, with SQLite or JSONL storage per run and `requestId` dedup.
- Use `replay:"safe"` **only** for idempotent tools.
- Summon's run/input/proof records stay the source of truth.
- Add a crash-resume test that kills a run mid-tool and reopens it, and prove it with a terminal transcript saved under `.lane/evidence/` (link this evidence in the PR body).
- Keep the diff small, follow the repo's existing conventions, and run the repo's relevant tests. **Do not build Rust or run Rust builds** in this lane.
- Note any drift risk against the private lab repo `misty-step/summon` (not reachable yet; it will be ported later).
- Update `/home/box/agent-data/chief-of-staff/factory/audit/SCHEMA.md` so pi-durable is **not** its own `system` value. Record it as Summon's engine (for example `system=summon, engine=pi-durable`), and migrate existing JSONL rows only if that is trivial and non-destructive (append a correction note; never rewrite raw history).
- Commit WIP at least every 30 minutes, and push this branch (GitHub auth works on the box).
- Keep the draft PR body current, including an evidence section and the crash-resume transcript link.
- Status goes to `/home/box/agent-data/chief-of-staff/factory/lanes/summon-durable.status.md`; audit to `/home/box/agent-data/chief-of-staff/factory/audit/summon-durable.jsonl` (per `SCHEMA.md`).
- Stop at review-ready. Never merge.

## Lane/runner note

The box has `@earendil-works/pi-durable` installed locally in this lane only. runner-01 currently has Pi 0.87.1 at `/usr/local/bin/pi` and no global pi-durable package; do not install it now. Record the missing runner capability as a follow-up in a lane `setup.sh` rather than attempting an install during this run.

- Never spend Codex's free reset; if a Codex reset/retry choice appears, stop and report it.
