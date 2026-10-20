#!/usr/bin/env bun
// t3-pool: owned standalone launcher (misty-step/harness)

import { Database } from "bun:sqlite";
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { CliError, CommandRejected, object, parseMode, withT3Session } from "../lib/t3-rpc.ts";
import defaults from "../t3-pool/pools.json";

type ModelSelection = { instanceId: string; model: string; options?: { id: string; value: string | boolean }[] };
type LimitedThread = {
	threadId: string; runId: string; failedInstance: string; resetAt: string | null; failedAt: number;
	modelSelection: ModelSelection; runtimeMode: ReturnType<typeof parseMode>;
	blockedReason: string | null; currentFailure: boolean;
};
type Move = Pick<LimitedThread, "threadId" | "runId" | "modelSelection" | "runtimeMode"> & {
	from: string; to: string; phase: "switch" | "continue" | "done" | "abandoned"; attempt: number; rejections: number;
};
type Admission = { runId: string; to: string; at: string };
type State = { version: 1; limits: Record<string, string>; moves: Move[]; admissions: Admission[] };
type Config = { pools: string[][]; reserved: string[]; maxMovesPerPass: number };
type Snapshot = { threads: LimitedThread[]; failures: LimitedThread[]; room: Record<string, number>; running: Record<string, number> };
const hour = 60 * 60_000;
const failureMaxAge = 30 * 60_000;
const hourlyTargetCap = 3;

function string(value: unknown): string {
	if (typeof value !== "string" || !value.trim()) throw new CliError("Invalid T3 pool data");
	return value;
}

function model(value: unknown): ModelSelection {
	const selection = object(value);
	const result: ModelSelection = { instanceId: string(selection.instanceId), model: string(selection.model) };
	if (selection.options !== undefined) {
		if (!Array.isArray(selection.options)) throw new CliError("Invalid T3 model options");
		result.options = selection.options.map((value) => {
			const option = object(value);
			if (typeof option.value !== "string" && typeof option.value !== "boolean") throw new CliError("Invalid T3 model option");
			return { id: string(option.id), value: option.value };
		});
	}
	return result;
}

function configuration(value: unknown): Config {
	const config = object(value);
	if (!Array.isArray(config.pools) || config.pools.length === 0) throw new CliError("Invalid T3 pools config");
	const seen = new Set<string>();
	const pools = config.pools.map((pool) => {
		if (!Array.isArray(pool) || pool.length < 2) throw new CliError("A T3 pool needs at least two instances");
		return pool.map((value) => {
			const id = string(value);
			if (seen.has(id)) throw new CliError("T3 pool instances must be unique");
			seen.add(id);
			return id;
		});
	});
	const reserved = config.reserved ?? defaults.reserved;
	if (!Array.isArray(reserved)) throw new CliError("Invalid reserved T3 instances");
	const maxMovesPerPass = config.maxMovesPerPass ?? defaults.maxMovesPerPass;
	if (maxMovesPerPass !== 1 && maxMovesPerPass !== 2) throw new CliError("T3 pool pass cap must be 1 or 2");
	return { pools, reserved: reserved.map(string), maxMovesPerPass };
}

// Match T3's latestExecutedRun and latestRootProviderFailure, not submission
// order: a held queue can execute out of order. Only root failures count.
const latestExecutedRunSql = `SELECT latest.run_id FROM orchestration_v2_projection_runs latest
  WHERE latest.thread_id = t.thread_id AND latest.status <> 'queued'
    AND NOT (latest.status = 'cancelled' AND json_extract(latest.payload_json, '$.startedAt') IS NULL)
  ORDER BY latest.completed_at IS NULL DESC, latest.completed_at DESC,
    latest.ordinal DESC, latest.run_id DESC LIMIT 1`;

