#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
	options: {
		source: { type: "string" },
		dest: { type: "string" },
		check: { type: "boolean", default: false },
		local: { type: "string" },
		"model-policy-only": { type: "boolean", default: false },
	},
	strict: true,
});
if (!values.source || !values.dest) {
	throw new Error("--source and --dest are required");
}

const sourcePath = resolve(values.source);
const destPath = resolve(values.dest);

type Yaml = null | boolean | number | string | Yaml[] | { [key: string]: Yaml };

function parseMapping(path: string, text: string): { [key: string]: Yaml } {
	const parsed = Bun.YAML.parse(text) as Yaml;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`Expected a YAML mapping: ${path}`);
	}
	return parsed;
}

function overlay(source: Yaml, live: Yaml): Yaml {
	if (
		source && typeof source === "object" && !Array.isArray(source) &&
		live && typeof live === "object" && !Array.isArray(live)
	) {
		const result: { [key: string]: Yaml } = Object.create(null);
		for (const key of Object.keys(source)) result[key] = overlay(source[key], live[key]);
		for (const key of Object.keys(live)) {
			if (!Object.hasOwn(source, key)) result[key] = live[key];
		}
		return result;
	}
	return source;
}

function pruneRetiredKeys(source: Yaml, merged: Yaml): void {
	// Retire only these owned leaves; other live-only config remains foreign.
	const paths = [
		["providers", "tinyModel"],
		["modelRoles", "designer"],
		["task", "agentModelOverrides", "designer"],
		["retry", "fallbackChains", "slow"],
		["retry", "fallbackChains", "extreme"],
		["retry", "fallbackChains", "plan"],
		["retry", "fallbackChains", "advisor"],
		["retry", "fallbackChains", "task"],
		["retry", "fallbackChains", "designer"],
		["retry", "fallbackChains", "smol"],
		["retry", "fallbackChains", "tiny"],
		["retry", "fallbackChains", "commit"],
		["retry", "fallbackChains", "reviewer"],
		["retry", "fallbackChains", "security-reviewer"],
		["retry", "fallbackChains", "anthropic/claude-opus-5-5"],
	];
	for (const path of paths) {
		if (values["model-policy-only"] && path[0] === "providers") continue;
		let sourceParent: Yaml | undefined = source;
		let mergedParent: Yaml | undefined = merged;
		for (let index = 0; index < path.length - 1; index++) {
			const key = path[index];
			sourceParent = sourceParent && typeof sourceParent === "object" && !Array.isArray(sourceParent)
				? sourceParent[key] : undefined;
			mergedParent = mergedParent && typeof mergedParent === "object" && !Array.isArray(mergedParent)
				? mergedParent[key] : undefined;
		}
		const leaf = path[path.length - 1];
		if (sourceParent && typeof sourceParent === "object" && !Array.isArray(sourceParent) &&
			Object.hasOwn(sourceParent, leaf)) continue;
		if (mergedParent && typeof mergedParent === "object" && !Array.isArray(mergedParent)) {
			delete mergedParent[leaf];
		}
	}
}


const sourceText = await readFile(sourcePath, "utf8");
if (!sourceText.trim()) throw new Error(`Missing or empty source: ${sourcePath}`);
let source = parseMapping(sourcePath, sourceText);
let adjusted = false;

// US-017: installed desktop palettes win over portable defaults, not explicit preferences.
if (!values["model-policy-only"] && Object.hasOwn(source, "theme") && existsSync(join(dirname(destPath), "themes", "omarchy-system.json"))) {
	source.theme = { dark: "omarchy-system", light: "omarchy-system" };
	adjusted = true;
}

// Machine-local preferences override portable defaults; credentials stay runtime-owned.
if (values.local) {
	try {
		const local = parseMapping(values.local, await readFile(values.local, "utf8"));
		Object.assign(source, overlay(local, source));
		adjusted = true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

if (values["model-policy-only"]) {
	// Select only routing leaves after the local overlay. Do not retire or
	// replace any provider, credential, presentation or task-execution setting.
	const selected: { [key: string]: Yaml } = {};
	if (Object.hasOwn(source, "modelRoles")) selected.modelRoles = source.modelRoles;
	for (const [parent, leaves] of [
		["retry", ["fallbackChains"]],
		["task", ["agentModelOverrides", "disabledAgents"]],
	] as const) {
		const value = source[parent];
		if (value === undefined) continue;
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			throw new Error(`${parent} must be a mapping`);
		}
		const selection: { [key: string]: Yaml } = {};
		for (const leaf of leaves) {
			if (Object.hasOwn(value, leaf)) selection[leaf] = value[leaf];
		}
		if (Object.keys(selection).length > 0) selected[parent] = selection;
	}
	source = selected;
	adjusted = true;
}

let live: { [key: string]: Yaml } | null = null;
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
let body: string;
if (live === null) {
	body = adjusted ? `${Bun.YAML.stringify(source)}\n`
		: sourceText.endsWith("\n") ? sourceText : `${sourceText}\n`;
} else {
	const merged = overlay(source, live ?? {});
	pruneRetiredKeys(source, merged);
	// Retire only the former source-owned email pins, preserving local policies.
	const auth = merged && typeof merged === "object" && !Array.isArray(merged) ? merged.auth : undefined;
	const sourceAuth = source.auth;
	const sourcePolicies = sourceAuth && typeof sourceAuth === "object" && !Array.isArray(sourceAuth)
		? sourceAuth.accountPolicies : undefined;
	if (!values["model-policy-only"] && !sourcePolicies && auth && typeof auth === "object"
		&& !Array.isArray(auth) && Array.isArray(auth.accountPolicies)) {
		auth.accountPolicies = auth.accountPolicies.filter(policy => {
			if (!policy || typeof policy !== "object" || Array.isArray(policy)) return true;
			const account = policy.account;
			return !(["anthropic", "openai-codex"].some(provider => provider === policy.provider) &&
				policy.priority === 1 && account && typeof account === "object" && !Array.isArray(account) &&
				account.email === "phaedrus@r90.dev" && Object.keys(account).length === 1 &&
				Object.keys(policy).length === 3);
		});
	}
	// Adding the fail-closed specialist gate must not enable a foreign agent
	// that the operator already disabled.
	const task = merged && typeof merged === "object" && !Array.isArray(merged) ? merged.task : undefined;
	const liveTask = live.task;
	if (task && liveTask && typeof task === "object" && typeof liveTask === "object"
		&& !Array.isArray(task) && !Array.isArray(liveTask)
		&& Array.isArray(task.disabledAgents) && Array.isArray(liveTask.disabledAgents)) {
		const disabled = new Set(task.disabledAgents);
		for (const agent of liveTask.disabledAgents) disabled.add(agent);
		task.disabledAgents = [...disabled];
	}
	body = `${Bun.YAML.stringify(merged)}\n`;
}
const temporary = `${destPath}.${process.pid}.tmp`;
try {
	await writeFile(temporary, body, { mode: 0o600, flag: "wx" });
	await chmod(temporary, 0o600);
	await rename(temporary, destPath);
} finally {
	await rm(temporary, { force: true });
}
