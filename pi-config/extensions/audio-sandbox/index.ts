/**
 * audio-sandbox: keep agent audio out of the operator's ears (US-026).
 *
 * Second layer. The installer's `shellCommandPrefix` already routes the bash
 * tool from settings, without this code. This extension applies the same
 * contract to `process.env`, which Node mirrors into the process environment,
 * so every other child pi spawns plays into the silent agent-sandbox sink too.
 */
import { sandboxAgentAudio } from "./env.ts";

export default function audioSandbox(): void {
	sandboxAgentAudio();
}
