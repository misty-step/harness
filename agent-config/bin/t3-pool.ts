#!/usr/bin/env bun
// t3-pool: owned standalone launcher (misty-step/harness)

import { Database } from "bun:sqlite";
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { CliError, CommandRejected, object, parseMode, withT3Session } from "../lib/t3-rpc.ts";
import defaults from "../t3-pool/pools.json";

type ModelSelection = { instanceId: string; model: string; options?: { id: string; value: string | boolean }[] };
type LimitedThread = {
	threadId: string; runId: string; failedInstance: string; resetAt: string | null; failedAt: number;
	modelSelection: ModelSelection; runtimeMode: ReturnType<typeof parseMode>;
	blockedReason: string | null; currentFailure: boolean; active: boolean;
	// "handoff" is T3 refusing to replay the transcript into the selected provider thread.
	failure: "usage" | "handoff"; child: boolean; parentThreadId: string | null; title: string; projectId: string; interactionMode: string;
	worktreePath: string | null; branch: string | null;
	// Same-title threads in its project created after the failure: other starters' successors.
	successors: string[];
};
type Kind = "account" | "provider" | "successor" | "parent";
type MoveDetails = Pick<LimitedThread, "threadId" | "runId" | "modelSelection" | "runtimeMode" | "child"> & {
	from: string; to: string; target: ModelSelection; attempt: number; rejections: number;
	successor?: string;
};
type RecoveryNotice = { status: "pending" | "sent"; reason: string };
type RecoveryMove = MoveDetails & { kind: "account" | "provider"; phase: "switch" | "continue" | "done" | "abandoned"; notice: RecoveryNotice | null };
type NotificationMove = MoveDetails & { kind: "successor" | "parent"; phase: "announce" | "done" | "abandoned" };
type Move = RecoveryMove | NotificationMove;
type Admission = { runId: string; to: string; at: string };
type State = { version: 1; limits: Record<string, string>; moves: Move[]; admissions: Admission[] };
type Config = { wipRoots: string[]; pools: string[][]; reserved: string[]; maxMovesPerPass: number; crossProvider: Record<string, string>[]; efforts: string[] };
type Snapshot = { threads: LimitedThread[]; failures: LimitedThread[]; room: Record<string, number>; running: Record<string, number> };
type Choice = { to: string; target: ModelSelection; kind: Kind; reason: string };
const hour = 60 * 60_000;
const failureMaxAge = 30 * 60_000;
const hourlyTargetCap = 3;
const handoffRefusal = "Insufficient context allowance for the provider handoff";
const rejectedReason = "after three rejected commands";

function isRecovery(move: Move): move is RecoveryMove {
	return move.kind === "account" || move.kind === "provider";
}

function string(value: unknown): string {
	if (typeof value !== "string" || !value.trim()) throw new CliError("Invalid T3 pool data");
	return value;
}

function optionalString(value: unknown): string | null {
	return value === null || value === undefined ? null : string(value);
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
	const roots = config.wipRoots;
	if (!Array.isArray(roots)) throw new CliError("Invalid T3 WIP roots");
	const wipRoots = roots.map(string);
	if (new Set(wipRoots).size !== wipRoots.length) throw new CliError("T3 WIP roots must be unique");
	const reserved = config.reserved ?? defaults.reserved;
	if (!Array.isArray(reserved)) throw new CliError("Invalid reserved T3 instances");
	const maxMovesPerPass = config.maxMovesPerPass ?? defaults.maxMovesPerPass;
	if (maxMovesPerPass !== 1 && maxMovesPerPass !== 2) throw new CliError("T3 pool pass cap must be 1 or 2");
	const crossProvider = config.crossProvider ?? defaults.crossProvider;
	const models = new Set<string>();
	if (!Array.isArray(crossProvider)) throw new CliError("Invalid T3 cross-provider map");
	const pairs = crossProvider.map((value) => {
		const entries = Object.entries(object(value));
		if (entries.length !== 2) throw new CliError("A T3 cross-provider pair maps exactly two models to effort options");
		return Object.fromEntries(entries.map(([name, option]) => {
			if (!name.trim() || models.has(name)) throw new CliError("T3 cross-provider models must be unique");
			models.add(name);
			return [name, string(option)];
		}));
	});
	const efforts = config.efforts ?? defaults.efforts;
	if (!Array.isArray(efforts)) throw new CliError("Invalid T3 cross-provider efforts");
	return { wipRoots, pools, reserved: reserved.map(string), maxMovesPerPass, crossProvider: pairs, efforts: efforts.map(string) };
}

