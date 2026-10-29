import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";

export default function mistystackCore(pi: ExtensionAPI) {
	const core = readFileSync(new URL("../../rules/core.md", import.meta.url), "utf8");
	pi.on("before_agent_start", event => ({ systemPrompt: `${event.systemPrompt}\n\n${core}` }));
}
