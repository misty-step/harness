import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ENV_READ_DENY } from "./env-reads.ts";
import { mergeClaudeSettings } from "./settings.ts";

const scratch = mkdtempSync(join(process.env.TMPDIR || join(homedir(), ".cache", "tmp"), "claude-settings-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const foreign = {
	env: { OTEL_LOGS_EXPORTER: "otlp" },
	permissions: { allow: ["Bash(git status)"], deny: ["Bash(rm -rf *)", "Read(.env.*)"], defaultMode: "default" },
	model: "x",
};

test("#351 the env-read rules deny .env and its variants but leave reference files readable", () => {
	expect(ENV_READ_DENY).toEqual([
		"Read(//**/.env)",
		"Read(//**/.env.local)",
		"Read(//**/.env.*.local)",
		"Read(.env.*)",
		"Read(!.env.example)",
		"Read(!.env.pass)",
		"Read(!.env.pass.example)",
	]);
});

test("#351 deny rules lead permissions.deny once and every foreign rule and key survives", () => {
	const once = mergeClaudeSettings(JSON.stringify(foreign), { deny: ENV_READ_DENY });
	const merged = JSON.parse(once);
	expect(merged.permissions).toEqual({
		allow: ["Bash(git status)"],
		deny: [...ENV_READ_DENY, "Bash(rm -rf *)"],
		defaultMode: "default",
	});
	expect(merged.env).toEqual(foreign.env);
	expect(merged.model).toBe("x");
	expect(mergeClaudeSettings(once, { deny: ENV_READ_DENY })).toBe(once);
	expect(JSON.parse(mergeClaudeSettings(undefined, { deny: ENV_READ_DENY }))).toEqual({
		permissions: { deny: [...ENV_READ_DENY] },
	});
});

test("#351 env and deny owners compose without touching each other's keys", () => {
	const withDeny = mergeClaudeSettings(JSON.stringify(foreign), { deny: ENV_READ_DENY });
	const both = JSON.parse(mergeClaudeSettings(withDeny, { env: { PULSE_SINK: "agent-sandbox" } }));
	expect(both.env).toEqual({ OTEL_LOGS_EXPORTER: "otlp", PULSE_SINK: "agent-sandbox" });
	expect(both.permissions.deny).toEqual([...ENV_READ_DENY, "Bash(rm -rf *)"]);
});

test("#351 malformed permissions fail closed", () => {
	expect(() => mergeClaudeSettings("[]", { deny: ENV_READ_DENY })).toThrow("JSON object");
	expect(() => mergeClaudeSettings('{"permissions": []}', { deny: ENV_READ_DENY })).toThrow(
		"`permissions` must be an object",
	);
	expect(() => mergeClaudeSettings('{"permissions": {"deny": "Read(.env)"}}', { deny: ENV_READ_DENY })).toThrow(
		"`permissions.deny` must be an array of strings",
	);
});

const runCli = (...args: string[]) =>
	Bun.spawnSync(["bun", join(import.meta.dir, "env-reads.ts"), ...args], {
		env: { PATH: process.env.PATH },
		stdout: "pipe",
		stderr: "pipe",
	});

test("#351 the CLI checks without writing, then merges into a settings file", () => {
	const dir = join(scratch, "cli");
	const settings = join(dir, "settings.json");
	mkdirSync(dir, { recursive: true });
	const before = `${JSON.stringify(foreign)}\n`;
	writeFileSync(settings, before);
	expect(runCli("--settings", settings, "--check").exitCode).toBe(0);
	expect(readFileSync(settings, "utf8")).toBe(before);
	const result = runCli("--settings", settings);
	expect(result.exitCode).toBe(0);
	expect(result.stdout.toString()).toContain("updated");
	expect(JSON.parse(readFileSync(settings, "utf8")).permissions.deny).toEqual([...ENV_READ_DENY, "Bash(rm -rf *)"]);
	expect(runCli("--settings", settings).stdout.toString()).toContain("unchanged");
});

test("#351 the CLI refuses malformed settings in check mode and leaves them alone", () => {
	const settings = join(scratch, "malformed.json");
	writeFileSync(settings, '{"permissions": {"deny": {}}}\n');
	const result = runCli("--settings", settings, "--check");
	expect(result.exitCode).toBe(1);
	expect(result.stderr.toString()).toContain("`permissions.deny` must be an array of strings");
	expect(readFileSync(settings, "utf8")).toBe('{"permissions": {"deny": {}}}\n');
});
