import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Install the executive policy's identical bytes beside this cage-readable extension.
const guard = join(import.meta.dir, "pane_guard.py");
const reads: Record<string, true> = { read: true, grep: true, glob: true, find: true, web_search: true, todo: true, ask: true };

export default function kayleePaneGuard(pi: ExtensionAPI): void {
	pi.on("tool_call", (event) => {
		if (Object.hasOwn(reads, event.toolName)) return;
		const result = spawnSync("python3", [guard], {
			input: JSON.stringify({ tool_name: event.toolName, args: event.input }),
			encoding: "utf8", timeout: 12000,
		});
		try {
			if (result.error || result.status !== 0) throw new Error("Guard unavailable");
			const verdict = JSON.parse(result.stdout);
			if (verdict === null) return;
			if (verdict.action !== "block" || typeof verdict.message !== "string") throw new Error("Invalid verdict");
			return { block: true, reason: verdict.message };
		} catch {
			return { block: true, reason: "Kaylee pane guard unavailable; no tool action was dispatched." };
		}
	});
}
