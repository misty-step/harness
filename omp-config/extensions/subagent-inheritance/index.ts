import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { lookup } from "@oh-my-pi/pi-coding-agent/config/registry";
import { findScopedSettings } from "@oh-my-pi/pi-coding-agent/config/settings";

type Spawn = { agent: string; invocationKind: string };
type ModelSelection = { model: string } | { block: true; reason: string } | undefined;
const GUARDED_AGENTS: Record<string, true> = { reviewer: true, "security-reviewer": true, designer: true };
const REVIEW_PIN = "harness:reviewer-model-pin";
const REVIEW_MODEL = "anthropic/claude-sonnet-5-5";
const expectedReviews = new Map<string, { parentId: string; model: string }>();

/** Reviews retain Sonnet high; visual work retains Opus. */
function taskModelSelection(spawn: Spawn, ctx: ExtensionContext, thinking: string | undefined): ModelSelection {
	const parent = ctx.model;
	if (spawn.agent === "reviewer" || spawn.agent === "security-reviewer") {
		return { model: `${REVIEW_MODEL}:high` };
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

type RuntimeModel = { provider: string; id: string };
const TASK_KINDS: Record<string, string> = {
	scout: "research", reviewer: "review", "security-reviewer": "review", designer: "design", sonic: "mechanical",
};

function restricted(model: RuntimeModel): boolean {
	return /grok/i.test(model.id) || (model.provider === "google-antigravity" && /gemini/i.test(model.id));
}

/** The central policy owns quota, freshness and reset admission; never infer them here. */
async function admitRestricted(model: RuntimeModel, reasoning: string, agent: string): Promise<void> {
	const base = process.env.AI_USAGE_ROUTER_URL;
	if (!base) throw new Error("AI_USAGE_ROUTER_URL is missing.");
	const hold = `${model.provider}/${model.id}`;
	const taskKind = TASK_KINDS[agent] ?? "build";
	const url = new URL("/v1/route", base);
	url.searchParams.set("task_kind", taskKind);
	url.searchParams.set("harness", "omp");
	url.searchParams.set("model_hold", hold);
	url.searchParams.set("eligible_model", hold);
	const controller = new AbortController();
	let timeout: NodeJS.Timeout | undefined;
	try {
		await Promise.race([
			(async () => {
				const response = await fetch(url, { signal: controller.signal, redirect: "error" });
				if (!response.ok) throw new Error("Central route read failed.");
				const answer = await response.json();
				const request = answer?.request;
				const choice = answer?.choice;
				if (answer?.schema_version !== 1 || answer.policy_version !== "K-20261012-2" || answer.ok !== true
					|| answer.fallback_gate?.allowed !== true
					|| request?.task_kind !== taskKind || request.harness !== "omp" || request.model_hold !== hold
					|| request.family_hold !== null
					|| !Array.isArray(request.eligible_models) || request.eligible_models.length !== 1
					|| request.eligible_models[0] !== hold
					|| choice?.provider !== model.provider || choice.model !== model.id || choice.reasoning !== reasoning
					|| choice.selector !== `${hold}:${reasoning}` || choice.billing !== "plan") {
					throw new Error("Central policy2 did not admit the exact restricted model and reasoning on plan.");
				}
			})(),
			new Promise<never>((_, reject) => {
				timeout = setTimeout(() => {
					controller.abort();
					reject(new Error("Central route read timed out."));
				}, 5_000);
			}),
		]);
	} finally {
		clearTimeout(timeout);
	}
}

export default function registerSubagentInheritance(pi: ExtensionAPI) {
	let ready = false;
	let reviewer = true;
	let reviewerModel: string | undefined;
	let restrictedModel: string | undefined;
	let stopExtensions: (() => void) | undefined;
	let stopDisabledExtensions: (() => void) | undefined;
	let revokePermissions: (() => void) | undefined;
	let restoreRecovery: (() => void) | undefined;

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
		// Native patterns are observable before resolution; modelRole is absent
		// for explicit selectors. Specialist replacements above are authoritative.
		if (!selection && event.modelRole === undefined) {
			try {
				for (const pattern of event.patterns) {
					const [selector, reasoning = pi.getThinkingLevel()] = pattern.split(":");
					const separator = selector.indexOf("/");
					const provider = selector.slice(0, separator);
					const id = separator < 0 ? undefined : selector.slice(separator + 1);
					if (!id) {
						if (/grok|gemini/i.test(pattern)) throw new Error("Restricted model needs an exact native selector.");
						continue;
					}
					const model = { provider, id };
					if (!restricted(model)) continue;
					if (!ready || /[*?]/.test(pattern)) throw new Error("Restricted model guard requires an exact initialized route.");
					await admitRestricted(model, reasoning, event.agent);
					if (!ready) throw new Error("Restricted model permission was revoked.");
				}
			} catch (error) {
				ctx.abort();
				return { block: true, reason: `Restricted model refused: ${error instanceof Error ? error.message : String(error)}` };
			}
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
		restrictedModel = ctx.model && restricted(ctx.model) ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
		try {
			revokePermissions?.();
			stopExtensions?.();
			stopDisabledExtensions?.();
			restoreRecovery?.();
			restoreRecovery = undefined;
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
				if (!ctx.model || reviewerModel !== REVIEW_MODEL || reviewerModel !== `${ctx.model.provider}/${ctx.model.id}`) return;
				pi.setThinkingLevel("high");
			}
			if (reviewer || restrictedModel) {
				const previousFallback = switching.get(settings);
				const previousChains = structuredClone(chains.get(settings));
				restoreRecovery = () => {
					switching.override(settings, previousFallback);
					chains.override(settings, previousChains);
				};
				// A gated fallback is an exact hold, not permission to enter the
				// engineer's recovery chain before a provider payload exists.
				switching.override(settings, false);
				if (switching.get(settings) !== false) return;
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
		restoreRecovery?.();
		restoreRecovery = undefined;
	});
	pi.on("before_provider_request", async (_event, ctx) => {
		if (restrictedModel && restrictedModel !== `${ctx.model?.provider}/${ctx.model?.id}`) {
			ctx.abort();
			throw new Error("Restricted model hold changed; request aborted.");
		}
		if (reviewer) {
			try {
				pinReviewer(ctx);
				if (!ready || reviewerModel !== REVIEW_MODEL || reviewerModel !== `${ctx.model?.provider}/${ctx.model?.id}`
					|| pi.getThinkingLevel() !== "high") {
					throw new Error("Reviewer recovery guard is unavailable.");
				}
			} catch {
				// Provider hooks isolate errors: abort, never rely on the throw.
				ctx.abort();
				throw new Error("Reviewer recovery guard is unavailable; review aborted.");
			}
		}
		if (ctx.model && restricted(ctx.model)) {
			try {
				if (!ready) throw new Error("Restricted model guard is unavailable.");
				await admitRestricted(ctx.model, pi.getThinkingLevel(), ctx.agent.name);
				if (!ready) throw new Error("Restricted model permission was revoked.");
			} catch (error) {
				ctx.abort();
				throw new Error(`Restricted model refused: ${error instanceof Error ? error.message : String(error)}`);
			}
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
