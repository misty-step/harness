import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { object } from "../lib/t3-rpc.ts";
import defaults from "../t3-pool/pools.json";

setDefaultTimeout(30_000);

const roots: string[] = [];
const servers: ReturnType<typeof Bun.serve>[] = [];
const databases: Database[] = [];
const token = "synthetic-pool-bearer-never-print";
const cli = process.env.T3_POOL_TEST_CLI ?? join(import.meta.dir, "t3-pool.ts");
const future = "2099-01-01T00:00:00.000Z";
const past = "2000-01-01T00:00:00.000Z";
const recent = new Date(Date.now() - 60_000).toISOString();
const later = new Date(Date.now() - 30_000).toISOString();

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "t3-pool-"));
	roots.push(root);
	for (const dir of ["bin", "userdata", "config"]) mkdirSync(join(root, dir));
	writeFileSync(join(root, "config/t3-pool.json"), JSON.stringify({ wipRoots: [], pools: [["claudeAgent", "claude-hello", "claude-r90", "claude-mistystep"], ["codex", "codex-mistystep", "codex-r90"]], reserved: [], maxMovesPerPass: 2 }));
	writeFileSync(join(root, "bin/t3"), `#!${process.execPath}
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const root = process.env.T3CODE_HOME;
const args = process.argv.slice(2);
appendFileSync(root + "/auth-calls", JSON.stringify(args) + "\\n");
if (args[2] === "issue" && existsSync(root + "/auth-config.json")) {
 const path = root + "/config/t3-pool.json";
 writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), ...JSON.parse(readFileSync(root + "/auth-config.json", "utf8")) }));
}
if (args[2] === "issue" && existsSync(root + "/auth-receipt")) {
 const { Database } = await import("bun:sqlite");
 const db = new Database(root + "/userdata/statev2.sqlite");
 db.run("INSERT INTO orchestration_command_receipts VALUES (?, 'accepted')", [readFileSync(root + "/auth-receipt", "utf8")]);
 db.close();
}
if (args[2] === "issue") console.log(JSON.stringify({ sessionId: "pool-session", token: ${JSON.stringify(token)} }));
else if (args[2] === "revoke") writeFileSync(root + "/revoked", args[3]);
else process.exit(1);
`, { mode: 0o700 });
	writeFileSync(join(root, "bin/home"), `#!${process.execPath}
import { appendFileSync, existsSync, readFileSync } from "node:fs";
const root = process.env.T3CODE_HOME;
if (existsSync(root + "/home-fails")) process.exit(1);
appendFileSync(root + "/home-posts", JSON.stringify({ args: process.argv.slice(2), body: await new Response(Bun.stdin).text(), poolState: JSON.parse(readFileSync(process.env.XDG_STATE_HOME + "/t3-pool/state.json", "utf8")) }) + "\\n");
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
CREATE TABLE orchestration_v2_projection_subagents (subagent_id TEXT, thread_id TEXT, child_thread_id TEXT, origin TEXT, status TEXT, payload_json TEXT);
CREATE TABLE orchestration_v2_projection_provider_threads (provider_thread_id TEXT, thread_id TEXT, owner_node_id TEXT, provider_instance_id TEXT, updated_at TEXT, payload_json TEXT);
`);
	const env = { ...process.env, T3CODE_HOME: root, XDG_STATE_HOME: join(root, "state"), XDG_CONFIG_HOME: join(root, "config"), PATH: `${root}/bin:${process.env.PATH}` };
	return { root, db, env };
}
type Fixture = ReturnType<typeof fixture>;

const handoffRefusal = "Insufficient context allowance for the provider handoff. Compact the target conversation or use a larger-context model; the current request has not been truncated.";

function allowRoot(files: Fixture, id: string) {
	const path = join(files.root, "config/t3-pool.json");
	const current = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : defaults;
	writeFileSync(path, JSON.stringify({ ...current, wipRoots: [...new Set([...(current.wipRoots ?? []), id])] }));
}

function thread(files: Fixture, id = "limited", instance = "claudeAgent", options: {
	resetAt?: string | null; failureClass?: string; status?: string; archivedAt?: string | null; message?: string;
	deletedAt?: string | null; settledOverride?: string | null; parentThreadId?: string | null; failedAt?: string;
	model?: string; options?: { id: string; value: string | boolean }[]; worktreePath?: string | null; creationSource?: string;
} = {}) {
	const selection = { instanceId: instance, model: options.model ?? "model-original", options: options.options ?? [
		{ id: "reasoningEffort", value: "max" }, { id: "fastMode", value: true },
	] };
	const parent = options.parentThreadId ?? null;
	if (parent === null) allowRoot(files, id);
	files.db.run("INSERT INTO orchestration_v2_projection_threads VALUES (?, ?, ?, ?)", [id, instance, options.deletedAt ?? null, JSON.stringify({
		id, title: `Lane ${id}`, projectId: "project", interactionMode: "default", worktreePath: options.worktreePath ?? null, branch: options.worktreePath ? "lane-branch" : null,
		creationSource: options.creationSource ?? "web", forkedFrom: parent === null ? null : { type: "node", nodeId: `task:${id}` },
		providerInstanceId: instance, modelSelection: selection, runtimeMode: "full-access", lineage: { parentThreadId: parent, relationshipToParent: parent === null ? null : "subagent" },
		archivedAt: options.archivedAt ?? null, deletedAt: options.deletedAt ?? null, settledOverride: options.settledOverride ?? null,
	})]);
	run(files, id, `${id}:run`, { status: options.status ?? "failed", instance });
	error(files, id, `${id}:run`, { failureClass: options.failureClass ?? (options.message ? "provider_error" : "usage_limit"), message: options.message,
		resetAt: options.resetAt === undefined ? future : options.resetAt, updatedAt: options.failedAt });
	return selection;
}

// A delegated child of `parent`, whose original app-owned task holds a result.
function child(files: Fixture, id: string, parent = "parent", options: { result?: string | null; origin?: string; creationSource?: string; parentArchived?: boolean } = {}) {
	if (!files.db.query("SELECT 1 FROM orchestration_v2_projection_threads WHERE thread_id = ?").get(parent)) {
		files.db.run("INSERT INTO orchestration_v2_projection_threads VALUES (?, 'claudeAgent', NULL, ?)", [parent, JSON.stringify({ id: parent, archivedAt: options.parentArchived ? past : null, deletedAt: null, lineage: { parentThreadId: null, relationshipToParent: null } })]);
		allowRoot(files, parent);
	}
	thread(files, id, "claudeAgent", { parentThreadId: parent, creationSource: options.creationSource });
	files.db.run("INSERT INTO orchestration_v2_projection_subagents VALUES (?, ?, ?, ?, 'failed', ?)", [`task:${id}`, parent, id, options.origin ?? "app_owned",
		JSON.stringify({ result: options.result === undefined ? "Claude API rate limit reached." : options.result })]);
}

function nativeThread(files: Fixture, id: string, instance: string, usedTokens: number, maxTokens = 1_000_000) {
	files.db.run("INSERT INTO orchestration_v2_projection_provider_threads VALUES (?, ?, NULL, ?, ?, ?)", [`${id}:${instance}`, id, instance, past, JSON.stringify({ contextUsage: { usedTokens, maxTokens } })]);
}