const limitedThreadsSql = `
SELECT t.payload_json AS thread, r.run_id AS runId,
  r.run_id = (${latestExecutedRunSql}) AS latestRun,
  r.provider_instance_id AS failedInstance, item.updated_at AS failedAt,
  json_extract(item.payload_json, '$.failure.resetAt') AS resetAt,
  json_extract(item.payload_json, '$.failure.message') AS failureMessage,
  (SELECT json_extract(session.payload_json, '$.lastError')
   FROM orchestration_v2_projection_provider_session_bindings binding
   JOIN orchestration_v2_projection_provider_sessions session
     ON session.provider_session_id = binding.provider_session_id
   WHERE binding.thread_id = t.thread_id AND session.provider_instance_id = t.provider_instance_id
   ORDER BY session.updated_at DESC, session.provider_session_id DESC LIMIT 1) AS sessionError,
  EXISTS(SELECT 1 FROM orchestration_v2_projection_runtime_requests request
    WHERE request.thread_id = t.thread_id AND request.status = 'pending') AS pending,
  EXISTS(SELECT 1 FROM orchestration_v2_projection_runs queued
    WHERE queued.thread_id = t.thread_id AND queued.status = 'queued') AS queued
FROM orchestration_v2_projection_threads t
JOIN orchestration_v2_projection_runs r ON r.thread_id = t.thread_id AND r.status = 'failed'
JOIN orchestration_v2_projection_turn_items item ON item.turn_item_id = (
  SELECT error.turn_item_id FROM orchestration_v2_projection_turn_items error
  WHERE error.thread_id = t.thread_id AND error.run_id = r.run_id
    AND error.type = 'error' AND error.status = 'failed'
    AND error.node_id IS json_extract(r.payload_json, '$.rootNodeId')
  ORDER BY error.updated_at DESC, error.ordinal DESC, error.turn_item_id DESC LIMIT 1
)
WHERE t.deleted_at IS NULL
  AND t.thread_id IN (SELECT failure.thread_id FROM orchestration_v2_projection_turn_items failure
    WHERE failure.type = 'error' AND failure.status = 'failed'
      AND json_extract(failure.payload_json, '$.failure.class') = 'usage_limit')
  AND json_extract(item.payload_json, '$.failure.class') = 'usage_limit'
ORDER BY t.thread_id`;

function readSnapshot(path: string, now: number): Snapshot {
	const db = new Database(path, { readonly: true, strict: true });
	try {
		db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 3000;");
		const failures = db.query(limitedThreadsSql).all().map((value): { thread: LimitedThread; latest: boolean } => {
			const row = object(value);
			const thread = object(JSON.parse(string(row.thread)));
			// A target session's historical error cannot supersede the source run
			// while a reserved move is waiting for its guarded continuation.
			const superseded = thread.providerInstanceId === row.failedInstance && row.sessionError !== null && row.sessionError !== row.failureMessage;
			const modelSelection = model(thread.modelSelection);
			if (modelSelection.instanceId !== string(thread.providerInstanceId)) throw new CliError("Inconsistent T3 model selection");
			const failedAt = Date.parse(string(row.failedAt));
			const active = thread.archivedAt === null && thread.deletedAt === null && thread.settledOverride !== "settled";
			const lineage = object(thread.lineage);
			const blockedReason = lineage.parentThreadId !== null ? "delegated child: manual continuation cannot retain task ownership"
				: !active ? "archived, deleted or settled"
				: superseded ? "superseded provider failure"
				: !Number.isFinite(failedAt) || failedAt > now || now - failedAt >= failureMaxAge ? "failure is not within the last 30 minutes"
				: row.pending !== 0 || row.queued !== 0 ? "pending request or queued run" : null;
			return { latest: row.latestRun === 1, thread: {
				threadId: string(thread.id), runId: string(row.runId), failedInstance: string(row.failedInstance),
				resetAt: typeof row.resetAt === "string" && Number.isFinite(Date.parse(row.resetAt)) ? row.resetAt : null,
				modelSelection, runtimeMode: parseMode(string(thread.runtimeMode)), failedAt, blockedReason,
				currentFailure: active && !superseded && Number.isFinite(failedAt) && failedAt <= now,
			} };
		});
		const room: Record<string, number> = {};
		const running: Record<string, number> = {};
		for (const value of db.query(`SELECT provider_instance_id AS instance,
    MAX(CASE WHEN status = 'completed' THEN completed_at ELSE json_extract(payload_json, '$.startedAt') END) AS roomAt,
    SUM(status = 'running') AS running
    FROM orchestration_v2_projection_runs WHERE status IN ('completed', 'running')
    AND provider_instance_id IS NOT NULL GROUP BY provider_instance_id`).all()) {
			const row = object(value);
			const instance = string(row.instance);
			if (typeof row.running !== "number") throw new CliError("Invalid running run count");
			running[instance] = row.running;
			if (typeof row.roomAt === "string" && Number.isFinite(Date.parse(row.roomAt))) room[instance] = Date.parse(row.roomAt);
		}
		return { threads: failures.filter((row) => row.latest).map((row) => row.thread), failures: failures.map((row) => row.thread), room, running };
	} finally { db.close(); }
}

