import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { object } from "../lib/t3-rpc.ts";

setDefaultTimeout(30_000);

const roots: string[] = [];
const servers: ReturnType<typeof Bun.serve>[] = [];
const databases: Database[] = [];
const token = "synthetic-pool-bearer-never-print";
const cli = join(import.meta.dir, "t3-pool.ts");
const future = "2099-01-01T00:00:00.000Z";
const past = "2000-01-01T00:00:00.000Z";
const recent = new Date(Date.now() - 60_000).toISOString();
const later = new Date(Date.now() - 30_000).toISOString();

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "t3-pool-"));
	roots.push(root);
	for (const dir of ["bin", "userdata", "config"]) mkdirSync(join(root, dir));
	writeFileSync(join(root, "config/t3-pool.json"), JSON.stringify({ pools: [["claudeAgent", "claude-hello", "claude-r90", "claude-mistystep"], ["codex", "codex-mistystep", "codex-r90"]], reserved: [], maxMovesPerPass: 2 }));
	writeFileSync(join(root, "bin/t3"), `#!${process.execPath}
import { appendFileSync, writeFileSync } from "node:fs";
const root = process.env.T3CODE_HOME;
const args = process.argv.slice(2);
appendFileSync(root + "/auth-calls", JSON.stringify(args) + "\\n");
if (args[2] === "issue") console.log(JSON.stringify({ sessionId: "pool-session", token: ${JSON.stringify(token)} }));
else if (args[2] === "revoke") writeFileSync(root + "/revoked", args[3]);
else process.exit(1);
`, { mode: 0o700 });
	const db = new Database(join(root, "userdata/statev2.sqlite"));
	databases.push(db);
	db.exec(`
PRAGMA journal_mode=MEMORY;
PRAGMA synchronous=OFF;
CREATE TABLE orchestration_v2_projection_threads (thread_id TEXT PRIMARY KEY, provider_instance_id TEXT, deleted_at TEXT, payload_json TEXT);
CREATE TABLE orchestration_v2_projection_runs (run_id TEXT PRIMARY KEY, thread_id TEXT, ordinal INTEGER, provider_instance_id TEXT, status TEXT, completed_at TEXT, payload_json TEXT);
CREATE TABLE orchestration_v2_projection_turn_items (turn_item_id TEXT PRIMARY KEY, thread_id TEXT, run_id TEXT, node_id TEXT, ordinal INTEGER, type TEXT, status TEXT, updated_at TEXT, payload_json TEXT);
CREATE TABLE orchestration_v2_projection_runtime_requests (thread_id TEXT, status TEXT);
CREATE TABLE orchestration_v2_projection_provider_session_bindings (thread_id TEXT, provider_session_id TEXT);
CREATE TABLE orchestration_v2_projection_provider_sessions (provider_session_id TEXT, provider_instance_id TEXT, updated_at TEXT, payload_json TEXT);
CREATE TABLE orchestration_command_receipts (command_id TEXT PRIMARY KEY, status TEXT);
CREATE TABLE orchestration_v2_projection_subagents (child_thread_id TEXT, status TEXT);
`);
	const env = { ...process.env, T3CODE_HOME: root, XDG_STATE_HOME: join(root, "state"), XDG_CONFIG_HOME: join(root, "config"), PATH: `${root}/bin:${process.env.PATH}` };
	return { root, db, env };
}
type Fixture = ReturnType<typeof fixture>;