// Match T3's latestExecutedRun and latestRootProviderFailure, not submission
// order: a held queue can execute out of order. Only root failures count.
const latestExecutedRunSql = `SELECT latest.run_id FROM orchestration_v2_projection_runs latest
  WHERE latest.thread_id = t.thread_id AND latest.status <> 'queued'
    AND NOT (latest.status = 'cancelled' AND json_extract(latest.payload_json, '$.startedAt') IS NULL)
  ORDER BY latest.completed_at IS NULL DESC, latest.completed_at DESC,
    latest.ordinal DESC, latest.run_id DESC LIMIT 1`;

const poolFailureSql = (alias: string) => `(json_extract(${alias}.payload_json, '$.failure.class') = 'usage_limit'
    OR json_extract(${alias}.payload_json, '$.failure.message') LIKE '${handoffRefusal}%')`;

const limitedThreadsSql = `
SELECT t.thread_id AS threadId, t.payload_json AS thread, r.run_id AS runId,
  r.run_id = (${latestExecutedRunSql}) AS latestRun,
  r.provider_instance_id AS failedInstance, item.updated_at AS failedAt,
  json_extract(item.payload_json, '$.failure.class') AS failureClass,
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
    WHERE queued.thread_id = t.thread_id AND queued.status = 'queued') AS queued,
  EXISTS(SELECT 1 FROM orchestration_v2_projection_subagents task
    WHERE task.subagent_id = json_extract(t.payload_json, '$.forkedFrom.nodeId') AND task.child_thread_id = t.thread_id
      AND task.thread_id = json_extract(t.payload_json, '$.lineage.parentThreadId') AND task.origin = 'app_owned'
      AND COALESCE(json_type(task.payload_json, '$.result'), 'null') <> 'null') AS followable,
  EXISTS(SELECT 1 FROM orchestration_v2_projection_runs parentRun
    WHERE parentRun.thread_id = json_extract(t.payload_json, '$.lineage.parentThreadId')
      AND (parentRun.status = 'queued' OR json_extract(parentRun.payload_json, '$.startedAt') > item.updated_at))
    OR EXISTS(SELECT 1 FROM orchestration_v2_projection_subagents newerTask
      WHERE newerTask.thread_id = json_extract(t.payload_json, '$.lineage.parentThreadId')
        AND newerTask.child_thread_id <> t.thread_id AND newerTask.origin = 'app_owned'
        AND json_extract(newerTask.payload_json, '$.startedAt') > item.updated_at) AS parentAdvanced,
  (SELECT parent.deleted_at IS NULL AND json_extract(parent.payload_json, '$.archivedAt') IS NULL
   FROM orchestration_v2_projection_threads parent
   WHERE parent.thread_id = json_extract(t.payload_json, '$.lineage.parentThreadId')) AS parentActive,
  (SELECT json_group_array(other.thread_id) FROM orchestration_v2_projection_threads other
   WHERE other.thread_id <> t.thread_id AND other.deleted_at IS NULL
     AND json_extract(other.payload_json, '$.projectId') = json_extract(t.payload_json, '$.projectId')
     AND json_extract(other.payload_json, '$.title') = json_extract(t.payload_json, '$.title')
     AND json_extract(other.payload_json, '$.createdAt') > item.updated_at) AS successors
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
    WHERE failure.type = 'error' AND failure.status = 'failed' AND ${poolFailureSql("failure")})
  AND ${poolFailureSql("item")}
ORDER BY t.thread_id`;

// Titles and lineage.rootThreadId do not establish ownership.
function wipThreads(db: Database, roots: string[]): Set<string> {
	const nodes = new Map<string, { parent: string | null; valid: boolean; active: boolean }>();
	const owners = new Map<string, { id: string; parent: string }[]>();
	for (const value of db.query("SELECT subagent_id AS id, thread_id AS parent, child_thread_id AS child FROM orchestration_v2_projection_subagents WHERE child_thread_id IS NOT NULL").all()) {
		const row = object(value);
		const child = string(row.child);
		const tasks = owners.get(child) ?? [];
		tasks.push({ id: string(row.id), parent: string(row.parent) });
		owners.set(child, tasks);
	}
	for (const value of db.query("SELECT thread_id AS id, deleted_at AS deleted, payload_json AS payload FROM orchestration_v2_projection_threads").all()) {
		const row = object(value);
		const payload = object(JSON.parse(string(row.payload)));
		const lineage = typeof payload.lineage === "object" && payload.lineage !== null ? object(payload.lineage) : {};
		const fork = typeof payload.forkedFrom === "object" && payload.forkedFrom !== null ? object(payload.forkedFrom) : {};
		const parent = typeof lineage.parentThreadId === "string" ? lineage.parentThreadId : null;
		const tasks = owners.get(string(row.id)) ?? [];
		const valid = parent === null
			? lineage.parentThreadId === null && lineage.relationshipToParent === null && tasks.length === 0
			: lineage.relationshipToParent === "subagent" && fork.type === "node"
				&& tasks.filter((task) => task.id === fork.nodeId && task.parent === parent).length === 1
				&& tasks.every((task) => task.parent === parent);
		nodes.set(string(row.id), { parent, valid, active: row.deleted === null && payload.deletedAt === null
			&& payload.archivedAt === null && payload.settledOverride !== "settled" });
	}
	const allowed = new Set<string>();
	for (const id of nodes.keys()) {
		const seen = new Set<string>();
		let current: string | null = id;
		while (current !== null && !seen.has(current)) {
			seen.add(current);
			const node = nodes.get(current);
			if (!node?.valid || !node.active) break;
			if (node.parent === null) {
				if (roots.includes(current)) allowed.add(id);
				break;
			}
			current = node.parent;
		}
	}
	return allowed;
}

