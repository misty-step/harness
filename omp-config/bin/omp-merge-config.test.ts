import { afterEach, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
	const inherited = {
		...source,
		retry: { fallbackChains: { default: ["openai-codex/gpt-6-astra:xhigh"] } },
	};
	writeFileSync(files.source, Bun.YAML.stringify(inherited));
	expect(invoke(files).exitCode).toBe(0);
	const migrated = parsed(files) as { retry: { fallbackChains: Record<string, string[]> } };
	expect(migrated.retry.fallbackChains.default).toEqual(["openai-codex/gpt-6-astra:xhigh"]);
	for (const role of ["slow", "extreme", "plan", "smol", "tiny", "commit"]) {
		expect(Object.hasOwn(migrated.retry.fallbackChains, role)).toBe(false);
	}
	expect(migrated.retry.fallbackChains.custom).toEqual(["foreign/custom"]);
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

test("model-policy selection overlays routing leaves only and retains foreign denies and unrelated retirements", () => {
	const source = {
		modelRoles: { advisor: "source/advisor" },
		retry: { enabled: true, fallbackChains: { advisor: ["source/recovery"] } },
		task: { maxRecursionDepth: 5, agentModelOverrides: { task: "@advisor" }, disabledAgents: ["designer"] },
		providers: { tinyModel: "source-tiny" }, theme: "source-theme",
		auth: { accountPolicies: [] },
	};
	const live = {
		modelRoles: { advisor: "old/advisor", designer: "old/designer", foreign: "foreign/model" },
		retry: { enabled: false, fallbackChains: { advisor: ["old/recovery"], designer: [], foreign: [] } },
		task: { maxRecursionDepth: 1, foreign: true, agentModelOverrides: { designer: "old/designer", other: "foreign/model" }, disabledAgents: ["foreign-agent", "designer"] },
		providers: { tinyModel: "retired-but-unrelated", custom: "keep" },
		theme: "live-theme",
		auth: { accountPolicies: [{ provider: "anthropic", account: { email: "phaedrus@r90.dev" }, priority: 1 }] },
		foreign: { keep: true },
	};
	const files = fixture(Bun.YAML.stringify(source), Bun.YAML.stringify(live));
	const local = join(dirname(files.source), "local.yml");
	writeFileSync(local, Bun.YAML.stringify({
		modelRoles: { advisor: "local/advisor" },
		retry: { enabled: true, fallbackChains: { advisor: ["local/recovery"] } },
		task: { maxRecursionDepth: 8, disabledAgents: ["designer", "local-agent"] },
		theme: "local-theme", auth: { accountPolicies: [] },
	}));
	expect(invoke(files, "--model-policy-only", "--local", local, "--check").exitCode).toBe(0);
	expect(parsed(files)).toEqual(live);
	expect(invoke(files, "--model-policy-only", "--local", local).exitCode).toBe(0);
	expect(parsed(files)).toEqual({
		...live,
		modelRoles: { advisor: "local/advisor", foreign: "foreign/model" },
		retry: { enabled: false, fallbackChains: { advisor: ["local/recovery"], foreign: [] } },
		task: { ...live.task, agentModelOverrides: { task: "@advisor", other: "foreign/model" }, disabledAgents: ["designer", "local-agent", "foreign-agent"] },
	});
});

test("fresh model-policy selection does not install unrelated source or local keys", () => {
	const files = fixture("modelRoles: {advisor: source/model}\nretry: {fallbackChains: {advisor: []}, enabled: true}\ntask: {disabledAgents: [designer], maxRecursionDepth: 5}\nauth: {foreign: source}\n");
	const local = join(dirname(files.source), "local.yml");
	writeFileSync(local, "task: {agentModelOverrides: {task: '@advisor'}, maxRecursionDepth: 9}\nforeign: local\n");
	expect(invoke(files, "--model-policy-only", "--local", local).exitCode).toBe(0);
	expect(parsed(files)).toEqual({
		modelRoles: { advisor: "source/model" },
		retry: { fallbackChains: { advisor: [] } },
		task: { disabledAgents: ["designer"], agentModelOverrides: { task: "@advisor" } },
	});
});

type InstallFixture = { home: string; agent: string; local: string };

function installFixture(live?: Record<string, unknown>): InstallFixture {
	const root = mkdtempSync(join(tmpdir(), "omp-model-policy-install-test-"));
	roots.push(root);
	const home = join(root, "home");
	const agent = join(home, "agent");
	const local = join(home, ".config/harness/omp.yml");
	const sentinels = [
		"agent/auth.json", "agent/secrets.yml", "agent/models.yml", "agent/.env",
		"agent/mcp.json", "agent/AGENTS.md", "agent/extensions/foreign/index.ts",
		"agent/extensions/diff-review/index.ts", "agent/extensions/loc/git-hook.sh",
		"agent/extensions/subagent-inheritance/foreign.ts", "agent/bin/foreign",
		".local/bin/omp", ".local/bin/pass-env", ".config/systemd/user/omp.slice",
		".config/pipewire/pipewire.conf.d/foreign.conf",
	];
	for (const path of sentinels) {
		const file = join(home, path);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, `foreign sentinel: ${path}\n`, { mode: 0o640 });
	}
	if (live) writeFileSync(join(agent, "config.yml"), Bun.YAML.stringify(live));
	mkdirSync(dirname(local), { recursive: true });
	return { home, agent, local };
}

