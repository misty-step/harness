import { Database } from "bun:sqlite";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, readSync, realpathSync, statSync } from "node:fs";
import { hostname } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import type { DeliveryState, NativeAdapter, NativeEvent, NativeResult, ReviewReceipt, RunState, TaskSpec } from "./contract";

export class SummonError extends Error {
	constructor(public readonly code: string, message: string) { super(message); this.name = "SummonError"; }
}

export interface TurnSnapshot {
	sequence: number;
	requestId: string;
	text: string;
	state: DeliveryState;
	sessionId: string | null;
	acknowledged: boolean;
	result: NativeResult | null;
	error: string | null;
	reconciliation: Reconciliation | null;
}
export interface RunSnapshot {
	runId: string;
	task: TaskSpec;
	manifestHash: string;
	generation: number;
	state: RunState;
	sessionId: string | null;
	owner: { pid: number; purpose: string; leaseUntil: number; alive: boolean | null } | null;
	turns: TurnSnapshot[];
}
export interface DeliveryInspection extends RunSnapshot {
	deliveryDigest: string;
	head: string | null;
	outputs: { path: string; sha256: string | null; bytes: number | null }[];
	readyForReview: boolean;
	checks: { id: string; type: "command" | "review"; status: "pending" | "pass" | "block"; evidence: unknown }[];
}
/** Explicit commissioner assertion about an already acknowledged native transcript. Never a resend. */
export interface Reconciliation {
	runId: string;
	requestId: string;
	sessionId: string;
	completed: true;
	text: string;
	reviewer: string;
	evidence: string[];
}
interface TaskRow {
	run_id: string; manifest: string; manifest_hash: string; generation: number; state: RunState;
	session_id: string | null; stop_requested: number; owner_token: string | null; owner_pid: number | null;
	owner_identity: string | null; owner_host: string | null; owner_boot: string | null;
	owner_purpose: string | null; lease_until: number | null;
}
interface TurnRow {
	seq: number; request_id: string; text: string; text_hash: string; state: DeliveryState;
	session_id: string | null; acknowledged_at: number | null; result: string | null;
	error: string | null; reconciliation: string | null;
}
interface ProofRow { check_id: string; digest: string; verdict: "pass" | "block"; evidence: string }
interface Lease { token: string; signal: AbortSignal; release(): void }
const SCHEMA_VERSION = 1;
const LEASE_MS = 15_000;
const BOOT = readOptional("/proc/sys/kernel/random/boot_id");
const HOST = hostname();

