#!/usr/bin/env bun
// t3-pool: owned standalone launcher (misty-step/harness)

import { Database } from "bun:sqlite";
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { CliError, object, parseMode, withT3Session } from "../lib/t3-rpc.ts";
import defaults from "../t3-pool/pools.json";

type ModelSelection = { instanceId: string; model: string; options?: { id: string; value: string | boolean }[] };
type LimitedThread = {
	threadId: string; runId: string; failedInstance: string; resetAt: string | null;
	modelSelection: ModelSelection; runtimeMode: ReturnType<typeof parseMode>; eligible: boolean;
};
type Move = Omit<LimitedThread, "eligible" | "failedInstance" | "resetAt"> & {
	from: string; to: string; phase: "switch" | "continue" | "done"; attempt: number;
};
type State = { version: 1; limits: Record<string, string | null>; moves: Move[] };

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

function pools(value: unknown): string[][] {
	const config = object(value);
	if (!Array.isArray(config.pools) || config.pools.length === 0) throw new CliError("Invalid T3 pools config");
	const seen = new Set<string>();
	return config.pools.map((pool) => {
		if (!Array.isArray(pool) || pool.length < 2) throw new CliError("A T3 pool needs at least two instances");
		return pool.map((value) => {
			const id = string(value);
			if (seen.has(id)) throw new CliError("T3 pool instances must be unique");
			seen.add(id);
			return id;
		});
	});
}

