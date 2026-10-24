#!/usr/bin/env bun
// t3-runtime-mode: owned standalone launcher (misty-step/harness)

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { CliError, parseMode, withT3Session } from "../lib/t3-rpc.ts";

async function main(args: string[]): Promise<void> {
	if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
		console.log("Usage: t3-runtime-mode <threadId> <mode>\nModes: approval-required, auto-accept-edits, auto, full-access");
		return;
	}
	if (args.length !== 2 || !args[0].trim() || /[\x00-\x20\x7f]/.test(args[0]) || args[0].startsWith("-")) {
		throw new CliError("Usage: t3-runtime-mode <threadId> <mode>");
	}
	const [threadId, mode] = args;
	const runtimeMode = parseMode(mode);
	const baseDir = resolve(process.env.T3CODE_HOME?.trim() || join(homedir(), ".t3"));
	const { value: sequence, sessionId } = await withT3Session(baseDir, "agent-runtime-mode", (send) => send({
		type: "thread.runtime-mode.set", commandId: crypto.randomUUID(), threadId, runtimeMode,
	}));
	console.log(JSON.stringify({ threadId, runtimeMode, sequence, sessionId, revoked: true }));
}

if (import.meta.main) {
	try { await main(process.argv.slice(2)); }
	catch (error) {
		console.error(error instanceof CliError ? error.message : "t3-runtime-mode failed");
		process.exitCode = 1;
	}
}