function run(files: Fixture, threadId: string, runId: string, options: { status?: string; instance?: string; ordinal?: number; completedAt?: string | null; startedAt?: string | null } = {}) {
	files.db.run("INSERT INTO orchestration_v2_projection_runs VALUES (?, ?, ?, ?, ?, ?, ?)", [
		runId, threadId, options.ordinal ?? 1, options.instance ?? "claudeAgent", options.status ?? "failed",
		options.completedAt === undefined ? recent : options.completedAt,
		JSON.stringify({ rootNodeId: `${runId}:root`, startedAt: options.startedAt === undefined ? recent : options.startedAt }),
	]);
}

function error(files: Fixture, threadId: string, runId: string, options: { node?: string; failureClass?: string; resetAt?: string | null; ordinal?: number; updatedAt?: string; message?: string } = {}) {
	const ordinal = options.ordinal ?? 1;
	files.db.run("INSERT INTO orchestration_v2_projection_turn_items VALUES (?, ?, ?, ?, ?, 'error', 'failed', ?, ?)", [
		`${runId}:error:${ordinal}`, threadId, runId, options.node ?? `${runId}:root`, ordinal,
		options.updatedAt ?? recent, JSON.stringify({ failure: { class: options.failureClass ?? "usage_limit", resetAt: options.resetAt === undefined ? future : options.resetAt, message: options.message ?? "synthetic limit" } }),
	]);
}

function server(files: Fixture, hook: (command: Record<string, unknown>, index: number) => "success" | "failure" | "unreceipted" | "close" | "wait" = () => "success") {
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
				if (response !== "unreceipted") files.db.run("INSERT OR IGNORE INTO orchestration_command_receipts VALUES (?, ?)", [String(command.commandId), response === "failure" ? "rejected" : "accepted"]);
				if (response !== "failure" && response !== "unreceipted" && !applied.has(String(command.commandId))) {
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
						// recordSubagentFollowup: a user continuation of a child whose
						// app-owned task has a result gets a fresh parent-owned task.
						if (files.db.query("SELECT 1 FROM orchestration_v2_projection_subagents WHERE child_thread_id = ? AND origin = 'app_owned' AND json_extract(payload_json, '$.result') IS NOT NULL").get(String(command.threadId))) {
							files.db.run("INSERT INTO orchestration_v2_projection_runs VALUES (?, ?, 9, NULL, 'running', NULL, ?)", [`${command.threadId}:followup`, String(command.threadId),
								JSON.stringify({ userMessageId: command.messageId, delegatedTaskId: `followup:${command.threadId}`, startedAt: later })]);
						}
					}
					applied.add(String(command.commandId));
				}
				if (response === "close") { socket.close(); return; }
				const value = { sequence: commands.length };
				socket.send(JSON.stringify({ _tag: "Exit", requestId: frame.id, exit: response === "failure" || response === "unreceipted"
					? { _tag: "Failure", cause: { message: token } } : { _tag: "Success", value } }));
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

function seedMove(files: Fixture, selection: ReturnType<typeof thread>, patch: Record<string, unknown> = {}) {
	mkdirSync(join(files.root, "state/t3-pool"), { recursive: true });
	writeFileSync(join(files.root, "state/t3-pool/state.json"), JSON.stringify({ version: 1, limits: {}, admissions: [], moves: [{
		threadId: "limited", runId: "limited:run", from: selection.instanceId, to: "claude-hello",
		target: { ...selection, instanceId: "claude-hello" }, modelSelection: selection,
		runtimeMode: "full-access", phase: "switch", kind: "account", child: false, attempt: 0, rejections: 0, ...patch,
	}] }));
}

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
	expect(logs(files)).toEqual([{ at: expect.any(String), thread: "limited", from: "claudeAgent", to: "claude-hello", run: "limited:run", kind: "account" }]);
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
		{ dryRun: true, thread: "claude", from: "claude-mistystep", to: "claude-hello", run: "claude:run", kind: "account" },
		{ dryRun: true, thread: "codex", from: "codex-r90", to: "codex-mistystep", run: "codex:run", kind: "account" },
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

test("eligibility admits followable children after top-level lanes, and excludes stale lanes and unfollowable children", async () => {
	const files = fixture();
	config(files, { maxMovesPerPass: 2 });
	child(files, "a-child");
	child(files, "no-result", "parent", { result: null });
	child(files, "provider-owned", "parent", { origin: "provider_owned" });
	child(files, "native", "parent", { creationSource: "provider" });
	child(files, "orphan", "archived-parent", { parentArchived: true });
	thread(files, "stale-lane", "claudeAgent", { failedAt: new Date(Date.now() - 31 * 60_000).toISOString() });
	thread(files, "fresh-lane");
	const output = plans(await result(start(files, ["--dry-run"])));
	expect(output.filter((row) => row.to).map((row) => [row.thread, row.child])).toEqual([["fresh-lane", undefined], ["a-child", true]]);
	expect(output.at(-1).excluded).toEqual({
		"delegated child: no app-owned task result to follow up": 3,
		"delegated child: parent archived or deleted": 1,
		"failure is not within the last 30 minutes": 1,
	});
});

test("continues a delegated child so T3 records a fresh task that notifies its parent", async () => {
	const files = fixture();
	child(files, "worker");
	const fake = server(files);
	const output = await result(start(files));
	expect(output.status).toBe(0);
	expect(fake.commands.map((command) => command.type)).toEqual(["provider.switch", "message.dispatch"]);
	expect(fake.commands[1]).toMatchObject({ threadId: "worker", createdBy: "user", manualContinuationOfRunId: "worker:run" });
	expect(plans(output)[0]).toEqual({ moved: "worker", kind: "account", to: "claude-hello", task: "followup:worker" });
	expect(state(files).moves[0]).toMatchObject({ phase: "done", child: true });
});

