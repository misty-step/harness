import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { lookup } from "@oh-my-pi/pi-coding-agent/config/registry";
import { findScopedSettings } from "@oh-my-pi/pi-coding-agent/config/settings";

type Spawn = { agent: string; invocationKind: string };
type ModelSelection = { model: string } | { block: true; reason: string } | undefined;
const GUARDED_AGENTS: Record<string, true> = { reviewer: true, "security-reviewer": true, designer: true };
const REVIEW_PIN = "harness:reviewer-model-pin";
const expectedReviews = new Map<string, { parentId: string; model: string }>();

/** Reviewers contrast the live author; visual work stays on Opus at high or above. */
function taskModelSelection(spawn: Spawn, ctx: ExtensionContext, thinking: string | undefined): ModelSelection {
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
	let ready = false;
	let reviewer = true;
	let reviewerModel: string | undefined;
	let stopExtensions: (() => void) | undefined;
	let stopDisabledExtensions: (() => void) | undefined;
	let revokePermissions: (() => void) | undefined;

	function pinReviewer(ctx: ExtensionContext) {
		const request = expectedReviews.get(ctx.agent.id);
		if (request) {
			expectedReviews.delete(ctx.agent.id);
			if (request.parentId !== ctx.agent.parentId) throw new Error("Reviewer dispatch identity mismatch.");
			reviewerModel = request.model;
			pi.appendEntry(REVIEW_PIN, reviewerModel);
		} else if (!reviewerModel) {
			const saved = ctx.sessionManager.getEntries().findLast(entry =>
				entry.type === "custom" && entry.customType === REVIEW_PIN);
			if (typeof saved?.data === "string") reviewerModel = saved.data;
		}
	}
	pi.on("before_subagent_spawn", async (event, ctx) => {
		let selection: ModelSelection;
		try {
			selection = taskModelSelection(event, ctx, pi.getThinkingLevel());
		} catch {
			return { block: true, reason: "Specialist model selection failed; refusing parent-model fallback." };
		}
		if (!selection || "block" in selection) return selection;
		if (!ready) return { block: true, reason: "Specialist guard is not initialized." };
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
			if (!ready || !key) return blocked;
			if (event.agent === "reviewer" || event.agent === "security-reviewer") {
				if (!event.spawnKey || !ctx.agent.id || expectedReviews.has(event.spawnKey)) {
					return { block: true, reason: "Reviewer dispatch identity is unavailable or already pending." };
				}
				expectedReviews.set(event.spawnKey, { parentId: ctx.agent.id, model: `${provider}/${id}` });
			}
			return selection;
		} catch {
			return blocked;
		} finally {
			clearTimeout(timeout);
		}
	});
	pi.on("session_start", (_event, ctx) => {
		ready = false;
		reviewer = true;
		reviewerModel = undefined;
		try {
			revokePermissions?.();
			stopExtensions?.();
			stopDisabledExtensions?.();
			const initialization = ctx.sessionManager.getEntries().findLast(entry => entry.type === "session_init");
			reviewer = ctx.agent.name === "reviewer" || ctx.agent.name === "security-reviewer"
				|| initialization?.agent === "reviewer" || initialization?.agent === "security-reviewer";
			// The public resolver follows the handler's native async scope.
			// pi.pi.settings is the root singleton and must not be mutated here.
			const settings = findScopedSettings(ctx.cwd);
			const chains = lookup("retry.fallbackChains");
			const switching = lookup("retry.modelFallback");
			const disabled = lookup("task.disabledAgents");
			const extensions = lookup("extensions");
			const disabledExtensions = lookup("disabledExtensions");
			if (!settings || !chains || !switching || !disabled || !extensions || !disabledExtensions) return;
			if (reviewer) {
				// Native session_init.resolvedModel already includes startup auth
				// substitution. Only the caller's immutable spawn pin is authoritative.
				pinReviewer(ctx);
				if (!ctx.model || reviewerModel !== `${ctx.model.provider}/${ctx.model.id}`) return;
				switching.override(settings, false);
				if (switching.get(settings) !== false) return;
				pi.setThinkingLevel(ctx.model?.id === "claude-sonnet-5-5" ? "high" : "medium");
				// Record overrides merge keys: empty inherited model/effort/wildcard
				// chains explicitly, then confirm the effective recovery boundary.
				const empty: Record<string, string[]> = { default: [], reviewer: [], "security-reviewer": [] };
				for (const key of Object.keys(chains.get(settings) as Record<string, unknown>)) empty[key] = [];
				chains.override(settings, empty);
				if (Object.values(chains.get(settings) as Record<string, unknown>)
					.some(chain => !Array.isArray(chain) || chain.length !== 0)) return;
			}
			revokePermissions = () => {
				ready = false;
				for (const [id, request] of expectedReviews) {
					if (request.parentId === ctx.agent.id) expectedReviews.delete(id);
				}
				const denied = new Set(disabled.get(settings) as string[]);
				for (const agent in GUARDED_AGENTS) denied.add(agent);
				disabled.override(settings, [...denied]);
			};
			// Native extension suspension removes hooks, not setting listeners.
			// Close permissions before its async discovery can suspend this guard.
			stopExtensions = extensions.listen(settings, revokePermissions);
			stopDisabledExtensions = disabledExtensions.listen(settings, revokePermissions);
			// Config denies these agents even when this extension cannot load.
			disabled.override(settings, (disabled.get(settings) as string[]).filter(agent => !Object.hasOwn(GUARDED_AGENTS, agent)));
			ready = true;
		} catch {
			// Startup errors are isolated by OMP. Keep permissions closed, and
			// abort an already-spawned reviewer before its first provider request.
		}
	});
	pi.on("session_shutdown", () => {
		revokePermissions?.();
		stopExtensions?.();
		stopDisabledExtensions?.();
	});
	pi.on("before_provider_request", (_event, ctx) => {
		if (!reviewer) return;
		try {
			pinReviewer(ctx);
			if (ready && reviewerModel === `${ctx.model?.provider}/${ctx.model?.id}`) return;
		} catch {
			// Provider hooks also isolate errors: abort, never rely on the throw.
		}
		ctx.abort();
		throw new Error("Reviewer recovery guard is unavailable; review aborted.");
	});
	pi.on("tool_call", event => {
		if (event.toolName !== "task") return;
		const tasks = event.input.tasks;
		if (Array.isArray(tasks) ? tasks.some(hasUnsafeDesignerEffort) : hasUnsafeDesignerEffort(event.input)) {
			return { block: true, reason: "Designer effort must be high; lower effort would violate the visual model floor." };
		}
	});
}