function thread(files: Fixture, id = "limited", instance = "claudeAgent", options: {
	resetAt?: string | null; failureClass?: string; status?: string; archivedAt?: string | null;
	deletedAt?: string | null; settledOverride?: string | null; parentThreadId?: string | null; failedAt?: string;
} = {}) {
	const selection = { instanceId: instance, model: "model-original", options: [
		{ id: "reasoningEffort", value: "max" }, { id: "fastMode", value: true },
	] };
	files.db.run("INSERT INTO orchestration_v2_projection_threads VALUES (?, ?, ?, ?)", [id, instance, options.deletedAt ?? null, JSON.stringify({
		id, providerInstanceId: instance, modelSelection: selection, runtimeMode: "full-access", lineage: { parentThreadId: options.parentThreadId ?? null },
		archivedAt: options.archivedAt ?? null, deletedAt: options.deletedAt ?? null, settledOverride: options.settledOverride ?? null,
	})]);
	run(files, id, `${id}:run`, { status: options.status ?? "failed", instance });
	error(files, id, `${id}:run`, { failureClass: options.failureClass ?? "usage_limit", resetAt: options.resetAt === undefined ? future : options.resetAt, updatedAt: options.failedAt });
	return selection;
}

function run(files: Fixture, threadId: string, runId: string, options: { status?: string; instance?: string; ordinal?: number; completedAt?: string | null; startedAt?: string | null } = {}) {
	files.db.run("INSERT INTO orchestration_v2_projection_runs VALUES (?, ?, ?, ?, ?, ?, ?)", [
		runId, threadId, options.ordinal ?? 1, options.instance ?? "claudeAgent", options.status ?? "failed",
		options.completedAt === undefined ? recent : options.completedAt,
		JSON.stringify({ rootNodeId: `${runId}:root`, startedAt: options.startedAt === undefined ? recent : options.startedAt }),
	]);
}

function error(files: Fixture, threadId: string, runId: string, options: { node?: string; failureClass?: string; resetAt?: string | null; ordinal?: number; updatedAt?: string } = {}) {
	const ordinal = options.ordinal ?? 1;
	files.db.run("INSERT INTO orchestration_v2_projection_turn_items VALUES (?, ?, ?, ?, ?, 'error', 'failed', ?, ?)", [
		`${runId}:error:${ordinal}`, threadId, runId, options.node ?? `${runId}:root`, ordinal,
		options.updatedAt ?? recent, JSON.stringify({ failure: { class: options.failureClass ?? "usage_limit", resetAt: options.resetAt === undefined ? future : options.resetAt, message: "synthetic limit" } }),
	]);
}

function server(files: Fixture, hook: (command: Record<string, unknown>, index: number) => "success" | "failure" | "close" | "wait" = () => "success") {
	const commands: Record<string, unknown>[] = [];
	const applied = new Set<string>();
	let notify = () => {};
	const ready = new Promise<void>((accept) => { notify = accept; });
	const server = Bun.serve({
		hostname: "127.0.0.1", port: 0,
		fetch(request, server) {
			expect(request.headers.get("authorization")).toBe(`Bearer ${token}`);
			expect(new URL(request.url).searchParams.get("orchestrationProtocol")).toBe("2");
			if (server.upgrade(request)) return;
			return new Response("Bad upgrade", { status: 400 });
		},
		websocket: {
			message(socket, data) {
				const frame = object(JSON.parse(String(data)));
				if (frame._tag !== "Request") return;
				expect(frame.tag).toBe("orchestration.dispatchCommand");
				const command = object(frame.payload);
				commands.push(command);
				const receipt = files.db.query("SELECT status FROM orchestration_command_receipts WHERE command_id = ?").get(String(command.commandId));
				const response = receipt !== null && object(receipt).status === "rejected" ? "failure" : hook(command, commands.length);
				if (response === "wait") { notify(); return; }
				files.db.run("INSERT OR IGNORE INTO orchestration_command_receipts VALUES (?, ?)", [String(command.commandId), response === "failure" ? "rejected" : "accepted"]);
				if (response !== "failure" && !applied.has(String(command.commandId))) {
					if (command.type === "provider.switch") {
						const selection = object(command.modelSelection);
						files.db.run(`UPDATE orchestration_v2_projection_threads SET provider_instance_id = ?,
 payload_json = json_set(payload_json, '$.providerInstanceId', ?, '$.modelSelection', json(?)) WHERE thread_id = ?`,
							[String(selection.instanceId), String(selection.instanceId), JSON.stringify(selection), String(command.threadId)]);
					} else if (command.type === "message.dispatch") {
						// Model the real server's continuation contract, including the
						// automatic guard that silently refuses cross-account recovery.
						expect(command.usageLimitContinuationOfRunId).toBeUndefined();
						expect(command.manualContinuationOfRunId).toBe(`${command.threadId}:run`);
						expect(command).toMatchObject({ text: "Continue where you left off.", attachments: [], dispatchMode: { type: "start_immediately" }, createdBy: "user", creationSource: "server" });
					}
					applied.add(String(command.commandId));
				}
				if (response === "close") { socket.close(); return; }
				socket.send(JSON.stringify({ _tag: "Exit", requestId: frame.id, exit: response === "failure"
					? { _tag: "Failure", cause: { message: token } } : { _tag: "Success", value: { sequence: commands.length } } }));
			},
		},
	});
	servers.push(server);
	writeFileSync(join(files.root, "userdata/server-runtime.json"), JSON.stringify({ origin: server.url.origin }));
	return { commands, ready, applied };
}