// Match T3's latestExecutedRun and latestRootProviderFailure, not submission
// order: a held queue can execute out of order. Only root failures count.
const limitedThreadsSql = `
SELECT t.payload_json AS thread, r.run_id AS runId,
  r.provider_instance_id AS failedInstance,
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
JOIN orchestration_v2_projection_runs r ON r.run_id = (
  SELECT latest.run_id FROM orchestration_v2_projection_runs latest
  WHERE latest.thread_id = t.thread_id AND latest.status <> 'queued'
    AND NOT (latest.status = 'cancelled' AND json_extract(latest.payload_json, '$.startedAt') IS NULL)
  ORDER BY latest.completed_at IS NULL DESC, latest.completed_at DESC,
    latest.ordinal DESC, latest.run_id DESC LIMIT 1
) AND r.status = 'failed'
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

function readLimitedThreads(path: string): LimitedThread[] {
	const db = new Database(path, { readonly: true, strict: true });
	try {
		db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 3000;");
		return db.query(limitedThreadsSql).all().flatMap((value) => {
			const row = object(value);
			const thread = object(JSON.parse(string(row.thread)));
			// A target session's historical error cannot supersede the source run
			// while a reserved move is waiting for its guarded continuation.
			if (thread.providerInstanceId === row.failedInstance && row.sessionError !== null && row.sessionError !== row.failureMessage) return [];
			const modelSelection = model(thread.modelSelection);
			if (modelSelection.instanceId !== string(thread.providerInstanceId)) throw new CliError("Inconsistent T3 model selection");
			return [{
				threadId: string(thread.id), runId: string(row.runId), failedInstance: string(row.failedInstance),
				resetAt: typeof row.resetAt === "string" && Number.isFinite(Date.parse(row.resetAt)) ? row.resetAt : null,
				modelSelection, runtimeMode: parseMode(string(thread.runtimeMode)),
				eligible: thread.archivedAt === null && thread.deletedAt === null && thread.settledOverride !== "settled"
					&& row.pending === 0 && row.queued === 0,
			}];
		});
	} finally { db.close(); }
}

function readState(path: string): State {
	if (!existsSync(path)) return { version: 1, limits: {}, moves: [] };
	const state = object(JSON.parse(readFileSync(path, "utf8")));
	if (state.version !== 1 || !Array.isArray(state.moves)) throw new CliError("Invalid T3 pool state");
	const limits = Object.fromEntries(Object.entries(object(state.limits)).map(([id, reset]) => {
		if (reset !== null && (typeof reset !== "string" || !Number.isFinite(Date.parse(reset)))) throw new CliError("Invalid T3 pool limit state");
		return [id, reset];
	}));
	const moves = state.moves.map((value): Move => {
		const move = object(value);
		if (move.phase !== "switch" && move.phase !== "continue" && move.phase !== "done") throw new CliError("Invalid T3 pool move state");
		if (typeof move.attempt !== "number" || !Number.isSafeInteger(move.attempt) || move.attempt < 0) throw new CliError("Invalid T3 pool attempt state");
		return {
			threadId: string(move.threadId), runId: string(move.runId), from: string(move.from), to: string(move.to),
			modelSelection: model(move.modelSelection), runtimeMode: parseMode(string(move.runtimeMode)), phase: move.phase, attempt: move.attempt,
		};
	});
	return { version: 1, limits, moves };
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

function plan(threads: LimitedThread[], configuredPools: string[][], state: State, now: number): Move[] {
	const configured = new Set(configuredPools.flat());
	for (const [id, reset] of Object.entries(state.limits)) {
		if (!configured.has(id) || reset !== null && Date.parse(reset) <= now) delete state.limits[id];
	}
	for (const thread of threads) {
		if (!configured.has(thread.failedInstance) || thread.resetAt !== null && Date.parse(thread.resetAt) <= now) continue;
		const old = state.limits[thread.failedInstance];
		state.limits[thread.failedInstance] = old === null || thread.resetAt === null ? null
			: old === undefined || Date.parse(old) < Date.parse(thread.resetAt) ? thread.resetAt : old;
	}
	const latest = new Set(threads.map((thread) => thread.runId));
	state.moves = state.moves.filter((move) => latest.has(move.runId));
	const moves: Move[] = [];
	for (const thread of threads) {
		if (!thread.eligible) continue;
		const previous = state.moves.find((move) => move.runId === thread.runId);
		if (previous?.phase === "done") continue;
		if (previous) {
			if (matches(thread, previous) && !Object.hasOwn(state.limits, previous.to)) moves.push(previous);
			continue;
		}
		const from = thread.modelSelection.instanceId;
		// A human switch supersedes this worker's decision.
		if (from !== thread.failedInstance || thread.resetAt !== null && Date.parse(thread.resetAt) <= now) continue;
		const pool = configuredPools.find((pool) => pool.includes(from));
		if (!pool) continue;
		const index = pool.indexOf(from);
		const next = [...pool.slice(index + 1), ...pool.slice(0, index)].find((id) => !Object.hasOwn(state.limits, id));
		if (!next) continue;
		const move: Move = {
			threadId: thread.threadId, runId: thread.runId, from, to: next,
			modelSelection: thread.modelSelection, runtimeMode: thread.runtimeMode, phase: "switch", attempt: 0,
		};
		state.moves.push(move);
		moves.push(move);
	}
	return moves;
}

function matches(thread: LimitedThread, move: Move): boolean {
	return thread.threadId === move.threadId && thread.runId === move.runId && thread.eligible
		&& thread.runtimeMode === move.runtimeMode && thread.failedInstance === move.from
		&& [move.from, move.to].includes(thread.modelSelection.instanceId)
		&& JSON.stringify({ ...thread.modelSelection, instanceId: move.from }) === JSON.stringify(move.modelSelection);
}

function commandIdFor(move: Move, database: string, directory: string, state: State): string {
	const db = new Database(database, { readonly: true, strict: true });
	try {
		db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 3000;");
		for (;;) {
			const id = `t3-pool:${move.runId}:${move.phase}:${move.attempt}`;
			const receipt = db.query("SELECT status FROM orchestration_command_receipts WHERE command_id = ?").get(id);
			// T3 permanently caches rejections. Advance only when its authoritative
			// receipt proves this command did not run, never on a transport error.
			if (receipt === null || object(receipt).status !== "rejected") return id;
			move.attempt++;
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
	const configuredPools = pools(existsSync(config) ? JSON.parse(readFileSync(config, "utf8")) : defaults);
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
		const moves = plan(readLimitedThreads(database), configuredPools, state, Date.now());
		for (const move of moves) process.stdout.write(JSON.stringify({ dryRun, thread: move.threadId, from: move.from, to: move.to, run: move.runId }) + "\n");
		if (!dryRun) saveState(directory, state);
		if (!dryRun && moves.length > 0) {
			const log = join(directory, "moves.jsonl");
			const logged = new Set(existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => string(object(JSON.parse(line)).run)) : []);
			await withT3Session(base, "agent-pool", async (send) => {
				for (const move of moves) {
					// Re-read before each side effect: users, native recovery and earlier
					// moves in this pass may have changed the projection.
					const current = readLimitedThreads(database).find((thread) => thread.runId === move.runId);
					if (!current || !matches(current, move)) continue;
					const currentLimits = plan(readLimitedThreads(database), configuredPools, state, Date.now());
					if (!currentLimits.includes(move)) continue;
					if (move.phase === "switch") {
						await send({ type: "provider.switch", commandId: commandIdFor(move, database, directory, state), threadId: move.threadId,
							modelSelection: { ...move.modelSelection, instanceId: move.to } });
						if (!logged.has(move.runId)) {
							appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), thread: move.threadId, from: move.from, to: move.to, run: move.runId }) + "\n", { mode: 0o600, flush: true });
							logged.add(move.runId);
						}
						move.phase = "continue";
						move.attempt = 0;
						saveState(directory, state);
					}
					const switched = readLimitedThreads(database).find((thread) => thread.runId === move.runId);
					if (!switched || !matches(switched, move) || switched.modelSelection.instanceId !== move.to) continue;
					// Automatic usageLimitContinuationOfRunId is a no-op before reset
					// and after switching. T3's manual guard accepts cross-account limits
					// and rejects a stale run, archive, or pending approval atomically.
					await send({
						type: "message.dispatch", commandId: commandIdFor(move, database, directory, state), messageId: `t3-pool:${move.runId}:continue`,
						threadId: move.threadId, manualContinuationOfRunId: move.runId,
						text: "Continue where you left off.", attachments: [],
						dispatchMode: { type: "start_immediately" }, createdBy: "user", creationSource: "server",
					});
					move.phase = "done";
					saveState(directory, state);
				}
			});
		}
		process.stdout.write(JSON.stringify({ dryRun, planned: moves.length, limited: Object.keys(state.limits).sort() }) + "\n");
	} finally { if (lock !== undefined) closeSync(lock); }
}

if (import.meta.main) {
	try { await main(process.argv.slice(2)); }
	catch (error) {
		process.stderr.write((error instanceof CliError ? error.message : "t3-pool failed; check config, projection schema and state") + "\n");
		process.exitCode = 1;
	}
}
