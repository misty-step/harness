/**
 * Claude Code user settings (`settings.json`) as shared primitives write them.
 *
 * Each primitive owns only the keys it merges: `env` entries by name and
 * `permissions.deny` rules by exact text. Every other key and rule survives,
 * and a malformed file fails closed instead of being replaced.
 */
import { randomUUID } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export type OwnedSettings = {
	env?: Readonly<Record<string, string>>;
	/** Rules placed first in `permissions.deny`, so a `!` carve-out among them reaches only them. */
	deny?: readonly string[];
};

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** Claude Code settings carrying the owned keys; every other key survives. */
export function mergeClaudeSettings(text: string | undefined, owned: OwnedSettings): string {
	const settings: unknown = text === undefined ? {} : JSON.parse(text);
	if (!isObject(settings)) throw new Error("Claude Code settings must be a JSON object");
	const next: Json = { ...settings };
	if (owned.env) {
		const env = settings.env ?? {};
		if (!isObject(env)) throw new Error("Claude Code settings `env` must be an object");
		next.env = { ...env, ...owned.env };
	}
	if (owned.deny) {
		const permissions = settings.permissions ?? {};
		if (!isObject(permissions)) throw new Error("Claude Code settings `permissions` must be an object");
		const deny = permissions.deny ?? [];
		if (!Array.isArray(deny) || !deny.every(rule => typeof rule === "string")) {
			throw new Error("Claude Code settings `permissions.deny` must be an array of strings");
		}
		const rules = owned.deny;
		next.permissions = { ...permissions, deny: [...rules, ...deny.filter(rule => !rules.includes(rule))] };
	}
	return `${JSON.stringify(next, null, 2)}\n`;
}

export const claudeSettingsPath = (agentDir: string): string => join(agentDir, "settings.json");

/** A regular file's text, or undefined when it does not exist. */
export function readRegular(path: string): string | undefined {
	try {
		if (!lstatSync(path).isFile()) throw new Error(`Refusing non-regular destination: ${path}`);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
	return readFileSync(path, "utf8");
}

/** Atomically replace `path` when its text changes, keeping an existing mode. */
export function writeIfChanged(path: string, text: string, current: string | undefined): string {
	if (current === text) return "unchanged";
	const mode = current === undefined ? 0o600 : lstatSync(path).mode & 0o777;
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}`);
	writeFileSync(temp, text, { flag: "wx", mode });
	chmodSync(temp, mode);
	renameSync(temp, path);
	return current === undefined ? "created" : "updated";
}
