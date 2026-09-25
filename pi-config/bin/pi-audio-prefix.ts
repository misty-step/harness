#!/usr/bin/env bun
/**
 * Own pi's `shellCommandPrefix` for the agent audio sandbox (US-026).
 *
 *   pi-audio-prefix.ts --contract <agent-config/audio-sandbox/env.ts> --file <settings.json> [--check]
 *
 * The prefix routes pi's bash tool from settings alone. It is ours only when it
 * is an export line of single-quoted assignments whose names are exactly the
 * contract marker plus the keys that marker lists, so a stale value is renewed.
 * Any other prefix (an operator's own, or ours composed with more shell) fails
 * closed before any write; foreign settings keys are always preserved.
 */
import { chmodSync, lstatSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";

type Settings = Record<string, unknown>;

export function ownsPrefix(prefix: string, marker: string): boolean {
	const line = /^export((?: [A-Za-z_][A-Za-z0-9_]*='[^'\n]*')+)$/.exec(prefix);
	if (!line) return false;
	const assignments = [...line[1].matchAll(/ ([A-Za-z_][A-Za-z0-9_]*)='([^'\n]*)'/g)];
	const names = assignments.map(match => match[1]);
	const listed = assignments.find(match => match[1] === marker)?.[2];
	if (listed === undefined) return false;
	const expected = new Set([...listed.split(" ").filter(Boolean), marker]);
	return names.length === expected.size && names.every(name => expected.has(name));
}

/** Settings text with the sandbox prefix; throws on a prefix pi-config did not write. */
export function mergeAudioPrefix(text: string | undefined, exportsLine: string, marker: string): string {
	const parsed: unknown = text === undefined || text.trim() === "" ? {} : JSON.parse(text);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("pi settings must be a JSON object");
	const settings: Settings = { ...parsed };
	const current = settings.shellCommandPrefix;
	if (current !== undefined && current !== "" && !(typeof current === "string" && ownsPrefix(current, marker))) {
		throw new Error("Refusing to replace a foreign shellCommandPrefix; compose it with the audio sandbox by hand");
	}
	return `${JSON.stringify({ ...settings, shellCommandPrefix: exportsLine }, null, 2)}\n`;
}

function readSettings(path: string): string | undefined {
	try {
		const stat = lstatSync(path);
		if (!stat.isFile()) throw new Error(`Refusing non-regular settings: ${path}`);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
		throw error;
	}
	return readFileSync(path, "utf8");
}

if (import.meta.main) {
	const { values } = parseArgs({
		options: { contract: { type: "string" }, file: { type: "string" }, check: { type: "boolean", default: false } },
		strict: true,
	});
	if (!values.contract || !values.file) throw new Error("--contract and --file are required");
	// Runtime-selected: the installer passes the agent-config checkout it resolved (AGENT_CONFIG_DIR may override).
	const contract: unknown = await import(values.contract);
	if (!contract || typeof contract !== "object" || !("shellExports" in contract) || !("AGENT_AUDIO_MARKER" in contract)) {
		throw new Error(`Not an audio sandbox contract: ${values.contract}`);
	}
	const { shellExports, AGENT_AUDIO_MARKER: marker } = contract;
	if (typeof shellExports !== "function" || typeof marker !== "string") throw new Error("Malformed audio sandbox contract");
	const current = readSettings(values.file);
	const next = mergeAudioPrefix(current, String(shellExports()), marker);
	if (values.check || next === current) process.exit(0);
	const mode = current === undefined ? 0o600 : lstatSync(values.file).mode & 0o777;
	const temp = join(dirname(values.file), `.${basename(values.file)}.${process.pid}.tmp`);
	writeFileSync(temp, next, { flag: "wx", mode });
	chmodSync(temp, mode);
	renameSync(temp, values.file);
	console.log(`pi: audio sandbox shellCommandPrefix written to ${values.file}`);
}