function readSnapshot(path: string, now: number, config: Config): Snapshot {
	const db = new Database(path, { readonly: true, strict: true });
	try {
		db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 3000;");
		db.exec("BEGIN;");
		const wip = wipThreads(db, config.wipRoots);
		const failures = db.query(limitedThreadsSql).all().map((value): { thread: LimitedThread; latest: boolean } => {
			const row = object(value);
			const thread = object(JSON.parse(string(row.thread)));
			if (thread.id !== row.threadId) throw new CliError("Inconsistent T3 thread identity");
			// A target session's historical error cannot supersede the source run
			// while a reserved move is waiting for its guarded continuation.
			const superseded = thread.providerInstanceId === row.failedInstance && row.sessionError !== null && row.sessionError !== row.failureMessage;
			const modelSelection = model(thread.modelSelection);
			if (modelSelection.instanceId !== string(thread.providerInstanceId)) throw new CliError("Inconsistent T3 model selection");
			const failedAt = Date.parse(string(row.failedAt));
			const active = thread.archivedAt === null && thread.deletedAt === null && thread.settledOverride !== "settled";
			const lineage = object(thread.lineage);
			const failure = row.failureClass === "usage_limit" ? "usage" : "handoff";
			const child = lineage.parentThreadId !== null;
			// T3 records a follow-up task, which notifies the parent, only for an
			// app-owned subagent whose original task already has a result.
			const childReason = !child ? null
				: lineage.relationshipToParent !== "subagent" || thread.creationSource === "provider" || row.followable !== 1
					? "delegated child: no app-owned task result to follow up"
				: row.parentActive !== 1 ? "delegated child: parent archived or deleted"
				: row.parentAdvanced !== 0 ? "delegated child: parent has newer work" : null;
			const title = string(thread.title);
			const blockedReason = childReason
				?? (!wip.has(string(thread.id)) ? "outside maintained WIP roots or unverified ancestry" : null)
				?? (!active ? "archived, deleted or settled"
				: failure === "handoff" && !child && / \(succeeded by [^)]+\)$/.test(title) ? "already succeeded"
				: superseded ? "superseded provider failure"
				: !Number.isFinite(failedAt) || failedAt > now || now - failedAt >= failureMaxAge ? "failure is not within the last 30 minutes"
				: row.pending !== 0 || row.queued !== 0 ? "pending request or queued run" : null);
			return { latest: row.latestRun === 1, thread: {
				threadId: string(thread.id), runId: string(row.runId), failedInstance: string(row.failedInstance),
				resetAt: typeof row.resetAt === "string" && Number.isFinite(Date.parse(row.resetAt)) ? row.resetAt : null,
				modelSelection, runtimeMode: parseMode(string(thread.runtimeMode)), failedAt, blockedReason, active,
				currentFailure: failure === "usage" && active && !superseded && Number.isFinite(failedAt) && failedAt <= now,
				failure, child, parentThreadId: optionalString(lineage.parentThreadId), title, projectId: string(thread.projectId), interactionMode: string(thread.interactionMode),
				worktreePath: optionalString(thread.worktreePath), branch: optionalString(thread.branch),
				successors: (JSON.parse(string(row.successors)) as unknown[]).map(string),
			} };
		});
		const room: Record<string, number> = {};
		const running: Record<string, number> = {};
		// Only completions prove room: limited accounts accept and start runs
		// that then fail at the same limit.
		for (const value of db.query(`SELECT provider_instance_id AS instance,
    MAX(CASE WHEN status = 'completed' THEN completed_at END) AS roomAt,
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
		const kind = move.kind === undefined ? "account" : move.kind;
		const child = move.child === undefined ? false : move.child;
		if (typeof child !== "boolean") throw new CliError("Invalid T3 pool move kind");
		if (typeof move.attempt !== "number" || !Number.isSafeInteger(move.attempt) || move.attempt < 0) throw new CliError("Invalid T3 pool attempt state");
		const modelSelection = model(move.modelSelection);
		const from = string(move.from);
		const to = string(move.to);
		// Only the original account-only format omitted kind and target.
		if (move.target === undefined && move.kind !== undefined) throw new CliError("Invalid T3 pool move target");
		const target = move.target === undefined ? { ...modelSelection, instanceId: to } : model(move.target);
		if (from !== modelSelection.instanceId || to !== target.instanceId) throw new CliError("Inconsistent T3 pool move identity");
		const details: MoveDetails = {
			threadId: string(move.threadId), runId: string(move.runId), from, to, modelSelection, target,
			runtimeMode: parseMode(string(move.runtimeMode)), child, attempt: move.attempt, rejections: nonnegativeInteger(move.rejections ?? 0),
		};
		if (move.successor !== undefined) details.successor = string(move.successor);
		if (move.notificationPending !== undefined && (kind !== "successor" && kind !== "parent" || move.phase !== "done" || move.notificationPending !== true)) throw new CliError("Invalid T3 pool notification state");
		if (kind === "successor" || kind === "parent") {
			if (move.phase !== "announce" && move.phase !== "done" && move.phase !== "abandoned") throw new CliError("Invalid T3 pool succession phase");
			if (to !== from || !sameModel(target, modelSelection) || move.notice !== undefined) throw new CliError("Invalid T3 pool succession target");
			if (kind === "parent" && !child) throw new CliError("Invalid T3 pool parent recovery");
			return { ...details, kind: child ? "parent" : "successor", phase: move.notificationPending === true ? "announce" : move.phase };
		}
		if (kind !== "account" && kind !== "provider") throw new CliError("Invalid T3 pool move kind");
		if (move.phase !== "switch" && move.phase !== "continue" && move.phase !== "done" && move.phase !== "abandoned") throw new CliError("Invalid T3 pool recovery phase");
		if (to === from || kind === "account" && !sameModel(target, { ...modelSelection, instanceId: to })) throw new CliError("Invalid T3 pool recovery target");
		if (details.rejections > 3 || details.rejections === 3 && move.phase !== "abandoned") throw new CliError("Inconsistent T3 pool rejection state");
		let notice: RecoveryNotice | null = null;
		if (move.notice !== undefined && move.notice !== null) {
			const value = object(move.notice);
			if (move.phase !== "abandoned" || value.status !== "pending" && value.status !== "sent") throw new CliError("Invalid T3 pool recovery notification");
			notice = { status: value.status, reason: string(value.reason) };
		} else if (move.phase === "abandoned") {
			if (details.rejections !== 3) throw new CliError("Invalid T3 pool abandoned state");
			notice = { status: "pending", reason: rejectedReason };
		}
		return { ...details, kind, phase: move.phase, notice };
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
	// Old readers must never execute a Home notification as a continuation.
	const persisted = { ...state, moves: state.moves.map((move) => !isRecovery(move) && move.phase === "announce"
		? { ...move, phase: "done", notificationPending: true } : move) };
	try { writeFileSync(file, JSON.stringify(persisted) + "\n"); fsyncSync(file); }
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

// Sol at an effort maps to Opus at the same effort; other options are
// provider-specific and stay behind.
function crossSelection(selection: ModelSelection, instanceId: string, config: Config): ModelSelection | null {
	const pair = config.crossProvider.find((candidate) => Object.hasOwn(candidate, selection.model));
	if (!pair) return null;
	const [target, option] = Object.entries(pair).find(([name]) => name !== selection.model)!;
	const efforts = (selection.options ?? []).filter((candidate) => candidate.id === pair[selection.model]);
	if (efforts.length !== 1 || efforts.some((effort) => typeof effort.value !== "string" || !config.efforts.includes(effort.value))) return null;
	return { instanceId, model: target, ...(efforts.length > 0 ? { options: [{ id: option, value: efforts[0].value }] } : {}) };
}

function sameModel(left: ModelSelection, right: ModelSelection): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function configuredTarget(move: RecoveryMove, config: Config): boolean {
	const source = config.pools.find((pool) => pool.includes(move.from));
	const target = config.pools.find((pool) => pool.includes(move.to));
	if (!source || !target) return false;
	if (move.kind === "account") return source === target && sameModel(move.target, { ...move.modelSelection, instanceId: move.to });
	const mapped = crossSelection(move.modelSelection, move.to, config);
	return source !== target && mapped !== null && sameModel(move.target, mapped);
}

function ineligibleReason(move: RecoveryMove, snapshot: Snapshot, config: Config, now: number): string | null {
	const current = snapshot.threads.find((thread) => thread.runId === move.runId);
	if (!current) return "the failed run is no longer current";
	if (current.blockedReason) return current.blockedReason;
	if (!matches(current, move)) return "superseded account, model or runtime selection";
	if (!configuredTarget(move, config)) return "the reserved target no longer matches the configured pools, model or effort";
	if (config.reserved.includes(move.to)) return "the target is now reserved";
	const limits = accountLimits(snapshot, config, now);
	if (Object.hasOwn(limits, move.to)) return "the target is now limited";
	if (!Object.hasOwn(limits, move.from)) return "the source has room or its limit expired; native recovery owns it";
	return null;
}

function choose(thread: LimitedThread, pool: string[], config: Config, state: State, loads: Record<string, number>, previous: Move | undefined): Choice | string {
	if (thread.failure === "handoff") return { to: thread.modelSelection.instanceId, target: thread.modelSelection,
		kind: thread.child ? "parent" : "successor", reason: thread.child ? "handoff refused; request recovery through the owning parent" : "handoff refused; request succession from Home" };
	const open = (id: string) => !config.reserved.includes(id) && !Object.hasOwn(state.limits, id);
	const admitted = (id: string) => state.admissions.some((entry) => entry.runId === thread.runId && entry.to === id)
		|| state.admissions.filter((entry) => entry.to === id).length < hourlyTargetCap;
	if (previous && isRecovery(previous) && !configuredTarget(previous, config)) return "no target: the reserved target no longer matches the configured pools, model or effort";
	if (previous) return open(previous.to) && admitted(previous.to)
		? { to: previous.to, target: previous.target, kind: previous.kind, reason: `resuming ${previous.kind} move at ${previous.phase}` }
		: "no target: the reserved target is now limited, reserved or at the hourly cap";
	const index = pool.indexOf(thread.failedInstance);
	const ordered = [...pool.slice(index + 1), ...pool.slice(0, index)];
	let options = ordered.filter(open).map((id) => ({ id, target: { ...thread.modelSelection, instanceId: id } as ModelSelection | null }));
	const provider = options.length === 0;
	if (provider) {
		options = config.pools.filter((other) => other !== pool).flat().filter(open).map((id) => ({ id, target: crossSelection(thread.modelSelection, id, config) }));
		if (options.length === 0) return "no target: accounts in every pool are limited or reserved";
		if (options.some((option) => !option.target)) return "no target: its pool is limited or reserved, and its model or effort has no cross-provider mapping";
	}
	const ranked = options.filter((option) => admitted(option.id)).sort((a, b) => (loads[a.id] ?? 0) - (loads[b.id] ?? 0));
	if (ranked.length === 0) return "no target: other accounts are limited, reserved or at the hourly cap";
	return { to: ranked[0].id, target: ranked[0].target!, kind: provider ? "provider" : "account", reason: provider
		? "fresh usage-limit failure; mapped model on the least-loaded account of another pool"
		: "fresh usage-limit failure; least-loaded eligible target" };
}

function plan(snapshot: Snapshot, config: Config, state: State, now: number) {
	state.limits = accountLimits(snapshot, config, now);
	state.admissions = state.admissions.filter((entry) => Date.parse(entry.at) > now - hour);
	const latest = new Set(snapshot.threads.map((thread) => thread.runId));
	state.moves = state.moves.filter((move) => latest.has(move.runId));
	const moves: Move[] = [];
	const excluded: Record<string, number> = {};
	const candidates: { thread: string; run: string; from: string; reason: string; to?: string; kind?: Kind; model?: string; child?: true }[] = [];
	const loads = { ...snapshot.running };
	let admittedMoves = 0;
	// Top-level lanes take the pass and hourly caps before delegated children.
	for (const thread of [...snapshot.threads].sort((a, b) => Number(a.child) - Number(b.child))) {
		const previous = state.moves.find((move) => move.runId === thread.runId);
		if (thread.blockedReason) {
			excluded[thread.blockedReason] = (excluded[thread.blockedReason] ?? 0) + 1;
			continue;
		}
		let reason: string | null = null;
		const from = thread.modelSelection.instanceId;
		const pool = config.pools.find((pool) => pool.includes(thread.failedInstance));
		if (!reason && previous && ["done", "abandoned"].includes(previous.phase)) reason = `move ${previous.phase}`;
		if (!reason && (previous ? !matches(thread, previous) : from !== thread.failedInstance)) reason = "superseded account, model or runtime selection";
		if (!reason && thread.failure === "usage" && !Object.hasOwn(state.limits, thread.failedInstance)) reason = "source has room or its limit expired; native recovery owns it";
		if (!reason && !pool) reason = "source is not in a configured pool";
		if (!reason && thread.failure === "handoff" && !thread.child && thread.successors.some((id) => id !== previous?.successor)) reason = "a same-title thread created after the failure: another starter's successor";
		let choice: Choice | undefined;
		if (!reason && pool) {
			const chosen = choose(thread, pool, config, state, loads, previous);
			if (typeof chosen === "string") reason = chosen; else choice = chosen;
		}
		if (!reason && choice && admittedMoves >= config.maxMovesPerPass) reason = `per-pass move cap; next: ${choice.kind} move to ${choice.to}`;
		const child = thread.child ? { child: true as const } : {};
		if (!reason && choice) {
			const details: MoveDetails = {
				threadId: thread.threadId, runId: thread.runId, from, to: choice.to, target: choice.target, child: thread.child,
				modelSelection: thread.modelSelection, runtimeMode: thread.runtimeMode, attempt: 0, rejections: 0,
			};
			const move: Move = previous ?? (choice.kind === "account" || choice.kind === "provider" ? { ...details, kind: choice.kind, phase: "switch", notice: null }
				: { ...details, kind: choice.kind, phase: "announce" });
			if (!previous) state.moves.push(move);
			if (isRecovery(move) && !state.admissions.some((entry) => entry.runId === move.runId && entry.to === move.to)) {
				state.admissions.push({ runId: move.runId, to: move.to, at: new Date(now).toISOString() });
			}
			moves.push(move);
			admittedMoves++;
			loads[move.to] = (loads[move.to] ?? 0) + 1;
			candidates.push({ thread: thread.threadId, run: thread.runId, from, to: move.to, kind: move.kind,
				...(move.target.model === move.modelSelection.model ? {} : { model: move.target.model }), ...child, reason: choice.reason });
		} else candidates.push({ thread: thread.threadId, run: thread.runId, from, ...child, reason: reason ?? "no eligible target" });
	}
	return { moves, candidates, excluded };
}

function matches(thread: LimitedThread, move: Move): boolean {
	const selection = JSON.stringify(thread.modelSelection);
	return thread.threadId === move.threadId && thread.runId === move.runId && thread.blockedReason === null
		&& thread.runtimeMode === move.runtimeMode && thread.failedInstance === move.from
		&& thread.child === move.child && (move.kind !== "successor" || thread.parentThreadId === null)
		&& (move.kind !== "parent" || thread.parentThreadId !== null)
		&& thread.failure === (isRecovery(move) ? "usage" : "handoff")
		&& (selection === JSON.stringify(move.modelSelection) || isRecovery(move) && selection === JSON.stringify(move.target));
}

function abandon(move: RecoveryMove, reason: string, directory: string, state: State) {
	move.phase = "abandoned";
	move.notice = { status: "pending", reason };
	saveState(directory, state);
}

function reconcileRecovery(move: RecoveryMove, reason: string | null, database: string, directory: string, state: State): boolean {
	if (move.phase !== "switch" && move.phase !== "continue") return false;
	const db = new Database(database, { readonly: true, strict: true });
	try {
		const accepted = (phase: "switch" | "continue") => {
			const prefix = `t3-pool:${move.runId}:${phase}:`;
			return db.query("SELECT 1 FROM orchestration_command_receipts WHERE status = 'accepted' AND substr(command_id, 1, ?) = ? LIMIT 1").get(prefix.length, prefix) !== null;
		};
		if (accepted("continue")) {
			move.phase = "done";
			saveState(directory, state);
			return false;
		}
		const row = db.query("SELECT json_extract(payload_json, '$.modelSelection') AS selection FROM orchestration_v2_projection_threads WHERE thread_id = ?").get(move.threadId);
		const selected = row !== null && sameModel(model(JSON.parse(string(object(row).selection))), move.target);
		if (accepted("switch") || selected) {
			if (reason || !selected) {
				abandon(move, `because ${reason ?? "the applied switch no longer selects the reserved target"}`, directory, state);
				return false;
			}
			if (move.phase === "switch") {
				move.phase = "continue";
				move.attempt = 0;
				saveState(directory, state);
			}
		}
		return reason === null;
	} finally { db.close(); }
}

function rejected(move: RecoveryMove, directory: string, state: State) {
	move.rejections++;
	if (move.rejections >= 3) abandon(move, rejectedReason, directory, state);
	else saveState(directory, state);
	const rejection = { at: new Date().toISOString(), thread: move.threadId, run: move.runId, phase: move.phase, rejections: move.rejections, reason: "T3 rejected the command" };
	appendFileSync(join(directory, "rejections.jsonl"), JSON.stringify(rejection) + "\n", { mode: 0o600, flush: true });
	process.stderr.write(JSON.stringify(rejection) + "\n");
}

function commandIdFor(move: RecoveryMove, database: string, directory: string, state: State): string | null {
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
			rejected(move, directory, state);
		}
	} finally { db.close(); }
}

function followUpTask(database: string, move: Move): string | null {
	const db = new Database(database, { readonly: true, strict: true });
	try {
		db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 3000;");
		const row = db.query(`SELECT json_extract(payload_json, '$.delegatedTaskId') AS task FROM orchestration_v2_projection_runs
      WHERE thread_id = ? AND json_extract(payload_json, '$.userMessageId') = ?`).get(move.threadId, `t3-pool:${move.runId}:continue`);
		return row === null || typeof object(row).task !== "string" ? null : String(object(row).task);
	} finally { db.close(); }
}

function postHome(body: string) {
	try {
		const posted = Bun.spawnSync({ cmd: ["home", "post", "--from", "t3-pool"], stdin: Buffer.from(body + "\n"), stdout: "ignore", stderr: "ignore", timeout: 30_000 });
		if (posted.exitCode === 0) return;
	} catch { /* fall back to the inbox */ }
	const inbox = join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "home/inbox.md");
	mkdirSync(dirname(inbox), { recursive: true, mode: 0o700 });
	appendFileSync(inbox, `\n## ${new Date().toISOString()} [t3-pool]\n\n${body}\n`, { mode: 0o600, flush: true });
}

function requestSuccession(thread: LimitedThread) {
	if (thread.child || thread.parentThreadId !== null) throw new CliError("Only top-level WIP roots may request succession");
	postHome([
		`Lane succession requested: ${thread.threadId}`,
		`t3-pool requests Home succession for [${thread.title}](t3-thread://v1/${thread.threadId}).`,
		"Handoff: none; the successor builds it from t3_thread_read history.",
		`Latest failed run: ${thread.runId}. T3 refused the provider handoff: "${handoffRefusal}".`,
		`Project: ${thread.projectId}; workspace: ${thread.worktreePath ?? "project root"}; branch: ${thread.branch ?? "none"}.`,
		`Current selection: ${JSON.stringify(thread.modelSelection)}; runtime: ${thread.runtimeMode}; interaction: ${thread.interactionMode}.`,
		"Home owns thread creation from groomed and specced backlog. Heartbeat or Home dispatches named roster successions under the shared serialized lane-succession contract; the pool only requests.",
		"After verifying the replacement, intentionally replace the predecessor ID in pools.json wipRoots and deploy the config. Titles do not transfer pool eligibility.",
	].join("\n"));
}

function requestParentRecovery(thread: LimitedThread) {
	if (!thread.child || thread.parentThreadId === null) throw new CliError("Child recovery requires its owning parent");
	postHome([
		`Delegated child recovery requested: ${thread.threadId}`,
		`t3-pool requests recovery of [${thread.title}](t3-thread://v1/${thread.threadId}) through its owning parent [${thread.parentThreadId}](t3-thread://v1/${thread.parentThreadId}).`,
		`Latest failed run: ${thread.runId}. T3 refused the provider handoff: "${handoffRefusal}".`,
		`Current selection: ${JSON.stringify(thread.modelSelection)}; runtime: ${thread.runtimeMode}.`,
		"Home: route recovery to the owning parent. The parent owns continuation or replacement of this task and must retain delivery of its result.",
		"Do not open a top-level replacement for this child.",
	].join("\n"));
}

function notifyAbandoned(directory: string, state: State) {
	for (const move of state.moves) {
		if (!isRecovery(move) || move.notice?.status !== "pending") continue;
		postHome(`t3-pool abandoned recovery of [${move.threadId}](t3-thread://v1/${move.threadId}) ${move.notice.reason}. Failed run: ${move.runId}; original selection: ${JSON.stringify(move.modelSelection)}; selected target: ${JSON.stringify(move.target)}. Read the thread before choosing recovery; no new thread was opened.`);
		move.notice.status = "sent";
		saveState(directory, state);
	}
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
	const readConfig = () => {
		if (!existsSync(config)) throw new CliError("T3 pool roster absent; install t3-pool.json with explicit wipRoots");
		return configuration(JSON.parse(readFileSync(config, "utf8")));
	};
	readConfig();
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
		// Deliver durable terminal notices before pruning obsolete failed runs.
		if (!dryRun) notifyAbandoned(directory, state);
		const currentConfig = readConfig();
		const snapshot = readSnapshot(database, Date.now(), currentConfig);
		if (!dryRun) for (const move of state.moves) {
			if (!isRecovery(move)) continue;
			const reason = ineligibleReason(move, snapshot, currentConfig, Date.now());
			reconcileRecovery(move, reason, database, directory, state);
		}
		if (!dryRun) notifyAbandoned(directory, state);
		const { moves, candidates, excluded } = plan(snapshot, currentConfig, state, Date.now());
		if (dryRun) for (const candidate of candidates) process.stdout.write(JSON.stringify({ dryRun, ...candidate }) + "\n");
		if (!dryRun) saveState(directory, state);
		if (!dryRun && moves.length > 0) {
			const log = join(directory, "moves.jsonl");
			const logged = new Set(existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => string(object(JSON.parse(line)).run)) : []);
			const save = () => saveState(directory, state);
			const record = (move: Move) => {
				if (logged.has(move.runId)) return;
				appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), thread: move.threadId, from: move.from, to: move.to, run: move.runId, kind: move.kind,
					...(move.target.model === move.modelSelection.model ? {} : { model: move.target.model }), ...(move.successor ? { successor: move.successor } : {}) }) + "\n", { mode: 0o600, flush: true });
				logged.add(move.runId);
			};
			const reject = (move: RecoveryMove) => {
				const before = move.rejections;
				commandIdFor(move, database, directory, state);
				// A rejection without a receipt still counts toward abandonment.
				if (move.rejections === before && move.phase !== "abandoned") rejected(move, directory, state);
			};
			for (const move of moves.filter((move) => !isRecovery(move))) {
				const config = readConfig();
				const current = readSnapshot(database, Date.now(), config).threads.find((thread) => matches(thread, move));
				if (!current) continue;
				if (move.kind === "successor") {
					if (!config.wipRoots.includes(current.threadId)) continue;
					requestSuccession(current);
				} else requestParentRecovery(current);
				move.phase = "done";
				save();
				process.stdout.write(JSON.stringify({ requested: move.threadId, kind: move.kind === "successor" ? "succession" : "parent-recovery", run: move.runId }) + "\n");
			}
			const dispatches = moves.filter(isRecovery);
			if (dispatches.length > 0) await withT3Session(base, "agent-pool", async (send) => {
				const eligible = (move: RecoveryMove) => {
					const config = readConfig();
					const snapshot = readSnapshot(database, Date.now(), config);
					const reason = ineligibleReason(move, snapshot, config, Date.now());
					return reconcileRecovery(move, reason, database, directory, state)
						? snapshot.threads.find((thread) => thread.runId === move.runId) : undefined;
				};
				for (const move of dispatches) {
					try {
						if (!eligible(move)) continue;
						if (move.phase === "switch") {
							const commandId = commandIdFor(move, database, directory, state);
							if (!commandId) continue;
							await send({ type: "provider.switch", commandId, threadId: move.threadId, modelSelection: move.target });
							record(move);
							move.phase = "continue";
							move.attempt = 0;
							save();
						}
						const switched = eligible(move);
						if (!switched || switched.modelSelection.instanceId !== move.to) continue;
						const commandId = commandIdFor(move, database, directory, state);
						if (!commandId) continue;
						record(move);
						// T3's manual guard checks the latest failed run and pending requests
						// atomically. For a delegated child, this user continuation makes T3
						// record a fresh task whose completion notifies the parent.
						await send({
							type: "message.dispatch", commandId, messageId: `t3-pool:${move.runId}:continue`,
							threadId: move.threadId, manualContinuationOfRunId: move.runId,
							text: "Continue where you left off.", attachments: [],
							dispatchMode: { type: "start_immediately" }, createdBy: "user", creationSource: "server",
						});
						move.phase = "done";
						save();
						const task = move.child ? { task: followUpTask(database, move) } : {};
						process.stdout.write(JSON.stringify({ moved: move.threadId, kind: move.kind, to: move.to, ...task }) + "\n");
						if (move.child && task.task === null) process.stderr.write(JSON.stringify({ thread: move.threadId, run: move.runId, warning: "T3 recorded no follow-up task for the parent" }) + "\n");
					} catch (error) {
						if (!(error instanceof CommandRejected)) throw error;
						reject(move);
					}
				}
			});
		}
		if (!dryRun) notifyAbandoned(directory, state);
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