function start(files: Fixture, args: string[] = []) {
	return Bun.spawn({ cmd: [process.execPath, cli, ...args], env: files.env, stdout: "pipe", stderr: "pipe" });
}

async function result(child: ReturnType<typeof start>) {
	const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	expect(stdout + stderr).not.toContain(token);
	return { stdout, stderr, status };
}

function state(files: Fixture) { return JSON.parse(readFileSync(join(files.root, "state/t3-pool/state.json"), "utf8")); }
function logs(files: Fixture) { return readFileSync(join(files.root, "state/t3-pool/moves.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line)); }

afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true);
	for (const db of databases.splice(0)) db.close();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("dry run reads a fixture database without auth, state, log or database writes", async () => {
	const files = fixture();
	thread(files);
	const before = readFileSync(join(files.root, "userdata/statev2.sqlite"));
	const output = await result(start(files, ["--dry-run"]));
	expect(output.status).toBe(0);
	expect(JSON.parse(output.stdout.split("\n")[0])).toMatchObject({ dryRun: true, thread: "limited", from: "claudeAgent", to: "claude-hello", run: "limited:run", reason: expect.any(String) });
	expect(existsSync(join(files.root, "auth-calls"))).toBe(false);
	expect(existsSync(join(files.root, "state"))).toBe(false);
	expect(readFileSync(join(files.root, "userdata/statev2.sqlite"))).toEqual(before);
});

test("switches then continues once, preserving model options and runtime mode, and always revokes", async () => {
	const files = fixture();
	const selection = thread(files);
	const fake = server(files);
	expect((await result(start(files))).status).toBe(0);
	expect(fake.commands.map((command) => command.type)).toEqual(["provider.switch", "message.dispatch"]);
	expect(fake.commands[0].modelSelection).toEqual({ ...selection, instanceId: "claude-hello" });
	const row = object(files.db.query("SELECT payload_json FROM orchestration_v2_projection_threads").get());
	expect(JSON.parse(String(row.payload_json)).runtimeMode).toBe("full-access");
	expect(readFileSync(join(files.root, "revoked"), "utf8")).toBe("pool-session");
	expect(state(files).moves[0].phase).toBe("done");
	expect(logs(files)).toEqual([{ at: expect.any(String), thread: "limited", from: "claudeAgent", to: "claude-hello", run: "limited:run" }]);
	expect(statSync(join(files.root, "state/t3-pool/state.json")).mode & 0o777).toBe(0o600);
	expect((await result(start(files))).status).toBe(0);
	expect(fake.commands).toHaveLength(2);
	expect(logs(files)).toHaveLength(1);
});

test("uses only the same pool, wraps the order, and treats unknown or malformed resets as limited", async () => {
	const files = fixture();
	thread(files, "claude", "claude-mistystep");
	thread(files, "blocked-claude", "claudeAgent", { resetAt: null, parentThreadId: "parent" });
	thread(files, "codex", "codex-r90");
	thread(files, "blocked-codex", "codex", { resetAt: "bad timestamp", parentThreadId: "parent" });
	const output = await result(start(files, ["--dry-run"]));
	expect(output.status).toBe(0);
	const plans = output.stdout.trim().split("\n").map((line) => JSON.parse(line));
	expect(plans.filter((row) => row.to).map(({ reason, ...row }) => row)).toEqual([
		{ dryRun: true, thread: "claude", from: "claude-mistystep", to: "claude-hello", run: "claude:run" },
		{ dryRun: true, thread: "codex", from: "codex-r90", to: "codex-mistystep", run: "codex:run" },
	]);
});

test("all instances limited leaves threads and auth alone, and expired failures use native recovery", async () => {
	const files = fixture();
	for (const instance of ["claudeAgent", "claude-hello", "claude-r90", "claude-mistystep"]) thread(files, instance, instance);
	thread(files, "expired", "codex", { resetAt: past });
	expect((await result(start(files))).stdout).toContain('"planned":0');
	expect(existsSync(join(files.root, "auth-calls"))).toBe(false);
	expect(existsSync(join(files.root, "state/t3-pool/moves.jsonl"))).toBe(false);
});

test("only latest executed root usage failures qualify; skips archives, deletions, settlement, approvals and queues", async () => {
	const files = fixture();
	thread(files, "archived", "claudeAgent", { archivedAt: past });
	thread(files, "deleted", "claudeAgent", { deletedAt: past });
	thread(files, "settled", "claudeAgent", { settledOverride: "settled" });
	thread(files, "other-error", "claudeAgent", { failureClass: "authentication" });
	thread(files, "running", "claude-r90", { status: "running" });
	thread(files, "pending");
	files.db.run("INSERT INTO orchestration_v2_projection_runtime_requests VALUES ('pending','pending')");
	thread(files, "queued");
	run(files, "queued", "queued:held", { ordinal: 2, status: "queued", completedAt: null });
	thread(files, "newer-success", "claude-r90");
	run(files, "newer-success", "success", { ordinal: 0, instance: "claude-r90", status: "completed", completedAt: later });
	thread(files, "child-error", "claudeAgent", { failureClass: "internal" });
	error(files, "child-error", "child-error:run", { node: "child", ordinal: 2 });
	thread(files, "superseded-error");
	error(files, "superseded-error", "superseded-error:run", { ordinal: 2, failureClass: "internal" });
	thread(files, "session-error");
	files.db.run("INSERT INTO orchestration_v2_projection_provider_session_bindings VALUES ('session-error','session')");
	files.db.run("INSERT INTO orchestration_v2_projection_provider_sessions VALUES ('session','claudeAgent',?,?)", [past, JSON.stringify({ lastError: "different failure" })]);
	thread(files, "valid");
	run(files, "valid", "cancelled-before-start", { ordinal: 2, status: "cancelled", startedAt: null, completedAt: later });
	const output = await result(start(files, ["--dry-run"]));
	expect(output.status).toBe(0);
	expect(plans(output).filter((row) => row.to).map((row) => row.thread)).toEqual(["valid"]);
});

for (const scenario of ["switch-rejected", "continue-rejected", "switch-ack-lost", "continue-ack-lost"] as const) {
	test(`recovers ${scenario} with the same target and receipt-aware command IDs`, async () => {
		const files = fixture();
		thread(files);
		let failed = false;
		const fake = server(files, (command) => {
			const selectedType = scenario.startsWith("switch") ? "provider.switch" : "message.dispatch";
			if (!failed && command.type === selectedType) { failed = true; return scenario.endsWith("lost") ? "close" : "failure"; }
			return "success";
		});
		expect((await result(start(files))).status).toBe(scenario.endsWith("lost") ? 1 : 0);
		expect(readFileSync(join(files.root, "revoked"), "utf8")).toBe("pool-session");
		expect((await result(start(files))).status).toBe(0);
		expect(new Set(fake.commands.filter((c) => c.type === "provider.switch").map((c) => c.commandId)).size).toBe(scenario === "switch-rejected" ? 2 : 1);
		expect(new Set(fake.commands.filter((c) => c.type === "message.dispatch").map((c) => c.commandId)).size).toBe(scenario === "continue-rejected" ? 2 : 1);
		expect(fake.applied.size).toBe(2);
		expect(state(files).moves[0].phase).toBe("done");
		expect(logs(files)).toHaveLength(1);
	});
}

test("clears recovered accounts and prunes obsolete handled runs", async () => {
	const files = fixture();
	thread(files);
	server(files);
	expect((await result(start(files))).status).toBe(0);
	files.db.run("UPDATE orchestration_v2_projection_runs SET status='completed'");
	thread(files, "another", "claude-mistystep");
	const output = await result(start(files, ["--dry-run"]));
	expect(JSON.parse(output.stdout.split("\n")[0]).to).toBe("claudeAgent");
	expect((await result(start(files))).status).toBe(0);
	expect(state(files).moves.map((move: { threadId: string }) => move.threadId)).toEqual(["another"]);
	expect(state(files).limits.claudeAgent).toBeUndefined();
});

test("a human provider, model or runtime change cancels a pending continuation", async () => {
	for (const patch of [{ providerInstanceId: "claude-r90" }, { model: "different-model" }, { runtimeMode: "approval-required" }]) {
		const files = fixture();
		thread(files);
		const fake = server(files, (command) => command.type === "message.dispatch" ? "failure" : "success");
		expect((await result(start(files))).status).toBe(0);
		if (patch.providerInstanceId) files.db.run("UPDATE orchestration_v2_projection_threads SET payload_json=json_set(payload_json,'$.modelSelection.instanceId',?,'$.providerInstanceId',?)", [patch.providerInstanceId, patch.providerInstanceId]);
		if (patch.model) files.db.run("UPDATE orchestration_v2_projection_threads SET payload_json=json_set(payload_json,'$.modelSelection.model',?)", [patch.model]);
		if (patch.runtimeMode) files.db.run("UPDATE orchestration_v2_projection_threads SET payload_json=json_set(payload_json,'$.runtimeMode',?)", [patch.runtimeMode]);
		expect((await result(start(files))).status).toBe(0);
		expect(fake.commands).toHaveLength(2);
	}
});

test("rechecks archive state between the switch and continuation", async () => {
	const files = fixture();
	thread(files);
	const fake = server(files, (command) => {
		if (command.type === "provider.switch") files.db.run("UPDATE orchestration_v2_projection_threads SET payload_json=json_set(payload_json,'$.archivedAt',?)", [past]);
		return "success";
	});
	expect((await result(start(files))).status).toBe(0);
	expect(fake.commands).toHaveLength(1);
});

test("a historical target session error does not hide the source failure after switching", async () => {
	const files = fixture();
	thread(files);
	files.db.run("INSERT INTO orchestration_v2_projection_provider_session_bindings VALUES ('limited','old-target')");
	files.db.run("INSERT INTO orchestration_v2_projection_provider_sessions VALUES ('old-target','claude-hello',?,?)", [past, JSON.stringify({ lastError: "old target failure" })]);
	const fake = server(files);
	expect((await result(start(files))).status).toBe(0);
	expect(fake.commands.map((command) => command.type)).toEqual(["provider.switch", "message.dispatch"]);
	expect((await result(start(files))).status).toBe(0);
	expect(fake.commands).toHaveLength(2);
	expect(state(files).moves[0].phase).toBe("done");
});

test("flock excludes overlapping passes and SIGTERM revokes and releases it", async () => {
	const files = fixture();
	thread(files);
	const fake = server(files, () => "wait");
	const first = start(files);
	await fake.ready;
	try {
		const second = await result(start(files));
		expect(second.status).toBe(0);
		expect(second.stdout).toContain("pool pass already running");
		expect(fake.commands).toHaveLength(1);
	} finally { first.kill("SIGTERM"); }
	expect((await result(first)).status).toBe(1);
	expect(readFileSync(join(files.root, "revoked"), "utf8")).toBe("pool-session");
	expect((await result(start(files, ["--dry-run"]))).status).toBe(0);
});

test("bad config or corrupt state fails closed without minting credentials", async () => {
	const files = fixture();
	thread(files);
	writeFileSync(join(files.root, "config/t3-pool.json"), JSON.stringify({ pools: [["a", "a"]] }));
	expect((await result(start(files))).status).toBe(1);
	rmSync(join(files.root, "config/t3-pool.json"));
	mkdirSync(join(files.root, "state/t3-pool"), { recursive: true });
	writeFileSync(join(files.root, "state/t3-pool/state.json"), "broken");
	expect((await result(start(files))).status).toBe(1);
	expect(existsSync(join(files.root, "auth-calls"))).toBe(false);
});

function plans(output: { stdout: string }) { return output.stdout.trim().split("\n").map((line) => JSON.parse(line)); }

function config(files: Fixture, patch: Record<string, unknown>) {
	const path = join(files.root, "config/t3-pool.json");
	writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), ...patch }));
}