function readState(path: string): State {
	if (!existsSync(path)) return { version: 1, limits: {}, moves: [], admissions: [] };
	const state = object(JSON.parse(readFileSync(path, "utf8")));
	if (state.version !== 1 || !Array.isArray(state.moves)) throw new CliError("Invalid T3 pool state");
	const limits = Object.fromEntries(Object.entries(object(state.limits)).map(([id, reset]) => {
		if (reset !== null && (typeof reset !== "string" || !Number.isFinite(Date.parse(reset)))) throw new CliError("Invalid T3 pool limit state");
		return [id, reset ?? new Date(0).toISOString()];
	}));
	const moves = state.moves.map((value): Move => {
		const move = object(value);
		if (move.phase !== "switch" && move.phase !== "continue" && move.phase !== "done" && move.phase !== "abandoned") throw new CliError("Invalid T3 pool move state");
		if (typeof move.attempt !== "number" || !Number.isSafeInteger(move.attempt) || move.attempt < 0) throw new CliError("Invalid T3 pool attempt state");
		return {
			threadId: string(move.threadId), runId: string(move.runId), from: string(move.from), to: string(move.to),
			modelSelection: model(move.modelSelection), runtimeMode: parseMode(string(move.runtimeMode)), phase: move.phase, attempt: move.attempt,
			rejections: nonnegativeInteger(move.rejections ?? 0),
		};
	});
	const admissions = state.admissions ?? [];
	if (!Array.isArray(admissions)) throw new CliError("Invalid T3 pool admissions");
	return { version: 1, limits, moves, admissions: admissions.map((value) => {
		const row = object(value);
		const at = string(row.at);
		if (!Number.isFinite(Date.parse(at))) throw new CliError("Invalid T3 pool admission time");
		return { runId: string(row.runId), to: string(row.to), at };
	}) };
}

function saveState(directory: string, state: State) {
	const temporary = join(directory, `state.${crypto.randomUUID()}.tmp`);
	const file = openSync(temporary, "wx", 0o600);
	try { writeFileSync(file, JSON.stringify(state) + "\n"); fsyncSync(file); }
	finally { closeSync(file); }
	renameSync(temporary, join(directory, "state.json"));
	const dir = openSync(directory, "r");
	try { fsyncSync(dir); } finally { closeSync(dir); }
}

function nonnegativeInteger(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new CliError("Invalid T3 pool rejection count");
	return value;
}

function accountLimits(snapshot: Snapshot, config: Config, now: number): Record<string, string> {
	const failures = new Map<string, LimitedThread>();
	for (const thread of snapshot.failures) {
		if (!thread.currentFailure || !config.pools.flat().includes(thread.failedInstance)) continue;
		const previous = failures.get(thread.failedInstance);
		if (!previous || thread.failedAt > previous.failedAt) failures.set(thread.failedInstance, thread);
	}
	const limits: Record<string, string> = {};
	for (const [id, failure] of failures) {
		const expires = failure.resetAt ?? new Date(failure.failedAt + hour).toISOString();
		if (failure.failedAt > (snapshot.room[id] ?? -Infinity) && Date.parse(expires) > now) limits[id] = expires;
	}
	return limits;
}

