import { strict as assert } from "node:assert";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { openRuntime } from "../durable.ts";
import { pilotTools } from "../pilot-tools.ts";
import { createSummonModels } from "./models-fixture.mjs";

const directory = fileURLToPath(new URL(".", import.meta.url));
const hash = (text) => createHash("sha256").update(text).digest("hex");
function fixture(root) {
	const runId = "cf1:durable-fixture", sessionId = `summon-${hash(runId)}`, text = "Read the stable fixture.";
	const input = { runId, attemptId: "claim-1", inputId: "input-1", textSha256: hash(text), sessionId,
		sessionFile: join(root, `${sessionId}.sqlite`), text };
	writeFileSync(join(root, "input.json"), JSON.stringify(input));
	writeFileSync(join(root, "source.txt"), "stable read result\n");
	return input;
}
async function until(predicate) {
	for (let i = 0; i < 500; i++) { if (predicate()) return; await sleep(10); }
	throw new Error("bounded fixture condition was not observed");
}
function worker(root, policy, mode) {
	const child = spawn(process.execPath, [join(directory, "crash-worker.mjs"), root, policy, mode],
		{ env: { ...process.env, FIXTURE_CALLS: join(root, "model-calls") }, stdio: ["ignore", "pipe", "pipe"] });
	let stderr = "";
	child.stderr.on("data", (chunk) => { stderr += chunk; });
	const exit = once(child, "exit");
	return { child, exit, stderr: () => stderr };
}

for (const policy of ["safe", "unsafe"]) {
	test(`SIGKILL mid-tool, reopen SQLite, ${policy} replay and requestId dedup`, { timeout: 15000 }, async () => {
		const root = mkdtempSync(join(tmpdir(), "summon-crash-"));
		const input = fixture(root);
		const first = worker(root, policy, "start");
		let second;
		try {
			await until(() => (existsSync(join(root, "mid-tool")) && existsSync(join(root, "admission.json"))) || first.child.exitCode !== null);
			assert.ok(existsSync(join(root, "mid-tool")), first.stderr());
			console.log(`${policy}: tool intent persisted; execute entered; sending SIGKILL`);
			first.child.kill("SIGKILL");
			assert.deepEqual(await first.exit, [null, "SIGKILL"]);
			writeFileSync(join(root, "release"), "resume\n");
			second = worker(root, policy, "resume");
			assert.deepEqual(await second.exit, [0, null], second.stderr());
			const result = JSON.parse(readFileSync(join(root, "result.json"), "utf8"));
			const admission = JSON.parse(readFileSync(join(root, "admission.json"), "utf8"));
			assert.equal(result.submissionId, admission.submissionId);
			assert.equal(result.conversationId, admission.conversationId);
			assert.equal(result.settled.status, "done");
			assert.equal(result.entries.filter((entry) => entry.kind === "pi.user").length, 1);
			assert.equal(result.entries.filter((entry) => entry.kind === "summon.pi.receipt.v1").length, 1);
			const invocations = readFileSync(join(root, "invocations"), "utf8").trim().split("\n").length;
			assert.equal(invocations, policy === "safe" ? 2 : 1);
			const toolResult = result.entries.find((entry) => entry.kind === "pi.tool-result");
			assert.ok(toolResult);
			if (policy === "safe") assert.equal(toolResult.model[0].content[0].text, "stable read result\n");
			else { assert.equal(toolResult.model[0].isError, true); assert.match(JSON.stringify(toolResult), /interrupted/i); }
			assert.equal(readFileSync(join(root, "model-calls"), "utf8").trim().split("\n").length, 2);
			console.log(`${policy}: reopened same conversation; 1 user input; 1 receipt; ${invocations} tool executions; 2 fixture model calls; settled=done`);
		} finally {
			for (const process of [first, second]) if (process && process.child.exitCode === null && process.child.signalCode === null) {
				process.child.kill("SIGKILL"); await process.exit;
			}
			rmSync(root, { recursive: true, force: true });
		}
	});
}

test("reopen a binding without admission stays uncertain and never dispatches", async () => {
	const root = mkdtempSync(join(tmpdir(), "summon-uncertain-")), input = fixture(root);
	const options = { ...input, resume: false, provider: "openai-codex", model: "fixture", effort: "off", cwd: root,
		instructions: [], models: createSummonModels(), tools: pilotTools(root) };
	let runtime = await openRuntime(options);
	try {
		assert.equal((await runtime.receipt(input)).state, "absent");
		await runtime.conversation.commit((tx) => tx.appendEntry(runtime.conversation.id, { kind: "summon.pi.input.v1", data: input }), context);
		await runtime.close();
		runtime = await openRuntime({ ...options, resume: true });
		assert.equal((await runtime.receipt(input)).state, "uncertain");
		const state = await runtime.state();
		assert.equal(state.isStreaming, false); assert.equal(state.pendingMessageCount, 0);
		assert.equal((await runtime.conversation.entries({}, 100, undefined, context)).items.some((entry) => entry.kind === "pi.user"), false);
	} finally { await runtime.close(); rmSync(root, { recursive: true, force: true }); }
});