function fail(code: string, message: string): never { throw new SummonError(code, message); }
function object(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_INPUT", `${label} must be an object`);
	return value as Record<string, unknown>;
}
function text(value: unknown, label: string): string {
	if (typeof value !== "string" || !value.trim() || value.includes("\0")) fail("INVALID_INPUT", `${label} must be a nonempty string without NUL`);
	return value;
}
function fields(value: Record<string, unknown>, allowed: string[], label: string): void {
	if (Object.keys(value).some((key) => !allowed.includes(key))) fail("INVALID_INPUT", `${label} contains an unknown field`);
}
function evidence(value: unknown): string[] {
	if (!Array.isArray(value) || !value.length) fail("INVALID_INPUT", "evidence must contain at least one native transcript or review reference");
	return value.map((item) => text(item, "evidence reference"));
}
function reviewerIdentity(value: unknown): string {
	const reviewer = text(value, "reviewer");
	if (/[\u0000-\u001f\u007f]/.test(reviewer)) fail("INVALID_INPUT", "reviewer must be one nonempty identity without control characters");
	return reviewer;
}
function outputPath(value: unknown): string {
	const path = text(value, "output path");
	if (isAbsolute(path) || path.split(/[\\/]/).some((part) => !part || part === "." || part === "..") || path.includes("\\")) {
		fail("OUTPUT_ESCAPE", "outputs must be relative file paths without traversal");
	}
	return path;
}
export function validateTaskSpec(value: unknown): TaskSpec {
	const task = object(value, "task");
	fields(task, ["id", "kind", "brief", "workspace", "route", "checks", "outputs", "source"], "task");
	const kind = task.kind;
	if (kind !== "implementation" && kind !== "research") fail("INVALID_INPUT", "kind must be implementation or research");
	let workspace: string;
	try {
		workspace = realpathSync(resolve(text(task.workspace, "workspace")));
		if (!statSync(workspace).isDirectory()) fail("INVALID_INPUT", "workspace must be a directory");
	} catch (error) {
		if (error instanceof SummonError) throw error;
		fail("INVALID_INPUT", "workspace must be an existing directory");
	}
	const route = object(task.route, "route");
	fields(route, ["harness", "provider", "model", "effort"], "route");
	if (!((route.harness === "claude-code" && route.provider === "anthropic") || (route.harness === "antigravity" && route.provider === "google-antigravity"))) {
		fail("UNSUPPORTED_ROUTE", "supported native routes are claude-code/anthropic and antigravity/google-antigravity");
	}
	if (!Array.isArray(task.checks) || !Array.isArray(task.outputs)) fail("INVALID_INPUT", "checks and outputs must be explicit arrays");
	const checks = task.checks.map((value) => {
		const check = object(value, "check");
		const id = text(check.id, "check id");
		if (check.type === "command") {
			fields(check, ["id", "type", "argv"], "command check");
			if (!Array.isArray(check.argv) || !check.argv.length || check.argv.some((arg) => typeof arg !== "string" || arg.includes("\0"))) fail("INVALID_INPUT", "command checks require argv, never an implicit shell");
			text(check.argv[0], "command executable");
			return { id, type: "command" as const, argv: check.argv as string[] };
		}
		if (check.type === "review") {
			fields(check, ["id", "type", "criterion"], "review check");
			return { id, type: "review" as const, criterion: text(check.criterion, "review criterion") };
		}
		return fail("INVALID_INPUT", "check type must be command or review");
	});
	const outputs = task.outputs.map(outputPath);
	if (new Set(checks.map((check) => check.id)).size !== checks.length || new Set(outputs).size !== outputs.length) fail("INVALID_INPUT", "check ids and output paths must be unique");
	const result: TaskSpec = {
		id: text(task.id, "task id"), kind, brief: text(task.brief, "brief"), workspace,
		route: { harness: route.harness, provider: route.provider, model: text(route.model, "model"), effort: text(route.effort, "effort") },
		checks, outputs,
	};
	if (task.source !== undefined) {
		const source = object(task.source, "source");
		fields(source, ["adapter", "id"], "source");
		result.source = { adapter: text(source.adapter, "source adapter"), id: text(source.id, "source id") };
	}
	for (const path of outputs) inspectOutput(workspace, path);
	return result;
}
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
	}
	return JSON.stringify(value);
}
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function readOptional(path: string): string | null { try { return readFileSync(path, "utf8").trim(); } catch { return null; } }
function errorCode(error: unknown): string | null {
	return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null;
}
function processIdentity(pid: number): string | null {
	const stat = readOptional(`/proc/${pid}/stat`);
	return stat ? stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? null : null;
}
function ownerAlive(row: TaskRow): boolean | null {
	if (!row.owner_token || !row.owner_pid) return false;
	if (row.owner_host !== HOST) return null;
	if (row.owner_boot && BOOT && row.owner_boot !== BOOT) return false;
	const stat = readOptional(`/proc/${row.owner_pid}/stat`);
	if (stat && ["Z", "X"].includes(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0]!)) return false;
	const identity = processIdentity(row.owner_pid);
	if (identity && row.owner_identity) return identity === row.owner_identity;
	try { process.kill(row.owner_pid, 0); return true; }
	catch (error) { return errorCode(error) === "ESRCH" ? false : null; }
}
function inside(workspace: string, path: string): boolean {
	const rel = relative(workspace, path);
	return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
function inspectOutput(workspace: string, path: string): { path: string; sha256: string | null; bytes: number | null } {
	let current = workspace;
	for (const part of path.split("/")) {
		current = join(current, part);
		try {
			if (lstatSync(current).isSymbolicLink() && !inside(workspace, resolve(join(current, ".."), readlinkSync(current)))) fail("OUTPUT_ESCAPE", `output ${path} links outside workspace`);
			current = realpathSync(current);
		}
		catch (error) {
			if (error instanceof SummonError) throw error;
			if (errorCode(error) === "ENOENT") return { path, sha256: null, bytes: null };
			fail("OUTPUT_INVALID", `cannot inspect output ${path}`);
		}
		if (!inside(workspace, current)) fail("OUTPUT_ESCAPE", `output ${path} resolves outside workspace`);
	}
	let fd: number;
	try { fd = openSync(current, constants.O_RDONLY | constants.O_NOFOLLOW); }
	catch { return fail("OUTPUT_INVALID", `cannot open output ${path}`); }
	try {
		// On Linux this checks the actual opened kernel object, not only a pre-open pathname.
		const opened = existsSync("/proc/self/fd") ? realpathSync(`/proc/self/fd/${fd}`) : realpathSync(current);
		if (!inside(workspace, opened)) fail("OUTPUT_ESCAPE", `output ${path} opened outside workspace`);
		const before = fstatSync(fd);
		if (!before.isFile()) fail("OUTPUT_INVALID", `output ${path} must be a regular file`);
		const digest = createHash("sha256");
		const buffer = Buffer.allocUnsafe(64 * 1024);
		let bytes = 0;
		for (;;) {
			const count = readSync(fd, buffer, 0, buffer.length, null);
			if (!count) break;
			digest.update(buffer.subarray(0, count)); bytes += count;
		}
		const after = fstatSync(fd);
		if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) fail("OUTPUT_CHANGED", `output ${path} changed while inspecting`);
		if (!inside(workspace, realpathSync(join(workspace, path)))) fail("OUTPUT_ESCAPE", `output ${path} changed to an escaping path`);
		return { path, sha256: digest.digest("hex"), bytes };
	} finally { closeSync(fd); }
}
function gitHead(workspace: string): string | null {
	const result = spawnSync("git", ["-C", workspace, "rev-parse", "--verify", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
	if (result.error || result.status !== 0) return null;
	return result.stdout.trim();
}
function baseState(task: TaskSpec): RunState { return task.kind === "implementation" ? "implementing" : "researching"; }
function taskRow(db: Database): TaskRow {
	const row = db.query("SELECT * FROM task WHERE singleton = 1").get() as TaskRow | null;
	return row ?? fail("NOT_FOUND", "task does not exist");
}
function turns(db: Database): TurnRow[] { return db.query("SELECT * FROM turns ORDER BY seq").all() as TurnRow[]; }
function uncertain(db: Database, reason: string): void {
	db.query("UPDATE turns SET state = 'uncertain', error = $reason WHERE state IN ('dispatching', 'acknowledged')").run({ reason });
}
function recover(db: Database): TaskRow {
	let row = taskRow(db);
	if (row.owner_token && ownerAlive(row) !== false) return row;
	const inflight = turns(db).some((turn) => turn.state === "dispatching" || turn.state === "acknowledged");
	if (row.owner_token || inflight) {
		uncertain(db, "dispatch owner terminated; native submission may have happened; never automatically replay");
		db.query(`UPDATE task SET owner_token = NULL, owner_pid = NULL, owner_identity = NULL, owner_host = NULL,
			owner_boot = NULL, owner_purpose = NULL, lease_until = NULL, state = $state WHERE singleton = 1`).run({
			state: row.stop_requested ? "stopped" : inflight ? "interrupted" : row.state,
		});
		row = taskRow(db);
	}
	return row;
}
function nativeResult(value: NativeResult): NativeResult {
	const result = object(value, "native result");
	if (typeof result.completed !== "boolean" || typeof result.acknowledged !== "boolean" || typeof result.text !== "string") fail("NATIVE_PROTOCOL", "native completion fields are invalid");
	if (result.sessionId !== null) text(result.sessionId, "native session id");
	if (result.model !== null) text(result.model, "native model");
	if (result.usage !== null) {
		const usage = object(result.usage, "native usage");
		if (Object.values(usage).some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0)) fail("NATIVE_PROTOCOL", "native usage must contain observed nonnegative counters");
	}
	return value;
}

/** One database per task; every ordinary operation closes its connection. No fleet/default state path. */
export class SummonStore {
	readonly stateDir: string;
	constructor(stateDir: string) { this.stateDir = resolve(text(stateDir, "state directory")); }
	private path(runId: string): string { return join(this.stateDir, `${hash(text(runId, "run id"))}.sqlite3`); }
	private open(runId: string, writable: boolean, create = false): Database {
		const path = this.path(runId);
		if (!create && !existsSync(path)) fail("NOT_FOUND", `unknown task ${runId}`);
		if (create) mkdirSync(this.stateDir, { recursive: true, mode: 0o700 });
		const db = new Database(path, { create, readonly: !writable, strict: true });
		try {
			db.exec("PRAGMA busy_timeout = 5000");
			if (writable) db.exec("PRAGMA synchronous = FULL");
			if (create) {
				db.transaction(() => {
					// SQLite owns the pragma row shape; the value is checked before schema access.
					const schema = db.query("PRAGMA user_version").get() as { user_version: number };
					const version = schema.user_version;
					if (version !== 0 && version !== SCHEMA_VERSION) fail("SCHEMA_MISMATCH", "unsupported summon task schema");
					db.exec(`CREATE TABLE IF NOT EXISTS task (
						singleton INTEGER PRIMARY KEY CHECK(singleton = 1), run_id TEXT NOT NULL,
						manifest TEXT NOT NULL, manifest_hash TEXT NOT NULL, generation INTEGER NOT NULL,
						state TEXT NOT NULL, session_id TEXT, stop_requested INTEGER NOT NULL DEFAULT 0,
						owner_token TEXT, owner_pid INTEGER, owner_identity TEXT, owner_host TEXT, owner_boot TEXT,
						owner_purpose TEXT, lease_until INTEGER
					);
					CREATE TABLE IF NOT EXISTS turns (
						seq INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL UNIQUE,
						text TEXT NOT NULL, text_hash TEXT NOT NULL, state TEXT NOT NULL,
						session_id TEXT, acknowledged_at INTEGER, result TEXT, error TEXT, reconciliation TEXT
					);
					CREATE TABLE IF NOT EXISTS proofs (
						check_id TEXT PRIMARY KEY, digest TEXT NOT NULL, verdict TEXT NOT NULL, evidence TEXT NOT NULL
					);
					CREATE TRIGGER IF NOT EXISTS immutable_manifest BEFORE UPDATE OF run_id, manifest, manifest_hash ON task
					BEGIN SELECT RAISE(ABORT, 'immutable task manifest'); END;
					CREATE TRIGGER IF NOT EXISTS immutable_request BEFORE UPDATE OF request_id, text, text_hash, seq ON turns
					BEGIN SELECT RAISE(ABORT, 'immutable request'); END;
					PRAGMA user_version = ${SCHEMA_VERSION};`);
				}).immediate();
				chmodSync(path, 0o600);
			}
			const schema = db.query("PRAGMA user_version").get() as { user_version: number };
			const version = schema.user_version;
			if (version !== SCHEMA_VERSION) fail("SCHEMA_MISMATCH", "unsupported summon task schema");
			return db;
		} catch (error) { db.close(); throw error; }
	}
	private using<T>(runId: string, writable: boolean, fn: (db: Database) => T, create = false): T {
		const db = this.open(runId, writable, create);
		try { return fn(db); } finally { db.close(); }
	}
	private snapshot(db: Database, verifyProof = true): RunSnapshot {
		const row = taskRow(db);
		const task = JSON.parse(row.manifest) as TaskSpec;
		const alive = row.owner_token ? ownerAlive(row) : false;
		const values = turns(db).map((turn): TurnSnapshot => ({
			sequence: turn.seq, requestId: turn.request_id, text: turn.text,
			state: alive === false && (turn.state === "dispatching" || turn.state === "acknowledged") ? "uncertain" : turn.state,
			sessionId: turn.session_id, acknowledged: turn.acknowledged_at !== null,
			result: turn.result ? JSON.parse(turn.result) : null, error: turn.error,
			reconciliation: turn.reconciliation ? JSON.parse(turn.reconciliation) : null,
		}));
		let state = row.state;
		if (row.stop_requested || state === "stopped") state = "stopped";
		else if (values.some((turn) => turn.state === "uncertain" || turn.state === "failed")) state = "interrupted";
		else if (values.some((turn) => turn.state !== "answered")) state = state === "waiting_input" && !row.owner_token ? "waiting_input" : baseState(task);
		else state = state === "verified_delivery" ? state : "awaiting_review";
		const snapshot: RunSnapshot = {
			runId: row.run_id, task, manifestHash: row.manifest_hash, generation: row.generation, state,
			sessionId: row.session_id,
			owner: row.owner_token ? { pid: row.owner_pid!, purpose: row.owner_purpose!, leaseUntil: row.lease_until!, alive } : null,
			turns: values,
		};
		return verifyProof && snapshot.state === "verified_delivery" ? this.inspectDb(db, snapshot) : snapshot;
	}
	private inspectDb(db: Database, snapshot = this.snapshot(db, false)): DeliveryInspection {
		const outputs = snapshot.task.outputs.map((path) => inspectOutput(snapshot.task.workspace, path));
		const head = gitHead(snapshot.task.workspace);
		const deliveryDigest = hash(canonical({
			manifestHash: snapshot.manifestHash, generation: snapshot.generation, head, outputs,
			turns: snapshot.turns.map(({ sequence, requestId, text, state, sessionId, acknowledged, result, reconciliation }) => ({ sequence, requestId, text, state, sessionId, acknowledged, result, reconciliation })),
		}));
		const readyForReview = snapshot.state !== "stopped" && !snapshot.owner && snapshot.turns.length > 0 && snapshot.turns.every((turn) => turn.state === "answered") && outputs.every((output) => output.sha256 !== null);
		const proofs = db.query("SELECT * FROM proofs").all() as ProofRow[];
		const checks = snapshot.task.checks.map((check) => {
			const proof = proofs.find((proof) => proof.check_id === check.id && proof.digest === deliveryDigest);
			return { id: check.id, type: check.type, status: readyForReview && proof ? proof.verdict : "pending" as const, evidence: proof ? JSON.parse(proof.evidence) : null };
		});
		if (snapshot.state === "verified_delivery" && (!readyForReview || checks.length === 0 || checks.some((check) => check.status !== "pass"))) snapshot.state = "awaiting_review";
		return { ...snapshot, deliveryDigest, head, outputs, readyForReview, checks };
	}
	private recordDeliveryState(db: Database): void {
		const inspected = this.inspectDb(db);
		if (!inspected.readyForReview) return;
		const state = inspected.checks.length > 0 && inspected.checks.every((check) => check.status === "pass") ? "verified_delivery" : "awaiting_review";
		db.query("UPDATE task SET state = $state WHERE singleton = 1").run({ state });
	}
	start(value: unknown): RunSnapshot {
		const task = validateTaskSpec(value);
		const manifest = canonical(task);
		const manifestHash = hash(manifest);
		return this.using(task.id, true, (db) => {
			db.transaction(() => {
				const existing = db.query("SELECT * FROM task WHERE singleton = 1").get() as TaskRow | null;
				if (existing) {
					if (existing.manifest_hash !== manifestHash || existing.manifest !== manifest) fail("START_CONFLICT", "task id already has a different immutable manifest");
					return;
				}
				db.query("INSERT INTO task (singleton, run_id, manifest, manifest_hash, generation, state) VALUES (1, $id, $manifest, $manifestHash, 1, $state)").run({ id: task.id, manifest, manifestHash, state: baseState(task) });
				db.query("INSERT INTO turns (request_id, text, text_hash, state) VALUES ('start', $brief, $textHash, 'queued')").run({ brief: task.brief, textHash: hash(task.brief) });
			}).immediate();
			return this.snapshot(db);
		}, true);
	}
	/** No creation, recovery writes, leases, task checks or model dispatch. */
	status(runId: string): RunSnapshot {
		return this.using(runId, false, (db) => db.transaction(() => this.snapshot(db)).deferred());
	}
	inspect(runId: string): DeliveryInspection { return this.using(runId, false, (db) => db.transaction(() => this.inspectDb(db)).deferred()); }
	say(runId: string, requestId: string, message: string): RunSnapshot {
		text(requestId, "request id"); text(message, "message");
		return this.using(runId, true, (db) => {
			db.transaction(() => {
				const existing = db.query("SELECT text, text_hash FROM turns WHERE request_id = $requestId").get({ requestId }) as { text: string; text_hash: string } | null;
				if (existing) {
					if (existing.text !== message || existing.text_hash !== hash(message)) fail("SAY_CONFLICT", "request id already has different text");
					return;
				}
				const row = recover(db);
				const task = JSON.parse(row.manifest) as TaskSpec;
				db.query("INSERT INTO turns (request_id, text, text_hash, state) VALUES ($requestId, $message, $textHash, 'queued')").run({ requestId, message, textHash: hash(message) });
				db.query("DELETE FROM proofs").run();
				db.query("UPDATE task SET generation = generation + 1, state = $state WHERE singleton = 1").run({ state: row.stop_requested ? "stopped" : baseState(task) });
			}).immediate();
			return this.snapshot(db);
		});
	}
	private acquire(db: Database, purpose: string, external?: AbortSignal, prepare?: (row: TaskRow) => void): Lease {
		const token = randomUUID();
		// Commit orphan classification even when the following dispatch/readiness guard refuses.
		db.transaction(() => recover(db)).immediate();
		db.transaction(() => {
			const row = taskRow(db);
			if (row.owner_token) fail("BUSY", `task is owned by process ${row.owner_pid}; live owners are never replaced merely because a lease expires`);
			prepare?.(row);
			db.query(`UPDATE task SET owner_token = $token, owner_pid = $pid, owner_identity = $identity,
				owner_host = $host, owner_boot = $boot, owner_purpose = $purpose, lease_until = $until WHERE singleton = 1`).run({
				token, pid: process.pid, identity: processIdentity(process.pid), host: HOST, boot: BOOT, purpose, until: Date.now() + LEASE_MS,
			});
		}).immediate();
		const controller = new AbortController();
		const cancel = () => controller.abort(external?.reason ?? new SummonError("CANCELED", "operation canceled"));
		if (external?.aborted) cancel(); else external?.addEventListener("abort", cancel, { once: true });
		const pulse = () => {
			try {
				const row = taskRow(db);
				if (row.owner_token !== token) controller.abort(new SummonError("OWNERSHIP_LOST", "task ownership changed"));
				else if (row.stop_requested) controller.abort(new SummonError("CANCELED", "stop requested"));
				else db.query("UPDATE task SET lease_until = $until WHERE owner_token = $token").run({ until: Date.now() + LEASE_MS, token });
			} catch (error) { controller.abort(error); }
		};
		const timer = setInterval(pulse, 100);
		return {
			token, signal: controller.signal,
			release() {
				clearInterval(timer); external?.removeEventListener("abort", cancel);
				db.query(`UPDATE task SET owner_token = NULL, owner_pid = NULL, owner_identity = NULL,
					owner_host = NULL, owner_boot = NULL, owner_purpose = NULL, lease_until = NULL WHERE owner_token = $token`).run({ token });
			},
		};
	}
	private assertOwner(db: Database, lease: Lease): TaskRow {
		const row = taskRow(db);
		if (row.owner_token !== lease.token) fail("OWNERSHIP_LOST", "task ownership changed");
		return row;
	}
	/** Dispatches only the oldest queued-safe request. An uncertain predecessor always blocks. */
	async run(runId: string, adapter: NativeAdapter, options: { signal?: AbortSignal } = {}): Promise<RunSnapshot> {
		const db = this.open(runId, true);
		let lease: Lease | undefined;
		let requestId: string | undefined;
		let dispatched = false;
		try {
			lease = this.acquire(db, "run", options.signal, (row) => {
				const task = JSON.parse(row.manifest) as TaskSpec;
				if (adapter.id !== task.route.harness) fail("UNSUPPORTED_ROUTE", "native adapter does not match task harness");
				if (turns(db).some((turn) => ["uncertain", "dispatching", "acknowledged", "failed"].includes(turn.state))) fail("RECONCILIATION_REQUIRED", "an ambiguous native turn blocks dispatch; never resend it automatically");
				db.query("UPDATE task SET stop_requested = 0, state = $state WHERE singleton = 1").run({ state: baseState(task) });
			});
			const activeLease = lease;
			const row = this.assertOwner(db, lease);
			const task = JSON.parse(row.manifest) as TaskSpec;
			const queued = db.query("SELECT * FROM turns WHERE state = 'queued' ORDER BY seq LIMIT 1").get() as TurnRow | null;
			if (!queued) {
				db.query("UPDATE task SET state = CASE WHEN stop_requested = 1 THEN 'stopped' ELSE 'awaiting_review' END WHERE singleton = 1").run();
				lease.release(); lease = undefined;
				this.recordDeliveryState(db);
				return this.snapshot(db);
			}
			requestId = queued.request_id;
			if (turns(db).some((turn) => turn.state === "answered") && (!row.session_id || !adapter.capabilities.resume)) fail("SESSION_UNAVAILABLE", "continuing this task requires its observed native session and a resume-capable adapter");
			if (lease.signal.aborted) throw lease.signal.reason;
			await adapter.preflight(task);
			db.transaction(() => {
				if (activeLease.signal.aborted || this.assertOwner(db, activeLease).stop_requested) fail("CANCELED", "dispatch canceled before native submission");
				db.query("UPDATE turns SET state = 'dispatching', error = NULL WHERE request_id = $requestId AND state = 'queued'").run({ requestId: requestId! });
			}).immediate();
			dispatched = true;
			let eventError: unknown;
			const onEvent = (event: NativeEvent) => {
				try {
					db.transaction(() => {
						const current = this.assertOwner(db, activeLease);
						if (event.requestId && event.requestId !== requestId) fail("NATIVE_PROTOCOL", "native acknowledgement belongs to another request");
						if (!["session", "acknowledged", "activity"].includes(event.type)) fail("NATIVE_PROTOCOL", "unknown native event");
						if (event.sessionId !== undefined) {
							text(event.sessionId, "native session id");
							if (current.session_id && current.session_id !== event.sessionId) fail("NATIVE_PROTOCOL", "native session identity changed");
							db.query("UPDATE task SET session_id = $session WHERE singleton = 1").run({ session: event.sessionId });
							db.query("UPDATE turns SET session_id = $session WHERE request_id = $requestId").run({ session: event.sessionId, requestId: requestId! });
						}
						if (event.type === "acknowledged") db.query("UPDATE turns SET state = 'acknowledged', acknowledged_at = $now WHERE request_id = $requestId").run({ now: Date.now(), requestId: requestId! });
					}).immediate();
				} catch (error) { eventError = error; }
			};
			const result = nativeResult(await adapter.invoke({ runId, requestId, text: queued.text, sessionId: row.session_id, task }, onEvent, lease.signal));
			if (eventError) throw eventError;
			db.transaction(() => {
				const current = this.assertOwner(db, activeLease);
				if (result.sessionId && current.session_id && result.sessionId !== current.session_id) fail("NATIVE_PROTOCOL", "native result changed session identity");
				const session = result.sessionId ?? current.session_id;
				const complete = result.completed && result.acknowledged;
				db.query(`UPDATE turns SET state = $state, session_id = $session, result = $result,
					acknowledged_at = CASE WHEN $ack = 1 THEN COALESCE(acknowledged_at, $now) ELSE acknowledged_at END,
					error = $error WHERE request_id = $requestId`).run({
					state: complete ? "answered" : "uncertain", session, result: canonical({ ...result, sessionId: session }), ack: result.acknowledged ? 1 : 0,
					now: Date.now(), error: complete ? null : "native turn ended without an acknowledged final answer", requestId: requestId!,
				});
				db.query("UPDATE task SET session_id = $session, state = $state WHERE singleton = 1").run({
					session, state: current.stop_requested ? "stopped" : !complete ? "interrupted" : turns(db).some((turn) => turn.state === "queued") ? baseState(task) : "awaiting_review",
				});
			}).immediate();
			if (!result.completed || !result.acknowledged) fail("UNCERTAIN", "native turn may have been delivered; explicit reconciliation is required");
			lease.release(); lease = undefined;
			return this.snapshot(db);
		} catch (error) {
			if (lease) db.transaction(() => {
				const row = this.assertOwner(db, lease!);
				if (requestId) db.query("UPDATE turns SET state = $state, error = $error WHERE request_id = $requestId AND state != 'answered'").run({ state: dispatched ? "uncertain" : "queued", error: error instanceof Error ? error.message : String(error), requestId });
				db.query("UPDATE task SET state = $state WHERE singleton = 1").run({ state: row.stop_requested ? "stopped" : dispatched ? "interrupted" : requestId ? "waiting_input" : row.state });
			}).immediate();
			throw error;
		} finally { try { lease?.release(); } finally { db.close(); } }
	}
	async stop(runId: string, options: { timeoutMs?: number } = {}): Promise<RunSnapshot> {
		const db = this.open(runId, true);
		try {
			const target = db.transaction(() => {
				const row = recover(db);
				db.query("UPDATE task SET stop_requested = 1, state = 'stopped' WHERE singleton = 1").run();
				return row.owner_token;
			}).immediate();
			const deadline = Date.now() + (options.timeoutMs ?? 30_000);
			for (;;) {
				const row = db.transaction(() => recover(db)).immediate();
				if (!target || row.owner_token !== target) return this.snapshot(db);
				if (Date.now() >= deadline) fail("STOP_PENDING", "stop is persisted; owner cleanup has not yet completed, and no process was blindly killed");
				await Bun.sleep(25);
			}
		} finally { db.close(); }
	}
	async check(runId: string, options: { signal?: AbortSignal } = {}): Promise<DeliveryInspection> {
		const db = this.open(runId, true);
		let lease: Lease | undefined;
		try {
			let initial!: DeliveryInspection;
			lease = this.acquire(db, "check", options.signal, () => {
				initial = this.inspectDb(db);
				if (!initial.readyForReview) fail("CHECK_NOT_READY", "checks require completed turns and present workspace outputs, with no active owner or stop");
			});
			for (const check of initial.task.checks) {
				if (check.type !== "command") continue;
				if (lease.signal.aborted) throw lease.signal.reason;
				const before = db.transaction(() => {
					const current = this.inspectDb(db);
					if (current.state === "stopped" || current.turns.some((turn) => turn.state !== "answered") || current.outputs.some((output) => output.sha256 === null)) fail("CHECK_NOT_READY", "delivery changed before this command check");
					return current.deliveryDigest;
				}).deferred();
				const detail = await command(check.argv, initial.task.workspace, lease.signal);
				const stable = db.transaction(() => {
					this.assertOwner(db, lease!);
					const after = this.inspectDb(db).deliveryDigest;
					const stable = before === after;
					db.query("INSERT INTO proofs (check_id, digest, verdict, evidence) VALUES ($id, $digest, $verdict, $evidence) ON CONFLICT(check_id) DO UPDATE SET digest = excluded.digest, verdict = excluded.verdict, evidence = excluded.evidence").run({
						id: check.id, digest: before, verdict: detail.exitCode === 0 && !detail.aborted && stable ? "pass" : "block",
						evidence: canonical({ argv: check.argv, ...detail, stable, error: stable ? detail.error : "delivery changed while check ran" }),
					});
					return stable;
				}).immediate();
				if (lease.signal.aborted) throw lease.signal.reason;
				if (!stable) fail("CHECK_STALE", "manifest, steering, HEAD or outputs changed while the command check ran; no passing proof was recorded");
			}
			lease.release(); lease = undefined;
			db.transaction(() => this.recordDeliveryState(db)).immediate();
			return this.inspectDb(db);
		} finally { try { lease?.release(); } finally { db.close(); } }
	}
	review(value: unknown): DeliveryInspection {
		const receipt = object(value, "review receipt");
		fields(receipt, ["runId", "checkId", "deliveryDigest", "verdict", "reviewer", "evidence"], "review receipt");
		const runId = text(receipt.runId, "run id");
		const checkId = text(receipt.checkId, "check id");
		if (receipt.verdict !== "pass" && receipt.verdict !== "block") fail("INVALID_INPUT", "review verdict must be pass or block");
		const normalized: ReviewReceipt = { runId, checkId, deliveryDigest: text(receipt.deliveryDigest, "delivery digest"), verdict: receipt.verdict, reviewer: reviewerIdentity(receipt.reviewer), evidence: evidence(receipt.evidence) };
		return this.using(runId, true, (db) => {
			db.transaction(() => {
				const row = recover(db);
				if (row.owner_token) fail("BUSY", "review cannot be imported during an owned operation");
				const inspected = this.inspectDb(db);
				if (!inspected.task.checks.some((check) => check.id === checkId && check.type === "review")) fail("UNKNOWN_REVIEW", "receipt must name a commissioner-supplied review criterion");
				if (normalized.deliveryDigest !== inspected.deliveryDigest) fail("STALE_REVIEW", "receipt does not match current manifest, turns, HEAD and output contents");
				if (!inspected.readyForReview) fail("REVIEW_NOT_READY", "review requires completed turns and present outputs");
				db.query("INSERT INTO proofs (check_id, digest, verdict, evidence) VALUES ($id, $digest, $verdict, $evidence) ON CONFLICT(check_id) DO UPDATE SET digest = excluded.digest, verdict = excluded.verdict, evidence = excluded.evidence").run({ id: checkId, digest: inspected.deliveryDigest, verdict: normalized.verdict, evidence: canonical(normalized) });
				this.recordDeliveryState(db);
			}).immediate();
			return this.inspectDb(db);
		});
	}
	reconcile(value: unknown): RunSnapshot {
		const receipt = object(value, "reconciliation");
		fields(receipt, ["runId", "requestId", "sessionId", "completed", "text", "reviewer", "evidence"], "reconciliation");
		if (receipt.completed !== true || typeof receipt.text !== "string") fail("INVALID_INPUT", "reconciliation requires an observed completed native answer");
		const normalized: Reconciliation = {
			runId: text(receipt.runId, "run id"), requestId: text(receipt.requestId, "request id"), sessionId: text(receipt.sessionId, "native session id"),
			completed: true, text: receipt.text, reviewer: reviewerIdentity(receipt.reviewer), evidence: evidence(receipt.evidence),
		};
		return this.using(normalized.runId, true, (db) => {
			db.transaction(() => {
				const row = recover(db);
				if (row.owner_token) fail("BUSY", "cannot reconcile an owned operation");
				const turn = db.query("SELECT * FROM turns WHERE request_id = $requestId").get({ requestId: normalized.requestId }) as TurnRow | null;
				if (turn?.reconciliation === canonical(normalized)) return;
				if (!turn || turn.state !== "uncertain" || turn.acknowledged_at === null || !turn.session_id || turn.session_id !== normalized.sessionId || row.session_id !== normalized.sessionId) fail("RECONCILIATION_REFUSED", "only an uncertain, natively acknowledged request in its observed native session can be reconciled");
				const observed = turn.result ? nativeResult(JSON.parse(turn.result)) : null;
				const result: NativeResult = { sessionId: normalized.sessionId, completed: true, acknowledged: true, text: normalized.text, model: observed?.model ?? null, usage: observed?.usage ?? null };
				db.query("UPDATE turns SET state = 'answered', result = $result, reconciliation = $receipt, error = NULL WHERE request_id = $requestId").run({ result: canonical(result), receipt: canonical(normalized), requestId: normalized.requestId });
				db.query("DELETE FROM proofs").run();
				db.query("UPDATE task SET state = $state WHERE singleton = 1").run({ state: row.stop_requested ? "stopped" : turns(db).every((turn) => turn.state === "answered") ? "awaiting_review" : baseState(JSON.parse(row.manifest)) });
			}).immediate();
			return this.snapshot(db);
		});
	}
}

interface CommandEvidence { exitCode: number | null; signal: string | null; aborted: boolean; stdout: string; stderr: string; stdoutHash: string; stderrHash: string; error: string | null }
/** argv only. Cancellation kills the owned process group and waits for stdio/process cleanup. */
async function command(argv: string[], workspace: string, signal: AbortSignal): Promise<CommandEvidence> {
	if (signal.aborted) throw signal.reason;
	const { promise, resolve: finish } = Promise.withResolvers<CommandEvidence>();
	const child = spawn(argv[0]!, argv.slice(1), { cwd: workspace, shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
	const out = createHash("sha256"), err = createHash("sha256");
	let stdout = "", stderr = "", error: string | null = null;
	let escalation: NodeJS.Timeout | undefined;
	const kill = (name: NodeJS.Signals) => {
		if (!child.pid) return;
		try { if (process.platform !== "win32") process.kill(-child.pid, name); else child.kill(name); }
		catch (failure) { if (errorCode(failure) !== "ESRCH") child.kill(name); }
	};
	const cancel = () => { kill("SIGTERM"); escalation = setTimeout(() => kill("SIGKILL"), 1_000); };
	child.stdout.on("data", (chunk: Buffer) => { out.update(chunk); if (stdout.length < 16_384) stdout += chunk.toString().slice(0, 16_384 - stdout.length); });
	child.stderr.on("data", (chunk: Buffer) => { err.update(chunk); if (stderr.length < 16_384) stderr += chunk.toString().slice(0, 16_384 - stderr.length); });
	child.on("error", (failure) => { error = failure.message; });
	child.on("close", (exitCode, exitSignal) => {
		signal.removeEventListener("abort", cancel);
		clearTimeout(escalation);
		if (signal.aborted) kill("SIGKILL");
		finish({ exitCode, signal: exitSignal, aborted: signal.aborted, stdout, stderr, stdoutHash: out.digest("hex"), stderrHash: err.digest("hex"), error });
	});
	signal.addEventListener("abort", cancel, { once: true });
	if (signal.aborted) cancel();
	return await promise;
}