test("eligibility excludes delegated children and stale lanes, but admits fresh top-level failures", async () => {
	const files = fixture();
	for (const status of ["failed", "completed", "cancelled", "running", "waiting"]) {
		thread(files, `${status}-child`, "claudeAgent", { parentThreadId: "parent" });
		files.db.run("INSERT INTO orchestration_v2_projection_subagents VALUES (?, ?)", [`${status}-child`, status]);
	}
	thread(files, "stale-lane", "claudeAgent", { failedAt: new Date(Date.now() - 31 * 60_000).toISOString() });
	thread(files, "fresh-lane");
	const output = await result(start(files, ["--dry-run"]));
	expect(output.status).toBe(0);
	expect(plans(output).filter((row) => row.to).map((row) => row.thread)).toEqual(["fresh-lane"]);
});

test("later completed and running runs clear stale child null-reset limits", async () => {
	const files = fixture();
	thread(files, "source", "codex-r90");
	thread(files, "stale-child", "codex", { parentThreadId: "parent", resetAt: null, failedAt: past });
	thread(files, "recent-child", "codex-mistystep", { parentThreadId: "parent", resetAt: null });
	run(files, "unrelated-healthy", "completed", { instance: "codex", status: "completed", completedAt: later });
	run(files, "another", "running", { instance: "codex-mistystep", status: "running", completedAt: null, startedAt: later });
	const output = await result(start(files, ["--dry-run"]));
	expect(plans(output).at(-1).limited).toEqual(["codex-r90"]);
	expect(plans(output).find((row) => row.to)?.to).toBe("codex");
});

