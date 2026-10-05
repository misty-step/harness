import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = join(import.meta.dir, "omp-model-policy.ts");
const roots: string[] = [];

function fixture(config: unknown): { root: string; config: string } {
	const root = mkdtempSync(join(tmpdir(), "omp-model-policy-test-"));
	roots.push(root);
	const path = join(root, "config.yml");
	writeFileSync(path, Bun.YAML.stringify(config));
	return { root, config: path };
}

function run(config?: string, env?: Record<string, string>) {
	return Bun.spawnSync({
		cmd: [process.execPath, cli, ...(config ? ["--config", config] : []), ...(env ? ["--probe"] : [])],
		stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env },
	});
}

type PolicyConfig = {
	modelRoles: Record<string, unknown>;
	retry: { fallbackChains: Record<string, unknown> };
	task?: { agentModelOverrides: Record<string, unknown> };
	providers?: Record<string, unknown>;
};

function smallConfig(): PolicyConfig {
	return {
		modelRoles: { default: "anthropic/claude-sonnet-5-5:medium", web: "web/exa" },
		task: { agentModelOverrides: { worker: "@default" } },
		retry: { fallbackChains: { "anthropic/claude-sonnet-5-5": [] } },
	};
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});


test("offline policy rejects stale, alias, malformed and disallowed routing selectors", () => {
	const cases: Array<[string, (config: PolicyConfig) => void, string]> = [
		["stale Sonnet role", config => { config.modelRoles.default = "anthropic/claude-sonnet-5:medium"; }, "unapproved model"],
		["retired Sol role", config => { config.modelRoles.default = "openai-codex/gpt-6-sol:xhigh"; }, "unapproved model"],
		["retired Luna role", config => { config.modelRoles.smol = "openai-codex/gpt-6-luna:low"; }, "unapproved model"],
		["retired agent override", config => { config.task = { agentModelOverrides: { designer: "anthropic/claude-sonnet-5:medium" } }; }, "unapproved model"],
		["unknown model role override", config => { config.task = { agentModelOverrides: { designer: "@unknown" } }; }, "does not resolve to a chat role"],
		["fuzzy alias", config => { config.modelRoles.default = "sonnet"; }, "concrete model selector"],
		["DeepSeek fallback", config => { config.retry.fallbackChains.default = ["openrouter/deepseek/deepseek-v4.1-flash:max"]; }, "concrete model selector"],
		["unapproved model-key chain", config => { config.retry.fallbackChains["anthropic/claude-opus-5"] = []; }, "unapproved model"],
		["unsupported provider effort", config => { config.modelRoles.default = "google-antigravity/gemini-3.8-flash:max"; }, "unsupported effort"],
		["malformed fallback chain", config => { config.retry.fallbackChains.default = "anthropic/claude-opus-5-5"; }, "must be an array"],
		["unknown chain role", config => { config.retry.fallbackChains.typo = []; }, "Unknown retry.fallbackChains role"],
		["web route exemption is exact", config => { config.modelRoles.web = "openrouter/deepseek/deepseek-v4.1-flash"; }, "concrete model selector"],
		["retired web recovery model", config => { config.retry.fallbackChains.web = ["web/parallel", "anthropic/claude-sonnet-5:medium"]; }, "must be a web search provider"],
		["chat model in web recovery", config => { config.retry.fallbackChains.web = ["anthropic/claude-sonnet-5-5:medium"]; }, "must be a web search provider"],
		["local tiny model bypass", config => { config.providers = { tinyModel: "lfm2-350m" }; }, "providers.tinyModel"],
	];
	for (const [label, change, reason] of cases) {
		const config = smallConfig();
		change(config);
		const result = run(fixture(config).config);
		expect(result.exitCode, label).not.toBe(0);
		expect(result.stderr.toString(), label).toContain(reason);
	}
});

test("native Sol reasoning levels support low helpers alongside high-reasoning work and review", () => {
	const config = smallConfig();
	config.modelRoles = {
		default: "openai-codex/gpt-6.1-sol:xhigh",
		task: "openai-codex/gpt-6.1-sol:xhigh",
		smol: "openai-codex/gpt-6.1-sol:low",
		tiny: "openai-codex/gpt-6.1-sol:low",
		commit: "openai-codex/gpt-6.1-sol:low",
		reviewer: "anthropic/claude-opus-5-5:xhigh",
		"security-reviewer": "openai-codex/gpt-6.1-sol:xhigh",
	};
	config.task = { agentModelOverrides: { worker: "@task", scout: "@smol", reviewer: "@reviewer", "security-reviewer": "@security-reviewer" } };
	config.retry.fallbackChains = { default: ["openai-codex/gpt-6.1-sol:medium"], smol: ["openai-codex/gpt-6.1-sol:low"] };
	expect(run(fixture(config).config).exitCode).toBe(0);

	config.modelRoles.smol = "openai-codex/gpt-6.1-sol:minimal";
	const refused = run(fixture(config).config);
	expect(refused.exitCode).not.toBe(0);
	expect(refused.stderr.toString()).toContain("modelRoles.smol has unsupported effort: minimal");
});

test("web search fallback providers remain available without chat model recovery", () => {
	const config = smallConfig();
	config.retry.fallbackChains.web = ["web/parallel", "web/perplexity"];
	const result = run(fixture(config).config);
	expect(result.exitCode).toBe(0);
});