test("later completed runs clear stale null-reset limits; later running runs do not", async () => {
	const files = fixture();
	thread(files, "source", "codex-r90");
	thread(files, "stale-child", "codex", { parentThreadId: "parent", resetAt: null, failedAt: past });
	thread(files, "recent-child", "codex-mistystep", { parentThreadId: "parent", resetAt: null });
	run(files, "unrelated-healthy", "completed", { instance: "codex", status: "completed", completedAt: later });
	run(files, "another", "running", { instance: "codex-mistystep", status: "running", completedAt: null, startedAt: later });
	const output = await result(start(files, ["--dry-run"]));
	expect(plans(output).at(-1).limited).toEqual(["codex-mistystep", "codex-r90"]);
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
	writeFileSync(join(files.root, "config/t3-pool.json"), JSON.stringify({ pools: [["codex-r90", "codex", "codex-mistystep"]], reserved: [], maxMovesPerPass: cap, wipRoots: ["a", "b", "c"] }));
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

// A limited account accepts runs that then fail at the same limit: only completions prove room.
test.each([["running", true], ["completed", false]] as const)("newer %s activity leaves an account limited: %p", async (status, newer) => {
	for (const [at, limited] of [[later, newer], [past, true]] as const) {
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

const sol = (effort: string) => ({ model: "gpt-6.1-sol", options: [{ id: "reasoningEffort", value: effort }, { id: "serviceTier", value: "priority" }] });

test("moves across providers with the mapped model and effort only when its whole pool is limited or reserved", async () => {
	const files = fixture();
	config(files, { reserved: ["claude-hello", "claude-r90", "codex-r90"] });
	thread(files, "lane", "codex", sol("xhigh"));
	thread(files, "other-limited", "codex-mistystep", { parentThreadId: "parent" });
	run(files, "busy", "busy:run", { instance: "claudeAgent", status: "running", completedAt: null, startedAt: later });
	const fake = server(files);
	const dry = plans(await result(start(files, ["--dry-run"])));
	expect(dry[0]).toMatchObject({ thread: "lane", from: "codex", to: "claude-mistystep", kind: "provider", model: "claude-opus-5-5" });
	expect((await result(start(files))).status).toBe(0);
	expect(fake.commands.map((command) => command.type)).toEqual(["provider.switch", "message.dispatch"]);
	expect(fake.commands[0].modelSelection).toEqual({ instanceId: "claude-mistystep", model: "claude-opus-5-5", options: [{ id: "effort", value: "xhigh" }] });
	const row = object(files.db.query("SELECT payload_json FROM orchestration_v2_projection_threads WHERE thread_id = 'lane'").get());
	expect(JSON.parse(String(row.payload_json)).runtimeMode).toBe("full-access");
	expect(logs(files)).toEqual([{ at: expect.any(String), thread: "lane", from: "codex", to: "claude-mistystep", run: "lane:run", kind: "provider", model: "claude-opus-5-5" }]);
	expect(state(files).moves[0].phase).toBe("done");
});

test("cross-provider moves need a mapped model and effort, and never cross while a same-pool account is only capped", async () => {
	const files = fixture();
	config(files, { reserved: ["codex-r90"], pools: [["claude-mistystep", "claudeAgent"], ["codex", "codex-r90"]] });
	thread(files, "max-effort", "codex", sol("max"));
	thread(files, "unmapped", "codex", { model: "gpt-6-astra", options: [] });
	expect(plans(await result(start(files, ["--dry-run"]))).filter((row) => row.thread).map((row) => row.reason))
		.toEqual(Array(2).fill("no target: its pool is limited or reserved, and its model or effort has no cross-provider mapping"));
	const capped = fixture();
	config(capped, { pools: [["codex", "codex-mistystep"], ["claudeAgent", "claude-mistystep"]], reserved: [] });
	thread(capped, "lane", "codex", sol("high"));
	mkdirSync(join(capped.root, "state/t3-pool"), { recursive: true });
	writeFileSync(join(capped.root, "state/t3-pool/state.json"), JSON.stringify({ version: 1, limits: {}, moves: [],
		admissions: ["a", "b", "c"].map((runId) => ({ runId, to: "codex-mistystep", at: new Date().toISOString() })) }));
	expect(plans(await result(start(capped, ["--dry-run"])))[0].reason).toBe("no target: other accounts are limited, reserved or at the hourly cap");
});

function posts(files: Fixture) { return readFileSync(join(files.root, "home-posts"), "utf8").trim().split("\n").map((line) => JSON.parse(line)); }

test("a WIP handoff refusal requests Home succession once without auth, launch or settlement", async () => {
	const files = fixture();
	const selection = thread(files, "big", "claude-mistystep", { message: handoffRefusal, worktreePath: "/work/tree" });
	const fake = server(files);
	const before = readFileSync(join(files.root, "userdata/statev2.sqlite"));
	const dry = plans(await result(start(files, ["--dry-run"])));
	expect(dry[0]).toMatchObject({ thread: "big", kind: "successor", reason: "handoff refused; request succession from Home" });
	expect(existsSync(join(files.root, "home-posts"))).toBe(false);
	const output = await result(start(files));
	expect(output.status).toBe(0);
	expect(plans(output)[0]).toEqual({ requested: "big", kind: "succession", run: "big:run" });
	expect(fake.commands).toEqual([]);
	expect(existsSync(join(files.root, "auth-calls"))).toBe(false);
	expect(readFileSync(join(files.root, "userdata/statev2.sqlite"))).toEqual(before);
	const [post] = posts(files);
	expect(post.args).toEqual(["post", "--from", "t3-pool"]);
	expect(post.body.split("\n")[0]).toBe("Lane succession requested: big");
	expect(post.body.split("\n")).toContain("Handoff: none; the successor builds it from t3_thread_read history.");
	expect(post.poolState.moves[0]).toMatchObject({ phase: "done", notificationPending: true });
	for (const text of ["t3-thread://v1/big", "big:run", "/work/tree", "lane-branch", "full-access", JSON.stringify(selection), "Home owns thread creation", "wipRoots"]) expect(post.body).toContain(text);
	expect(state(files).moves[0]).toMatchObject({ phase: "done", kind: "successor" });
	expect(state(files).admissions).toEqual([]);
	expect((await result(start(files))).status).toBe(0);
	expect(posts(files)).toHaveLength(1);
});

test("stale native context rows never turn an account move into succession", async () => {
	const files = fixture();
	thread(files, "lane");
	for (const target of ["claude-hello", "claude-r90", "claude-mistystep"]) nativeThread(files, "lane", target, 990_000);
	expect(plans(await result(start(files, ["--dry-run"])))[0]).toMatchObject({ to: "claude-hello", kind: "account" });
	child(files, "worker");
	for (const target of ["claude-hello", "claude-r90", "claude-mistystep"]) nativeThread(files, "worker", target, 990_000);
	const fake = server(files);
	expect((await result(start(files))).status).toBe(0);
	expect(fake.commands.filter((command) => command.type === "message.dispatch").map((command) => command.threadId)).toEqual(["lane", "worker"]);
});

test("succession notification falls back to Home's inbox once", async () => {
	const files = fixture();
	thread(files, "big", "claude-mistystep", { message: handoffRefusal });
	writeFileSync(join(files.root, "home-fails"), "");
	expect((await result(start(files))).status).toBe(0);
	const inbox = readFileSync(join(files.root, "state/home/inbox.md"), "utf8");
	expect(inbox).toContain("\nLane succession requested: big\n");
	expect(inbox.split("\n")).toContain("Handoff: none; the successor builds it from t3_thread_read history.");
	expect(inbox).toContain("t3-pool requests Home succession");
	expect((await result(start(files))).status).toBe(0);
	expect(readFileSync(join(files.root, "state/home/inbox.md"), "utf8")).toBe(inbox);
});

test("children with a handoff refusal request parent recovery without a succession marker", async () => {
	const files = fixture();
	child(files, "big-child");
	files.db.run("UPDATE orchestration_v2_projection_turn_items SET payload_json = json_set(payload_json, '$.failure.class', 'provider_error', '$.failure.message', ?)", [handoffRefusal]);
	config(files, { wipRoots: ["parent", "big-child"] });
	const fake = server(files);
	expect(plans(await result(start(files, ["--dry-run"])))[0].kind).toBe("parent");
	expect((await result(start(files))).status).toBe(0);
	expect(fake.commands).toEqual([]);
	expect(posts(files)[0].body).toContain("t3-thread://v1/big-child");
	expect(posts(files)[0].body).not.toContain("Lane succession requested:");
	expect(posts(files)[0].body).not.toContain("Handoff: none;");
	expect(posts(files)[0].body).toContain("t3-thread://v1/parent");
	expect(posts(files)[0].body).toContain("owning parent");
	expect(posts(files)[0].body).toContain("Do not open a top-level replacement");
	expect(state(files).moves[0]).toMatchObject({ kind: "parent", phase: "done" });
	expect(existsSync(join(files.root, "auth-calls"))).toBe(false);
	expect((await result(start(files))).status).toBe(0);
	expect(posts(files)).toHaveLength(1);
});

test("child handoff alerts fall back without a lane succession marker", async () => {
	const files = fixture();
	child(files, "big-child");
	files.db.run("UPDATE orchestration_v2_projection_turn_items SET payload_json=json_set(payload_json,'$.failure.class','provider_error','$.failure.message',?)", [handoffRefusal]);
	writeFileSync(join(files.root, "home-fails"), "fixture");
	const fake = server(files);
	expect((await result(start(files))).status).toBe(0);
	const inbox = readFileSync(join(files.root, "state/home/inbox.md"), "utf8");
	expect(inbox).toContain("t3-thread://v1/parent");
	expect(inbox).not.toContain("Lane succession requested:");
	expect(inbox).not.toContain("Handoff: none;");
	expect(fake.commands).toEqual([]);
	expect((await result(start(files))).status).toBe(0);
	expect(readFileSync(join(files.root, "state/home/inbox.md"), "utf8")).toBe(inbox);
});

test.each(["account", "provider", "succession"])("%s path cannot act on excluded roots or their children", async (kind) => {
	const files = fixture();
	const options = kind === "succession" ? { message: handoffRefusal } : sol("high");
	for (const id of ["Home", "Heartbeat", "Verify", "backlog"]) thread(files, id, "codex", options);
	child(files, "non-wip-child", "Verify");
	if (kind === "provider") config(files, { reserved: ["codex-mistystep", "codex-r90"] });
	config(files, { wipRoots: [] });
	const fake = server(files);
	expect(plans(await result(start(files, ["--dry-run"]))).at(-1).planned).toBe(0);
	expect((await result(start(files))).status).toBe(0);
	expect(fake.commands).toEqual([]);
	expect(existsSync(join(files.root, "home-posts"))).toBe(false);
	expect(existsSync(join(files.root, "auth-calls"))).toBe(false);
});

test("WIP descendants require every parent/task edge and a live ancestry to the maintained root", async () => {
	const files = fixture();
	child(files, "middle", "root");
	child(files, "leaf", "middle");
	config(files, { wipRoots: ["root"] });
	const fake = server(files);
	expect((await result(start(files))).status).toBe(0);
	expect(fake.commands.filter((command) => command.type === "message.dispatch").map((command) => command.threadId)).toEqual(["leaf", "middle"]);
});

test.each(["missing", "ambiguous", "cycle", "archived", "deleted", "settled", "forged-root"])("fails closed on %s ancestry", async (defect) => {
	const files = fixture();
	child(files, "middle", "root");
	child(files, "leaf", "middle");
	config(files, { wipRoots: ["root"] });
	if (defect === "missing") files.db.run("DELETE FROM orchestration_v2_projection_threads WHERE thread_id='root'");
	if (defect === "ambiguous") files.db.run("INSERT INTO orchestration_v2_projection_subagents VALUES ('conflict','elsewhere','middle','app_owned','failed','{}')");
	if (defect === "cycle") {
		files.db.run("UPDATE orchestration_v2_projection_threads SET payload_json=json_set(payload_json,'$.lineage.parentThreadId','leaf','$.lineage.relationshipToParent','subagent','$.forkedFrom',json('{\"type\":\"node\",\"nodeId\":\"task:root\"}')) WHERE thread_id='root'");
		files.db.run("INSERT INTO orchestration_v2_projection_subagents VALUES ('task:root','leaf','root','app_owned','failed','{}')");
	}
	if (defect === "archived") files.db.run("UPDATE orchestration_v2_projection_threads SET payload_json=json_set(payload_json,'$.archivedAt',?) WHERE thread_id='root'", [past]);
	if (defect === "deleted") files.db.run("UPDATE orchestration_v2_projection_threads SET deleted_at=? WHERE thread_id='root'", [past]);
	if (defect === "settled") files.db.run("UPDATE orchestration_v2_projection_threads SET payload_json=json_set(payload_json,'$.settledOverride','settled') WHERE thread_id='root'");
	if (defect === "forged-root") {
		files.db.run("DELETE FROM orchestration_v2_projection_subagents WHERE child_thread_id='middle'");
		files.db.run("UPDATE orchestration_v2_projection_threads SET payload_json=json_set(payload_json,'$.lineage.rootThreadId','root') WHERE thread_id='middle'");
	}
	const fake = server(files);
	expect((await result(start(files))).status).toBe(0);
	expect(fake.commands).toEqual([]);
});

test("rechecks WIP config and transitive parent ownership before continuing", async () => {
	for (const change of ["roots", "parent", "new-run", "new-task"]) {
		const files = fixture();
		child(files, "worker", "root");
		const fake = server(files, (command) => {
			if (command.type === "provider.switch") {
				if (change === "roots") config(files, { wipRoots: [] });
				if (change === "parent") files.db.run("UPDATE orchestration_v2_projection_threads SET payload_json=json_set(payload_json,'$.archivedAt',?) WHERE thread_id='root'", [past]);
				if (change === "new-run") run(files, "root", "new-parent-work", { status: "running", startedAt: later, completedAt: null });
				if (change === "new-task") files.db.run("INSERT INTO orchestration_v2_projection_subagents VALUES ('replacement','root','other','app_owned','running',?)", [JSON.stringify({ startedAt: later })]);
			}
			return "success";
		});
		expect((await result(start(files))).status).toBe(0);
		expect(fake.commands.map((command) => command.type)).toEqual(["provider.switch"]);
	}
});

test("a WIP child can cross providers and preserve its parent follow-up task", async () => {
	const files = fixture();
	child(files, "worker");
	files.db.run("UPDATE orchestration_v2_projection_threads SET payload_json=json_set(payload_json,'$.modelSelection.model','claude-opus-5-5','$.modelSelection.options',json('[{\"id\":\"effort\",\"value\":\"high\"}]')) WHERE thread_id='worker'");
	config(files, { reserved: ["claude-hello", "claude-r90", "claude-mistystep", "codex-r90"] });
	const fake = server(files);
	const output = await result(start(files));
	expect(output.status).toBe(0);
	expect(fake.commands[0].modelSelection).toEqual({ instanceId: "codex", model: "gpt-6.1-sol", options: [{ id: "reasoningEffort", value: "high" }] });
	expect(plans(output)[0]).toMatchObject({ moved: "worker", kind: "provider", task: "followup:worker" });
});

test("Home must intentionally change the maintained root after succession; titles confer no eligibility", async () => {
	const files = fixture();
	thread(files, "old", "codex", { message: handoffRefusal });
	thread(files, "replacement", "codex", sol("high"));
	files.db.run("UPDATE orchestration_v2_projection_threads SET payload_json=json_set(payload_json,'$.title','Old (succeeded by replacement)') WHERE thread_id='old'");
	config(files, { wipRoots: ["old"] });
	const fake = server(files);
	expect((await result(start(files))).status).toBe(0);
	expect(fake.commands).toEqual([]);
	config(files, { wipRoots: ["replacement"] });
	expect((await result(start(files))).status).toBe(0);
	expect(fake.commands.filter((command) => command.type === "message.dispatch").map((command) => command.threadId)).toEqual(["replacement"]);
});

test("cross-provider recovery refuses implicit effort", async () => {
	const files = fixture();
	thread(files, "implicit", "codex", { model: "gpt-6.1-sol", options: [] });
	config(files, { reserved: ["codex-mistystep", "codex-r90"] });
	const fake = server(files);
	expect((await result(start(files))).status).toBe(0);
	expect(fake.commands).toEqual([]);
});

test("abandoned provider continuations notify Home once with both selections", async () => {
	const files = fixture();
	thread(files, "lane", "codex", sol("high"));
	config(files, { reserved: ["codex-mistystep", "codex-r90"] });
	const fake = server(files, (command) => command.type === "message.dispatch" ? "failure" : "success");
	for (let pass = 0; pass < 4; pass++) expect((await result(start(files))).status).toBe(0);
	expect(posts(files)).toHaveLength(1);
	expect(posts(files)[0].body).toContain("abandoned recovery");
	expect(posts(files)[0].body).toContain("claude-opus-5-5");
	expect(posts(files)[0].body).toContain("gpt-6.1-sol");
	expect(fake.commands.filter((command) => command.type === "provider.switch")).toHaveLength(1);
});


test("malformed or duplicate WIP config fails closed", async () => {
	for (const wipRoots of [null, "root", ["root", "root"], [""]]) {
		const files = fixture();
		thread(files);
		config(files, { wipRoots });
		expect((await result(start(files))).status).toBe(1);
		expect(existsSync(join(files.root, "auth-calls"))).toBe(false);
	}
});

test("persisted out-of-scope moves cannot bypass the WIP boundary", async () => {
	for (const phase of ["switch", "continue", "announce"]) {
		const files = fixture();
		const selection = thread(files, "excluded");
		config(files, { wipRoots: [] });
		mkdirSync(join(files.root, "state/t3-pool"), { recursive: true });
		writeFileSync(join(files.root, "state/t3-pool/state.json"), JSON.stringify({ version: 1, limits: {}, moves: [{
			threadId: "excluded", runId: "excluded:run", from: "claudeAgent", to: phase === "announce" ? "claudeAgent" : "claude-hello",
			target: phase === "announce" ? selection : { ...selection, instanceId: "claude-hello" },
			modelSelection: selection, runtimeMode: "full-access", phase, attempt: 0, rejections: 0,
			kind: ["switch", "continue"].includes(phase) ? "account" : "successor", successor: "forged",
		}] }));
		const fake = server(files);
		expect((await result(start(files))).status).toBe(0);
		expect(fake.commands).toEqual([]);
		expect(existsSync(join(files.root, "home-posts"))).toBe(false);
	}
});

test("a pending Home request resumes only notification", async () => {
	const files = fixture();
	const selection = thread(files, "big", "claude-mistystep", { message: handoffRefusal });
	mkdirSync(join(files.root, "state/t3-pool"), { recursive: true });
	writeFileSync(join(files.root, "state/t3-pool/state.json"), JSON.stringify({ version: 1, limits: {}, moves: [{
		threadId: "big", runId: "big:run", from: "claude-mistystep", to: "claude-mistystep", target: selection,
		modelSelection: selection, runtimeMode: "full-access", phase: "done", kind: "successor", notificationPending: true, attempt: 0,
	}] }));

	expect((await result(start(files))).status).toBe(0);
	expect(posts(files)).toHaveLength(1);
	expect((await result(start(files))).status).toBe(0);
	expect(posts(files)).toHaveLength(1);
});

test("a pending legacy child succession notice becomes parent recovery without a marker", async () => {
	const files = fixture();
	child(files, "big-child");
	files.db.run("UPDATE orchestration_v2_projection_turn_items SET payload_json=json_set(payload_json,'$.failure.class','provider_error','$.failure.message',?)", [handoffRefusal]);
	const selection = { instanceId: "claudeAgent", model: "model-original", options: [{ id: "reasoningEffort", value: "max" }, { id: "fastMode", value: true }] };
	seedMove(files, selection, { threadId: "big-child", runId: "big-child:run", to: "claudeAgent", target: selection,
		child: true, kind: "successor", phase: "done", notificationPending: true });
	const before = readFileSync(join(files.root, "userdata/statev2.sqlite"));
	const fake = server(files);
	for (let pass = 0; pass < 2; pass++) expect((await result(start(files))).status).toBe(0);
	expect(fake.commands).toEqual([]);
	expect(readFileSync(join(files.root, "userdata/statev2.sqlite"))).toEqual(before);
	expect(posts(files)).toHaveLength(1);
	expect(posts(files)[0].body).toContain("t3-thread://v1/parent");
	expect(posts(files)[0].body).not.toContain("Lane succession requested:");
	expect(posts(files)[0].body).not.toContain("Handoff: none;");
	expect(state(files).moves[0]).toMatchObject({ kind: "parent", phase: "done" });
	expect(existsSync(join(files.root, "auth-calls"))).toBe(false);
});

for (const [name, patch] of Object.entries({
	"target identity mismatch": { target: { instanceId: "claude-r90", model: "model-original" } },
	"source identity mismatch": { from: "codex" },
	"null kind": { kind: null },
	"null child flag": { child: null },
	"successor at switch": { kind: "successor" },
	"account at launch": { phase: "launch" },
	"account at settle": { phase: "settle" },
	"account at announce": { phase: "announce" },
	"provider without target": { kind: "provider", target: undefined },
	"account without target": { target: undefined },
	"account with a different model": { target: { instanceId: "claude-hello", model: "another-model" } },
	"account with successor notification": { phase: "done", notificationPending: true },
	"exhausted rejection count before abandonment": { rejections: 3 },
})) test(`rejects inconsistent persisted move: ${name} before auth or writes`, async () => {
	const files = fixture();
	const selection = thread(files);
	config(files, { reserved: ["claude-r90"] });
	seedMove(files, selection, patch);
	const path = join(files.root, "state/t3-pool/state.json");
	const before = readFileSync(path);
	const fake = server(files);
	expect((await result(start(files))).status).toBe(1);
	expect(readFileSync(path)).toEqual(before);
	expect(fake.commands).toEqual([]);
	expect(existsSync(join(files.root, "auth-calls"))).toBe(false);
	expect(existsSync(join(files.root, "home-posts"))).toBe(false);
	expect(existsSync(join(files.root, "state/home/inbox.md"))).toBe(false);
});

test("legacy account moves without kind or target resume on their reserved account", async () => {
	const files = fixture();
	const selection = thread(files);
	seedMove(files, selection, { kind: undefined, target: undefined, child: undefined });
	const fake = server(files);
	expect((await result(start(files))).status).toBe(0);
	expect(fake.commands.map((command) => command.type)).toEqual(["provider.switch", "message.dispatch"]);
	expect(fake.commands[0].modelSelection).toEqual({ ...selection, instanceId: "claude-hello" });
});

for (const boundary of ["auth", "ack"] as const) {
	for (const change of ["target removal", "pool change", "mapping change", "effort removal"] as const) {
		test(`revalidates ${change} at ${boundary} before dispatch`, async () => {
			const files = fixture();
			thread(files, "limited", "claudeAgent", { model: "claude-opus-5-5", options: [{ id: "effort", value: "high" }] });
			config(files, { reserved: ["claude-hello", "claude-r90", "claude-mistystep"] });
			const patch = change === "target removal" ? { pools: [["claudeAgent", "claude-mistystep"], ["codex-mistystep", "codex-r90"]] }
				: change === "pool change" ? { pools: [["claudeAgent", "codex"], ["claude-mistystep", "codex-mistystep"]] }
				: change === "mapping change" ? { crossProvider: [{ "claude-opus-5-5": "effort", "another-model": "reasoningEffort" }] }
				: { efforts: ["low"] };
			if (boundary === "auth") writeFileSync(join(files.root, "auth-config.json"), JSON.stringify(patch));
			const fake = server(files, () => { if (boundary === "ack") config(files, patch); return "success"; });
			expect((await result(start(files))).status).toBe(0);
			expect(fake.commands.map((command) => command.type)).toEqual(boundary === "auth" ? [] : ["provider.switch"]);
			expect(existsSync(join(files.root, "revoked"))).toBe(true);
			if (boundary === "ack") {
				expect(state(files).moves[0].phase).toBe("abandoned");
				expect(posts(files)).toHaveLength(1);
				expect((await result(start(files))).status).toBe(0);
				expect(posts(files)).toHaveLength(1);
			}
		});
	}
	test(`removing the same-provider target at ${boundary} prevents continuation`, async () => {
		const files = fixture();
		thread(files);
		const patch = { pools: [["claudeAgent", "claude-mistystep"], ["codex", "codex-mistystep"]] };
		if (boundary === "auth") writeFileSync(join(files.root, "auth-config.json"), JSON.stringify(patch));
		const fake = server(files, () => { if (boundary === "ack") config(files, patch); return "success"; });
		expect((await result(start(files))).status).toBe(0);
		expect(fake.commands.map((command) => command.type)).toEqual(boundary === "auth" ? [] : ["provider.switch"]);
	});
}

test("removing WIP roots during auth still prevents every command", async () => {
	const files = fixture();
	thread(files);
	writeFileSync(join(files.root, "auth-config.json"), JSON.stringify({ wipRoots: [] }));
	const fake = server(files);
	expect((await result(start(files))).status).toBe(0);
	expect(fake.commands).toEqual([]);
	expect(existsSync(join(files.root, "revoked"))).toBe(true);
});

for (const interruptedNotice of [false, true]) test(`cached third rejection durably notifies Home${interruptedNotice ? " after notification failure and restart" : " once"}`, async () => {
	const files = fixture();
	const selection = thread(files, "limited", "claudeAgent", { model: "claude-opus-5-5", options: [{ id: "effort", value: "high" }] });
	const target = { instanceId: "codex", ...sol("high"), options: [{ id: "reasoningEffort", value: "high" }] };
	files.db.run("UPDATE orchestration_v2_projection_threads SET provider_instance_id='codex', payload_json=json_set(payload_json,'$.providerInstanceId','codex','$.modelSelection',json(?))", [JSON.stringify(target)]);
	seedMove(files, selection, { kind: "provider", to: "codex", target, phase: "continue", attempt: 2, rejections: 2 });
	files.db.run("INSERT INTO orchestration_command_receipts VALUES ('t3-pool:limited:run:continue:2','rejected')");
	const fake = server(files);
	const inbox = join(files.root, "state/home/inbox.md");
	if (interruptedNotice) {
		writeFileSync(join(files.root, "home-fails"), "fixture");
		mkdirSync(inbox, { recursive: true });
	}
	expect((await result(start(files))).status).toBe(interruptedNotice ? 1 : 0);
	expect(state(files).moves[0]).toMatchObject({ phase: "abandoned", rejections: 3 });
	if (interruptedNotice) {
		rmSync(join(files.root, "home-fails"));
		rmSync(inbox, { recursive: true });
		// A newer run must not prune an undelivered terminal notification.
		run(files, "limited", "newer", { status: "completed", ordinal: 2, completedAt: later });
	}
	expect((await result(start(files))).status).toBe(0);
	expect(posts(files)).toHaveLength(1);
	expect(posts(files)[0].body).toContain("after three rejected commands");
	expect(posts(files)[0].body).toContain("claude-opus-5-5");
	expect(posts(files)[0].body).toContain("gpt-6.1-sol");
	expect(fake.commands).toEqual([]);
	expect(readFileSync(join(files.root, "state/t3-pool/rejections.jsonl"), "utf8")).toContain('"rejections":3');
});

for (const timing of ["ack", "restart"] as const) test(`a provider target limited after switch at ${timing} notifies Home once`, async () => {
	const files = fixture();
	thread(files, "limited", "claudeAgent", { model: "claude-opus-5-5", options: [{ id: "effort", value: "high" }] });
	config(files, { reserved: ["claude-hello", "claude-r90", "claude-mistystep"] });
	const limitTarget = () => {
		thread(files, "target-limited", "codex");
		config(files, { wipRoots: ["limited"] });
	};
	const fake = server(files, (command) => {
		if (timing === "ack") limitTarget();
		return command.type === "message.dispatch" ? "failure" : "success";
	});
	expect((await result(start(files))).status).toBe(0);
	if (timing === "restart") limitTarget();
	const before = fake.commands.length;
	for (let pass = 0; pass < 2; pass++) expect((await result(start(files))).status).toBe(0);
	expect(fake.commands).toHaveLength(before);
	expect(fake.commands.filter((command) => command.type === "provider.switch")).toHaveLength(1);
	if (timing === "ack") expect(fake.commands.map((command) => command.type)).toEqual(["provider.switch"]);
	expect(state(files).moves[0].phase).toBe("abandoned");
	expect(posts(files)).toHaveLength(1);
	expect(posts(files)[0].body).toContain("target is now limited");
	expect(posts(files)[0].body).toContain("claude-opus-5-5");
	expect(posts(files)[0].body).toContain("gpt-6.1-sol");
});

for (const accepted of [false, true]) test(`a superseded provider recovery ${accepted ? "with an accepted continuation does not alert" : "notifies Home before pruning"}`, async () => {
	const files = fixture();
	const selection = thread(files, "limited", "claudeAgent", { model: "claude-opus-5-5", options: [{ id: "effort", value: "high" }] });
	const target = { instanceId: "codex", model: "gpt-6.1-sol", options: [{ id: "reasoningEffort", value: "high" }] };
	seedMove(files, selection, { kind: "provider", to: "codex", target, phase: "continue" });
	files.db.run("INSERT INTO orchestration_command_receipts VALUES ('t3-pool:limited:run:switch:0','accepted')");
	run(files, "limited", "newer", { status: "completed", ordinal: 2, completedAt: later });
	if (accepted) files.db.run("INSERT INTO orchestration_command_receipts VALUES ('t3-pool:limited:run:continue:0','accepted')");
	const fake = server(files);
	expect((await result(start(files))).status).toBe(0);
	expect(fake.commands).toEqual([]);
	expect(existsSync(join(files.root, "home-posts"))).toBe(!accepted);
	expect(state(files).moves).toEqual([]);
	if (!accepted) {
		expect(posts(files)).toHaveLength(1);
		expect(posts(files)[0].body).toContain("no longer current");
	}
});


test("the shipped roster accepts Upkeep and the Voice drain without a fixed lane cap", async () => {
	const files = fixture();
	expect(defaults.wipRoots).toEqual([
		"mcp:8145fc74-15ad-428f-b7f6-d9b162fff416", "mcp:bb364610-42c9-4d68-a43d-7c67c79bf07a",
		"mcp:8449eb2b-175f-48cf-ae80-f9f699c7879f", "mcp:51b7a12d-8392-4fb0-b270-6aaafb8b63f8",
		"mcp:69a8cc28-3648-4607-b15a-143e48dd80b5", "mcp:2ee20fca-f82d-4e94-812b-204ef22308f6",
	]);
	for (const id of [...defaults.wipRoots, "unnamed"]) thread(files, id, "codex", { message: handoffRefusal });
	config(files, { wipRoots: defaults.wipRoots });
	const fake = server(files);
	for (let pass = 0; pass < defaults.wipRoots.length; pass++) expect((await result(start(files))).status).toBe(0);
	expect(posts(files)).toHaveLength(defaults.wipRoots.length);
	for (const id of defaults.wipRoots) expect(posts(files).some((post) => post.body.includes(`t3-thread://v1/${id}`))).toBe(true);
	expect(posts(files).some((post) => post.body.includes("t3-thread://v1/unnamed"))).toBe(false);
	expect(fake.commands).toEqual([]);
	// Home can name another lane; the planner has no global numeric admission cap.
	config(files, { wipRoots: [...defaults.wipRoots, "unnamed"] });
	expect((await result(start(files))).status).toBe(0);
	expect(posts(files)).toHaveLength(defaults.wipRoots.length + 1);
});


test.each(["run", "task"])("never revives a child after newer parent %s work", async (kind) => {
	const files = fixture();
	child(files, "stale-child", "root");
	if (kind === "run") run(files, "root", "replacement-run", { status: "running", startedAt: later, completedAt: null });
	else files.db.run("INSERT INTO orchestration_v2_projection_subagents VALUES ('replacement','root','new-child','app_owned','running',?)", [JSON.stringify({ startedAt: later })]);
	const fake = server(files);
	const dry = plans(await result(start(files, ["--dry-run"])));
	expect(dry.at(-1)).toMatchObject({ planned: 0, excluded: { "delegated child: parent has newer work": 1 } });
	expect((await result(start(files))).status).toBe(0);
	expect(fake.commands).toEqual([]);
	expect(existsSync(join(files.root, "auth-calls"))).toBe(false);
});


test.each(["file", "key", "json"])("an absent or invalid roster %s authorizes no action", async (defect) => {
	const files = fixture();
	thread(files);
	const path = join(files.root, "config/t3-pool.json");
	if (defect === "file") rmSync(path);
	if (defect === "key") {
		const value = JSON.parse(readFileSync(path, "utf8"));
		delete value.wipRoots;
		writeFileSync(path, JSON.stringify(value));
	}
	if (defect === "json") writeFileSync(path, "{");
	const fake = server(files);
	for (const args of [["--dry-run"], []]) expect((await result(start(files, args))).status).toBe(1);
	expect(existsSync(join(files.root, "auth-calls"))).toBe(false);
	expect(existsSync(join(files.root, "state"))).toBe(false);
	expect(fake.commands).toEqual([]);
});

function selectTarget(files: Fixture, target: ReturnType<typeof thread>) {
	files.db.run("UPDATE orchestration_v2_projection_threads SET provider_instance_id=?, payload_json=json_set(payload_json,'$.providerInstanceId',?,'$.modelSelection',json(?)) WHERE thread_id='limited'",
		[target.instanceId, target.instanceId, JSON.stringify(target)]);
}

for (const kind of ["account", "provider"] as const) {
	for (const phase of ["switch", "continue"] as const) {
		for (const applied of ["receipt", "selection", "both"] as const) {
			for (const eligibility of ["eligible", "limited", "removed"] as const) test(`applied recovery ${kind}/${phase}/${applied}/${eligibility} continues or alerts once`, async () => {
				const files = fixture();
				const selection = thread(files, "limited", "claudeAgent", { model: "claude-opus-5-5", options: [{ id: "effort", value: "high" }] });
				const target = kind === "account" ? { ...selection, instanceId: "claude-hello" }
					: { instanceId: "codex", model: "gpt-6.1-sol", options: [{ id: "reasoningEffort", value: "high" }] };
				seedMove(files, selection, { kind, phase, to: target.instanceId, target });
				if (applied !== "selection") files.db.run("INSERT INTO orchestration_command_receipts VALUES ('t3-pool:limited:run:switch:2','accepted')");
				if (applied !== "receipt") selectTarget(files, target);
				if (eligibility === "limited") {
					thread(files, "target-limited", target.instanceId);
					config(files, { wipRoots: ["limited"] });
				} else if (eligibility === "removed") config(files, { pools: [["claudeAgent", "claude-mistystep"], ["codex-mistystep", "codex-r90"]] });
				const fake = server(files);
				for (let pass = 0; pass < 3; pass++) expect((await result(start(files))).status).toBe(0);
				if (eligibility === "eligible" && applied !== "receipt") {
					expect(fake.commands.filter((command) => command.type === "message.dispatch")).toHaveLength(1);
					expect(state(files).moves[0].phase).toBe("done");
					expect(existsSync(join(files.root, "home-posts"))).toBe(false);
				} else {
					expect(fake.commands).toEqual([]);
					expect(state(files).moves[0]).toMatchObject({ phase: "abandoned", notice: { status: "sent" } });
					expect(posts(files)).toHaveLength(1);
					expect(posts(files)[0].body).toContain(`original selection: ${JSON.stringify(selection)}`);
					expect(posts(files)[0].body).toContain(`selected target: ${JSON.stringify(target)}`);
				}
			});
		}
		for (const eligibility of ["eligible", "limited"] as const) test(`accepted continuation completes ${kind}/${phase}/${eligibility} without auth, replay or alert`, async () => {
			const files = fixture();
			const selection = thread(files, "limited", "claudeAgent", { model: "claude-opus-5-5", options: [{ id: "effort", value: "high" }] });
			const target = kind === "account" ? { ...selection, instanceId: "claude-hello" }
				: { instanceId: "codex", model: "gpt-6.1-sol", options: [{ id: "reasoningEffort", value: "high" }] };
			seedMove(files, selection, { kind, phase, to: target.instanceId, target, attempt: 2 });
			files.db.run("INSERT INTO orchestration_command_receipts VALUES ('t3-pool:limited:run:continue:1','accepted')");
			if (eligibility === "limited") { thread(files, "target-limited", target.instanceId); config(files, { wipRoots: ["limited"] }); }
			const fake = server(files);
			for (let pass = 0; pass < 2; pass++) expect((await result(start(files))).status).toBe(0);
			expect(state(files).moves[0]).toMatchObject({ phase: "done", notice: null });
			expect(fake.commands).toEqual([]);
			expect(existsSync(join(files.root, "auth-calls"))).toBe(false);
			expect(existsSync(join(files.root, "home-posts"))).toBe(false);
		});
	}
	for (const boundary of ["auth", "ack", "lost-ack"] as const) {
		for (const eligibility of boundary === "auth" ? ["reserved", "removed"] : ["limited", "removed"]) test(`interrupted recovery ${kind}/${boundary}/${eligibility} alerts only for an applied switch`, async () => {
			const files = fixture();
			thread(files, "limited", "claudeAgent", { model: "claude-opus-5-5", options: [{ id: "effort", value: "high" }] });
			if (kind === "provider") config(files, { reserved: ["claude-hello", "claude-r90", "claude-mistystep"] });
			const target = kind === "account" ? "claude-hello" : "codex";
			const patch = { pools: [["claudeAgent", "claude-mistystep"], ["codex-mistystep", "codex-r90"]] };
			if (boundary === "auth") {
				writeFileSync(join(files.root, "auth-config.json"), JSON.stringify(eligibility === "removed" ? patch : { reserved: [target] }));
			}
			const fake = server(files, () => {
				if (boundary !== "auth") {
					if (eligibility === "removed") config(files, patch);
					else { thread(files, "target-limited", target); config(files, { wipRoots: ["limited"] }); }
				}
				return boundary === "lost-ack" ? "close" : "success";
			});
			expect((await result(start(files))).status).toBe(boundary === "lost-ack" ? 1 : 0);
			if (boundary === "lost-ack") expect(state(files).moves[0].phase).toBe("switch");
			for (let pass = 0; pass < 2; pass++) expect((await result(start(files))).status).toBe(0);
			expect(fake.commands.map((command) => command.type)).toEqual(boundary === "auth" ? [] : ["provider.switch"]);
			expect(existsSync(join(files.root, "home-posts"))).toBe(boundary !== "auth");
			if (boundary !== "auth") {
				expect(posts(files)).toHaveLength(1);
				expect(state(files).moves[0]).toMatchObject({ phase: "abandoned", notice: { status: "sent" } });
			}
		});
	}
}

for (const owner of ["root", "child"] as const) {
	for (const unrelated of ["root", "child", "suffix"] as const) test(`usage recovery ignores display titles for ${owner} with unrelated ${unrelated}`, async () => {
		const files = fixture();
		if (owner === "root") thread(files);
		else child(files, "limited", "parent");
		const title = unrelated === "suffix" ? "Spec axis review (succeeded by unrelated)" : "Spec axis review";
		files.db.run("UPDATE orchestration_v2_projection_threads SET payload_json=json_set(payload_json,'$.title',?) WHERE thread_id='limited'", [title]);
		if (unrelated === "root") thread(files, "unrelated", "claude-r90", { status: "completed" });
		else child(files, "unrelated", "other-parent");
		files.db.run("UPDATE orchestration_v2_projection_threads SET payload_json=json_set(payload_json,'$.title',?,'$.createdAt',?) WHERE thread_id='unrelated'", [title, new Date().toISOString()]);
		config(files, { wipRoots: [owner === "root" ? "limited" : "parent"] });
		const fake = server(files);
		expect(plans(await result(start(files, ["--dry-run"])))[0]).toMatchObject({ thread: "limited", kind: "account" });
		expect((await result(start(files))).status).toBe(0);
		expect(fake.commands.map((command) => command.type)).toEqual(["provider.switch", "message.dispatch"]);
		expect(state(files).moves[0]).toMatchObject({ phase: "done", child: owner === "child" });
		if (owner === "child") expect(fake.applied.has("t3-pool:limited:run:continue:0")).toBe(true);
	});
}

for (const owner of ["root", "child"] as const) test(`handoff title deduplication applies only to a top-level root, ${owner} control`, async () => {
	const files = fixture();
	if (owner === "root") thread(files, "limited", "claudeAgent", { message: handoffRefusal });
	else {
		child(files, "limited", "parent");
		files.db.run("UPDATE orchestration_v2_projection_turn_items SET payload_json=json_set(payload_json,'$.failure.class','provider_error','$.failure.message',?) WHERE thread_id='limited'", [handoffRefusal]);
	}
	thread(files, "unrelated", "claude-r90", { status: "completed" });
	files.db.run("UPDATE orchestration_v2_projection_threads SET payload_json=json_set(payload_json,'$.title','Lane limited','$.createdAt',?) WHERE thread_id='unrelated'", [new Date().toISOString()]);
	config(files, { wipRoots: [owner === "root" ? "limited" : "parent"] });
	const fake = server(files);
	expect((await result(start(files))).status).toBe(0);
	expect(fake.commands).toEqual([]);
	expect(existsSync(join(files.root, "home-posts"))).toBe(owner === "child");
	if (owner === "child") {
		expect(posts(files)[0].body).toContain("t3-thread://v1/parent");
		expect(posts(files)[0].body).not.toContain("Lane succession requested:");
		expect(posts(files)[0].body).not.toContain("Handoff: none;");
	}
});

for (const kind of ["account", "provider"] as const) test(`applied ${kind} switch reports interruption when the source limit expires`, async () => {
	const files = fixture();
	const selection = thread(files, "limited", "claudeAgent", { model: "claude-opus-5-5", options: [{ id: "effort", value: "high" }], resetAt: past });
	const target = kind === "account" ? { ...selection, instanceId: "claude-hello" }
		: { instanceId: "codex", model: "gpt-6.1-sol", options: [{ id: "reasoningEffort", value: "high" }] };
	selectTarget(files, target);
	seedMove(files, selection, { kind, to: target.instanceId, target });
	const fake = server(files);
	for (let pass = 0; pass < 2; pass++) expect((await result(start(files))).status).toBe(0);
	expect(fake.commands).toEqual([]);
	expect(posts(files)).toHaveLength(1);
	expect(posts(files)[0].body).toContain("source has room or its limit expired");
});

for (const kind of ["account", "provider"] as const) {
	for (const boundary of ["auth", "ack"] as const) test(`accepted continuation arriving at ${kind}/${boundary} prevents replay and false alerts`, async () => {
		const files = fixture();
		thread(files, "limited", "claudeAgent", { model: "claude-opus-5-5", options: [{ id: "effort", value: "high" }] });
		if (kind === "provider") config(files, { reserved: ["claude-hello", "claude-r90", "claude-mistystep"] });
		const receipt = "t3-pool:limited:run:continue:0";
		if (boundary === "auth") writeFileSync(join(files.root, "auth-receipt"), receipt);
		const fake = server(files, () => {
			if (boundary === "ack") files.db.run("INSERT INTO orchestration_command_receipts VALUES (?, 'accepted')", [receipt]);
			return "success";
		});
		for (let pass = 0; pass < 2; pass++) expect((await result(start(files))).status).toBe(0);
		expect(fake.commands.map((command) => command.type)).toEqual(boundary === "auth" ? [] : ["provider.switch"]);
		expect(state(files).moves[0]).toMatchObject({ phase: "done", notice: null });
		expect(existsSync(join(files.root, "home-posts"))).toBe(false);
	});
	test(`interrupted applied ${kind} recovery retains a failed notice across restart and pruning`, async () => {
		const files = fixture();
		const selection = thread(files, "limited", "claudeAgent", { model: "claude-opus-5-5", options: [{ id: "effort", value: "high" }] });
		const target = kind === "account" ? { ...selection, instanceId: "claude-hello" }
			: { instanceId: "codex", model: "gpt-6.1-sol", options: [{ id: "reasoningEffort", value: "high" }] };
		seedMove(files, selection, { kind, to: target.instanceId, target });
		selectTarget(files, target);
		thread(files, "target-limited", target.instanceId);
		config(files, { wipRoots: ["limited"] });
		writeFileSync(join(files.root, "home-fails"), "fixture");
		const inbox = join(files.root, "state/home/inbox.md");
		mkdirSync(inbox, { recursive: true });
		const fake = server(files);
		expect((await result(start(files))).status).toBe(1);
		expect(state(files).moves[0]).toMatchObject({ phase: "abandoned", notice: { status: "pending" } });
		run(files, "limited", "newer", { status: "completed", ordinal: 2, completedAt: later });
		rmSync(join(files.root, "home-fails"));
		rmSync(inbox, { recursive: true });
		for (let pass = 0; pass < 2; pass++) expect((await result(start(files))).status).toBe(0);
		expect(fake.commands).toEqual([]);
		expect(posts(files)).toHaveLength(1);
		expect(posts(files)[0].poolState.moves[0]).toMatchObject({ phase: "abandoned", notice: { status: "pending" } });
		expect(state(files).moves).toEqual([]);
	});
}
