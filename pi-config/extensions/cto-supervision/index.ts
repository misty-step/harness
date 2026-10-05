import type { AgentBeforeSettleEvent, ExtensionAPI, ExtensionContext, TurnEndEvent } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { ACK_TOOL, BINDING, EVENT, PASS, PRIMARY, QUEUE_PREVIEW, SESSION, TIMER, WAKE, nextWake, same, snapshot, validateAck, validId, validText, wakeContent, type Event, type Pass, type QueuePreview } from "./branch.js";

type Binding = { schema: "cto-supervision.binding/1"; sessionId: string; sessionFile: string; cwd: string; runtimeBinary: string; runtimeSha256: string; inboxDir: string; returnDir: string };
type Heartbeat = { op: "heartbeat"; period_ms: number; scheduled_at_ms: number; fired_at_ms: number; elapsed_since_boot_ms: number };
const MAX_FRAME = 1_048_576;
const INSPECT_TOOL = "cto_supervision_inspect";

function parseJson(text: string) {
	try { return JSON.parse(text); }
	catch { throw new Error("native JSON malformed; inspect retained original; no content echo or ACK"); }
}
function readOwned(path: string, max: number, executable = false) {
	if (!isAbsolute(path) || realpathSync(path) !== path) throw new Error("canonical absolute native path required");
	const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const m = fstatSync(fd);
		if (!m.isFile() || m.uid !== process.getuid!() || m.size > max || (m.mode & (executable ? 0o022 : 0o077)) !== 0 || (executable && !(m.mode & 0o100))) throw new Error("invalid owned native file");
		const bytes = readFileSync(fd);
		if (bytes.length > max) throw new Error("native file exceeded bound");
		return bytes;
	} finally { closeSync(fd); }
}
function validateBinding(config: Binding, ctx: ExtensionContext) {
	const keys = ["schema", "sessionId", "sessionFile", "cwd", "runtimeBinary", "runtimeSha256", "inboxDir", "returnDir"].sort();
	if (!config || !same(Object.keys(config).sort(), keys) || config.schema !== "cto-supervision.binding/1" || config.sessionId !== SESSION
		|| config.sessionId !== ctx.sessionManager.getSessionId() || config.sessionFile !== ctx.sessionManager.getSessionFile()
		|| config.cwd !== ctx.cwd || !/^[a-f0-9]{64}$/.test(config.runtimeSha256)) throw new Error("binding must name the existing exact CTO session and root cwd");
	const header = parseJson(readOwned(config.sessionFile, 64 * 1024 * 1024).toString("utf8").split("\n")[0]);
	if (header.type !== "session" || header.id !== SESSION || header.cwd !== config.cwd) throw new Error("existing native disk header differs; no runtime start");
	for (const path of [config.cwd, config.inboxDir, config.returnDir]) {
		if (!isAbsolute(path) || realpathSync(path) !== path || !lstatSync(path).isDirectory()) throw new Error("canonical native directory required");
	}
	for (const path of [config.inboxDir, config.returnDir]) {
		const m = lstatSync(path);
		if (m.uid !== process.getuid!() || (m.mode & 0o077) !== 0) throw new Error("owner-only native inbox/return directory required");
	}
	if (config.inboxDir === config.returnDir) throw new Error("inbox and returns must differ");
	const sha = createHash("sha256").update(readOwned(config.runtimeBinary, 32 * 1024 * 1024, true)).digest("hex");
	if (sha !== config.runtimeSha256) throw new Error("reviewed native runtime SHA differs; no spawn");
}

