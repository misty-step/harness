import { expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerSubagentInheritance from "./index.ts";

type ParentModel = { provider: string; id: string };
type Hook = (event: { agent: string; invocationKind: "task" | "eval" }, ctx: { model?: ParentModel }) => unknown;

function taskSelection() {
	let level = "max";
	let handler: Hook | undefined;
	registerSubagentInheritance({
		on(event: string, callback: Hook) {
			if (event !== "before_subagent_spawn") throw new Error(`Unexpected hook: ${event}`);
			handler = callback;
		},
		getThinkingLevel() { return level; },
	} as unknown as ExtensionAPI);
	return (agent: string, parent: ParentModel | undefined, thinking: string, invocationKind: "task" | "eval" = "task") => {
		level = thinking;
		if (!handler) throw new Error("Subagent spawn hook was not registered");
		return handler({ agent, invocationKind }, { model: parent });
	};
}

test("task agents inherit the live parent model and thinking, including designer at max", () => {
	const select = taskSelection();
	expect(select("designer", { provider: "anthropic", id: "claude-opus-5-5" }, "max"))
		.toEqual({ model: "anthropic/claude-opus-5-5:max" });
	expect(select("task", { provider: "openai-codex", id: "gpt-6-sol" }, "high"))
		.toMatchObject({ model: "openai-codex/gpt-6-sol:high" });
});

test("an explicitly tagged task model and non-task dispatch keep their own selection", () => {
	const select = taskSelection();
	const parent = { provider: "anthropic", id: "claude-opus-5-5" };
	expect(select("m1", parent, "max")).toBeUndefined();
	expect(select("reviewer", parent, "max", "eval")).toBeUndefined();
});

test("designer never silently inherits a non-Opus or below-high parent", () => {
	const select = taskSelection();
	for (const [parent, thinking] of [
		[{ provider: "openai-codex", id: "gpt-6-sol" }, "max"],
		[{ provider: "anthropic", id: "claude-opus-5-5" }, "medium"],
	] as const) {
		expect(select("designer", parent, thinking)).toMatchObject({ block: true });
	}
	expect(select("task", undefined, "max")).toMatchObject({ block: true });
});