test("unknown resets expire in one hour, including legacy persisted null limits", async () => {
	const files = fixture();
	thread(files, "source", "codex-r90");
	thread(files, "old-null", "codex", { resetAt: null, failedAt: new Date(Date.now() - 61 * 60_000).toISOString() });
	thread(files, "fresh-null", "codex-mistystep", { resetAt: "invalid" });
	mkdirSync(join(files.root, "state/t3-pool"), { recursive: true });
	writeFileSync(join(files.root, "state/t3-pool/state.json"), JSON.stringify({ version: 1, limits: { codex: null }, moves: [] }));
	const output = await result(start(files, ["--dry-run"]));
	expect(plans(output).at(-1).limited).toEqual(["codex-mistystep", "codex-r90"]);
	expect(plans(output).find((row) => row.to)?.to).toBe("codex");
});

test("shipped reserved instances remain sources but never targets", async () => {
	const files = fixture();
	rmSync(join(files.root, "config/t3-pool.json"));
	thread(files, "source", "claudeAgent");
	thread(files, "other-limited", "claude-mistystep", { parentThreadId: "parent" });
	expect(plans(await result(start(files, ["--dry-run"]))).filter((row) => row.to)).toEqual([]);
	const second = fixture();
	rmSync(join(second.root, "config/t3-pool.json"));
	thread(second, "reserved-source", "claude-hello");
	expect(plans(await result(start(second, ["--dry-run"]))).find((row) => row.to)?.to).toBe("claude-mistystep");
	const codex = fixture();
	rmSync(join(codex.root, "config/t3-pool.json"));
	thread(codex, "source", "codex");
	thread(codex, "out-of-credits", "codex-r90", { resetAt: null, failedAt: past });
	run(codex, "busy", "busy:run", { instance: "codex-mistystep", status: "running", completedAt: null, startedAt: later });
	expect(plans(await result(start(codex, ["--dry-run"]))).find((row) => row.to)?.to).toBe("codex-mistystep");
});

