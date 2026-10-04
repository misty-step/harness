import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HarnessId, NativeEvent, NativeRequest, TaskSpec } from "./contract";
import { createNativeAdapter } from "./native";

// Representative records from primary CLI docs, not authenticated native runs:
// https://code.claude.com/docs/en/agent-sdk/typescript#sdkusermessagereplay
// https://antigravity.google/docs/cli/headless/#streaming-json
const SESSION = "055a398f-db14-4c5f-abbb-1bf03f8120a7";
// Fixed wire identity for fixture-run/fixture-message. The player never echoes argv/stdin.
const MESSAGE = "e7d67043-83ab-54af-b059-6dceae30c4c0";
const AUTH = { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "max" };
const TEXT = "Explain git rebase.";
const ANSWER = "Git rebase rewrites branch history. résumé";
const CLAUDE_INIT = { type: "system", subtype: "init", session_id: SESSION, apiKeySource: "none", model: "claude-opus-4-6" };
const REPLAY = { type: "user", uuid: MESSAGE, session_id: SESSION, isReplay: true, parent_tool_use_id: null, message: { role: "user", content: [{ type: "text", text: TEXT }] } };
const CLAUDE_RESULT = { type: "result", subtype: "success", session_id: SESSION, is_error: false, result: ANSWER, user_message_uuid: MESSAGE, usage: { input_tokens: 10418, output_tokens: 589, cache_read_input_tokens: 8113 } };
const AGY_INIT = { event: "init", conversation_id: SESSION, init: { cwd: "/home/user/project", tools: ["ask_permission", "run_command", "write_to_file"], permission_mode: "request-review", model: "gemini-3.1-pro-high" } };
const AGY_STEP = { event: "step_update", step_update: { conversation_id: SESSION, step_index: 0, state: "DONE", step_type: "user_input" } };
const AGY_RESULT = { event: "result", result: { conversation_id: SESSION, status: "SUCCESS", response: ANSWER, num_turns: 1, usage: { input_tokens: 10418, output_tokens: 589, thinking_tokens: 551, cache_read_tokens: 8113, total_tokens: 11007 } } };
const roots: string[] = [];

function records(...values: unknown[]): Buffer {
	return Buffer.from(`${values.map(value => JSON.stringify(value)).join("\n")}\n`);
}

function fixture(options: { output?: Buffer; auth?: unknown; registry?: string; exitCode?: number; hanging?: boolean; rejectBoundary?: boolean; envGuard?: boolean } = {}) {
	const scratch = join(homedir(), ".cache/tmp");
	mkdirSync(scratch, { recursive: true, mode: 0o700 });
	const root = mkdtempSync(join(scratch, "summon-native-protocol-"));
	roots.push(root);
	const binary = join(root, "record-player"), boundary = join(root, "protocol-boundary.py");
	// This pass-through is only a protocol-test transport. It is deliberately NOT
	// engineer isolation evidence: Main must exercise the real source boundary.
	writeFileSync(boundary, options.rejectBoundary ? "raise SystemExit(73)\n" : "import os, sys\nassert sys.argv[1] == '--'\nos.execv(sys.argv[2], sys.argv[2:])\n", { mode: 0o700 });
	const output = options.output ?? records(CLAUDE_INIT, REPLAY, CLAUDE_RESULT);
	writeFileSync(binary, `#!/usr/bin/python3
import base64, json, os, signal, subprocess, sys, time
${options.envGuard ? "if 'OPENROUTER_API_KEY' in os.environ or 'DISPLAY' in os.environ:\n    raise SystemExit(79)" : ""}
if 'auth' in sys.argv and 'status' in sys.argv:
    print(${JSON.stringify(JSON.stringify(options.auth ?? AUTH))})
    raise SystemExit(0)
if 'models' in sys.argv:
    sys.stdout.write(${JSON.stringify(options.registry ?? "gemini-3.1-pro-high    Gemini 3.1 Pro (High)\n")})
    raise SystemExit(0)
sys.stdin.buffer.read()
${options.hanging ? `child = subprocess.Popen([sys.executable, '-c', 'import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(60)'], start_new_session=True)
stat = open('/proc/' + str(child.pid) + '/stat').read()
stamp = stat[stat.rfind(')') + 2:].split()[19]
with open(${JSON.stringify(join(root, "owned-child.json"))}, 'w') as f:
    json.dump({'pid': child.pid, 'stamp': stamp}, f)
` : ""}
raw = base64.b64decode(${JSON.stringify(output.toString("base64"))})
# Split a multibyte code point and also leave a partial final record in the pipe.
split = raw.find(b'\\xc3') + 1
if split <= 0:
    split = max(1, len(raw) // 2)
os.write(1, raw[:split])
time.sleep(0.02)
os.write(1, raw[split:])
${options.hanging ? "time.sleep(60)" : `raise SystemExit(${options.exitCode ?? 0})`}
`, { mode: 0o700 });
	function task(harness: HarnessId): TaskSpec {
		return { id: "protocol-fixture", kind: "research", brief: TEXT, workspace: root, checks: [], outputs: [], route: { harness, provider: harness === "claude-code" ? "anthropic" : "google-antigravity", model: harness === "claude-code" ? "opus" : "gemini-3.1-pro-high", effort: "high" } };
	}
	function request(harness: HarnessId): NativeRequest {
		return { runId: "fixture-run", requestId: "fixture-message", sessionId: SESSION, text: TEXT, task: task(harness) };
	}
	return { root, binary, boundary, task, request, adapter: (id: HarnessId, timeoutMs = 3000) => createNativeAdapter(id, { claudeBinary: binary, antigravityBinary: binary, displayScript: boundary, timeoutMs }) };
}

