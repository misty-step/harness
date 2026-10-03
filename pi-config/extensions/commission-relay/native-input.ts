// Narrow supported SDK boundary for standalone summon-pi-runtime. No Mage dependency.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, openSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
const ATTEMPT = "summon.pi.attempt.v1";
const MESSAGE = "summon.pi.input.v1";
const RECEIPT = "summon.pi.receipt.v1";
type Input = { runId: string; attemptId: string; inputId: string; textSha256: string; sessionId: string; sessionFile: string; text: string };

export default function (pi: ExtensionAPI) {
	function parse(args: string, ctx: ExtensionContext): Input {
		const input = JSON.parse(args) as Input;
		if (!input.runId || !input.attemptId || !input.inputId || input.sessionId !== ctx.sessionManager.getSessionId() || input.sessionFile !== ctx.sessionManager.getSessionFile() || typeof input.text !== "string" || createHash("sha256").update(input.text).digest("hex") !== input.textSha256) throw new Error("exact native input/session/hash required");
		return input;
	}
	function receipt(input: Input, ctx: ExtensionContext) {
		const branch = ctx.sessionManager.getBranch();
		const prior = branch.find((e) => e.type === "custom" && e.customType === ATTEMPT && ((e.data as Input).attemptId === input.attemptId || (e.data as Input).inputId === input.inputId));
		if (prior?.type === "custom" && JSON.stringify(prior.data) !== JSON.stringify(input)) throw new Error("native attempt ID conflict");
		const message = branch.find((e) => e.type === "custom_message" && e.customType === MESSAGE && (e.details as Input).attemptId === input.attemptId);
		if (message?.type !== "custom_message") return { state: prior ? "uncertain" : "absent" };
		if (JSON.stringify(message.details) !== JSON.stringify(input) || message.content !== input.text) throw new Error("native message conflict");
		let entry = branch.find((e) => e.type === "custom" && e.customType === RECEIPT && (e.data as { attemptId: string }).attemptId === input.attemptId);
		if (!entry) {
			pi.appendEntry(RECEIPT, { attemptId: input.attemptId, inputId: input.inputId, textSha256: input.textSha256, messageEntryId: message.id });
			entry = ctx.sessionManager.getBranch().find((e) => e.type === "custom" && e.customType === RECEIPT && (e.data as { attemptId: string }).attemptId === input.attemptId);
		}
		if (!entry || !existsSync(input.sessionFile)) return { state: "uncertain" };
		const disk = readFileSync(input.sessionFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
		if (!disk.some((e) => e.id === entry!.id) || !disk.some((e) => e.id === message.id)) return { state: "uncertain" };
		for (const path of [input.sessionFile, dirname(input.sessionFile)]) {
			const fd = openSync(path, "r"); try { fsyncSync(fd); } finally { closeSync(fd); }
		}
		return { state: "acknowledged", messageEntryId: message.id, receiptEntryId: entry.id };
	}
	pi.registerCommand("summon-native-input", {
		description: "Exact immutable native input from the commissioned standalone Rust adapter",
		handler: async (args, ctx) => {
			const input = parse(args, ctx);
			const prior = receipt(input, ctx);
			if (prior.state !== "absent") return; // unknown stays uncertain; never blind replay
			if (!ctx.isIdle()) throw new Error("between-turn input only");
			pi.appendEntry(ATTEMPT, input);
			pi.sendMessage({ customType: MESSAGE, content: input.text, display: true, details: input }, { triggerTurn: true });
		},
	});
	pi.registerCommand("summon-native-receipt", {
		description: "Reconcile exact durable active-branch native input; never deliver or run",
		handler: async (args, ctx) => { receipt(parse(args, ctx), ctx); },
	});
	const active = (ctx: ExtensionContext) => ctx.sessionManager.getBranch().some((e) => e.type === "custom" && e.customType === ATTEMPT);
	pi.on("session_before_switch", (_event, ctx) => active(ctx) ? { cancel: true } : undefined);
	pi.on("session_before_fork", (_event, ctx) => active(ctx) ? { cancel: true } : undefined);
	pi.on("session_before_tree", (_event, ctx) => active(ctx) ? { cancel: true } : undefined);
}
