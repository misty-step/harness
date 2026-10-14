// Local protocol fixtures, NOT live provider failover or quota evidence.
import { expect, test } from "bun:test";
import type { Api, AssistantMessage, AssistantMessageEvent, AssistantMessageEventStream, Model } from "@earendil-works/pi-ai";
import type * as PiSDK from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { userInfo } from "node:os";
import { fileURLToPath } from "node:url";
import { nativeStream, runOmp, type NativeRun } from "./native.ts";

const model = { id: "gpt-6.1-sol", provider: "openai-pool", api: "openai-codex-responses" } as Model<Api>;
const usage = { input: 7, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 10, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const message: AssistantMessage & { credentialId: number } = {
	role: "assistant", api: "openai-codex-responses", provider: "openai-codex", model: "gpt-6.1-sol",
	content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "notes.txt" } }],
	stopReason: "toolUse", usage, timestamp: 1, credentialId: 42,
};
const context = {
	systemPrompt: ["Base\n\n<rules>Current rules</rules>"],
	tools: [{ name: "read", description: "Read", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }],
	messages: [
		{ role: "user", content: [{ type: "text", text: "Continue" }, { type: "image", data: "fixture", mimeType: "image/png" }], timestamp: 1 },
		message,
		{ role: "toolResult", toolCallId: "call-1", toolName: "read", content: [{ type: "text", text: "File content" }], isError: false, timestamp: 2 },
	],
};
function output() {
	const events: AssistantMessageEvent[] = [];
	const { promise, resolve } = Promise.withResolvers<AssistantMessage>();
	const out: AssistantMessageEventStream = {
		push(event: AssistantMessageEvent) { events.push(event); if (event.type === "done") resolve(event.message); if (event.type === "error") resolve(event.error); },
		result: () => promise,
		async *[Symbol.asyncIterator]() { await promise; yield* events; },
	} as AssistantMessageEventStream;
	return { out, events };
}
async function waitForFile(path: string) {
	if (existsSync(path)) return;
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	const watcher = watch(dirname(path), () => { if (existsSync(path)) resolve(); });
	const timer = setTimeout(() => reject(new Error("Fixture child did not become ready")), 5000);
	if (existsSync(path)) resolve();
	try { await promise; } finally { watcher.close(); clearTimeout(timer); }
}
function fixture(mode: string) {
	const scratch = process.env.TMPDIR ?? join(userInfo().homedir, ".cache", "tmp");
	mkdirSync(scratch, { recursive: true });
	const root = mkdtempSync(join(scratch, "pi-native-fixture-"));
	const script = join(root, "gateway.cjs");
	writeFileSync(script, `
const fs = require('node:fs');
const root = process.argv[2], mode = process.argv[3], args = process.argv.slice(4);
if (process.env.PI_CODING_AGENT_DIR || process.env.OMP_PROFILE || process.env.PI_PACKAGE_DIR) throw Error('wrong owner environment');
fs.writeFileSync(root + '/env.json', JSON.stringify({home:process.env.HOME,cwd:process.cwd(),path:process.env.PATH,tmpdir:process.env.TMPDIR,locale:process.env.LANG,
  inherited:['OPENAI_API_KEY','ANTHROPIC_API_KEY','OPENROUTER_API_KEY','OMP_AUTH_GATEWAY_TOKEN','CODEX_HOME','PI_CODING_AGENT_DIR','OMP_PROFILE','PI_PACKAGE_DIR'].filter(name => process.env[name] !== undefined)}));
if (args[0] === 'config') { console.log(JSON.stringify({key:'retry.modelFallback',value:mode==='fallback',type:'boolean'})); process.exit(0); }
let input = ''; process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  const request = JSON.parse(input);
  fs.appendFileSync(root + '/requests.jsonl', JSON.stringify(request) + '\\n');
  const emit = () => {
    if (mode === 'http-error') { console.log(JSON.stringify({id:request.id,status:429,body:{error:{message:'fixture quota failure'}}})); return; }
    if (mode === 'wire-error') { console.log(JSON.stringify({id:request.id,status:200,body:'data: '+JSON.stringify({type:'error',reason:'error',errorMessage:'fixture native encoder failure'})+'\\n\\ndata: [DONE]\\n\\n'})); return; }
    let final = ${JSON.stringify(message)};
    if (mode === 'sdk' && request.body.context.messages.some(m => m.role === 'toolResult')) final = {...final,content:[{type:'text',text:'OFFLINE_SDK_DONE'}],stopReason:'stop'};
    const events = final.stopReason === 'stop' ? [{type:'start',partial:{...final,content:[]}}]
      : [{type:'start',partial:{...final,content:[]}}, {type:'toolcall_start',contentIndex:0,partial:final}, {type:'toolcall_end',contentIndex:0,toolCall:final.content[0],partial:final}];
    events.push(mode === 'post-tool-error' ? {type:'error',reason:'error',error:{...final,stopReason:'error',errorMessage:'fixture 401 after tool output'}} : {type:'done',reason:final.stopReason,message:final});
    const body = events.map(event => 'data: ' + JSON.stringify(event) + '\\n\\n').join('') + 'data: [DONE]\\n\\n';
    console.log(JSON.stringify({id:'other-request',status:500,body:'ignored'}));
    process.stdout.write(JSON.stringify({id:request.id,status:200,body}) + '\\n', () => process.exit(0));
  };
  if (mode === 'gate' || mode === 'abort') {
    const watcher = fs.watch(root, () => { if (fs.existsSync(root + '/release')) { watcher.close(); emit(); } });
    fs.writeFileSync(root + '/ready', String(process.pid));
    console.log(JSON.stringify({ready:true,version:'18.10.4'}));
  } else {
    console.log(JSON.stringify({ready:true,version:'18.10.4'}));
    emit();
  }
});
`, { mode: 0o600 });
	const run: NativeRun = (args, input, signal) => runOmp([script, root, mode, ...args], input, signal, process.execPath);
	return { root, run, close: () => rmSync(root, { recursive: true, force: true }) };
}

