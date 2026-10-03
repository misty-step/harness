#!/usr/bin/env bun
// story-deletion-check: owned standalone launcher (misty-step/harness).
import { resolve } from "node:path";
import { assessStoryDeletion } from "../system-one/story-deletion.ts";
import type { SystemOneProvider } from "../system-one/engine.ts";

const USAGE = "Usage: story-deletion-check --repo PATH --base REV --head REV [--json]";
type Options = { repo: string; base: string; head: string; json: boolean };

function parse(argv: string[]): Options | "help" {
	const values: Record<string, string> = {};
	let json = false;
	for (let i = 0; i < argv.length; i++) {
		const argument = argv[i];
		if (argument === "--help" || argument === "-h") return "help";
		if (argument === "--json") { if (json) throw new Error("Duplicate --json"); json = true; continue; }
		if (!["--repo", "--base", "--head"].includes(argument)) throw new Error(`Unknown argument: ${argument}`);
		if (values[argument] !== undefined || !argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`Missing or duplicate value: ${argument}`);
		values[argument] = argv[++i];
	}
	for (const flag of ["--repo", "--base", "--head"]) if (!values[flag]) throw new Error(`${flag} is required`);
	return { repo: resolve(values["--repo"]), base: values["--base"], head: values["--head"], json };
}

/** Provider injection is an in-process consumer test seam, not a CLI bypass flag. */
export async function runStoryDeletionCheck(argv: string[], provider?: SystemOneProvider | null): Promise<number> {
	try {
		const options = parse(argv);
		if (options === "help") { console.log(USAGE); return 0; }
		const result = await assessStoryDeletion({ repo: options.repo, base: options.base, head: options.head, provider });
		if (options.json) console.log(JSON.stringify(result, null, 2));
		else {
			console.log(`story-deletion-check: ${result.status} — ${result.reason}`);
			console.log(`base ${result.base}; head ${result.head}`);
			for (const finding of result.findings) console.log(`${finding.storyId}: ${finding.statement}\n${finding.criteria.join("\n")}\nChanged paths: ${finding.evidence.paths.join(", ")}`);
		}
		return result.status === "hold" ? 1 : 0;
	} catch (error) {
		console.error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
		return 2;
	}
}

if (import.meta.main) process.exitCode = await runStoryDeletionCheck(process.argv.slice(2));