function plan(snapshot: Snapshot, config: Config, state: State, now: number) {
	state.limits = accountLimits(snapshot, config, now);
	state.admissions = state.admissions.filter((entry) => Date.parse(entry.at) > now - hour);
	const latest = new Set(snapshot.threads.map((thread) => thread.runId));
	state.moves = state.moves.filter((move) => latest.has(move.runId));
	const moves: Move[] = [];
	const excluded: Record<string, number> = {};
	const candidates: { thread: string; run: string; from: string; reason: string; to?: string }[] = [];
	const loads = { ...snapshot.running };
	for (const thread of snapshot.threads) {
		if (thread.blockedReason) {
			excluded[thread.blockedReason] = (excluded[thread.blockedReason] ?? 0) + 1;
			continue;
		}
		const previous = state.moves.find((move) => move.runId === thread.runId);
		let reason: string | null = null;
		const from = thread.modelSelection.instanceId;
		const pool = config.pools.find((pool) => pool.includes(thread.failedInstance));
		if (!reason && previous && ["done", "abandoned"].includes(previous.phase)) reason = `move ${previous.phase}`;
		if (!reason && (previous ? !matches(thread, previous) : from !== thread.failedInstance)) reason = "superseded account, model or runtime selection";
		if (!reason && !Object.hasOwn(state.limits, thread.failedInstance)) reason = "source has room or its limit expired; native recovery owns it";
		if (!reason && !pool) reason = "source is not in a configured pool";
		let target: string | undefined;
		if (!reason && pool) {
			const index = pool.indexOf(thread.failedInstance);
			const ordered = [...pool.slice(index + 1), ...pool.slice(0, index)];
			target = ordered.filter((id) => (!previous || previous.to === id)
				&& !config.reserved.includes(id) && !Object.hasOwn(state.limits, id)
				&& (state.admissions.some((entry) => entry.runId === thread.runId && entry.to === id)
					|| state.admissions.filter((entry) => entry.to === id).length < hourlyTargetCap))
				.sort((a, b) => (loads[a] ?? 0) - (loads[b] ?? 0))[0];
			if (!target) reason = "no target: other accounts are limited, reserved or at the hourly cap";
		}
		if (!reason && moves.length >= config.maxMovesPerPass) reason = "per-pass move cap";
		if (!reason && target) {
			const move: Move = previous ?? {
				threadId: thread.threadId, runId: thread.runId, from, to: target,
				modelSelection: thread.modelSelection, runtimeMode: thread.runtimeMode, phase: "switch", attempt: 0, rejections: 0,
			};
			if (!previous) state.moves.push(move);
			if (!state.admissions.some((entry) => entry.runId === move.runId && entry.to === target)) {
				state.admissions.push({ runId: move.runId, to: target, at: new Date(now).toISOString() });
			}
			moves.push(move);
			loads[target] = (loads[target] ?? 0) + 1;
			candidates.push({ thread: thread.threadId, run: thread.runId, from, to: target, reason: "fresh top-level usage-limit failure; least-loaded eligible target" });
		} else candidates.push({ thread: thread.threadId, run: thread.runId, from, reason: reason ?? "no eligible target" });
	}
	return { moves, candidates, excluded };
}

function matches(thread: LimitedThread, move: Move): boolean {
	return thread.threadId === move.threadId && thread.runId === move.runId && thread.blockedReason === null
		&& thread.runtimeMode === move.runtimeMode && thread.failedInstance === move.from
		&& [move.from, move.to].includes(thread.modelSelection.instanceId)
		&& JSON.stringify({ ...thread.modelSelection, instanceId: move.from }) === JSON.stringify(move.modelSelection);
}

function commandIdFor(move: Move, database: string, directory: string, state: State): string | null {
	const db = new Database(database, { readonly: true, strict: true });
	try {
		db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 3000;");
		for (;;) {
			if (move.phase === "abandoned") return null;
			const id = `t3-pool:${move.runId}:${move.phase}:${move.attempt}`;
			const receipt = db.query("SELECT status FROM orchestration_command_receipts WHERE command_id = ?").get(id);
			// T3 permanently caches rejections. Advance only when its authoritative
			// receipt proves this command did not run, never on a transport error.
			if (receipt === null || object(receipt).status !== "rejected") return id;
			move.attempt++;
			move.rejections++;
			if (move.rejections >= 3) move.phase = "abandoned";
			saveState(directory, state);
		}
	} finally { db.close(); }
}