test("native protocol preserves structured tools/results, buffers original events and reports the real owner row", async () => {
	const f = fixture("gate"), received = output();
	const names = ["PI_CODING_AGENT_DIR", "OMP_PROFILE", "PI_PACKAGE_DIR", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "OMP_AUTH_GATEWAY_TOKEN", "CODEX_HOME", "LANG"];
	const old = Object.fromEntries(names.map(name => [name, process.env[name]]));
	for (const name of names) process.env[name] = name === "LANG" ? "C" : `synthetic-fixture-${name}`;
	try {
		let serving: number | undefined;
		nativeStream({ model, context, options: { reasoning: "xhigh", apiKey: "fixture-must-not-cross-wire", headers: { Authorization: "fixture-must-not-cross-wire" } }, out: received.out, onServe: m => { serving = m.credentialId; } }, f.run);
		await waitForFile(join(f.root, "ready"));
		expect(received.events).toEqual([]); // Child has announced ready; completion is still buffered.
		const request = JSON.parse(readFileSync(join(f.root, "requests.jsonl"), "utf8"));
		expect(request.path).toBe("/v1/pi/stream");
		expect(request.body.model).toBe("openai-codex/gpt-6.1-sol");
		expect(request.body.context).toEqual(context);
		expect(request.body.options.reasoning).toBe("xhigh");
		expect(request.body.options).not.toHaveProperty("apiKey");
		expect(request.body.options).not.toHaveProperty("headers");
		const env = JSON.parse(readFileSync(join(f.root, "env.json"), "utf8"));
		expect(env.inherited).toEqual([]);
		expect(env.home).toBe(userInfo().homedir);
		expect(env.cwd).toBe(userInfo().homedir);
		expect(env.path).toBe(process.env.PATH);
		expect(env.tmpdir).toBe(process.env.TMPDIR);
		expect(env.locale).toBe("C");
		writeFileSync(join(f.root, "release"), "release");
		const final = await received.out.result();
		expect(final).toEqual(message);
		expect(serving).toBe(42);
		expect(received.events.map(e => e.type)).toEqual(["start", "toolcall_start", "toolcall_end", "done"]);
	} finally {
		for (const name of names) {
			if (old[name] === undefined) delete process.env[name]; else process.env[name] = old[name];
		}
		f.close();
	}
});