test("RPC bridge dispatch, durable observations, duplicate refusal and reopen", { timeout: 15000 }, async () => {
	const root = mkdtempSync(join(tmpdir(), "summon-rpc-"));
	const input = fixture(root), bridge = fileURLToPath(new URL("../durable-rpc.ts", import.meta.url));
	const base = [bridge, "--mode", "rpc", "--offline", "--provider", "openai-codex", "--model", "fixture",
		"--thinking", "off", "--extension", bridge, "--tools", "read,grep,find,ls", "--run-id", input.runId,
		"--session-id", input.sessionId, "--session-dir", root];
	async function run(resume) {
		const child = spawn(process.execPath, [...base, ...(resume ? ["--session", input.sessionFile] : [])],
			{ cwd: root, env: { ...process.env, SUMMON_PI_MODELS_MODULE: join(directory, "models-fixture.mjs"), FIXTURE_CALLS: join(root, "calls") } });
		const exit = once(child, "exit");
		let output = "", errors = "", buffer = ""; const records = [];
		child.stdout.on("data", (chunk) => {
			output += chunk; buffer += chunk;
			let newline; while ((newline = buffer.indexOf("\n")) >= 0) { records.push(JSON.parse(buffer.slice(0, newline))); buffer = buffer.slice(newline + 1); }
		});
		child.stderr.on("data", (chunk) => { errors += chunk; });
		async function command(type, extra = {}) {
			const id = String(records.length);
			child.stdin.write(`${JSON.stringify({ id, type, ...extra })}\n`);
			await until(() => records.some((record) => record.id === id) || child.exitCode !== null);
			const response = records.find((record) => record.id === id);
			assert.ok(response, errors); return response;
		}
		try {
			const state = await command("get_state"); assert.equal(state.data.engine, "pi-durable");
			assert.equal(state.data.sessionFile, input.sessionFile);
			assert.equal((await command("set_auto_retry", { enabled: false })).success, true);
			const submit = await command("prompt", { message: `/summon-native-input ${JSON.stringify(input)}` });
			assert.equal(submit.success, true, output + errors);
			await until(() => records.some((record) => record.type === "agent_settled"));
			assert.equal((await command("prompt", { message: `/summon-native-input ${JSON.stringify(input)}` })).success, true);
			assert.equal((await command("prompt", { message: `/summon-native-receipt ${JSON.stringify(input)}` })).data.state, "acknowledged");
			const projection = (await command("get_entries")).data;
			const binding = projection.entries.findIndex((entry) => entry.type === "custom_message");
			// Rust's answer search stops at the next custom input or native user.
			const after = projection.entries.slice(binding + 1);
			assert.equal(after.some((entry) => entry.message?.role === "user"), false);
			assert.equal(after.filter((entry) => entry.message?.role === "assistant").at(-1).message.stopReason, "stop");
			const changed = { ...input, text: "changed", textSha256: hash("changed") };
			assert.equal((await command("prompt", { message: `/summon-native-input ${JSON.stringify(changed)}` })).success, false);
			return state.data.conversationId;
		} finally { child.stdin.end(); const [code] = await exit; assert.equal(code, 0, errors); }
	}
	try {
		assert.equal(await run(false), await run(true));
		assert.equal(readFileSync(join(root, "calls"), "utf8").trim().split("\n").length, 2);
		const options = { ...input, resume: true, provider: "openai-codex", model: "fixture", effort: "off", cwd: root,
			instructions: ["changed loadout"], models: createSummonModels(), tools: pilotTools(root) };
		await assert.rejects(openRuntime(options), /loadout conflict/);
		await assert.rejects(openRuntime({ ...options, sessionFile: join(root, "missing.sqlite") }), /resume file unavailable/);
		const foreign = join(root, "foreign.jsonl"), bytes = '{"type":"session","id":"legacy"}\n';
		writeFileSync(foreign, bytes);
		await assert.rejects(openRuntime({ ...options, sessionFile: foreign }), /no replacement/);
		assert.equal(readFileSync(foreign, "utf8"), bytes);
		writeFileSync(foreign, "");
		await assert.rejects(openRuntime({ ...options, sessionFile: foreign }), /no replacement/);
		assert.equal(readFileSync(foreign, "utf8"), "");
	} finally { rmSync(root, { recursive: true, force: true }); }
});
