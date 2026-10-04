// Bounded, zero-network contract walk against installed native SDK + real Rust
// transport. Local provider fixture is NOT live CTO/provider/subscription proof.
// Usage: PI_SDK_ENTRY=/absolute/.../dist/index.js MAGE_BINARY=/absolute/mage bun native-proof.ts
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const sdkPath = process.env.PI_SDK_ENTRY;
const binary = process.env.MAGE_BINARY;
if (!sdkPath || !binary || !process.env.TMPDIR) throw new Error("PI_SDK_ENTRY, MAGE_BINARY and run-scoped TMPDIR required");
const sdk = await import(sdkPath);
const ai = await import(join(dirname(sdkPath), "../../pi-ai/dist/index.js"));
const root = mkdtempSync(join(process.env.TMPDIR, "native-contract-"));
const spool = join(root, "spool"); mkdirSync(spool, { mode: 0o700 });
const socket = join(spool, "relay.sock");
let requests = 0;
let release: (() => void) | undefined;
let pause = false;
const fixture = (pi: any) => pi.registerProvider("relay-fixture", {
	api: "relay-fixture-api", apiKey: "local-fixture-not-a-credential", baseUrl: "http://invalid.local",
	models: [{ id: "fixture", name: "no-network fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 100 }],
	streamSimple(model: any) {
		requests++;
		const stream = new ai.AssistantMessageEventStream();
		const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
		stream.push({ type: "start", partial: { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id, usage, stopReason: "pending", timestamp: Date.now() } });
		void (async () => {
			if (pause) await new Promise<void>((resolve) => { release = resolve; });
			const message = { role: "assistant", content: [{ type: "text", text: "fixture settled" }], api: model.api, provider: model.provider, model: model.id, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now() };
			stream.push({ type: "text_start", contentIndex: 0, partial: message });
			stream.push({ type: "text_delta", contentIndex: 0, delta: "fixture settled", partial: message });
			stream.push({ type: "text_end", contentIndex: 0, content: "fixture settled", partial: message });
			stream.push({ type: "done", reason: "stop", message }); stream.end();
		})();
		return stream;
	},
});
const manager = sdk.SessionManager.create(root, join(root, "sessions"));
manager.appendMessage({ role: "user", content: "Local SDK transport contract fixture; no external actions.", timestamp: Date.now() });
const loader = new sdk.DefaultResourceLoader({ cwd: root, agentDir: root, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, agentsFilesOverride: () => ({ agentsFiles: [] }), additionalExtensionPaths: [join(import.meta.dir, "index.ts"), join(import.meta.dir, "native-input.ts")], extensionFactories: [fixture] });
await loader.reload();
assert.equal(loader.getExtensions().errors.length, 0);
const { session } = await sdk.createAgentSession({ cwd: root, agentDir: root, resourceLoader: loader, sessionManager: manager, noTools: true, settingsManager: sdk.SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false }, cacheWarming: "off" }) });
await session.bindExtensions({ onError: (error: unknown) => { throw new Error(JSON.stringify(error)); } });
await session.setModel(session.modelRuntime.getModel("relay-fixture", "fixture"));
const binding = { sessionId: manager.getSessionId(), sessionFile: manager.getSessionFile(), mageBinary: binary, spoolDir: spool, socketPath: socket };
const bindingPath = join(root, "binding.json"); writeFileSync(bindingPath, JSON.stringify(binding));
const exec = promisify(execFile);
async function mage(...args: string[]) { return JSON.parse((await exec(binary!, args)).stdout); }
async function until(check: () => Promise<boolean>) { for (let i = 0; i < 100; i++) { if (await check()) return; await new Promise((r) => setTimeout(r, 20)); } throw new Error("bounded condition not observed"); }
const envelope = { deliveryId: "native-contract-completion-1", sessionId: binding.sessionId, sessionFile: binding.sessionFile, kind: "completion", payload: "Harmless engineer completion: inspect native receipt; review remains required.", commissionRef: "contract-fixture" };
const input = join(root, "envelope.json"); writeFileSync(input, JSON.stringify(envelope));
try {
	await session.prompt(`/commission-relay-bind ${bindingPath}`);
	await until(async () => existsSync(socket));
	await mage("send", socket, input);
	await until(async () => (await mage("inspect", socket, input)).data?.state === "acknowledged");
	await session.waitForIdle();
	const first = await mage("inspect", socket, input);
	assert.ok(first.data.messageEntryId && first.data.receiptEntryId && first.data.settledEntryId);
	assert.equal(requests, 1, "completion must wake a new native run");
	assert.deepEqual(await mage("send", socket, input), first);
	assert.equal(requests, 1, "same delivery must not wake twice");
	const changed = join(root, "changed.json"); writeFileSync(changed, JSON.stringify({ ...envelope, payload: "different" }));
	assert.equal((await mage("send", socket, changed)).ok, false);
	writeFileSync(changed, JSON.stringify({ ...envelope, deliveryId: "foreign-binding", sessionId: "foreign-native" }));
	assert.equal((await mage("send", socket, changed)).ok, false);
	await session.reload();
	await until(async () => existsSync(socket));
	assert.deepEqual(await mage("send", socket, input), first);
	assert.equal(requests, 1, "reload must reconcile, not redeliver");

	// Actual native follow-up queue loss across supported reload: never auto-resend.
	pause = true;
	const active = session.prompt("Hold local fixture provider to exercise a queued completion.");
	await until(async () => !!release);
	const lost = { ...envelope, deliveryId: "native-contract-lost-2" };
	const lostPath = join(root, "lost.json"); writeFileSync(lostPath, JSON.stringify(lost));
	assert.equal((await mage("send", socket, lostPath)).data.state, "uncertain");
	await session.clearQueue();
	release!(); pause = false; await active;
	await session.reload(); await until(async () => existsSync(socket));
	assert.equal((await mage("send", socket, lostPath)).data.state, "uncertain");
	const recovery = await mage("recover", socket);
	assert.equal(recovery.deliveries.find((d: any) => d.deliveryId === lost.deliveryId).receipt.data.state, "uncertain");
	assert.equal(manager.getBranch().filter((e: any) => e.type === "custom_message" && e.customType === "commission-relay.message.v1").length, 1);
	assert.ok(readFileSync(binding.sessionFile, "utf8").includes(first.data.receiptEntryId));
	const text = "Standalone Summon native input; no Mage task execution.";
	const nativeInput = { runId: "cf1:local-fixture", attemptId: "claim-local-1", inputId: "input-local-1", textSha256: createHash("sha256").update(text).digest("hex"), sessionId: binding.sessionId, sessionFile: binding.sessionFile, text };
	const baseline = requests;
	await session.prompt(`/summon-native-input ${JSON.stringify(nativeInput)}`);
	await until(async () => requests === baseline + 1);
	await session.waitForIdle();
	await session.prompt(`/summon-native-receipt ${JSON.stringify(nativeInput)}`);
	assert.ok(manager.getBranch().some((e: any) => e.type === "custom" && e.customType === "summon.pi.receipt.v1" && e.data.attemptId === nativeInput.attemptId));
	await session.prompt(`/summon-native-input ${JSON.stringify(nativeInput)}`);
	assert.equal(requests, baseline + 1, "standalone native input duplicate must not run again");
	await assert.rejects(session.prompt(`/summon-native-input ${JSON.stringify({ ...nativeInput, inputId: "changed-input" })}`));
	const restored = sdk.SessionManager.open(binding.sessionFile);
	assert.ok(restored.getBranch().some((e: any) => e.type === "custom" && e.customType === "summon.pi.receipt.v1" && e.data.attemptId === nativeInput.attemptId));
	console.log(JSON.stringify({ proof: "native-sdk-local-fixture", root, receipt: first, duplicateWakeCount: 1, lostQueueState: "uncertain", standaloneInputReceiptRestored: true, requests }));
} finally {
	await session.prompt("/commission-relay-stop");
	session.dispose();
}