function runningOwnedChild(root: string): boolean {
	const { pid, stamp } = JSON.parse(readFileSync(join(root, "owned-child.json"), "utf8")) as { pid: number; stamp: string };
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
		const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
		return fields[19] === stamp && fields[0] !== "Z";
	} catch { return false; }
}

afterEach(() => {
	for (const root of roots.splice(0)) {
		// Cleanup is scoped to a captured child identity, even if an assertion fails.
		try {
			if (runningOwnedChild(root)) {
				const child = JSON.parse(readFileSync(join(root, "owned-child.json"), "utf8")) as { pid: number };
				process.kill(child.pid, "SIGKILL");
			}
		} catch { /* A fixture without a child has nothing to stop. */ }
		rmSync(root, { recursive: true, force: true });
	}
});

test("Claude accepts split UTF-8/NDJSON only with a session, matching native replay and successful terminal", async () => {
	const f = fixture();
	const events: NativeEvent[] = [];
	const adapter = f.adapter("claude-code");
	const result = await adapter.invoke(f.request("claude-code"), event => events.push(event));
	expect(result).toEqual({ sessionId: SESSION, completed: true, acknowledged: true, text: ANSWER, model: "claude-opus-4-6", usage: CLAUDE_RESULT.usage });
	expect(events.filter(event => event.type === "acknowledged")).toEqual([{ type: "acknowledged", sessionId: SESSION, requestId: "fixture-message" }]);
	expect(adapter.capabilities).toEqual({ resume: true, liveSteering: false, acknowledgement: "native-replay" });
});

test("A new Claude run must report its stable mapped native session instead of an unrelated session", async () => {
	const firstSession = "6ffe7644-f8cc-5682-8d7c-75b3cd9706ae";
	const f = fixture({ output: records({ ...CLAUDE_INIT, session_id: firstSession }, { ...REPLAY, session_id: firstSession }, { ...CLAUDE_RESULT, session_id: firstSession }) });
	const request = { ...f.request("claude-code"), sessionId: null };
	const result = await f.adapter("claude-code").invoke(request, () => {});
	expect(result.sessionId).toBe(firstSession);
	const foreign = fixture();
	await expect(foreign.adapter("claude-code").invoke({ ...foreign.request("claude-code"), sessionId: null }, () => {})).rejects.toThrow("resume identity mismatched");
});

test("Antigravity DONE user_input is not a per-message ACK; only terminal completion answers the turn", async () => {
	const f = fixture({ output: records(AGY_INIT, AGY_STEP, AGY_RESULT) });
	const events: NativeEvent[] = [];
	const adapter = f.adapter("antigravity");
	const result = await adapter.invoke(f.request("antigravity"), event => events.push(event));
	expect(result).toEqual({ sessionId: SESSION, completed: true, acknowledged: true, text: ANSWER, model: "gemini-3.1-pro-high", usage: AGY_RESULT.result.usage });
	expect(events.some(event => event.type === "acknowledged")).toBe(false);
	expect(adapter.capabilities.acknowledgement).toBe("completion-only");
});

test("A new Antigravity run learns its conversation only from native init/result records", async () => {
	const f = fixture({ output: records(AGY_INIT, AGY_RESULT) });
	const result = await f.adapter("antigravity").invoke({ ...f.request("antigravity"), sessionId: null }, () => {});
	expect(result.sessionId).toBe(SESSION);
});