test("post-tool native failure stays original and never retransmits the request", async () => {
	const f = fixture("post-tool-error"), received = output();
	try {
		nativeStream({ model, context, out: received.out }, f.run);
		const final = await received.out.result();
		expect(final.errorMessage).toBe("fixture 401 after tool output");
		expect(final.content).toEqual(message.content);
		expect(received.events.map(e => e.type)).toEqual(["start", "toolcall_start", "toolcall_end", "error"]);
		expect(readFileSync(join(f.root, "requests.jsonl"), "utf8").trim().split("\n")).toHaveLength(1);
	} finally { f.close(); }
});

test("abort kills only the pending owned child and settles without invented native output", async () => {
	const f = fixture("abort"), received = output(), controller = new AbortController();
	try {
		nativeStream({ model, context, options: { signal: controller.signal }, out: received.out }, f.run);
		await waitForFile(join(f.root, "ready"));
		const pid = Number(readFileSync(join(f.root, "ready"), "utf8"));
		controller.abort(new Error("fixture caller abort"));
		const final = await received.out.result();
		expect(final.stopReason).toBe("aborted");
		expect(final.content).toEqual([]);
		expect(final).not.toHaveProperty("credentialId");
		expect(() => process.kill(pid, 0)).toThrow();
		expect(received.events.map(e => e.type)).toEqual(["error"]);
	} finally { f.close(); }
});

test("pre-output gateway error is surfaced once; configured model fallback refuses dispatch", async () => {
	for (const mode of ["http-error", "wire-error", "fallback"]) {
		const f = fixture(mode), received = output();
		try {
			nativeStream({ model, context, out: received.out }, f.run);
			const final = await received.out.result();
			expect(final.stopReason).toBe("error");
			if (mode === "http-error") {
				expect(final.errorMessage).toContain("429");
				expect(final.errorMessage).toContain("fixture quota failure");
				expect(readFileSync(join(f.root, "requests.jsonl"), "utf8").trim().split("\n")).toHaveLength(1);
			} else if (mode === "wire-error") expect(final.errorMessage).toBe("fixture native encoder failure");
			else expect(existsSync(join(f.root, "requests.jsonl"))).toBe(false);
		} finally { f.close(); }
	}
});

test("local request hooks preserve mutation/replacement and reject errors or unsupported transforms before dispatch", async () => {
	const f = fixture("success"), received = output();
	try {
		nativeStream({ model, context: structuredClone(context), out: received.out, options: {
			onPayload: async payload => {
				const body = payload as { options: Record<string, unknown>; context: typeof context };
				body.context.systemPrompt = ["Offline policy mutation"];
				return { ...body, options: { ...body.options, maxTokens: 64 } };
			},
		} }, f.run);
		await received.out.result();
		const request = JSON.parse(readFileSync(join(f.root, "requests.jsonl"), "utf8"));
		expect(request.body.context.systemPrompt).toEqual(["Offline policy mutation"]);
		expect(request.body.options.maxTokens).toBe(64);
	} finally { f.close(); }
	for (const onPayload of [
		() => { throw new Error("offline policy failure"); },
		(payload: unknown) => ({ ...payload as object, model: "@paid-role" }),
		() => ({ model: "openai-codex/gpt-6.1-sol", input: "upstream vendor shape" }),
		(payload: unknown) => ({ ...payload as object, options: { apiKey: "synthetic-transform" } }),
	]) {
		let dispatches = 0;
		const failed = output();
		nativeStream({ model, context, options: { onPayload }, out: failed.out }, async () => {
			dispatches++; throw new Error("fixture should not dispatch");
		});
		expect((await failed.out.result()).stopReason).toBe("error");
		expect(dispatches).toBe(0);
	}
	const unsupported = output();
	let dispatches = 0;
	nativeStream({ model, context, options: { fetch: async () => { throw new Error("unused fixture fetch"); } }, out: unsupported.out }, async () => {
		dispatches++; throw new Error("fixture should not dispatch");
	});
	expect((await unsupported.out.result()).errorMessage).toContain("Unsupported callback");
	expect(dispatches).toBe(0);
});

