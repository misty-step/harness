import { expect, mock, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// The native registry is bundled into OMP, not installed in the standalone test runner.
mock.module("@oh-my-pi/pi-coding-agent/config/registry", () => ({ lookup: () => undefined }));
mock.module("@oh-my-pi/pi-coding-agent/config/settings", () => ({ findScopedSettings: () => undefined }));
const { default: registerSubagentInheritance } = await import("./index.ts");

type ParentModel = { provider: string; id: string };
type SpawnHook = (event: { agent: string; invocationKind: "task" | "eval" }, ctx: {
	model?: ParentModel;
	modelRegistry: { find: (provider: string, id: string) => ParentModel | undefined; getApiKey: () => Promise<string | undefined> };
	models: { resolve: (spec: string) => ParentModel; family: (model: ParentModel) => string };
}) => unknown;
type ToolHook = (event: { toolName: string; input: Record<string, unknown> }) => unknown;

function hooks(auth = async (): Promise<string | undefined> => "test-key", catalog = true) {
	let level = "max";
	let spawn: SpawnHook | undefined;
	let toolCall: ToolHook | undefined;
	registerSubagentInheritance({
		on(event: string, callback: SpawnHook | ToolHook) {
			if (event === "before_subagent_spawn") spawn = callback as SpawnHook;
			else if (event === "tool_call") toolCall = callback as ToolHook;
			else if (event === "session_start") return;
			else throw new Error(`Unexpected hook: ${event}`);
		},
		getThinkingLevel() { return level; },
	} as unknown as ExtensionAPI);
	return {
		select(agent: string, parent: ParentModel | undefined, thinking: string, invocationKind: "task" | "eval" = "task") {
			level = thinking;
			if (!spawn) throw new Error("Subagent spawn hook was not registered");
			return spawn({ agent, invocationKind }, {
				model: parent,
				models: {
					resolve: spec => {
						const [provider, id] = spec.split("/");
						return { provider, id };
					},
					family: model => model.id.startsWith("gpt-") ? "gpt" : model.id.startsWith("claude-") ? "claude" : model.id,
				},
				modelRegistry: {
					find: (provider: string, id: string) => catalog ? { provider, id } : undefined,
					getApiKey: auth,
				},
			});
		},
		call(input: Record<string, unknown>, toolName = "task") {
			if (!toolCall) throw new Error("Task tool-call guard was not registered");
			return toolCall({ toolName, input });
		},
	};
}

test("ordinary task agents keep configured routes instead of inheriting an expensive parent", async () => {
	const { select } = hooks();
	for (const agent of ["task", "scout", "sonic"]) {
		expect(await select(agent, { provider: "openai-codex", id: "gpt-6-astra" }, "max")).toBeUndefined();
	}
	expect(await select("task", undefined, "max")).toBeUndefined();
});

test("an explicitly tagged task model and non-task dispatch keep their own selection", async () => {
	const { select } = hooks();
	const parent = { provider: "anthropic", id: "claude-opus-5-5" };
	expect(await select("m1", parent, "max")).toBeUndefined();
});

test("designer routes to Opus high from any parent and preserves higher Opus effort", async () => {
	const { select } = hooks();
	const opus = { provider: "anthropic", id: "claude-opus-5-5" };
	expect(await select("designer", opus, "medium")).toEqual({ model: "anthropic/claude-opus-5-5:high" });
	expect(await select("designer", opus, "xhigh")).toEqual({ model: "anthropic/claude-opus-5-5:xhigh" });
	expect(await select("designer", opus, "max")).toEqual({ model: "anthropic/claude-opus-5-5:max" });
	expect(await select("designer", { provider: "anthropic", id: "claude-sonnet-5-5" }, "medium"))
		.toEqual({ model: "anthropic/claude-opus-5-5:high" });
	expect(await select("designer", { provider: "openai-codex", id: "gpt-6-astra" }, "max"))
		.toEqual({ model: "anthropic/claude-opus-5-5:high" });
	expect(await select("designer", undefined, "max")).toEqual({ model: "anthropic/claude-opus-5-5:high" });
});

test("designer blocks missing catalog, absent auth and failed auth rather than using the parent", async () => {
	const parent = { provider: "openai-codex", id: "gpt-6-astra" };
	for (const guard of [
		hooks(async () => undefined),
		hooks(async () => { throw new Error("credential lookup failed"); }),
		hooks(async () => "test-key", false),
	]) {
		expect(await guard.select("designer", parent, "medium")).toMatchObject({ block: true });
	}
});

test("reviewers contrast OpenAI and Anthropic authors on task and eval dispatch", async () => {
	const { select } = hooks();
	for (const agent of ["reviewer", "security-reviewer"]) {
		for (const invocation of ["task", "eval"] as const) {
			expect(await select(agent, { provider: "openai-codex", id: "gpt-6.1-sol" }, "max", invocation))
				.toEqual({ model: "anthropic/claude-sonnet-5-5:high" });
			expect(await select(agent, { provider: "anthropic", id: "claude-opus-5-5" }, "max", invocation))
				.toEqual({ model: "openai-codex/gpt-6.1-sol:medium" });
		}
	}
});

test("reviewers refuse unknown author families and unavailable cross-family models", async () => {
	for (const agent of ["reviewer", "security-reviewer"]) {
		expect(await hooks().select(agent, undefined, "high")).toMatchObject({ block: true });
		expect(await hooks().select(agent, { provider: "custom", id: "unknown" }, "high")).toMatchObject({ block: true });
		for (const guard of [
			hooks(async () => undefined),
			hooks(async () => { throw new Error("credential lookup failed"); }),
			hooks(async () => "test-key", false),
		]) {
			expect(await guard.select(agent, { provider: "openai-codex", id: "gpt-6.1-sol" }, "high"))
				.toMatchObject({ block: true });
		}
	}
});

test("per-item low effort cannot lower designer below the visual minimum", () => {
	const { call } = hooks();
	expect(call({ context: "Visual review", tasks: [
		{ agent: "task", task: "Inspect code", effort: "lo" },
		{ agent: "designer", task: "Inspect design", effort: "lo" },
	] })).toMatchObject({ block: true });
	expect(call({ agent: "designer", task: "Inspect design", effort: "med" })).toMatchObject({ block: true });
	expect(call({ agent: "designer", task: "Inspect design", effort: "hi" })).toBeUndefined();
	expect(call({ agent: "task", task: "Inspect code", effort: "lo" })).toBeUndefined();
});