test("Missing native model and usage stay unknown instead of echoing the selected route", async () => {
	const { model: _model, ...init } = CLAUDE_INIT;
	const { usage: _usage, ...result } = CLAUDE_RESULT;
	const f = fixture({ output: records(init, REPLAY, result) });
	const observed = await f.adapter("claude-code").invoke(f.request("claude-code"), () => {});
	expect(observed.model).toBeNull();
	expect(observed.usage).toBeNull();
});

const malformedClaude: Array<[string, Buffer]> = [
	["missing terminal", records(CLAUDE_INIT, REPLAY)],
	["missing init", records(REPLAY, CLAUDE_RESULT)],
	["missing native session", records({ ...CLAUDE_INIT, session_id: undefined }, REPLAY, CLAUDE_RESULT)],
	["foreign replay UUID", records(CLAUDE_INIT, { ...REPLAY, uuid: SESSION }, CLAUDE_RESULT)],
	["unmarked user message", records(CLAUDE_INIT, { ...REPLAY, isReplay: undefined }, CLAUDE_RESULT)],
	["replay payload mismatch", records(CLAUDE_INIT, { ...REPLAY, message: { role: "user", content: "Different commissioner input" } }, CLAUDE_RESULT)],
	["session drift", records(CLAUDE_INIT, REPLAY, { ...CLAUDE_RESULT, session_id: MESSAGE })],
	["provider mismatch", records({ ...CLAUDE_INIT, apiProvider: "bedrock" }, REPLAY, CLAUDE_RESULT)],
	["paid auth source", records({ ...CLAUDE_INIT, apiKeySource: "apiKeyHelper" }, REPLAY, CLAUDE_RESULT)],
	["explicit terminal error list", records(CLAUDE_INIT, REPLAY, { ...CLAUDE_RESULT, errors: ["Model request failed"] })],
	["model fallback", records(CLAUDE_INIT, REPLAY, { type: "assistant", session_id: SESSION, message: { model: "claude-sonnet-4-6", content: [] } }, CLAUDE_RESULT)],
	["terminal error subtype", records(CLAUDE_INIT, REPLAY, { ...CLAUDE_RESULT, subtype: "error_during_execution" })],
	["duplicate terminal", records(CLAUDE_INIT, REPLAY, CLAUDE_RESULT, CLAUDE_RESULT)],
	["invalid usage", records(CLAUDE_INIT, REPLAY, { ...CLAUDE_RESULT, usage: { input_tokens: -1 } })],
	["non-object record", records(CLAUDE_INIT, [])],
	["truncated final record", Buffer.concat([records(CLAUDE_INIT, REPLAY), Buffer.from('{"type":"result"')])],
	["invalid UTF-8", Buffer.concat([records(CLAUDE_INIT, REPLAY), Buffer.from([0xff, 10])])],
];
for (const [name, output] of malformedClaude) {
	test(`Claude refuses ${name}, never treating exit zero as native success`, async () => {
		const f = fixture({ output });
		await expect(f.adapter("claude-code").invoke(f.request("claude-code"), () => {})).rejects.toThrow();
	});
}

test("An overbound partial NDJSON line is refused before EOF", async () => {
	const f = fixture({ output: Buffer.concat([records(CLAUDE_INIT, REPLAY), Buffer.alloc(8 * 1024 * 1024 + 1, 32)]) });
	await expect(f.adapter("claude-code").invoke(f.request("claude-code"), () => {})).rejects.toThrow("line exceeds");
});

for (const [name, output] of [
	["missing terminal", records(AGY_INIT, AGY_STEP)],
	["resume conversation mismatch", records({ ...AGY_INIT, conversation_id: MESSAGE }, AGY_RESULT)],
	["native model mismatch", records({ ...AGY_INIT, init: { ...AGY_INIT.init, model: "gemini-3.8-flash-high" } }, AGY_RESULT)],
	["error terminal", records(AGY_INIT, { ...AGY_RESULT, result: { ...AGY_RESULT.result, status: "ERROR", error: "authentication required" } })],
] as Array<[string, Buffer]>) {
	test(`Antigravity refuses ${name}`, async () => {
		const f = fixture({ output });
		await expect(f.adapter("antigravity").invoke(f.request("antigravity"), () => {})).rejects.toThrow();
	});
}

