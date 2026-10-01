import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { lookup } from "@oh-my-pi/pi-coding-agent/config/registry";
import { findScopedSettings } from "@oh-my-pi/pi-coding-agent/config/settings";

type Spawn = { agent: string; invocationKind: string };

/** Reviewers contrast the live author; visual work stays on Opus at high or above. */
function taskModelSelection(spawn: Spawn, ctx: ExtensionContext, thinking: string | undefined) {
	const parent = ctx.model;
	if (spawn.agent === "reviewer" || spawn.agent === "security-reviewer") {
		if (!parent) return { block: true, reason: "Reviewer requires a known author model family." };
		const sol = ctx.models.resolve("openai-codex/gpt-6.1-sol");
		const sonnet = ctx.models.resolve("anthropic/claude-sonnet-5-5");
		const family = ctx.models.family(parent);
		if (sol && family === ctx.models.family(sol)) return { model: "anthropic/claude-sonnet-5-5:high" };
		if (sonnet && family === ctx.models.family(sonnet)) return { model: "openai-codex/gpt-6.1-sol:medium" };
		return { block: true, reason: "No reviewer route for the author's model family." };
	}
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
		const selection = taskModelSelection(event, ctx, pi.getThinkingLevel());
		if (!selection || "block" in selection) return selection;
		const blocked = { block: true, reason: "Required specialist model is unavailable; refusing parent-model fallback." };
		let timeout: NodeJS.Timeout | undefined;
		try {
			const [provider, id] = selection.model.split(":")[0].split("/");
			const model = ctx.modelRegistry.find(provider, id);
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
	pi.on("session_start", (_event, ctx) => {
		const reviewer = ctx.sessionManager.getEntries().some(entry =>
			entry.type === "session_init" && (entry.agent === "reviewer" || entry.agent === "security-reviewer"));
		if (!reviewer) return;
		// A roster's model-key chains outrank role chains. Pin only this child's
		// runtime settings, including cold revival; leave the engineer's recovery intact.
		const chains = lookup("retry.fallbackChains");
		if (!chains) throw new Error("Reviewer fallback setting is unavailable.");
		// pi.pi.settings is the root singleton, not the active child's scope.
		const settings = findScopedSettings(ctx.cwd);
		if (!settings) throw new Error("Reviewer session settings are unavailable.");
		// Record overrides merge keys, so explicitly empty inherited model,
		// effort-specific and wildcard chains as well as the reviewer roles.
		const empty: Record<string, string[]> = { default: [], reviewer: [], "security-reviewer": [] };
		for (const key of Object.keys(chains.get(settings) as Record<string, unknown>)) empty[key] = [];
		chains.override(settings, empty);
		pi.setThinkingLevel(ctx.model?.id === "claude-sonnet-5-5" ? "high" : "medium");
	});
	pi.on("tool_call", event => {
		if (event.toolName !== "task") return;
		const tasks = event.input.tasks;
		if (Array.isArray(tasks) ? tasks.some(hasUnsafeDesignerEffort) : hasUnsafeDesignerEffort(event.input)) {
			return { block: true, reason: "Designer effort must be high; lower effort would violate the visual model floor." };
		}
	});
}
