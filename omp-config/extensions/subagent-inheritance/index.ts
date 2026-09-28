import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ParentModel = { provider: string; id: string };
type Spawn = { agent: string; invocationKind: string };

const taggedModelAgent = /^m[1-9]\d*$/;

/** A tagged model is an explicit per-task selection; all ordinary agents inherit. */
function taskModelSelection(spawn: Spawn, parent: ParentModel | null | undefined, thinking: string | undefined) {
	if (spawn.invocationKind !== "task" || taggedModelAgent.test(spawn.agent)) return;
	if (!parent) return { block: true, reason: "Cannot inherit a task model without an active parent model." };
	if (
		spawn.agent === "designer" &&
		(
			parent.provider !== "anthropic" ||
			!parent.id.startsWith("claude-opus-5-5") ||
			(thinking !== "high" && thinking !== "xhigh" && thinking !== "max")
		)
	) {
		return { block: true, reason: "Designer requires an Opus 5.5 parent at high, xhigh, or max thinking." };
	}
	return { model: `${parent.provider}/${parent.id}${thinking ? `:${thinking}` : ""}` };
}

export default function registerSubagentInheritance(pi: ExtensionAPI) {
	pi.on("before_subagent_spawn", (event, ctx) =>
		taskModelSelection(event, ctx.model, pi.getThinkingLevel()),
	);
}
