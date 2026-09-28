import { expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerSubagentInheritance from "./index.ts";

type ParentModel = { provider: string; id: string };
type SpawnHook = (event: { agent: string; invocationKind: "task" | "eval" }, ctx: { model?: ParentModel }) => unknown;
type ToolHook = (event: { toolName: string; input: Record<string, unknown> }) => unknown;

function hooks() {
	let level = "max";
	let spawn: SpawnHook | undefined;
	let toolCall: ToolHook | undefined;
	registerSubagentInheritance({
		on(event: string, callback: SpawnHook | ToolHook) {
			if (event === "before_subagent_spawn") spawn = callback as SpawnHook;
			else if (event === "tool_call") toolCall = callback as ToolHook;
			else throw new Error(`Unexpected hook: ${event}`);
		},
		getThinkingLevel() { return level; },
	} as unknown as ExtensionAPI);
	return {
		select(agent: string, parent: ParentModel | undefined, thinking: string, invocationKind: "task" | "eval" = "task") {
			level = thinking;
			if (!spawn) throw new Error("Subagent spawn hook was not registered");
			return spawn({ agent, invocationKind }, { model: parent });
		},
		call(input: Record<string, unknown>, toolName = "task") {
			if (!toolCall) throw new Error("Task tool-call guard was not registered");
			return toolCall({ toolName, input });
		},
	};
}

test("ordinary task agents keep configured routes instead of inheriting an expensive parent", () => {
	const { select } = hooks();
	for (const agent of ["task", "reviewer", "security-reviewer", "scout", "sonic"]) {
		expect(select(agent, { provider: "openai-codex", id: "gpt-6-astra" }, "max")).toBeUndefined();
	}
	expect(select("task", undefined, "max")).toBeUndefined();
});

test("an explicitly tagged task model and non-task dispatch keep their own selection", () => {
	const { select } = hooks();
	const parent = { provider: "anthropic", id: "claude-opus-5-5" };
	expect(select("m1", parent, "max")).toBeUndefined();
	expect(select("reviewer", parent, "max", "eval")).toBeUndefined();
});

test("designer routes to Opus high from any parent and preserves higher Opus effort", () => {
	const { select } = hooks();
	const opus = { provider: "anthropic", id: "claude-opus-5-5" };
	expect(select("designer", opus, "medium")).toEqual({ model: "anthropic/claude-opus-5-5:high" });
	expect(select("designer", opus, "xhigh")).toEqual({ model: "anthropic/claude-opus-5-5:xhigh" });
	expect(select("designer", opus, "max")).toEqual({ model: "anthropic/claude-opus-5-5:max" });
	expect(select("designer", { provider: "anthropic", id: "claude-sonnet-5-5" }, "medium"))
		.toEqual({ model: "anthropic/claude-opus-5-5:high" });
	expect(select("designer", { provider: "openai-codex", id: "gpt-6-astra" }, "max"))
		.toEqual({ model: "anthropic/claude-opus-5-5:high" });
	expect(select("designer", undefined, "max")).toEqual({ model: "anthropic/claude-opus-5-5:high" });
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