test("least loaded targets spread reservations within a pass", async () => {
	const files = fixture();
	thread(files, "a", "codex-r90");
	thread(files, "b", "codex-r90");
	run(files, "unrelated", "busy", { instance: "codex", status: "running", completedAt: null, startedAt: later });
	expect(plans(await result(start(files, ["--dry-run"]))).filter((row) => row.to).map((row) => row.to)).toEqual(["codex-mistystep", "codex"]);
});

test("default ramp admits one move and configuration never permits more than two", async () => {
	const files = fixture();
	rmSync(join(files.root, "config/t3-pool.json"));
	for (const id of ["a", "b", "c"]) thread(files, id, "codex-r90");
	expect(plans(await result(start(files, ["--dry-run"]))).at(-1).planned).toBe(1);
	configFromDefaults(files, 3);
	expect((await result(start(files))).status).toBe(1);
	expect(existsSync(join(files.root, "auth-calls"))).toBe(false);
});

function configFromDefaults(files: Fixture, cap: number) {
	writeFileSync(join(files.root, "config/t3-pool.json"), JSON.stringify({ pools: [["codex-r90", "codex", "codex-mistystep"]], reserved: [], maxMovesPerPass: cap }));
}

test("target hourly cap survives pruning completed moves and a process restart", async () => {
	const files = fixture();
	config(files, { pools: [["codex-r90", "codex"]] });
	server(files);
	for (const id of ["a", "b", "c", "d"]) thread(files, id, "codex-r90");
	expect((await result(start(files))).status).toBe(0);
	expect((await result(start(files))).status).toBe(0);
	expect(state(files).moves.filter((move: { phase: string }) => move.phase === "done")).toHaveLength(3);
	files.db.run("DELETE FROM orchestration_v2_projection_runs WHERE thread_id IN ('a','b','c')");
	const capped = plans(await result(start(files, ["--dry-run"])));
	expect(capped.at(-1).planned).toBe(0);
	const saved = state(files);
	for (const admission of saved.admissions) admission.at = past;
	writeFileSync(join(files.root, "state/t3-pool/state.json"), JSON.stringify(saved));
	expect(plans(await result(start(files, ["--dry-run"]))).at(-1).planned).toBe(1);
});

