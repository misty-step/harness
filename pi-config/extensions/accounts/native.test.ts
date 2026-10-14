// Local protocol fixtures, NOT live provider failover or quota evidence.
import { expect, test } from "bun:test";
import type { Api, AssistantMessage, AssistantMessageEvent, AssistantMessageEventStream, Model } from "@earendil-works/pi-ai";
import { existsSync, mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
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
	const root = mkdtempSync(join(tmpdir(), "pi-native-fixture-"));
	const script = join(root, "gateway.cjs");
	writeFileSync(script, `
const fs = require('node:fs');
const root = process.argv[2], mode = process.argv[3], args = process.argv.slice(4);
if (process.env.PI_CODING_AGENT_DIR || process.env.OMP_PROFILE || process.env.PI_PACKAGE_DIR) throw Error('wrong owner environment');
if (args[0] === 'config') { console.log(JSON.stringify({key:'retry.modelFallback',value:mode==='fallback',type:'boolean'})); process.exit(0); }
let input = ''; process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  const request = JSON.parse(input);
  fs.appendFileSync(root + '/requests.jsonl', JSON.stringify(request) + '\\n');
  const emit = () => {
    if (mode === 'http-error') { console.log(JSON.stringify({id:request.id,status:429,body:{error:{message:'fixture quota failure'}}})); return; }
    if (mode === 'wire-error') { console.log(JSON.stringify({id:request.id,status:200,body:'data: '+JSON.stringify({type:'error',reason:'error',errorMessage:'fixture native encoder failure'})+'\\n\\ndata: [DONE]\\n\\n'})); return; }
    const final = ${JSON.stringify(message)};
    const events = [{type:'start',partial:{...final,content:[]}}, {type:'toolcall_start',contentIndex:0,partial:final}, {type:'toolcall_end',contentIndex:0,toolCall:final.content[0],partial:final}];
    events.push(mode === 'post-tool-error' ? {type:'error',reason:'error',error:{...final,stopReason:'error',errorMessage:'fixture 401 after tool output'}} : {type:'done',reason:'toolUse',message:final});
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
	const old = process.env.PI_CODING_AGENT_DIR, profile = process.env.OMP_PROFILE;
	process.env.PI_CODING_AGENT_DIR = "/fixture/pi-owner"; process.env.OMP_PROFILE = "fixture-pi-profile";
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
		writeFileSync(join(f.root, "release"), "release");
		const final = await received.out.result();
		expect(final).toEqual(message);
		expect(serving).toBe(42);
		expect(received.events.map(e => e.type)).toEqual(["start", "toolcall_start", "toolcall_end", "done"]);
	} finally {
		if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old;
		if (profile === undefined) delete process.env.OMP_PROFILE; else process.env.OMP_PROFILE = profile;
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
