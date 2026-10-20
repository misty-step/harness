#!/usr/bin/env bun
// t3-runtime-mode: owned standalone launcher (misty-step/harness)

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

class CliError extends Error {}

function object(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new CliError("Invalid T3 response");
	return value;
}

function parseMode(value: string) {
	switch (value) {
		case "approval-required": case "auto-accept-edits": case "auto": case "full-access": return value;
		default: throw new CliError("Mode must be approval-required, auto-accept-edits, auto, or full-access");
	}
}

function serverUrl(baseDir: string): URL {
	try {
		const state = object(JSON.parse(readFileSync(join(baseDir, "userdata/server-runtime.json"), "utf8")));
		if (typeof state.origin !== "string") throw new Error();
		const url = new URL(state.origin);
		if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname)
			|| url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error();
		url.protocol = "ws:";
		url.pathname = "/ws";
		url.searchParams.set("orchestrationProtocol", "2");
		return url;
	} catch {
		throw new CliError("Cannot read a loopback T3 server from userdata/server-runtime.json");
	}
}

async function auth(baseDir: string, args: string[]): Promise<string> {
	try {
		const child = Bun.spawn({
			cmd: ["t3", "auth", "session", ...args, "--base-dir", baseDir, "--log-level", "none"],
			stdin: "ignore", stdout: "pipe", stderr: "ignore",
		});
		const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
		try {
			const [output, status] = await Promise.all([new Response(child.stdout).text(), child.exited]);
			if (status !== 0) throw new Error();
			return output;
		} finally {
			clearTimeout(timer);
		}
	} catch {
		throw new CliError(`t3 auth session ${args[0]} failed`);
	}
}

// T3 0.1.1-nightly: /ws uses Effect RPC's JSON codec, not JSON-RPC 2.0.
async function dispatch(options: {
	url: URL; token: string; threadId: string; runtimeMode: ReturnType<typeof parseMode>; signal: AbortSignal;
}): Promise<number> {
	const { url, token, threadId, runtimeMode, signal } = options;
	signal.throwIfAborted();
	const socket = new WebSocket(url.href, { headers: { Authorization: `Bearer ${token}` } });
	let cleanup = () => {};
	try {
		return await new Promise<number>((accept, reject) => {
			const fail = (message: string) => reject(new CliError(message));
			const timer = setTimeout(() => fail("Timed out waiting for T3 acknowledgement; command outcome is unknown"), 15_000);
			const abort = () => fail("Interrupted; command outcome may be unknown");
			signal.addEventListener("abort", abort, { once: true });
			socket.addEventListener("open", () => {
				socket.send(JSON.stringify({
					_tag: "Request", id: 1, tag: "orchestration.dispatchCommand", headers: [],
					payload: { type: "thread.runtime-mode.set", commandId: crypto.randomUUID(), threadId, runtimeMode },
				}));
			});
			socket.addEventListener("message", (event) => {
				try {
					if (typeof event.data !== "string") throw new Error();
					const decoded: unknown = JSON.parse(event.data);
					for (const item of Array.isArray(decoded) ? decoded : [decoded]) {
						const frame = object(item);
						if (frame._tag === "Ping") { socket.send(JSON.stringify({ _tag: "Pong" })); continue; }
						if (frame._tag === "Defect") { fail("T3 RPC defect"); return; }
						if (frame._tag !== "Exit" || frame.requestId !== 1) continue;
						const exit = object(frame.exit);
						if (exit._tag === "Failure") { fail("T3 rejected the runtime mode command"); return; }
						if (exit._tag !== "Success") throw new Error();
						const { sequence } = object(exit.value);
						if (typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 0) throw new Error();
						accept(sequence);
					}
				} catch { fail("Invalid T3 RPC acknowledgement"); }
			});
			socket.addEventListener("error", () => fail("T3 WebSocket connection failed"));
			socket.addEventListener("close", () => fail("T3 closed before acknowledgement; command outcome is unknown"));
			// Promise settlement also removes timers and signal listeners on failures.
			cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
		});
	} finally {
		cleanup();
		socket.close();
	}
}

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
	const url = serverUrl(baseDir);
	const label = `agent-runtime-mode:${crypto.randomUUID()}`;
	const controller = new AbortController();
	const interrupt = () => controller.abort();
	const signals = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"] as const;
	for (const signal of signals) process.on(signal, interrupt);
	let sessionId: string | undefined;
	let sequence: number;
	try {
		const issued = object(JSON.parse(await auth(baseDir, ["issue", "--scope", "orchestration:operate", "--ttl", "10m", "--label", label, "--json"])));
		if (typeof issued.sessionId === "string" && issued.sessionId.length > 0) sessionId = issued.sessionId;
		if (!sessionId || typeof issued.token !== "string" || !issued.token || /\s/.test(issued.token)) throw new CliError("Invalid T3 session response");
		sequence = await dispatch({ url, token: issued.token, threadId, runtimeMode, signal: controller.signal });
	} finally {
		try {
			// Recover by this invocation's unique label if issuance failed after minting.
			const ids = sessionId ? [sessionId] : await (async () => {
				const sessions: unknown = JSON.parse(await auth(baseDir, ["list", "--json"]));
				if (!Array.isArray(sessions)) throw new Error();
				return sessions.map(object).filter((session) => {
					const client = session.client;
					return typeof client === "object" && client !== null && "label" in client && client.label === label;
				}).map((session) => {
					if (typeof session.sessionId !== "string" || !session.sessionId) throw new Error();
					return session.sessionId;
				});
			})();
			for (const id of ids) await auth(baseDir, ["revoke", id]);
		} catch {
			throw new CliError(`Session cleanup failed; revoke sessions labelled ${label} with t3 auth session revoke`);
		} finally {
			for (const signal of signals) process.removeListener(signal, interrupt);
		}
	}
	console.log(JSON.stringify({ threadId, runtimeMode, sequence, sessionId, revoked: true }));
}

if (import.meta.main) {
	try { await main(process.argv.slice(2)); }
	catch (error) {
		console.error(error instanceof CliError ? error.message : "t3-runtime-mode failed");
		process.exitCode = 1;
	}
}