async function main(args: string[]) {
	if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
		process.stdout.write("Usage: t3-pool [--dry-run]\nConfig: $XDG_CONFIG_HOME/t3-pool.json; state/log: $XDG_STATE_HOME/t3-pool/\n");
		return;
	}
	if (args.length > 1 || args.length === 1 && args[0] !== "--dry-run") throw new CliError("Usage: t3-pool [--dry-run]");
	const dryRun = args.includes("--dry-run");
	const base = resolve(process.env.T3CODE_HOME?.trim() || join(homedir(), ".t3"));
	const database = join(base, "userdata/statev2.sqlite");
	if (!existsSync(database)) { process.stdout.write('{"status":"T3 database absent","planned":0}\n'); return; }
	const config = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "t3-pool.json");
	const configSelection = configuration(existsSync(config) ? JSON.parse(readFileSync(config, "utf8")) : defaults);
	const directory = join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "t3-pool");
	let lock: number | undefined;
	if (!dryRun) {
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		lock = openSync(join(directory, "lock"), "a", 0o600);
		// flock locks the inherited open-file description, retained by this process.
		const acquired = Bun.spawnSync({ cmd: ["flock", "--exclusive", "--nonblock", "0"], stdin: lock, stdout: "ignore", stderr: "ignore" });
		if (acquired.exitCode !== 0) {
			closeSync(lock);
			if (acquired.exitCode === 1) { process.stdout.write('{"status":"pool pass already running","planned":0}\n'); return; }
			throw new CliError("Cannot lock T3 pool state with flock");
		}
	}
	try {
		const state = readState(join(directory, "state.json"));
		const { moves, candidates, excluded } = plan(readSnapshot(database, Date.now()), configSelection, state, Date.now());
		if (dryRun) for (const candidate of candidates) process.stdout.write(JSON.stringify({ dryRun, ...candidate }) + "\n");
		if (!dryRun) saveState(directory, state);
		if (!dryRun && moves.length > 0) {
			const log = join(directory, "moves.jsonl");
			const logged = new Set(existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => string(object(JSON.parse(line)).run)) : []);
			await withT3Session(base, "agent-pool", async (send) => {
				for (const move of moves) {
					try {
						const snapshot = readSnapshot(database, Date.now());
						const current = snapshot.threads.find((thread) => thread.runId === move.runId);
						if (!current || !matches(current, move) || configSelection.reserved.includes(move.to)
							|| Object.hasOwn(accountLimits(snapshot, configSelection, Date.now()), move.to)) continue;
						if (move.phase === "switch") {
							const commandId = commandIdFor(move, database, directory, state);
							if (!commandId) continue;
							await send({ type: "provider.switch", commandId, threadId: move.threadId,
								modelSelection: { ...move.modelSelection, instanceId: move.to } });
							if (!logged.has(move.runId)) {
								appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), thread: move.threadId, from: move.from, to: move.to, run: move.runId }) + "\n", { mode: 0o600, flush: true });
								logged.add(move.runId);
							}
							move.phase = "continue";
							move.attempt = 0;
							saveState(directory, state);
						}
						const switchedSnapshot = readSnapshot(database, Date.now());
						const switched = switchedSnapshot.threads.find((thread) => thread.runId === move.runId);
						if (!switched || !matches(switched, move) || switched.modelSelection.instanceId !== move.to
							|| Object.hasOwn(accountLimits(switchedSnapshot, configSelection, Date.now()), move.to)) continue;
						const commandId = commandIdFor(move, database, directory, state);
						if (!commandId) continue;
						// T3's manual guard checks the latest failed run and pending requests
						// atomically. Children stay excluded: this RPC drops delegatedTaskId.
						await send({
							type: "message.dispatch", commandId, messageId: `t3-pool:${move.runId}:continue`,
							threadId: move.threadId, manualContinuationOfRunId: move.runId,
							text: "Continue where you left off.", attachments: [],
							dispatchMode: { type: "start_immediately" }, createdBy: "user", creationSource: "server",
						});
						move.phase = "done";
						saveState(directory, state);
					} catch (error) {
						if (!(error instanceof CommandRejected)) throw error;
						commandIdFor(move, database, directory, state);
						const rejection = { at: new Date().toISOString(), thread: move.threadId, run: move.runId, phase: move.phase, rejections: move.rejections, reason: "T3 rejected the command" };
						appendFileSync(join(directory, "rejections.jsonl"), JSON.stringify(rejection) + "\n", { mode: 0o600, flush: true });
						process.stderr.write(JSON.stringify(rejection) + "\n");
					}
				}
			});
		}
		process.stdout.write(JSON.stringify({ dryRun, planned: moves.length, limited: Object.keys(state.limits).sort(), ...(dryRun ? { excluded } : {}) }) + "\n");
	} finally { if (lock !== undefined) closeSync(lock); }
}

if (import.meta.main) {
	try { await main(process.argv.slice(2)); }
	catch (error) {
		process.stderr.write((error instanceof CliError ? error.message : "t3-pool failed; check config, projection schema and state") + "\n");
		process.exitCode = 1;
	}
}