function homeFiles(home: string): Record<string, { body: string; mode: number }> {
	const files: Record<string, { body: string; mode: number }> = {};
	function walk(relative: string) {
		for (const name of readdirSync(join(home, relative))) {
			// Interpreter caches are not deployed state; include every configured asset.
			if (!relative && (name === ".cache" || name === ".bun")) continue;
			const path = join(relative, name);
			const stat = lstatSync(join(home, path));
			if (stat.isDirectory()) {
				files[`${path}/`] = { body: "", mode: stat.mode & 0o777 };
				walk(path);
			} else files[path] = { body: readFileSync(join(home, path), "utf8"), mode: stat.mode & 0o777 };
		}
	}
	walk("");
	return files;
}

function scopedInstall(files: InstallFixture) {
	return Bun.spawnSync({
		cmd: [join(import.meta.dir, "../install")],
		env: {
			PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
			HOME: files.home,
			PI_CODING_AGENT_DIR: files.agent,
			OMP_CONFIG_LOCAL_CONFIG: files.local,
			OMP_INSTALL_COMPONENTS: "model-policy",
			OMP_MODEL_PROBE: "0",
		},
		stdout: "pipe",
		stderr: "pipe",
	});
}

test("scoped installer changes only routing config and its two installed source files", () => {
	const live = {
		foreign: { keep: true }, theme: "foreign-theme",
		providers: { tinyModel: "preserved-local-provider" },
		tier: { openai: "priority", anthropic: "none" },
		auth: { accountPolicies: [{ provider: "anthropic", account: { email: "phaedrus@r90.dev" }, priority: 1 }] },
		modelRoles: {
			"foreign-agent": "anthropic/claude-sonnet-5-5:high",
			advisor: "openai-codex/gpt-6.1-sol:xhigh",
			reviewer: "anthropic/claude-sonnet-5-5:high",
			"security-reviewer": "anthropic/claude-sonnet-5-5:high",
		},
		retry: { enabled: false, fallbackChains: { "foreign-agent": [] } },
		task: { maxRecursionDepth: 9, disabledAgents: ["foreign-agent"], agentModelOverrides: { "foreign-agent": "@foreign-agent" } },
	};
	const files = installFixture(live);
	writeFileSync(files.local, "theme: ignored-local-theme\ntask: {maxRecursionDepth: 1}\n");
	const before = homeFiles(files.home);
	const result = scopedInstall(files);
	expect(result.stderr.toString()).toBe("");
	expect(result.exitCode).toBe(0);
	const after = homeFiles(files.home);
	for (const path of ["agent/config.yml", "agent/extensions/subagent-inheritance/index.ts", "agent/bin/omp-model-policy.ts"]) {
		delete before[path];
		delete after[path];
	}
	expect(after).toEqual(before);
	const installed = Bun.YAML.parse(readFileSync(join(files.agent, "config.yml"), "utf8")) as Record<string, unknown>;
	const roles = installed.modelRoles as Record<string, unknown>;
	expect({ advisor: roles.advisor, reviewer: roles.reviewer, "security-reviewer": roles["security-reviewer"] }).toEqual({
		advisor: "openai-codex/gpt-6.1-sol:xhigh",
		reviewer: "anthropic/claude-sonnet-5-5:high",
		"security-reviewer": "anthropic/claude-sonnet-5-5:high",
	});
	expect(installed).toMatchObject({
		foreign: { keep: true }, theme: "foreign-theme",
		providers: { tinyModel: "preserved-local-provider" },
		tier: { openai: "priority", anthropic: "none" },
		auth: { accountPolicies: [{ provider: "anthropic", account: { email: "phaedrus@r90.dev" }, priority: 1 }] },
		modelRoles: { "foreign-agent": "anthropic/claude-sonnet-5-5:high" },
		retry: { enabled: false, fallbackChains: { "foreign-agent": [] } },
		task: { maxRecursionDepth: 9, agentModelOverrides: { "foreign-agent": "@foreign-agent" }, disabledAgents: expect.arrayContaining(["foreign-agent"]) },
	});
});

