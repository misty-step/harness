#!/usr/bin/env bun
/**
 * Overlay source-owned pi settings onto the live file, preserving foreign keys.
 *
 * Source keys always win. Live keys the source does not declare are kept, so
 * runtime state such as `lastChangelogVersion` survives a deploy. Nested
 * objects are merged recursively only while both sides are plain objects;
 * arrays and scalars are replaced wholesale.
 */
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
	options: {
		source: { type: "string" },
		dest: { type: "string" },
		check: { type: "boolean", default: false },
		local: { type: "string" },
	},
	strict: true,
});
if (!values.source || !values.dest) {
	throw new Error("--source and --dest are required");
}

const sourcePath = resolve(values.source);
const destPath = resolve(values.dest);

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function parseMapping(path: string, text: string): { [key: string]: Json } {
	const parsed = JSON.parse(text) as Json;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`Expected a JSON object: ${path}`);
	}
	return parsed;
}

function isMapping(value: Json): value is { [key: string]: Json } {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Source owns its keys; live-only keys are preserved. */
function overlay(source: Json, live: Json): Json {
	if (isMapping(source) && isMapping(live)) {
		const result: { [key: string]: Json } = Object.create(null);
		for (const key of Object.keys(source)) result[key] = overlay(source[key], live[key]);
		for (const key of Object.keys(live)) {
			if (!Object.hasOwn(source, key)) result[key] = live[key];
		}
		return result;
	}
	return source;
}

const sourceText = await readFile(sourcePath, "utf8");
if (!sourceText.trim()) throw new Error(`Missing or empty source: ${sourcePath}`);
const source = parseMapping(sourcePath, sourceText);

// Machine-local preferences override portable defaults; credentials stay runtime-owned.
if (values.local) {
	try {
		const local = parseMapping(values.local, await readFile(values.local, "utf8"));
		Object.assign(source, overlay(local, source));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

let live: { [key: string]: Json } | null = null;
try {
	const destStat = await lstat(destPath);
	if (!destStat.isFile() || destStat.isSymbolicLink()) {
		throw new Error(`Refusing non-file or symlinked configuration: ${destPath}`);
	}
	const liveText = await readFile(destPath, "utf8");
	live = liveText.trim() ? parseMapping(destPath, liveText) : {};
} catch (error) {
	if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

if (values.check) process.exit(0);

await mkdir(dirname(destPath), { recursive: true, mode: 0o700 });
const merged = overlay(source, live ?? {});
// These effort pins were owned by the retired lightweight route. Do not keep
// them alive through the otherwise-preserving merge, or touch foreign providers.
if (isMapping(merged) && isMapping(merged.modelThinkingLevels)) {
	for (const key of Object.keys(merged.modelThinkingLevels)) {
		if (/^(openai-pool|openai-codex(?:-[2-4])?)\/gpt-6-luna$/.test(key)) delete merged.modelThinkingLevels[key];
	}
}
const body = `${JSON.stringify(merged, null, 2)}\n`;
const temporary = `${destPath}.${process.pid}.tmp`;
try {
	await writeFile(temporary, body, { mode: 0o600, flag: "wx" });
	await chmod(temporary, 0o600);
	await rename(temporary, destPath);
} finally {
	await rm(temporary, { force: true });
}
