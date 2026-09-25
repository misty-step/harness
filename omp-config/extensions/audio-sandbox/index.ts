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
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AGENT_AUDIO_ENV, sandboxAgentAudio, shellExports } from "./env.ts";

const PYTHON_ROUTING = `__import__("os").environ.update(${JSON.stringify(AGENT_AUDIO_ENV)})`;

/** A Python eval cell that applies the audio contract before its own code. */
export function routePythonCell(code: string): string {
	const lines = code.split("\n");
	if (lines.some(line => line.trim() === PYTHON_ROUTING || line.trim() === shellExports())) return code;
	// A standalone local:// %load is resolved by the host; the runner cannot read it.
	if (lines.length === 1 && /^%load\s+["']?local:\/\//.test(lines[0])) return code;
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

export default function audioSandbox(pi: ExtensionAPI): void {
	sandboxAgentAudio();
	pi.on("tool_call", event => {
		if (event.toolName !== "eval") return;
		const input = event.input as { language?: unknown; code?: unknown };
		if (input.language !== "py" || typeof input.code !== "string") return;
		return { input: { ...input, code: routePythonCell(input.code) } };
	});
}