test("scoped installer rejects forbidden local roles and chains before any deployment", () => {
	for (const local of [
		"modelRoles: {advisor: 'xai-oauth/grok-4.7:xhigh'}\n",
		"retry: {fallbackChains: {advisor: ['xai-oauth/grok-4.7:xhigh']}}\n",
		"task: {agentModelOverrides: {task: 'xai-oauth/grok-4.7:xhigh'}}\n",
		"modelRoles: {advisor: 'anthropic/claude-sonnet-5-5:impossible'}\n",
	]) {
		for (const live of [undefined, { foreign: "keep" }]) {
			const files = installFixture(live);
			writeFileSync(files.local, local);
			const before = homeFiles(files.home);
			const result = scopedInstall(files);
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr.toString()).toMatch(/modelRoles|fallbackChains|agentModelOverrides/);
			expect(homeFiles(files.home)).toEqual(before);
		}
	}
});

test("scoped preflight validates preserved foreign routing rather than only source selectors", () => {
	const files = installFixture({ modelRoles: { "foreign-agent": "xai-oauth/grok-4.7:xhigh" }, foreign: "keep" });
	const before = homeFiles(files.home);
	const result = scopedInstall(files);
	expect(result.exitCode).not.toBe(0);
	expect(result.stderr.toString()).toContain("modelRoles.foreign-agent");
	expect(homeFiles(files.home)).toEqual(before);
});

test("fresh scoped installation writes only the four routing leaves and two sources", () => {
	const files = installFixture();
	const before = homeFiles(files.home);
	const result = scopedInstall(files);
	expect(result.stderr.toString()).toBe("");
	expect(result.exitCode).toBe(0);
	const after = homeFiles(files.home);
	for (const path of ["agent/config.yml", "agent/extensions/subagent-inheritance/index.ts", "agent/bin/omp-model-policy.ts"]) {
		expect(after[path]).toBeDefined();
		delete after[path];
	}
	expect(after).toEqual(before);
	const installed = Bun.YAML.parse(readFileSync(join(files.agent, "config.yml"), "utf8")) as {
		modelRoles: Record<string, string>;
		retry: Record<string, unknown>;
		task: Record<string, unknown>;
	};
	expect(Object.keys(installed).sort()).toEqual(["modelRoles", "retry", "task"]);
	expect(Object.keys(installed.retry)).toEqual(["fallbackChains"]);
	expect(Object.keys(installed.task).sort()).toEqual(["agentModelOverrides", "disabledAgents"]);
});

test("scoped installer rejects unusable source-file targets before changing configuration", () => {
	for (const target of ["extensions/subagent-inheritance/index.ts", "bin/omp-model-policy.ts"]) {
		const files = installFixture({ foreign: "keep" });
		mkdirSync(join(files.agent, target));
		const before = homeFiles(files.home);
		const result = scopedInstall(files);
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr.toString()).toContain("Refusing non-file");
		expect(homeFiles(files.home)).toEqual(before);
	}
});
