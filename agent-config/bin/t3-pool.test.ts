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

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "t3-pool-"));
	roots.push(root);
	for (const dir of ["bin", "userdata", "config"]) mkdirSync(join(root, dir));
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
`);
	const env = { ...process.env, T3CODE_HOME: root, XDG_STATE_HOME: join(root, "state"), XDG_CONFIG_HOME: join(root, "config"), PATH: `${root}/bin:${process.env.PATH}` };
	return { root, db, env };
}
type Fixture = ReturnType<typeof fixture>;

function thread(files: Fixture, id = "limited", instance = "claudeAgent", options: {
	resetAt?: string | null; failureClass?: string; status?: string; archivedAt?: string | null;
	deletedAt?: string | null; settledOverride?: string | null;
} = {}) {
	const selection = { instanceId: instance, model: "model-original", options: [
		{ id: "reasoningEffort", value: "max" }, { id: "fastMode", value: true },
	] };
	files.db.run("INSERT INTO orchestration_v2_projection_threads VALUES (?, ?, ?, ?)", [id, instance, options.deletedAt ?? null, JSON.stringify({
		id, providerInstanceId: instance, modelSelection: selection, runtimeMode: "full-access",
		archivedAt: options.archivedAt ?? null, deletedAt: options.deletedAt ?? null, settledOverride: options.settledOverride ?? null,
	})]);
	run(files, id, `${id}:run`, { status: options.status ?? "failed", instance });
	error(files, id, `${id}:run`, { failureClass: options.failureClass ?? "usage_limit", resetAt: options.resetAt === undefined ? future : options.resetAt });
	return selection;
}

function run(files: Fixture, threadId: string, runId: string, options: { status?: string; instance?: string; ordinal?: number; completedAt?: string | null; startedAt?: string | null } = {}) {
	files.db.run("INSERT INTO orchestration_v2_projection_runs VALUES (?, ?, ?, ?, ?, ?, ?)", [
		runId, threadId, options.ordinal ?? 1, options.instance ?? "claudeAgent", options.status ?? "failed",
		options.completedAt === undefined ? "2026-10-19T12:00:00.000Z" : options.completedAt,
		JSON.stringify({ rootNodeId: `${runId}:root`, startedAt: options.startedAt === undefined ? "2026-10-19T11:00:00.000Z" : options.startedAt }),
	]);
}

function error(files: Fixture, threadId: string, runId: string, options: { node?: string; failureClass?: string; resetAt?: string | null; ordinal?: number; updatedAt?: string } = {}) {
	const ordinal = options.ordinal ?? 1;
	files.db.run("INSERT INTO orchestration_v2_projection_turn_items VALUES (?, ?, ?, ?, ?, 'error', 'failed', ?, ?)", [
		`${runId}:error:${ordinal}`, threadId, runId, options.node ?? `${runId}:root`, ordinal,
		options.updatedAt ?? "2026-10-19T12:00:00.000Z", JSON.stringify({ failure: { class: options.failureClass ?? "usage_limit", resetAt: options.resetAt === undefined ? future : options.resetAt, message: "synthetic limit" } }),
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
	expect(JSON.parse(output.stdout.split("\n")[0])).toEqual({ dryRun: true, thread: "limited", from: "claudeAgent", to: "claude-hello", run: "limited:run" });
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
	thread(files, "blocked-claude", "claudeAgent", { resetAt: null, archivedAt: past });
	thread(files, "codex", "codex-r90");
	thread(files, "blocked-codex", "codex", { resetAt: "bad timestamp", archivedAt: past });
	const output = await result(start(files, ["--dry-run"]));
	expect(output.status).toBe(0);
	const plans = output.stdout.trim().split("\n").map((line) => JSON.parse(line));
	expect(plans.slice(0, -1)).toEqual([
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
	thread(files, "running", "claudeAgent", { status: "running" });
	thread(files, "pending");
	files.db.run("INSERT INTO orchestration_v2_projection_runtime_requests VALUES ('pending','pending')");
	thread(files, "queued");
	run(files, "queued", "queued:held", { ordinal: 2, status: "queued", completedAt: null });
	thread(files, "newer-success");
	run(files, "newer-success", "success", { ordinal: 0, status: "completed", completedAt: "2026-10-20T00:00:00.000Z" });
	thread(files, "child-error", "claudeAgent", { failureClass: "internal" });
	error(files, "child-error", "child-error:run", { node: "child", ordinal: 2 });
	thread(files, "superseded-error");
	error(files, "superseded-error", "superseded-error:run", { ordinal: 2, failureClass: "internal" });
	thread(files, "session-error");
	files.db.run("INSERT INTO orchestration_v2_projection_provider_session_bindings VALUES ('session-error','session')");
	files.db.run("INSERT INTO orchestration_v2_projection_provider_sessions VALUES ('session','claudeAgent',?,?)", [past, JSON.stringify({ lastError: "different failure" })]);
	thread(files, "valid");
	run(files, "valid", "cancelled-before-start", { ordinal: 2, status: "cancelled", startedAt: null, completedAt: "2026-10-20T00:00:00.000Z" });
	const output = await result(start(files, ["--dry-run"]));
	expect(output.status).toBe(0);
	expect(output.stdout.trim().split("\n")).toHaveLength(2);
	expect(JSON.parse(output.stdout.split("\n")[0]).thread).toBe("valid");
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
		expect((await result(start(files))).status).toBe(1);
		expect(readFileSync(join(files.root, "revoked"), "utf8")).toBe("pool-session");
		expect((await result(start(files))).status).toBe(0);
		expect(new Set(fake.commands.filter((c) => c.type === "provider.switch").map((c) => c.commandId)).size).toBe(scenario === "switch-rejected" ? 2 : 1);
		expect(new Set(fake.commands.filter((c) => c.type === "message.dispatch").map((c) => c.commandId)).size).toBe(scenario === "continue-rejected" ? 2 : 1);
		expect(fake.applied.size).toBe(2);
		expect(state(files).moves[0].phase).toBe("done");
		expect(logs(files)).toHaveLength(1);
	});
}

test("retains a limited account after the moved thread succeeds and prunes obsolete handled runs", async () => {
	const files = fixture();
	thread(files);
	server(files);
	expect((await result(start(files))).status).toBe(0);
	files.db.run("UPDATE orchestration_v2_projection_runs SET status='completed'");
	thread(files, "another", "claude-mistystep");
	const output = await result(start(files, ["--dry-run"]));
	expect(JSON.parse(output.stdout.split("\n")[0]).to).toBe("claude-hello");
	expect((await result(start(files))).status).toBe(0);
	expect(state(files).moves.map((move: { threadId: string }) => move.threadId)).toEqual(["another"]);
	expect(state(files).limits.claudeAgent).toBe(future);
});

test("a human provider, model or runtime change cancels a pending continuation", async () => {
	for (const patch of [{ providerInstanceId: "claude-r90" }, { model: "different-model" }, { runtimeMode: "approval-required" }]) {
		const files = fixture();
		thread(files);
		const fake = server(files, (command) => command.type === "message.dispatch" ? "failure" : "success");
		expect((await result(start(files))).status).toBe(1);
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
