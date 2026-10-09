import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const cli = join(import.meta.dir, "omp-merge-config.ts");
const roots: string[] = [];

type Fixture = { source: string; dest: string };

function fixture(source: string, live?: string): Fixture {
	const root = mkdtempSync(join(tmpdir(), "omp-merge-config-test-"));
	roots.push(root);
	const files = { source: join(root, "source.yml"), dest: join(root, "live", "config.yml") };
	writeFileSync(files.source, source);
	if (live !== undefined) {
		mkdirSync(dirname(files.dest));
		writeFileSync(files.dest, live);
	}
	return files;
}

function invoke(files: Fixture, ...args: string[]) {
	return Bun.spawnSync({
		cmd: [process.execPath, cli, "--source", files.source, "--dest", files.dest, ...args],
		stdout: "pipe",
		stderr: "pipe",
	});
}

function parsed(files: Fixture): unknown {
	return Bun.YAML.parse(readFileSync(files.dest, "utf8"));
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("without selection the merger still overlays every source-owned key", () => {
	const files = fixture(
		"task:\n  maxRecursionDepth: 5\ntheme: source-theme\n",
		"task:\n  maxRecursionDepth: 1\n  enableLsp: true\ntheme: live-theme\nforeign: keep\n",
	);
	expect(invoke(files).exitCode).toBe(0);
	expect(parsed(files)).toEqual({
		task: { maxRecursionDepth: 5, enableLsp: true },
		theme: "source-theme",
		foreign: "keep",
	});
});

test("full config retirement removes only absent owned leaves and preserves foreign entries", () => {
	const astra = "openai-codex/gpt-6-astra:high";
	const flash = "google-antigravity/gemini-3.8-flash:high";
	const source = {
		providers: { webSearchOrder: ["exa"] },
		modelRoles: {
			default: astra, slow: astra, extreme: "openai-codex/gpt-6-astra:max",
			plan: astra, advisor: astra, task: astra, reviewer: astra, "security-reviewer": astra,
			vision: flash, smol: flash, tiny: flash, commit: flash,
		},
		retry: {
			fallbackChains: {
				default: [flash, "anthropic/claude-opus-5:max", "xai-oauth/grok-4.6:xhigh", "openai-codex/gpt-6-astra:low", "openrouter/meta/muse-spark-1.3-contributor:max", "openrouter/deepseek/deepseek-v4.1-flash:max"],
				vision: ["xai-oauth/grok-4.6:xhigh", "anthropic/claude-opus-5:max", "openai-codex/gpt-6-astra:low", "openrouter/meta/muse-spark-1.3-contributor:max", "openrouter/deepseek/deepseek-v4.1-flash:max"],
				smol: ["xai-oauth/grok-4.6:xhigh", "anthropic/claude-sonnet-5:low", "openai-codex/gpt-6-astra:low", "openrouter/meta/muse-spark-1.3-contributor:max", "openrouter/deepseek/deepseek-v4.1-flash:max"],
				tiny: ["xai-oauth/grok-4.6:xhigh", "anthropic/claude-sonnet-5:low", "openai-codex/gpt-6-astra:low", "openrouter/meta/muse-spark-1.3-contributor:max", "openrouter/deepseek/deepseek-v4.1-flash:max"],
				commit: ["xai-oauth/grok-4.6:xhigh", "anthropic/claude-sonnet-5:low", "openai-codex/gpt-6-astra:low", "openrouter/meta/muse-spark-1.3-contributor:max", "openrouter/deepseek/deepseek-v4.1-flash:max"],
			},
		},
		task: {
			maxRecursionDepth: 3,
			agentModelOverrides: {
				task: "@task", scout: "@smol", sonic: "@smol",
				reviewer: "@reviewer", "security-reviewer": "@security-reviewer",
			},
		},
	};
	const live = `modelRoles:
  default: old/default
  designer: old/designer
  fast: foreign/fast
providers:
  tinyModel: lfm2-350m
  custom: keep
retry:
  fallbackChains:
    default: [old/default]
    slow: [old/slow]
    extreme: [old/extreme]
    plan: [old/plan]
    advisor: [old/advisor]
    task: [old/task]
    designer: [old/designer]
    reviewer: [old/reviewer]
    security-reviewer: [old/security]
    custom: [foreign/custom]
task:
  maxRecursionDepth: 1
  agentModelOverrides:
    task: old/task
    designer: old/designer
    other: foreign/other
foreign: {keep: true}
`;
	const files = fixture(Bun.YAML.stringify(source), live);
	expect(invoke(files, "--check").exitCode).toBe(0);
	expect(readFileSync(files.dest, "utf8")).toBe(live);
	const result = invoke(files);
	expect(result.stderr.toString()).toBe("");
	expect(result.exitCode).toBe(0);
	expect(parsed(files)).toEqual({
		providers: { ...source.providers, custom: "keep" },
		modelRoles: { ...source.modelRoles, fast: "foreign/fast" },
		retry: { fallbackChains: { ...source.retry.fallbackChains, custom: ["foreign/custom"] } },
		task: {
			...source.task,
			agentModelOverrides: { ...source.task.agentModelOverrides, other: "foreign/other" },
		},
		foreign: { keep: true },
	});
});

test("US-014 Opus guards fail closed, retire on cutover, and preserve allowed recovery", () => {
	const source = readFileSync(join(import.meta.dir, "../config.yml"), "utf8");
	const files = fixture(source, `retry:
  fallbackChains:
    anthropic/claude-opus-5-5: [openrouter/deepseek/deepseek-v4.1-flash:max]
    anthropic/claude-opus-4-6: []
`);
	expect(invoke(files).exitCode).toBe(0);
	const installed = parsed(files) as {
		modelRoles: Record<string, string>;
		retry: { modelFallback?: boolean; fallbackChains: Record<string, string[]> };
	};
	const opusModels = new Set(Object.values(installed.modelRoles)
		.filter(selector => selector.includes("/claude-opus-"))
		.map(selector => selector.replace(/:[^/:]+$/, "")));
	// Fail rather than silently passing if the policy no longer selects any Opus.
	expect(opusModels.size).toBeGreaterThan(0);
	for (const model of opusModels) {
		expect(installed.retry.fallbackChains[model]).toEqual([]);
	}
	expect(installed.retry.modelFallback).not.toBe(false);
	for (const chain of Object.values(installed.retry.fallbackChains)) {
		const paid = chain.findIndex(selector => selector.startsWith("openrouter/"));
		if (paid !== -1) {
			expect(chain.slice(paid).every(selector => selector.startsWith("openrouter/"))).toBe(true);
		}
	}
	const successor = "anthropic/claude-opus-next";
	const next = Bun.YAML.parse(source) as typeof installed;
	for (const [role, selector] of Object.entries(next.modelRoles)) {
		const model = selector.replace(/:[^/:]+$/, "");
		if (opusModels.has(model)) next.modelRoles[role] = selector.replace(model, successor);
	}
	for (const model of opusModels) delete next.retry.fallbackChains[model];
	next.retry.fallbackChains[successor] = [];
	writeFileSync(files.source, Bun.YAML.stringify(next));
	expect(invoke(files).exitCode).toBe(0);
	const migrated = parsed(files) as typeof installed;
	for (const model of opusModels) {
		expect(Object.hasOwn(migrated.retry.fallbackChains, model)).toBe(false);
	}
	expect(migrated.retry.fallbackChains[successor]).toEqual([]);
	expect(migrated.retry.fallbackChains["anthropic/claude-opus-4-6"]).toEqual([]);
});

test("installing the specialist gate preserves foreign disabled agents without duplicating existing denies", () => {
	const files = fixture("task:\n  disabledAgents: [reviewer, security-reviewer, designer]\n",
		"task:\n  disabledAgents: [foreign-agent, reviewer]\n  foreign-setting: keep\n");
	expect(invoke(files).exitCode).toBe(0);
	expect(parsed(files)).toEqual({
		task: {
			disabledAgents: ["reviewer", "security-reviewer", "designer", "foreign-agent"],
			"foreign-setting": "keep",
		},
	});
});

test("portable config retires former email pins and preserves foreign account policies", () => {
 const files = fixture("theme: portable\n", Bun.YAML.stringify({auth: {accountPolicies: [
 {provider: "openai-codex", account: {email: "phaedrus@r90.dev"}, priority: 1},
 {provider: "anthropic", account: {email: "other@example.com"}, priority: 2}
 ]}}));
 expect(invoke(files).exitCode).toBe(0);
 expect((parsed(files) as any).auth.accountPolicies).toEqual([{provider: "anthropic", account: {email: "other@example.com"}, priority: 2}]);
});

test("local overlay selects machine themes and skills while preserving foreign runtime config", () => {
 const files = fixture("theme: portable\n", "foreign: keep\n");
 const local = join(dirname(files.source), "local.yml");
 writeFileSync(local, "theme: omarchy-system\nskills:\n  custom: local-path\n");
 expect(invoke(files, "--local", local, "--check").exitCode).toBe(0);
 expect(readFileSync(files.dest, "utf8")).toBe("foreign: keep\n");
 expect(invoke(files, "--local", local).exitCode).toBe(0);
 expect(parsed(files)).toEqual({theme: "omarchy-system", skills: {custom: "local-path"}, foreign: "keep"});
});

 test("fresh configuration applies local preferences and rejects invalid overlays before writing", () => {
	const files = fixture("theme: portable\n");
	const local = join(dirname(files.source), "local.yml");
	writeFileSync(local, "[not, a, mapping]\n");
	expect(invoke(files, "--local", local, "--check").exitCode).not.toBe(0);
	expect(existsSync(files.dest)).toBe(false);
	writeFileSync(local, "theme: host-theme\n");
	expect(invoke(files, "--local", local, "--check").exitCode).toBe(0);
	expect(existsSync(files.dest)).toBe(false);
	expect(invoke(files, "--local", local).exitCode).toBe(0);
	expect(parsed(files)).toEqual({ theme: "host-theme" });
});

 test("US-017 generated desktop palette is selected without replacing it; explicit local themes still win", () => {
	for (const live of [undefined, "foreign: keep\n"]) {
		const files = fixture("theme:\n  dark: everforest\n  light: everforest-light\n", live);
		const theme = join(dirname(files.dest), "themes", "omarchy-system.json");
		mkdirSync(dirname(theme), { recursive: true });
		writeFileSync(theme, '{"generated":"palette sentinel"}\n');
		expect(invoke(files).exitCode).toBe(0);
		expect((parsed(files) as { theme: unknown }).theme).toEqual({ dark: "omarchy-system", light: "omarchy-system" });
		expect(readFileSync(theme, "utf8")).toBe('{"generated":"palette sentinel"}\n');
		const local = join(dirname(files.source), "local.yml");
		writeFileSync(local, "theme:\n  dark: everforest\n");
		expect(invoke(files, "--local", local).exitCode).toBe(0);
		expect((parsed(files) as { theme: unknown }).theme).toEqual({ dark: "everforest", light: "omarchy-system" });
	}
});
