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

test("portable steering waits for tools after upgrading an immediate installation", () => {
	const files = fixture(
		readFileSync(join(import.meta.dir, "../config.yml"), "utf8"),
		`interruptMode: immediate
steeringMode: all
followUpMode: all
modelRoles: {foreign: foreign/model}
auth: {accountPolicies: [{provider: example, priority: 2}]}
bash: {autoBackground: {enabled: false, thresholdMs: 90000}}
foreign: {keep: true}
`,
	);
	expect(invoke(files).exitCode).toBe(0);
	expect(parsed(files)).toMatchObject({
		interruptMode: "wait",
		steeringMode: "all",
		followUpMode: "all",
		modelRoles: { foreign: "foreign/model" },
		auth: { accountPolicies: [{ provider: "example", priority: 2 }] },
		bash: { autoBackground: { enabled: false, thresholdMs: 90000 } },
		foreign: { keep: true },
	});
});

test("retired presentation settings return to native defaults without deleting foreign preferences", () => {
	const files = fixture("modelRoles: {default: native/model}\n", `cycleOrder: [smol, default]
symbolPreset: nerd
statusLine: {preset: custom, leftSegments: [status], foreign: keep}
tui: {tight: false, hyperlinks: auto, mouse: true}
display: {shimmer: classic, showTokenUsage: true, showTurnTime: true}
composer: {shape: pi, foreign: keep}
setupVersion: 2
`);
	expect(invoke(files).exitCode).toBe(0);
	expect(parsed(files)).toEqual({
		modelRoles: { default: "native/model" },
		statusLine: { foreign: "keep" },
		tui: { mouse: true },
		display: { showTurnTime: true },
		composer: { foreign: "keep" },
	});
});

test("native cutover retires owned routing while preserving foreign choices", () => {
	const files = fixture("modelRoles: {default: native/model}\nretry: {modelFallback: false}\n",
		`modelRoles: {default: old/model, reviewer: old/reviewer, foreign: foreign/model}
retry: {fallbackChains: {default: [paid/model], foreign: [foreign/recovery]}}
task: {agentModelOverrides: {scout: old/scout, foreign: foreign/model}}
`);
	const before = readFileSync(files.dest, "utf8");
	expect(invoke(files, "--check").exitCode).toBe(0);
	expect(readFileSync(files.dest, "utf8")).toBe(before);
	expect(invoke(files).exitCode).toBe(0);
	expect(parsed(files)).toEqual({
		modelRoles: { default: "native/model", foreign: "foreign/model" },
		retry: { modelFallback: false, fallbackChains: { foreign: ["foreign/recovery"] } },
		task: { agentModelOverrides: { foreign: "foreign/model" } },
	});
});


test("retiring the specialist guard leaves foreign and explicitly configured denies alone", () => {
	const files = fixture("task: {enableLsp: true}\n",
		"task: {disabledAgents: [foreign-agent, reviewer, security-reviewer, designer]}\n");
	expect(invoke(files).exitCode).toBe(0);
	expect(parsed(files)).toEqual({ task: { enableLsp: true, disabledAgents: ["foreign-agent"] } });
	writeFileSync(files.source, "task: {disabledAgents: [reviewer]}\n");
	expect(invoke(files).exitCode).toBe(0);
	expect(parsed(files)).toEqual({ task: { enableLsp: true, disabledAgents: ["reviewer"] } });
});

test("portable config preserves every live account policy", () => {
	const policies = [
		{ provider: "openai-codex", account: { email: "phaedrus@r90.dev" }, priority: 1 },
		{ provider: "anthropic", account: { email: "other@example.com" }, priority: 2 },
	];
	const files = fixture("theme: portable\n", Bun.YAML.stringify({ auth: { accountPolicies: policies } }));
	expect(invoke(files).exitCode).toBe(0);
	expect(parsed(files)).toEqual({ theme: "portable", auth: { accountPolicies: policies } });
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

