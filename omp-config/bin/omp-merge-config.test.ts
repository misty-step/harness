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
		modelRoles: { ...source.modelRoles, fast: "foreign/fast" },
		retry: { fallbackChains: { ...source.retry.fallbackChains, custom: ["foreign/custom"] } },
		task: {
			...source.task,
			agentModelOverrides: { ...source.task.agentModelOverrides, other: "foreign/other" },
		},
		foreign: { keep: true },
	});
});
