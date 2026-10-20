#!/usr/bin/env bun
/**
 * Deny Claude Code sessions reads of `.env` values (#351).
 *
 *   env-reads.ts --settings FILE [--check]
 *
 * Secrets reach a session only through `pass-env` and native logins, so a
 * session never needs a dotenv file's values. Claude Code 2.1.303 applies Read
 * deny rules to its file tools (Read, Grep, Glob), to Bash commands that name
 * the file (`cat`, `head`, `sed`, `< file`), and in every permission mode.
 * They miss commands that read without naming the file (`grep -r KEY .`) and
 * scripts that open files themselves; only the OS sandbox covers those.
 *
 * `//**` reaches `.env` and local overrides anywhere, including other projects.
 * `!` carve-outs reach only cwd-relative rules, so other variants are denied at
 * or under the session's directory, minus the files that hold references.
 *
 * --check validates the destination without writing.
 */
import { mergeClaudeSettings, readRegular, writeIfChanged } from "./settings.ts";

export const ENV_READ_DENY: readonly string[] = Object.freeze([
	"Read(//**/.env)",
	"Read(//**/.env.local)",
	"Read(//**/.env.*.local)",
	"Read(.env.*)",
	"Read(!.env.example)",
	"Read(!.env.pass)",
	"Read(!.env.pass.example)",
]);

function main(args: string[]): void {
	const settings = args[args.indexOf("--settings") + 1];
	if (!args.includes("--settings") || !settings || settings.startsWith("--")) {
		throw new Error("usage: env-reads.ts --settings FILE [--check]");
	}
	const current = readRegular(settings);
	const next = mergeClaudeSettings(current, { deny: ENV_READ_DENY });
	if (args.includes("--check")) return;
	console.log(`claude-settings: env-read deny rules ${settings} ${writeIfChanged(settings, next, current)}`);
}

if (import.meta.main) {
	try {
		main(Bun.argv.slice(2));
	} catch (error) {
		console.error(`claude-settings: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}
}