test("rejected moves do not block others and are abandoned after three rejections", async () => {
	const files = fixture();
	thread(files, "a-rejected"); thread(files, "b-good");
	const fake = server(files, (command) => command.threadId === "a-rejected" ? "failure" : "success");
	expect((await result(start(files))).status).toBe(0);
	expect(fake.commands.map((row) => row.threadId)).toEqual(["a-rejected", "b-good", "b-good"]);
	expect((await result(start(files))).status).toBe(0);
	expect((await result(start(files))).status).toBe(0);
	expect(state(files).moves.find((move: { threadId: string }) => move.threadId === "a-rejected").phase).toBe("abandoned");
	expect((await result(start(files))).status).toBe(0);
	expect(fake.commands.filter((row) => row.threadId === "a-rejected")).toHaveLength(3);
	const rejections = readFileSync(join(files.root, "state/t3-pool/rejections.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
	expect(rejections.map((row) => row.rejections)).toEqual([1, 2, 3]);
	expect(rejections.at(-1).phase).toBe("abandoned");
});

test.each(["running", "completed"])("newer %s activity clears an account limit; older activity does not", async (status) => {
	for (const [at, limited] of [[later, false], [past, true]] as const) {
		const files = fixture();
		thread(files, "source", "codex-r90");
		thread(files, "failed-child", "codex", { parentThreadId: "parent", resetAt: null });
		run(files, "healthy", "room", { instance: "codex", status, completedAt: status === "completed" ? at : null, startedAt: at });
		const summary = plans(await result(start(files, ["--dry-run"]))).at(-1);
		expect(summary.limited.includes("codex")).toBe(limited);
	}
});

test("newest failure replaces older unknown reset and recovery evidence", async () => {
	const files = fixture();
	thread(files, "old", "codex", { parentThreadId: "parent", resetAt: null, failedAt: past });
	run(files, "healthy", "completed", { instance: "codex", status: "completed", completedAt: past });
	thread(files, "new", "codex", { parentThreadId: "parent", resetAt: future });
	expect(plans(await result(start(files, ["--dry-run"]))).at(-1).limited).toEqual(["codex"]);
	files.db.run("UPDATE orchestration_v2_projection_turn_items SET payload_json=json_set(payload_json,'$.failure.resetAt',?) WHERE thread_id='new'", [past]);
	expect(plans(await result(start(files, ["--dry-run"]))).at(-1).limited).toEqual([]);
});

test("ownership is rechecked between switch and continuation", async () => {
	const files = fixture();
	thread(files);
	const fake = server(files, (command) => {
		if (command.type === "provider.switch") files.db.run("UPDATE orchestration_v2_projection_threads SET payload_json=json_set(payload_json,'$.lineage.parentThreadId','parent')");
		return "success";
	});
	expect((await result(start(files))).status).toBe(0);
	expect(fake.commands.map((row) => row.type)).toEqual(["provider.switch"]);
});

test("three continuation rejections abandon without switching again", async () => {
	const files = fixture(); thread(files);
	const fake = server(files, (command) => command.type === "message.dispatch" ? "failure" : "success");
	for (let pass = 0; pass < 4; pass++) expect((await result(start(files))).status).toBe(0);
	expect(fake.commands.filter((row) => row.type === "provider.switch")).toHaveLength(1);
	expect(fake.commands.filter((row) => row.type === "message.dispatch")).toHaveLength(3);
	expect(state(files).moves[0].phase).toBe("abandoned");
});

test("completion on a different account does not clear the source account's limit", async () => {
	const files = fixture();
	thread(files);
	server(files);
	expect((await result(start(files))).status).toBe(0);
	run(files, "limited", "target-success", { instance: "claude-hello", status: "completed", completedAt: later });
	const summary = plans(await result(start(files, ["--dry-run"]))).at(-1);
	expect(summary.limited).toContain("claudeAgent");
	expect(summary.planned).toBe(0);
});

test("archived, settled and deleted failures never poison target accounts", async () => {
	for (const options of [{ archivedAt: past }, { settledOverride: "settled" }, { deletedAt: past }]) {
		const files = fixture();
		thread(files, "source", "codex-r90");
		thread(files, "inactive", "codex", options);
		const output = plans(await result(start(files, ["--dry-run"])));
		expect(output.at(-1).limited).toEqual(["codex-r90"]);
		expect(output.find((row) => row.to)?.to).toBe("codex");
	}
});
