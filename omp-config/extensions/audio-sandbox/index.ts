/**
 * audio-sandbox: keep agent audio out of the operator's ears (US-026).
 *
 * Second layer. OMP loads the agent `.env` before any tool runs, and the
 * installer's block there already routes the bash tool without this code. This
 * extension applies the same contract to `process.env`, so children that OMP
 * spawns from it (JavaScript eval, browser, MCP and LSP servers) play into the
 * silent agent-sandbox sink as well.
 *
 * OMP starts its Python eval runner with an allowlisted environment that drops
 * the routing keys, so every Python cell is revised to apply the contract before
 * its own code runs (streams are routed when created, never moved after linking).
 * The revision adds one line, so Python tracebacks count one line more.
 */
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AGENT_AUDIO_ENV, sandboxAgentAudio, shellExports } from "./env.ts";

const PYTHON_ROUTING = `__import__("os").environ.update(${JSON.stringify(AGENT_AUDIO_ENV)})`;

/** The canonical path, following symlinks; a path that does not exist yet stays lexical. */
function canonical(path: string): string {
	try {
		return realpathSync(path);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return path;
		throw error;
	}
}

/**
 * A Python eval cell that applies the audio contract before its own code.
 * `localRoot` is the directory backing the session's `local://`; it is needed
 * only for a standalone local load.
 */
export function routePythonCell(code: string, localRoot?: string | null): string {
	const lines = code.split("\n");
	if (lines.some(line => line.trim() === PYTHON_ROUTING || line.trim() === shellExports())) return code;
	// The host resolves a standalone `%load local://…`, but the runner cannot read
	// that URL once other code shares the cell, so load the backing file by path.
	const localLoad = lines.length === 1 ? /^%load\s+(["']?)local:\/\/(.+?)\1\s*$/.exec(lines[0].trim()) : null;
	if (localLoad) {
		if (!localRoot) throw new Error("audio sandbox: cannot resolve local:// for this %load; load the file by path");
		const root = canonical(resolve(localRoot));
		const target = canonical(resolve(root, decodeURIComponent(localLoad[2])));
		if (!target.startsWith(`${root}${sep}`)) throw new Error("audio sandbox: local:// path escapes the session root");
		return `${PYTHON_ROUTING}\n%load ${JSON.stringify(target)}`;
	}
	// A cell magic must stay first; %%bash gets the contract as shell exports.
	if (lines[0].startsWith("%%")) {
		return lines[0].trim() === "%%bash" ? [lines[0], shellExports(), ...lines.slice(1)].join("\n") : code;
	}
	// `from __future__` imports must precede every other statement.
	let insertAt = 0;
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index].trim();
		if (line.startsWith("from __future__ import")) insertAt = index + 1;
		else if (line !== "" && !line.startsWith("#")) break;
	}
	return [...lines.slice(0, insertAt), PYTHON_ROUTING, ...lines.slice(insertAt)].join("\n");
}

function member(value: unknown, key: string): unknown {
	return value && typeof value === "object" && key in value ? Reflect.get(value, key) : undefined;
}

function invoke(target: unknown, method: string): unknown {
	const fn = member(target, method);
	return typeof fn === "function" ? fn.call(target) : undefined;
}

/**
 * The session's `local://` root, resolved as OMP does: `<artifacts dir>/local`,
 * else `<tmpdir>/omp-local/<session id>` for a session without artifacts. If OMP
 * changes this, the routing line still runs first and only the load fails.
 */
function localRootOf(ctx: unknown): string | null {
	const source = member(ctx, "localProtocolOptions") ?? member(ctx, "sessionManager");
	if (!source || typeof source !== "object") return null;
	const dir = invoke(source, "getArtifactsDir");
	if (typeof dir === "string" && dir !== "") return resolve(dir, "local");
	const id = invoke(source, "getSessionId");
	const safe = (typeof id === "string" ? id : "session").replace(/[^a-zA-Z0-9_.-]/g, "_");
	return join(tmpdir(), "omp-local", safe || "session");
}

export default function audioSandbox(pi: ExtensionAPI): void {
	sandboxAgentAudio();
	pi.on("tool_call", (event, ctx) => {
		const input: unknown = event.input;
		if (event.toolName !== "eval" || !input || typeof input !== "object") return;
		if (!("language" in input) || input.language !== "py" || !("code" in input)) return;
		if (typeof input.code !== "string") return;
		return { input: { ...input, code: routePythonCell(input.code, localRootOf(ctx)) } };
	});
}
