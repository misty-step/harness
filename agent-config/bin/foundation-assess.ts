#!/usr/bin/env bun
import { resolve } from "node:path";
import { assessFoundations, openGitSnapshot, type PackName } from "../system-one/foundation-assess.ts";
import { resolveProvider } from "../system-one/engine.ts";

const USAGE = "Usage: foundation-assess --repo DIR [--ref REF] [--pack sentry|postmortems|ledger|all] [--json] [--provider heuristic|openrouter] [--timeout-ms N]";
type Options = { repo: string; ref?: string; pack: PackName | "all"; json: boolean; provider: "heuristic" | "openrouter"; timeoutMs: number };

function parse(argv: string[]): Options | "help" {
	const values: Record<string, string> = {};
	let json = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--help" || arg === "-h") return "help";
		if (arg === "--json") { if (json) throw new Error("Duplicate --json"); json = true; continue; }
		if (!["--repo", "--ref", "--pack", "--provider", "--timeout-ms"].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
		if (values[arg] !== undefined || !argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`Missing or duplicate value: ${arg}`);
		values[arg] = argv[++i];
	}
	if (!values["--repo"]) throw new Error("--repo is required");
	const pack = values["--pack"] ?? "all";
	if (!["sentry", "postmortems", "ledger", "all"].includes(pack)) throw new Error("Invalid --pack");
	const provider = values["--provider"] ?? "openrouter";
	if (provider !== "heuristic" && provider !== "openrouter") throw new Error("Invalid --provider");
	const timeout = values["--timeout-ms"] ?? "15000";
	if (!/^[1-9]\d*$/.test(timeout) || !Number.isSafeInteger(Number(timeout))) throw new Error("--timeout-ms must be a positive integer");
	return { repo: resolve(values["--repo"]), ref: values["--ref"], pack: pack as Options["pack"], json, provider, timeoutMs: Number(timeout) };
}

async function main(): Promise<void> {
	let options: Options | "help";
	try {
		options = parse(process.argv.slice(2));
		if (options === "help") { console.log(USAGE); return; }
		const snapshot = openGitSnapshot(options.repo, options.ref);
		const result = await assessFoundations({ repo: options.repo, snapshot, pack: options.pack, provider: resolveProvider(options.provider), timeoutMs: options.timeoutMs });
		if (options.json) { console.log(JSON.stringify(result, null, 2)); return; }
		for (const packet of result.packets) for (const question of packet.questions) console.log(`${packet.pack} ${packet.source} ${question.id}: ${question.outcome}${question.choice ? ` (${question.choice})` : ""}${question.reason ? ` — ${question.reason}` : ""}`);
		for (const item of result.unassessed) console.log(`${item.pack} ${item.source}: not assessed — ${item.reason}`);
		if (!result.packets.length && !result.unassessed.length) console.log(`${options.pack}: no matching tracked evidence at ${result.ref}`);
	} catch (error) {
		console.error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
		process.exitCode = 2;
	}
}

if (import.meta.main) await main();
