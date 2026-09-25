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
import { resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AGENT_AUDIO_ENV, sandboxAgentAudio, shellExports } from "./env.ts";

const PYTHON_ROUTING = `__import__("os").environ.update(${JSON.stringify(AGENT_AUDIO_ENV)})`;

/**
 * A Python eval cell that applies the audio contract before its own code.
 * `artifactsDir` is the session's artifacts directory, whose `local`
 * subdirectory backs `local://`; it is needed only for a standalone local load.
 */
export function routePythonCell(code: string, artifactsDir?: string | null): string {
	const lines = code.split("\n");
	if (lines.some(line => line.trim() === PYTHON_ROUTING || line.trim() === shellExports())) return code;
	// The host resolves a standalone `%load local://…`, but the runner cannot read
	// that URL once other code shares the cell, so load the backing file by path.
	const localLoad = lines.length === 1 ? /^%load\s+(["']?)local:\/\/(.+?)\1\s*$/.exec(lines[0].trim()) : null;
	if (localLoad) {
		if (!artifactsDir) throw new Error("audio sandbox: cannot resolve local:// for this %load; load the file by path");
		const root = resolve(artifactsDir, "local");
		const target = resolve(root, decodeURIComponent(localLoad[2]));
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

/** The session artifacts directory from an extension context, when it exposes one. */
function artifactsDirOf(ctx: unknown): string | null {
	if (!ctx || typeof ctx !== "object" || !("localProtocolOptions" in ctx)) return null;
	const local = ctx.localProtocolOptions;
	if (!local || typeof local !== "object" || !("getArtifactsDir" in local)) return null;
	if (typeof local.getArtifactsDir !== "function") return null;
	const dir: unknown = local.getArtifactsDir();
	return typeof dir === "string" ? dir : null;
}

export default function audioSandbox(pi: ExtensionAPI): void {
	sandboxAgentAudio();
	pi.on("tool_call", (event, ctx) => {
		const input: unknown = event.input;
		if (event.toolName !== "eval" || !input || typeof input !== "object") return;
		if (!("language" in input) || input.language !== "py" || !("code" in input)) return;
		if (typeof input.code !== "string") return;
		return { input: { ...input, code: routePythonCell(input.code, artifactsDirOf(ctx)) } };
	});
}
