// owned by misty-step/harness omp-config auditors
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Loaded only into auditor sessions (`omp -e`), never installed globally. Auditors read and file
 * tickets; this guard and the launch tool list are the read-only boundary, so it refuses every
 * other tool even if a launch flag drifts. The filer owns dedupe, ranking and routing.
 */
export const ALLOWED_TOOLS: Record<string, true> = { read: true, grep: true, glob: true, audit_file: true };

export type Request = {
	action: "file" | "adopt" | "propose";
	gap: string;
	area: string;
	title: string;
	body: string;
	priority: "urgent" | "high" | "normal" | "low";
	ticket?: string;
};

type Runner = typeof spawnSync;

/** One request to the filer over stdin with fixed argv, so model text never becomes a command. */
export function fileRequest(filer: string, context: string, request: Request, run: Runner = spawnSync): { ok: boolean; text: string } {
	const result = run("python3", [filer, "file", "--context", context], {
		input: JSON.stringify(request),
		encoding: "utf8",
		timeout: 300_000,
	});
	const text = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
	if (result.error) return { ok: false, text: `filer did not run: ${result.error.message}` };
	return { ok: result.status === 0, text: text || `filer exited ${result.status}` };
}

export default function auditTool(pi: ExtensionAPI): void {
	// The launcher sets both on the auditor's Herdr tab; read once, as the session starts.
	const context = process.env.OMP_AUDIT_CONTEXT;
	const filer = process.env.OMP_AUDIT_FILER ?? join(homedir(), ".local", "bin", "omp-audit");
	pi.on("tool_call", (event) => {
		if (ALLOWED_TOOLS[event.toolName] !== true) {
			return { block: true, reason: "Auditors are read-only; audit_file is their only write." };
		}
	});
	if (!context) return;
	const z = pi.zod;
	pi.registerTool({
		name: "audit_file",
		label: "File audit gap",
		description:
			"File one audit outcome. action=file opens or updates the one ticket for this gap; action=adopt records that an existing open ticket (ticket=ID) already owns it; action=propose suggests a doctrine change to Phaedrus. No cap: call once per gap.",
		loadMode: "essential",
		parameters: z.object({
			action: z.enum(["file", "adopt", "propose"]),
			gap: z.string().regex(/^[a-z0-9][a-z0-9-]{1,59}$/).describe("Stable kebab-case name of the gap, the same every week"),
			area: z.string().regex(/^(F([1-9]|10)|P[1-5]|S)$/).describe("F1-F10 foundation, P1-P5 principle, or S for simplicity"),
			title: z.string().min(8).max(120).describe("<repository>: <outcome in plain words>"),
			body: z.string().min(20).max(6000).describe("The gap, evidence with links, and Done when"),
			priority: z.enum(["urgent", "high", "normal", "low"]),
			ticket: z.string().max(60).optional().describe("Existing ticket id, required for adopt"),
		}),
		async execute(_toolCallId, params) {
			const outcome = fileRequest(filer, context, params as Request);
			return { content: [{ type: "text", text: outcome.text }], details: { ok: outcome.ok } };
		},
	});
}
