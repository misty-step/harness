#!/usr/bin/env bun
// Validates and installs the harness-owned OMP secret-masking policy (US-039).
// OMP skips an invalid secrets.yml entry with only a warning, which would
// silently stop masking; this check fails closed instead. The installed file is
// harness-owned: a secrets.yml without the managed first line is never replaced.
import { chmod, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

export const MANAGED_MARKER = "# managed by misty-step/harness omp-config/secrets.yml";

const KEYS: Record<string, true> = {
	type: true,
	content: true,
	mode: true,
	replacement: true,
	flags: true,
	friendlyName: true,
};
const MODES: Record<string, true> = { obfuscate: true, replace: true };

export type PolicyEntry = {
	type: "regex";
	content: string;
	flags?: string;
	mode?: string;
	replacement?: string;
	friendlyName?: string;
};

// OMP accepts a `/pattern/flags` literal or content plus flags, and always scans globally.
export function compileEntry(entry: PolicyEntry): RegExp {
	const literal = /^\/(.+)\/([a-z]*)$/s.exec(entry.content);
	const [source, flags] = literal ? [literal[1], literal[2]] : [entry.content, entry.flags ?? ""];
	return new RegExp(source, flags.includes("g") ? flags : `${flags}g`);
}

export function parsePolicy(text: string): PolicyEntry[] {
	if (!text.startsWith(`${MANAGED_MARKER}\n`)) throw new Error(`policy must start with: ${MANAGED_MARKER}`);
	const parsed = Bun.YAML.parse(text) as unknown;
	if (!Array.isArray(parsed) || parsed.length === 0) {
		throw new Error("policy must be a non-empty YAML array");
	}
	return parsed.map((raw, index) => {
		const where = `entry ${index + 1}`;
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${where}: expected a mapping`);
		for (const key of Object.keys(raw)) {
			if (!Object.hasOwn(KEYS, key)) throw new Error(`${where}: unknown key ${key}`);
		}
		const entry = raw as PolicyEntry;
		if (entry.type !== "regex") throw new Error(`${where}: only regex entries belong in a committed policy`);
		if (typeof entry.content !== "string" || entry.content.trim() === "") {
			throw new Error(`${where}: content must be a non-empty string`);
		}
		if (entry.mode !== undefined && !Object.hasOwn(MODES, entry.mode)) {
			throw new Error(`${where}: unknown mode ${entry.mode}`);
		}
		for (const key of ["flags", "replacement", "friendlyName"] as const) {
			if (entry[key] !== undefined && typeof entry[key] !== "string") {
				throw new Error(`${where}: ${key} must be a string`);
			}
		}
		try {
			compileEntry(entry);
		} catch (error) {
			throw new Error(`${where}: ${(error as Error).message}`);
		}
		return entry;
	});
}

async function readIfPresent(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

// Validates the source and the destination's ownership without writing.
export async function checkPolicy(sourcePath: string, destPath: string): Promise<string> {
	const text = await readFile(sourcePath, "utf8");
	parsePolicy(text);
	const current = await readIfPresent(destPath);
	if (current !== undefined && !current.startsWith(`${MANAGED_MARKER}\n`)) {
		throw new Error(
			`refusing to replace ${destPath}: it is not harness-managed; move its entries to a project .omp/secrets.yml`,
		);
	}
	return text;
}

export async function installPolicy(sourcePath: string, destPath: string): Promise<"installed" | "unchanged"> {
	const text = await checkPolicy(sourcePath, destPath);
	if ((await readIfPresent(destPath)) === text) return "unchanged";
	const temp = join(dirname(destPath), `.secrets.yml.${process.pid}.tmp`);
	try {
		await writeFile(temp, text, { mode: 0o600 });
		await chmod(temp, 0o600);
		await rename(temp, destPath);
	} catch (error) {
		await rm(temp, { force: true });
		throw error;
	}
	return "installed";
}

if (import.meta.main) {
	const { values } = parseArgs({
		options: {
			source: { type: "string" },
			dest: { type: "string" },
			check: { type: "boolean", default: false },
		},
		strict: true,
	});
	if (!values.source || !values.dest) throw new Error("--source and --dest are required");
	const source = resolve(values.source);
	const dest = resolve(values.dest);
	if (values.check) {
		await checkPolicy(source, dest);
	} else {
		console.log(`secrets policy ${await installPolicy(source, dest)}: ${dest}`);
	}
}
