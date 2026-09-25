/**
 * audio-sandbox: keep agent audio out of the operator's ears (US-026).
 *
 * Second layer. OMP loads the agent `.env` before any tool runs, and the
 * installer's block there already routes the bash tool without this code. This
 * extension applies the same contract to `process.env`, so children that OMP
 * spawns from it (browser, MCP and LSP servers) play into the silent
 * agent-sandbox sink as well.
 */
import { sandboxAgentAudio } from "./env.ts";

export default function audioSandbox(): void {
	sandboxAgentAudio();
}
