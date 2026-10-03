import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { closeSync, existsSync, fsyncSync, openSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

// SDK boundary only: Rust owns socket framing, immutable spooling and clients.
const BINDING = "commission-relay.binding.v1";
const ATTEMPT = "commission-relay.attempt.v1";
const MESSAGE = "commission-relay.message.v1";
const RECEIPT = "commission-relay.receipt.v1";
const SETTLED = "commission-relay.settled.v1";
type Binding = { sessionId: string; sessionFile: string; mageBinary: string; spoolDir: string; socketPath: string };
type Envelope = { deliveryId: string; sessionId: string; sessionFile: string; kind: "commission" | "completion" | "decision"; payload: string; runId?: string; commissionRef?: string; inputId?: string };
type Call = { op: "deliver" | "inspect"; envelope: Envelope };

export default function (pi: ExtensionAPI) {
	let child: ChildProcessWithoutNullStreams | undefined;
	let binding: Binding | undefined;
	let stopping = false;

	function assertBound(ctx: ExtensionContext) {
		if (!binding || ctx.sessionManager.getSessionId() !== binding.sessionId || ctx.sessionManager.getSessionFile() !== binding.sessionFile) {
			throw new Error("native session binding changed; reconcile owner before delivery");
		}
	}

	// Pi's finalized entry tree is authority. Never ACK an enqueue or message_end event:
	// installed Pi dispatches message_end to extensions BEFORE persisting the message.
	function inspect(envelope: Envelope, ctx: ExtensionContext) {
		assertBound(ctx);
		const branch = ctx.sessionManager.getBranch();
		const attempt = branch.find((e) => e.type === "custom" && e.customType === ATTEMPT && (e.data as Envelope).deliveryId === envelope.deliveryId);
		if (attempt && JSON.stringify((attempt as { data: unknown }).data) !== JSON.stringify(envelope)) throw new Error("delivery ID conflict");
		const message = branch.find((e) => e.type === "custom_message" && e.customType === MESSAGE && (e.details as Envelope)?.deliveryId === envelope.deliveryId);
		if (!message) return { state: attempt ? "uncertain" : "absent" };
		if (message.type !== "custom_message" || JSON.stringify(message.details) !== JSON.stringify(envelope) || message.content !== envelope.payload) throw new Error("native payload conflict");
		let receipt = branch.find((e) => e.type === "custom" && e.customType === RECEIPT && (e.data as { deliveryId: string }).deliveryId === envelope.deliveryId);
		if (!receipt) {
			pi.appendEntry(RECEIPT, { deliveryId: envelope.deliveryId, messageEntryId: message.id });
			receipt = ctx.sessionManager.getBranch().find((e) => e.type === "custom" && e.customType === RECEIPT && (e.data as { deliveryId: string }).deliveryId === envelope.deliveryId);
		}
		if (!receipt) throw new Error("missing native receipt entry");
		// Custom-only new sessions are initially memory-only in Pi. Verify actual disk
		// entries and sync them before exposing a durable receipt. No transcript writes.
		if (!existsSync(binding!.sessionFile)) return { state: "uncertain" };
		const disk = readFileSync(binding!.sessionFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
		if (!disk.some((e) => e.id === message.id) || !disk.some((e) => e.id === receipt.id)) return { state: "uncertain" };
		for (const path of [binding!.sessionFile, dirname(binding!.sessionFile)]) {
			const fd = openSync(path, "r");
			try { fsyncSync(fd); } finally { closeSync(fd); }
		}
		const settled = branch.find((e) => e.type === "custom" && e.customType === SETTLED && (e.data as { deliveryIds: string[] }).deliveryIds.includes(envelope.deliveryId));
		return { state: "acknowledged", sessionId: binding!.sessionId, sessionFile: binding!.sessionFile, messageEntryId: message.id, receiptEntryId: receipt.id, settledEntryId: settled?.id ?? null };
	}

	function handle(call: Call, ctx: ExtensionContext) {
		assertBound(ctx);
		if (call.envelope.sessionId !== binding!.sessionId || call.envelope.sessionFile !== binding!.sessionFile) throw new Error("wrong native session");
		const result = inspect(call.envelope, ctx);
		if (call.op === "inspect" || result.state !== "absent") return result;
		pi.appendEntry(ATTEMPT, call.envelope);
		pi.sendMessage({ customType: MESSAGE, content: call.envelope.payload, display: true, details: call.envelope }, { triggerTurn: true, deliverAs: "followUp" });
		return { state: "uncertain" }; // caller must pull an explicit durable native receipt
	}

	async function stop() {
		stopping = true;
		const old = child;
		child = undefined;
		if (old) {
			old.stdin.end(); // orderly transport shutdown; never terminate the native session
			await new Promise<void>((resolve) => old.once("close", () => resolve()));
		}
	}

	function start(ctx: ExtensionContext) {
		assertBound(ctx);
		if (child) return;
		stopping = false;
		const process = spawn(binding!.mageBinary, ["serve", binding!.socketPath, binding!.spoolDir, binding!.sessionId, binding!.sessionFile], { stdio: "pipe" });
		child = process;
		let buffer = "";
		process.stdout.setEncoding("utf8");
		process.stdout.on("data", (chunk: string) => {
			buffer += chunk;
			let end: number;
			while ((end = buffer.indexOf("\n")) >= 0) {
				const line = buffer.slice(0, end);
				buffer = buffer.slice(end + 1);
				let response: unknown;
				try { response = { ok: true, data: handle(JSON.parse(line) as Call, ctx) }; }
				catch (error) { response = { ok: false, error: String(error) }; }
				process.stdin.write(JSON.stringify(response) + "\n");
			}
		});
		process.stderr.setEncoding("utf8");
		process.stderr.on("data", (message: string) => ctx.ui.notify(message.trim(), "warning"));
		process.on("error", (error) => ctx.ui.notify(`Commission relay: ${error.message}`, "error"));
		process.on("close", () => {
			if (child === process) child = undefined;
			if (!stopping) ctx.ui.notify("Commission relay transport stopped; unfinished dispatch remains uncertain", "warning");
		});
	}

	pi.registerCommand("commission-relay-bind", {
		description: "Opt in this exact native session to source relay; argument is an absolute binding JSON path",
		handler: async (path, ctx) => {
			const config = JSON.parse(readFileSync(path.trim(), "utf8")) as Binding;
			if (Object.values(config).some((v) => typeof v !== "string" || !v) || [config.sessionFile, config.mageBinary, config.spoolDir, config.socketPath].some((v) => !v.startsWith("/"))) throw new Error("binding requires absolute paths and nonempty session ID");
			if (config.sessionId !== ctx.sessionManager.getSessionId() || config.sessionFile !== ctx.sessionManager.getSessionFile()) throw new Error("binding must name this exact native session");
			if (binding && JSON.stringify(binding) !== JSON.stringify(config)) throw new Error("existing binding differs; reconcile native owner");
			binding = config;
			pi.appendEntry(BINDING, binding);
			start(ctx);
		},
	});
	pi.registerCommand("commission-relay-stop", {
		description: "Stop only relay transport; native session and uncertain inputs remain intact (reload reopens binding)",
		handler: async () => { await stop(); },
	});
	pi.registerCommand("commission-relay-reload", {
		description: "Reload using supported Pi runtime API; binding recovers from active native branch",
		handler: async (_args, ctx) => { await ctx.reload(); },
	});
	pi.on("session_start", (_event, ctx) => {
		const entry = ctx.sessionManager.getBranch().findLast((e) => e.type === "custom" && e.customType === BINDING);
		if (entry?.type === "custom") { binding = entry.data as Binding; start(ctx); }
	});
	pi.on("agent_settled", (_event, ctx) => {
		if (!binding) return;
		assertBound(ctx);
		const branch = ctx.sessionManager.getBranch();
		const already = new Set(branch.flatMap((e) => e.type === "custom" && e.customType === SETTLED ? (e.data as { deliveryIds: string[] }).deliveryIds : []));
		const deliveryIds = branch.flatMap((e) => e.type === "custom_message" && e.customType === MESSAGE && !already.has((e.details as Envelope).deliveryId) ? [(e.details as Envelope).deliveryId] : []);
		if (deliveryIds.length) pi.appendEntry(SETTLED, { deliveryIds }); // execution observation, NOT acceptance
	});
	// Moving the native branch invalidates delivery ownership, not just UI identity.
	pi.on("session_before_switch", () => binding ? { cancel: true } : undefined);
	pi.on("session_before_fork", () => binding ? { cancel: true } : undefined);
	pi.on("session_before_tree", () => binding ? { cancel: true } : undefined);
	pi.on("session_shutdown", async () => { await stop(); });
}