function fakeOmp(root: string, mode: string): Record<string, string> {
	const binary = join(root, "omp");
	writeFileSync(binary, `#!/usr/bin/env bun
const model = {provider: "anthropic", id: "claude-sonnet-5-5", selector: "anthropic/claude-sonnet-5-5", kind: "chat", thinking: ["low", "medium", "high", "xhigh", "max"]};
if (process.argv[2] === "models") {
  const models = process.env.FAKE_OMP_MODE === "effective-only"
    ? [["anthropic", "claude-opus-5-5"], ["anthropic", "claude-sonnet-5-5"],
       ["openai-codex", "gpt-6-astra"], ["openai-codex", "gpt-6.1-sol"],
       ["xai-oauth", "grok-4.7"],
       ["cursor", "grok-4.7"], ["cursor", "claude-sonnet-5-5"],
       ["google-antigravity", "gemini-3.8-flash"]].map(([provider, id]) => ({
         provider, id, selector: provider + "/" + id, kind: "chat",
         thinking: ["minimal", "low", "medium", "high", "xhigh", "max"],
       }))
    : process.env.FAKE_OMP_MODE === "stale-catalog"
      ? [{...model, id: "claude-3-5-sonnet-20241022", selector: "anthropic/claude-3-5-sonnet-20241022"}]
      : process.env.FAKE_OMP_MODE === "model-key"
        ? [model, {provider: "openai-codex", id: "gpt-6.1-sol", selector: "openai-codex/gpt-6.1-sol", kind: "chat", thinking: ["high"]}]
        : [model];
  console.log(JSON.stringify({models}));
} else {
  const chosen = process.argv[process.argv.indexOf("--model") + 1];
  const [provider, rest] = chosen.split("/");
  const id = rest.split(":")[0];
  const actual = process.env.FAKE_OMP_MODE === "effective-only"
    ? {role: "assistant", provider, model: process.env.FAKE_OMP_MODE === "effective-only" && chosen === "anthropic/claude-sonnet-5-5:low" ? "claude-3-5-sonnet-20241022" : id, stopReason: "stop"}
    : process.env.FAKE_OMP_MODE === "wrong-provider"
      ? {role: "assistant", provider: "openai-codex", model: "claude-sonnet-5-5", stopReason: "stop"}
    : process.env.FAKE_OMP_MODE === "wrong-model"
      ? {role: "assistant", provider: "anthropic", model: "claude-3-5-sonnet-20241022", stopReason: "stop"}
      : {role: "assistant", provider: "anthropic", model: "claude-sonnet-5-5", stopReason: process.env.FAKE_OMP_MODE === "reject" ? "error" : "stop"};
  console.log(JSON.stringify({type: "message_end", message: {role: "user", content: [{type: "text", text: "OK"}]}}));
  console.log(JSON.stringify({type: "message_end", message: actual}));
  console.log(JSON.stringify({type: "agent_end", isTerminal: true}));
}
`);
	chmodSync(binary, 0o700);
	return { PATH: `${root}:${process.env.PATH ?? ""}`, FAKE_OMP_MODE: mode };
}

test("online probe rejects a retired fuzzy catalog match before requesting a model", () => {
	const files = fixture(smallConfig());
	const result = run(files.config, fakeOmp(files.root, "stale-catalog"));
	expect(result.exitCode).not.toBe(0);
	expect(result.stderr.toString()).toContain("No unique exact catalog entry for anthropic/claude-sonnet-5-5:medium");
});

test("online probe rejects mismatches in provider or model ID independently", () => {
	for (const mode of ["wrong-provider", "wrong-model"]) {
		const files = fixture(smallConfig());
		const result = run(files.config, fakeOmp(files.root, mode));
		expect(result.exitCode, mode).not.toBe(0);
		expect(result.stderr.toString(), mode).toContain("routed anthropic/claude-sonnet-5-5:medium to a different provider/model");
	}
});

test("online probe includes model-key fallback selectors even when their chain is empty", () => {
	const config = smallConfig();
	config.retry.fallbackChains["openai-codex/gpt-6.1-sol"] = [];
	const files = fixture(config);
	const result = run(files.config, fakeOmp(files.root, "model-key"));
	expect(result.exitCode).not.toBe(0);
	expect(result.stderr.toString()).toContain("routed openai-codex/gpt-6.1-sol to a different provider/model");
});

test("online probe includes direct task model overrides", () => {
	const config = smallConfig();
	config.task!.agentModelOverrides.worker = "openai-codex/gpt-6.1-sol:high";
	const files = fixture(config);
	const result = run(files.config, fakeOmp(files.root, "model-key"));
	expect(result.exitCode).not.toBe(0);
	expect(result.stderr.toString()).toContain("routed openai-codex/gpt-6.1-sol:high to a different provider/model");
});

test("online probe rejects provider failure even if OMP exits cleanly", () => {
	const files = fixture(smallConfig());
	const result = run(files.config, fakeOmp(files.root, "reject"));
	expect(result.exitCode).not.toBe(0);
	expect(result.stderr.toString()).toContain("did not complete anthropic/claude-sonnet-5-5:medium successfully");
});

test("installer probes preserved foreign selectors before changing the live config", () => {
	const files = fixture({
		modelRoles: { foreign: "anthropic/claude-sonnet-5-5:low" },
		retry: { fallbackChains: {} },
	});
	const before = readFileSync(files.config, "utf8");
	const result = Bun.spawnSync({
		cmd: [join(import.meta.dir, "..", "install")],
		stdout: "pipe", stderr: "pipe",
		env: {
			...process.env, ...fakeOmp(files.root, "effective-only"),
			PI_CODING_AGENT_DIR: files.root, OMP_INSTALL_COMPONENTS: "config", OMP_MODEL_PROBE: "1",
		},
	});
	expect(result.exitCode).not.toBe(0);
	expect(result.stderr.toString()).toContain("routed anthropic/claude-sonnet-5-5:low to a different provider/model");
	expect(readFileSync(files.config, "utf8")).toBe(before);
});