test("A nonzero native exit cannot promote an otherwise successful terminal record", async () => {
	const f = fixture({ exitCode: 2 });
	await expect(f.adapter("claude-code").invoke(f.request("claude-code"), () => {})).rejects.toThrow("exit 2");
});

for (const auth of [
	{ ...AUTH, loggedIn: false, authMethod: "none" },
	{ ...AUTH, authMethod: "api_key" },
	{ ...AUTH, authMethod: "api_key_helper" },
	{ ...AUTH, authMethod: "oauth_token" },
	{ ...AUTH, authMethod: "third_party", apiProvider: "bedrock" },
	{ ...AUTH, subscriptionType: null },
]) {
	test(`Preflight refuses non-subscription auth ${auth.authMethod}/${auth.subscriptionType}`, async () => {
		const f = fixture({ auth });
		await expect(f.adapter("claude-code").preflight(f.task("claude-code"))).rejects.toThrow("native subscription login");
	});
}

test("Antigravity requires an existing native registry listing, not a configured request model", async () => {
	const f = fixture({ registry: "Sign in required\n" });
	await expect(f.adapter("antigravity").preflight(f.task("antigravity"))).rejects.toThrow("registry did not advertise");
});

test("Route and unsupported effort/model guards run before native dispatch", async () => {
	const f = fixture();
	const task = f.task("claude-code");
	await expect(f.adapter("claude-code").preflight({ ...task, route: { ...task.route, provider: "google-antigravity" } })).rejects.toThrow("route mismatch");
	await expect(f.adapter("claude-code").preflight({ ...task, route: { ...task.route, model: "claude-opus-9-9" } })).rejects.toThrow("Unsupported Claude model");
	await expect(f.adapter("claude-code").preflight({ ...task, route: { ...task.route, model: "claude-opus-4-6", effort: "xhigh" } })).rejects.toThrow("Unsupported Claude effort");
	const agy = f.task("antigravity");
	await expect(f.adapter("antigravity").preflight({ ...agy, route: { ...agy.route, effort: "max" } })).rejects.toThrow("Unsupported Antigravity");
});

test("Explicit paid credentials/cloud route overrides are refused rather than silently removed and retried", async () => {
	const f = fixture();
	for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_VERTEX"]) {
		const previous = process.env[key];
		process.env[key] = "protocol-test-not-a-credential";
		try { await expect(f.adapter("claude-code").preflight(f.task("claude-code"))).rejects.toThrow(`override ${key}`); }
		finally { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; }
	}
});

test("Unrelated provider credentials and host display brokers do not cross the child environment", async () => {
	const f = fixture({ envGuard: true });
	const keys = ["OPENROUTER_API_KEY", "DISPLAY"];
	const previous = keys.map(key => process.env[key]);
	for (const key of keys) process.env[key] = "protocol-test-sentinel";
	try { await f.adapter("claude-code").preflight(f.task("claude-code")); }
	finally {
		keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
	}
});

test("A refused boundary never triggers an unfenced native fallback", async () => {
	const f = fixture({ rejectBoundary: true });
	await expect(f.adapter("claude-code").preflight(f.task("claude-code"))).rejects.toThrow("exit 73");
});

for (const mode of ["abort", "timeout"] as const) {
	test(`${mode} rejects an ambiguous turn and stops its owned setsid descendant`, async () => {
		const f = fixture({ output: records(AGY_INIT, AGY_STEP), hanging: true });
		const controller = new AbortController();
		const events: NativeEvent[] = [];
		const turn = f.adapter("antigravity", mode === "timeout" ? 250 : 3000).invoke(f.request("antigravity"), event => {
			events.push(event);
			if (mode === "abort" && event.type === "session") controller.abort();
		}, controller.signal);
		await expect(turn).rejects.toThrow(mode === "timeout" ? "timed out" : "aborted");
		expect(events.some(event => event.type === "acknowledged")).toBe(false);
		expect(runningOwnedChild(f.root)).toBe(false);
	});
}

test("Aborting Claude after replay retains only the observed ACK, not a fabricated completed result", async () => {
	const f = fixture({ output: records(CLAUDE_INIT, REPLAY), hanging: true });
	const controller = new AbortController();
	const events: NativeEvent[] = [];
	const turn = f.adapter("claude-code").invoke(f.request("claude-code"), event => {
		events.push(event);
		if (event.type === "acknowledged") controller.abort();
	}, controller.signal);
	await expect(turn).rejects.toThrow("aborted");
	expect(events.filter(event => event.type === "acknowledged")).toHaveLength(1);
	expect(runningOwnedChild(f.root)).toBe(false);
});