test("abort settles a pending local request hook; late completion cannot dispatch or replay", async () => {
	const started = Promise.withResolvers<unknown>(), pending = Promise.withResolvers<unknown>();
	const controller = new AbortController(), received = output();
	let dispatches = 0;
	nativeStream({ model, context, out: received.out, options: {
		signal: controller.signal, onPayload: payload => { started.resolve(payload); return pending.promise; },
	} }, async () => { dispatches++; throw new Error("fixture should not dispatch"); });
	const body = await started.promise;
	controller.abort(new Error("offline hook abort"));
	expect((await received.out.result()).stopReason).toBe("aborted");
	pending.resolve(body);
	await pending.promise;
	expect(dispatches).toBe(0);
	expect(received.events.map(event => event.type)).toEqual(["error"]);
});

test.skipIf(!process.env.PI_NATIVE_SDK_ENTRY)("actual Pi SDK bridge enforces unchanged guard and retains tool continuation (OFFLINE gateway)", async () => {
	const f = fixture("sdk");
	// SDK location is runtime-selected and optional on portable test hosts.
	const sdk: typeof PiSDK = await import(process.env.PI_NATIVE_SDK_ENTRY!);
	const priorPath = process.env.PATH, priorDir = process.env.PI_CODING_AGENT_DIR, priorOffline = process.env.PI_OFFLINE;
	const fetch = globalThis.fetch;
	let networkCalls = 0, toolRuns = 0;
	globalThis.fetch = async () => { networkCalls++; throw new Error("offline SDK fixture prohibits network"); };
	process.env.PI_CODING_AGENT_DIR = f.root; process.env.PI_OFFLINE = "1";
	process.env.PATH = `${f.root}:${priorPath ?? ""}`;
	writeFileSync(join(f.root, "omp"), `#!${process.execPath}\nprocess.argv.splice(1,1,${JSON.stringify(join(f.root, "gateway.cjs"))},${JSON.stringify(f.root)},"sdk");require(${JSON.stringify(join(f.root, "gateway.cjs"))});\n`, { mode: 0o700 });
	writeFileSync(join(f.root, "notes.txt"), "Offline fixture tool result");
	const probe = join(f.root, "probe.mjs");
	writeFileSync(probe, `import {appendFileSync} from "node:fs";export default pi => pi.on("before_provider_request", async (event, ctx) => {
  appendFileSync(${JSON.stringify(join(f.root, "hooks.jsonl"))},JSON.stringify({model:ctx.model.id})+"\\n");
  return {...event.payload,context:{...event.payload.context,systemPrompt:[...event.payload.context.systemPrompt,"OFFLINE_POLICY"]},options:{...event.payload.options,maxTokens:64}};
});`, { mode: 0o600 });
	let session: PiSDK.AgentSession | undefined;
	try {
		const credentials = { read: async () => undefined, list: async () => [], modify: async () => { throw new Error("credential write prohibited"); }, delete: async () => { throw new Error("credential write prohibited"); } };
		const runtime = await sdk.ModelRuntime.create({ credentials, modelsPath: null, modelsStorePath: join(f.root, "models-store.json"), refreshOnCreate: false, allowModelNetwork: false });
		const loader = new sdk.DefaultResourceLoader({ cwd: f.root, agentDir: f.root, noExtensions: true,
			additionalExtensionPaths: [fileURLToPath(new URL("./index.ts", import.meta.url)), fileURLToPath(new URL("../failover/index.ts", import.meta.url)), probe],
			noSkills: true, noPromptTemplates: true, noThemes: true, agentsFilesOverride: () => ({ agentsFiles: [] }) });
		await loader.reload();
		expect(loader.getExtensions().errors).toEqual([]);
		({ session } = await sdk.createAgentSession({ cwd: f.root, agentDir: f.root, modelRuntime: runtime,
			model: runtime.getModel("openai-codex", "gpt-6.1-sol"), thinkingLevel: "xhigh", tools: ["read"],
			sessionManager: sdk.SessionManager.create(f.root, f.root),
			settingsManager: sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off", quietStartup: true }),
			resourceLoader: loader }));
		const errors: string[] = [];
		await session.bindExtensions({ onError: (event: { error: string }) => errors.push(event.error) });
		session.subscribe((event: { type: string; toolName?: string }) => { if (event.type === "tool_execution_start" && event.toolName === "read") toolRuns++; });
		const approved = runtime.getModel("openai-pool", "gpt-6.1-sol");
		if (!approved) throw new Error("Installed SDK did not register the native pool");
		await session.setModel({ ...approved, id: "gpt-5.3-codex-spark" });
		// Bypass input handling deliberately: exercise the SDK's before_provider_request bridge.
		await session.agent.prompt("Offline rejected-model policy fixture");
		const rejected = session.agent.state.messages.at(-1);
		if (!rejected || rejected.role !== "assistant") throw new Error("SDK did not settle rejected inference");
		if (rejected.stopReason !== "aborted") console.error(JSON.stringify({ fixture: "OFFLINE SDK rejected route", error: rejected.errorMessage }));
		expect(rejected.stopReason).toBe("aborted");
		expect(existsSync(join(f.root, "requests.jsonl"))).toBe(false);
		expect(JSON.parse(readFileSync(join(f.root, "hooks.jsonl"), "utf8")).model).toBe("gpt-5.3-codex-spark");
		await session.setModel(approved);
		await session.agent.prompt("Offline approved-model tool fixture");
		const requests = readFileSync(join(f.root, "requests.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
		expect(requests).toHaveLength(2);
		expect(requests.every(request => request.body.model === "openai-codex/gpt-6.1-sol" && request.body.options.maxTokens === 64 && request.body.options.reasoning === "xhigh")).toBe(true);
		expect(requests[0].body.context.systemPrompt.at(-1)).toBe("OFFLINE_POLICY");
		expect(requests[1].body.context.messages.findLast((m: { role: string }) => m.role === "toolResult").content).toEqual([{ type: "text", text: "Offline fixture tool result" }]);
		expect(toolRuns).toBe(1);
		const final = session.agent.state.messages.at(-1);
		if (!final || final.role !== "assistant") throw new Error("SDK did not settle tool continuation");
		expect(final.content).toEqual([{ type: "text", text: "OFFLINE_SDK_DONE" }]);
		expect(final.provider).toBe("openai-codex");
		// Native credentialId is a real wire extension absent from the installed SDK declaration.
		expect("credentialId" in final && final.credentialId).toBe(42); // Fixture provenance, never live attribution.
		expect(session.isIdle).toBe(true);
		expect(networkCalls).toBe(0);
		expect(errors).toEqual([]);
		console.log(JSON.stringify({ fixture: "OFFLINE actual Pi SDK", rejectedHookCalls: 1, rejectedGatewayCalls: 0, approvedGatewayCalls: requests.length, toolRuns, networkCalls }));
	} finally {
		session?.dispose();
		globalThis.fetch = fetch;
		if (priorPath === undefined) delete process.env.PATH; else process.env.PATH = priorPath;
		if (priorDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = priorDir;
		if (priorOffline === undefined) delete process.env.PI_OFFLINE; else process.env.PI_OFFLINE = priorOffline;
		f.close();
	}
}, 20000);