export default function (pi: ExtensionAPI) {
	let binding: Binding | undefined;
	let child: ChildProcessWithoutNullStreams | undefined;
	let current: ExtensionContext | undefined;
	let flushTimer: ReturnType<typeof setTimeout> | undefined;
	let fault: string | undefined;
	let stopped = false;
	const exported = new Set<string>(); // ephemeral; immutable native ACK IDs are authority on restart
	function assertBound(ctx: ExtensionContext) {
		if (!binding || ctx.sessionManager.getSessionId() !== SESSION || ctx.sessionManager.getSessionFile() !== binding.sessionFile || ctx.cwd !== binding.cwd) throw new Error("native supervision identity changed; no replacement/wake");
	}
	function note(ctx: ExtensionContext, message: string) { ctx.ui.notify(`CTO supervision: ${message}`, "warning"); }
	function durable(ctx: ExtensionContext, ids: string[]) {
		assertBound(ctx);
		const bytes = readOwned(binding!.sessionFile, 64 * 1024 * 1024);
		// Finalized native branch AND original JSONL are required; no transcript writes.
		const records = bytes.toString("utf8").split("\n").filter(Boolean).map(line => parseJson(line));
		if (records[0]?.type !== "session" || records[0].id !== SESSION || records[0].cwd !== binding!.cwd) throw new Error("original disk session identity differs; no pass return");
		const disk = new Map(records.map(entry => [entry.id, entry] as const));
		const branch = ctx.sessionManager.getBranch();
		if (ids.some(id => !disk.has(id) || !same(disk.get(id), branch.find(e => e.id === id)))) throw new Error("original native evidence absent/different on disk; no pass return");
		for (const path of [binding!.sessionFile, dirname(binding!.sessionFile)]) {
			const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
			try { fsyncSync(fd); } finally { closeSync(fd); }
		}
	}
	function exportAcks(ctx: ExtensionContext) {
		assertBound(ctx);
		if (!child || fault) return;
		const branch = ctx.sessionManager.getBranch();
		const state = snapshot(branch);
		for (const [passId, ack] of state.acknowledgements) {
			if (exported.has(ack.id) || ack.message.role !== "toolResult") continue;
			const data = ack.message.details as { action_entry_ids: string[]; source_refs: string[]; summary: string; pass_id: string };
			const { message, pass } = validateAck(branch, data);
			durable(ctx, [message.id, ack.id, ...data.action_entry_ids]);
			child.stdin.write(JSON.stringify({ schema: "cto-supervision.pass/1", target_session_id: SESSION,
				primary_commission: PRIMARY, closes_primary: false, pass_id: passId,
				message_entry_id: message.id, ack_entry_id: ack.id, event_ids: pass.event_ids,
				action_entry_ids: data.action_entry_ids, summary: data.summary, source_refs: data.source_refs }) + "\n");
			exported.add(ack.id); // stream write is not export ACK; helper confirms below; restart replays ORIGINAL receipt
		}
	}
	function flush(ctx: ExtensionContext) {
		assertBound(ctx);
		if (!child || fault || stopped) return;
		const state = snapshot(ctx.sessionManager.getBranch());
		const cause = nextWake(state);
		if (!cause) return;
		const pass: Pass = { pass_id: randomUUID(), ...cause };
		pi.appendEntry(PASS, pass); // durable may-have-sent intent; missing message is UNCERTAIN, never blind resend
		durable(ctx, ctx.sessionManager.getBranch().filter(e => e.type === "custom" && e.customType === PASS && (e.data as Pass).pass_id === pass.pass_id).map(e => e.id));
		pi.sendMessage({ customType: WAKE, content: wakeContent(pass, state), display: true, details: pass }, { triggerTurn: true, deliverAs: ctx.isIdle() ? "followUp" : "steer" });
	}
	function observeQueue(event: AgentBeforeSettleEvent | TurnEndEvent, ctx: ExtensionContext) {
		assertBound(ctx);
		const state = snapshot(ctx.sessionManager.getBranch());
		for (const pass_id of state.unacknowledged) {
			if (state.messages.has(pass_id)) continue;
			const present = event.context.pendingMessages.some(message => message.role === "custom" && message.customType === WAKE && same(message.details, state.passes.get(pass_id)));
			// Supported boundary preview, NOT all queues, delivery, pass ACK or no-effect proof.
			if (state.queuePreviews.get(pass_id)?.present !== present) pi.appendEntry(QUEUE_PREVIEW, { pass_id, present, boundary: event.type } satisfies QueuePreview);
		}
	}
	function schedule(ctx: ExtensionContext) {
		if (flushTimer) return;
		flushTimer = setTimeout(() => {
			flushTimer = undefined;
			try { flush(ctx); } catch (e) { fault = String(e); note(ctx, "wake uncertain; inspect original native intent; no retry"); }
		}, 25); // only transport burst coalescing; never a model polling loop
	}
	function handle(record: any, ctx: ExtensionContext) {
		assertBound(ctx);
		if (record.op === "event") {
			const e = record.event as Event;
			if (!e || e.schema !== "cto-supervision.event/1" || e.target_session_id !== SESSION || !validId(e.event_id)
				|| !validId(e.worker) || !validText(e.commission_id, 2048) || !["completion", "blocked"].includes(e.kind) || !validText(e.source_ref, 2048) || !validText(e.summary, 2048)) throw new Error("invalid native event");
			const old = snapshot(ctx.sessionManager.getBranch()).events.get(e.event_id);
			if (old && !same(old, e)) throw new Error("immutable event conflict; no replacement");
			if (!old) pi.appendEntry(EVENT, e);
			schedule(ctx);
		} else if (record.op === "heartbeat") {
			const pulse = record as Heartbeat;
			if (pulse.period_ms !== 300_000 || !Number.isSafeInteger(pulse.fired_at_ms) || !Number.isSafeInteger(pulse.scheduled_at_ms)
				|| pulse.fired_at_ms < pulse.scheduled_at_ms || !Number.isSafeInteger(pulse.elapsed_since_boot_ms) || pulse.elapsed_since_boot_ms < 0) throw new Error("invalid actual recovery timer firing");
			const old = [...snapshot(ctx.sessionManager.getBranch()).timers.values()].find(e => (e.data as Heartbeat).fired_at_ms === pulse.fired_at_ms);
			if (old && !same(old.data, pulse)) throw new Error("immutable timer firing conflict; no replacement");
			if (!old) pi.appendEntry(TIMER, pulse);
			schedule(ctx);
		} else if (record.op === "ready") {
			pi.appendEntry("cto-supervision.runtime.v1", { pid: record.pid, period_ms: record.period_ms, runtimeSha256: binding!.runtimeSha256 });
			exportAcks(ctx); schedule(ctx);
		} else if (record.op === "exported") {
			pi.appendEntry("cto-supervision.return.v1", { ack_entry_id: record.ack_entry_id }); // native export, NOT COO consumption
		} else if (record.op === "rejected") note(ctx, "inbox record rejected; original retained; no wake for that record");
		else throw new Error("unknown supervision transport record");
	}
	async function stop() {
		stopped = true;
		if (flushTimer) clearTimeout(flushTimer);
		flushTimer = undefined;
		const old = child;
		if (!old) return;
		await new Promise<void>(resolve => {
			old.once("close", () => resolve());
			old.stdin.end(); // EOF closes helper; await owned close, never abort/reset Pi
		});
		if (child === old) child = undefined;
	}
	function admitControlTools() {
		const original = pi.getActiveTools();
		pi.setActiveTools([...new Set([...original, INSPECT_TOOL, ACK_TOOL])]);
		if (![INSPECT_TOOL, ACK_TOOL].every(name => pi.getActiveTools().includes(name))) {
			pi.setActiveTools(original);
			throw new Error("native loadout does not admit supervision evidence/ACK tools; owner must select them, no permission bypass or runtime start");
		}
	}
	function start(ctx: ExtensionContext) {
		assertBound(ctx);
		if (child) return;
		validateBinding(binding!, ctx);
		admitControlTools();
		current = ctx; stopped = false; fault = undefined; exported.clear();
		const state = snapshot(ctx.sessionManager.getBranch());
		// Never recreate an uncertain old wake. A genuinely NEW timer pass can reconcile it.
		const p = spawn(binding!.runtimeBinary, [binding!.inboxDir, binding!.returnDir, String(state.lastHeartbeatMs)], { stdio: "pipe", cwd: binding!.cwd });
		child = p;
		let buffer = "";
		p.stdout.setEncoding("utf8");
		p.stdout.on("data", (chunk: string) => {
			if (fault) return;
			buffer += chunk;
			try {
				let end: number;
				while ((end = buffer.indexOf("\n")) >= 0) {
					if (Buffer.byteLength(buffer.slice(0, end)) > MAX_FRAME) throw new Error("native frame exceeded bound");
					const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
					handle(parseJson(line), current!);
				}
				if (Buffer.byteLength(buffer) > MAX_FRAME) throw new Error("unterminated native frame exceeded bound");
			} catch (e) { fault = String(e); note(ctx, "transport fault; preserve native intents and original events; no automatic restart"); p.stdin.end(); }
		});
		p.stderr.setEncoding("utf8");
		p.stderr.on("data", () => note(ctx, "native runtime refused/stopped; inspect retained original input and owned exit"));
		p.stdin.on("error", e => { fault = String(e); note(ctx, "native return stream failed; original ACK retained for exact restart recovery"); });
		p.on("error", e => { fault = String(e); note(ctx, "native runtime could not start; no replacement"); });
		p.on("close", (code, signal) => {
			if (child === p) child = undefined;
			if (current && binding) pi.appendEntry("cto-supervision.runtime-exit.v1", { pid: p.pid, code, signal, observed_owned_close: true });
			if (!stopped) note(ctx, "runtime exited; supervision inactive; this exit cannot close the original primary");
		});
		// Control-only tools were admitted before spawn; existing tools/auth/route remain intact.
	}
	pi.registerCommand("cto-supervision-bind", {
		description: "Opt in the existing exact CTO session; absolute private binding JSON path",
		handler: async (path, ctx) => {
			const config = parseJson(readOwned(path.trim(), 65_536).toString("utf8")) as Binding;
			validateBinding(config, ctx);
			if (binding && !same(binding, config)) throw new Error("original native binding differs; reconcile owner, no replacement");
			admitControlTools();
			if (!binding) { binding = config; pi.appendEntry(BINDING, config); }
			start(ctx);
		},
	});
	pi.registerCommand("cto-supervision-status", {
		description: "Read native supervision identity, original pending inputs and actual runtime boundary",
		handler: async (_args, ctx) => {
			const s = snapshot(ctx.sessionManager.getBranch());
			ctx.ui.notify(JSON.stringify({ primary_commission: PRIMARY, closes_primary: false, bound: !!binding, runtimePid: child?.pid ?? null,
				sessionId: ctx.sessionManager.getSessionId(), pending_event_ids: s.pending.map(e => e.event_id), unacknowledged_pass_ids: s.unacknowledged, lastHeartbeatMs: s.lastHeartbeatMs, fault: fault ?? null }), "info");
		},
	});
	pi.registerCommand("cto-supervision-stop", { description: "Stop native transport only; retain binding, primary and uncertain original wakes", handler: stop });
	pi.registerTool({
		name: INSPECT_TOOL, label: "CTO native evidence refs", defaultActive: false, exposure: "model-only",
		description: "Read only native supervision pass IDs and eligible original action entry IDs. No transcript/tool bodies, filesystem bridge, work status or commission closure.",
		parameters: Type.Object({}, { additionalProperties: false }),
		async execute(_id, _params, _signal, _update, ctx) {
			assertBound(ctx);
			const branch = ctx.sessionManager.getBranch();
			const state = snapshot(branch);
			const passes = state.unacknowledged.slice(-128).map(pass_id => {
				const message = state.messages.get(pass_id);
				const position = branch.findIndex(e => e.id === message?.id);
				return { pass_id, event_ids: state.passes.get(pass_id)!.event_ids, message_entry_id: message?.id ?? null, delivery: message ? "finalized_not_pass_ack" : "uncertain", queue_preview: state.queuePreviews.get(pass_id) ?? null,
					actions: position < 0 ? [] : branch.slice(position + 1).flatMap(e => e.type === "message" && e.message.role === "toolResult" && !e.message.isError && !e.message.toolName.startsWith("cto_supervision_") ? [{ entry_id: e.id, tool_name: e.message.toolName }] : []).slice(-128) };
			});
			return { content: [{ type: "text", text: JSON.stringify({ primary_commission: PRIMARY, closes_primary: false, retained_unacknowledged_count: state.unacknowledged.length, passes }) }], details: undefined };
		},
	});
	pi.registerTool({
		name: ACK_TOOL, label: "CTO pass ACK", defaultActive: false, exposure: "model-only", executionMode: "sequential",
		description: "Record a sourced CTO supervision pass after real native actions/readback. Not commission completion, permission or effect verification. Use original finalized action entry IDs after the wake; never queued/working status.",
		parameters: Type.Object({ pass_id: Type.String(), action_entry_ids: Type.Array(Type.String()), source_refs: Type.Array(Type.String()), summary: Type.String() }, { additionalProperties: false }),
		async execute(_id, params, _signal, _update, ctx) {
			assertBound(ctx);
			const { pass, message, prior } = validateAck(ctx.sessionManager.getBranch(), params);
			if (prior) return { content: [{ type: "text", text: `Original ACK ${prior.id} retained; no new pass/return.` }], details: { prior_ack_entry_id: prior.id } };
			durable(ctx, [message.id, ...params.action_entry_ids]);
			return { content: [{ type: "text", text: "Pass recorded only when this tool result is finalized and durable; this return cannot close the primary. Return export is not COO ACK." }],
				details: { schema: "cto-supervision.ack/1", ...params, event_ids: pass.event_ids, primary_commission: PRIMARY, closes_primary: false } };
		},
	});
	pi.on("session_start", (_event, ctx) => {
		const e = ctx.sessionManager.getBranch().findLast(e => e.type === "custom" && e.customType === BINDING);
		if (e?.type === "custom") { binding = e.data as Binding; start(ctx); }
	});
	pi.on("turn_start", (_event, ctx) => { if (binding) { current = ctx; schedule(ctx); } });
	pi.on("turn_end", (event, ctx) => { if (binding) { current = ctx; observeQueue(event, ctx); exportAcks(ctx); schedule(ctx); } });
	pi.on("agent_before_settle", (event, ctx) => { if (binding) { current = ctx; observeQueue(event, ctx); schedule(ctx); } });
	pi.on("agent_settled", (_event, ctx) => { if (binding) { current = ctx; exportAcks(ctx); schedule(ctx); } });
	// Branch/session changes cannot silently inherit the existing CTO's pending commission.
	pi.on("session_before_switch", () => binding ? { cancel: true } : undefined);
	pi.on("session_before_fork", () => binding ? { cancel: true } : undefined);
	pi.on("session_before_tree", () => binding ? { cancel: true } : undefined);
	pi.on("session_shutdown", stop);
}
