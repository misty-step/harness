import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ParentModel = { provider: string; id: string };
type Spawn = { agent: string; invocationKind: string };

/** Ordinary agents keep configured routes; visual work stays on Opus at high or above. */
function taskModelSelection(spawn: Spawn, parent: ParentModel | null | undefined, thinking: string | undefined) {
	if (spawn.invocationKind !== "task" || spawn.agent !== "designer") return;
	const opusParent = parent?.provider === "anthropic" && parent.id === "claude-opus-5-5";
	const level = opusParent && (thinking === "xhigh" || thinking === "max") ? thinking : "high";
	return { model: `anthropic/claude-opus-5-5:${level}` };
}

function hasUnsafeDesignerEffort(item: unknown): boolean {
	return item !== null && typeof item === "object" && "agent" in item && item.agent === "designer"
		&& "effort" in item && item.effort != null && item.effort !== "hi";
}

export default function registerSubagentInheritance(pi: ExtensionAPI) {
	pi.on("before_subagent_spawn", async (event, ctx) => {
		const selection = taskModelSelection(event, ctx.model, pi.getThinkingLevel());
		if (!selection) return;
		const blocked = { block: true, reason: "Designer requires authenticated Opus 5.5; refusing parent-model fallback." };
		let timeout: NodeJS.Timeout | undefined;
		try {
			const model = ctx.modelRegistry.find("anthropic", "claude-opus-5-5");
			if (!model) return blocked;
			// Native startup can fall back to the parent's authenticated model,
			// before retry chains apply. Return a block, never a swallowed throw.
			const key = await Promise.race([
				ctx.modelRegistry.getApiKey(model),
				new Promise<undefined>(resolve => { timeout = setTimeout(() => resolve(undefined), 5_000); }),
			]);
			return key ? selection : blocked;
		} catch {
			return blocked;
		} finally {
			clearTimeout(timeout);
		}
	});
	pi.on("tool_call", event => {
		if (event.toolName !== "task") return;
		const tasks = event.input.tasks;
		if (Array.isArray(tasks) ? tasks.some(hasUnsafeDesignerEffort) : hasUnsafeDesignerEffort(event.input)) {
			return { block: true, reason: "Designer effort must be high; lower effort would violate the visual model floor." };
		}
	});
}
