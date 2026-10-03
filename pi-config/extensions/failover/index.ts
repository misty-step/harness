/**
 * failover — the configured model-fallback chain for pi.
 *
 * Retry and fallback are two layers, each owned by the code that already
 * understands it (ADR-013). Stock pi owns same-model retry: a run that dies
 * on a transient provider error (rate limit, overloaded, 429/5xx, network)
 * is retried with exponential backoff per the `retry.*` settings, and
 * compaction overflow runs its own recovery loop. This extension owns the
 * boundary stock pi has no concept of — switching models: when a run that
 * just settled died on the current link of CHAIN (`agent_end` saw the error,
 * `agent_settled` means stock recovery is finished), the session moves to
 * the next link and a notification says so. The user re-sends the prompt; we
 * do not re-send it, because a run that dies mid-turn may have already
 * executed tools (ADR-011).
 *
 * The walk is strictly forward: one link per failed run, no flapping, no
 * automatic return. It is keyed to the current model, not to a remembered
 * position, so the only way to land on an earlier link is for the user to
 * explicitly select one. A run that dies on the last link reports chain
 * exhaustion instead of looping. The extension never touches a model the
 * user chose that is outside the chain. Removing this directory leaves
 * stock pi behavior (retry + compaction) intact.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { modelKey, nextInChain, runError, summarize } from "./decide.ts";

/**
 * The fallback chain, in order; a failure advances from the current model's
 * link. Pi uses only OpenAI, Grok and OpenRouter, never Anthropic. GPT-6.1 Sol
 * xhigh, then Luna max, then Grok 4.7, all through Pi-native subscription
 * logins. Astra remains available only by explicit selection. Paid
 * DeepSeek/Mercury recovery is retired; missing authentication never opts
 * into a paid route. Each link has a modelThinkingLevels entry in settings.json
 * where it needs one (ADR-011/013/025).
 */
const CHAIN = [
	"openai-pool/gpt-6.1-sol",
	"openai-pool/gpt-6-luna",
	"xai-pool/grok-4.7",
];

/**
 * Approved routes: the pools and account slots from extensions/accounts
 * (ADR-024/026) plus the base providers. Matched by an exact id pattern, so a
 * custom provider that merely looks like a slot stays refused. Codex permits
 * Sol 6.1, Luna, and explicit Astra; xAI any model; OpenRouter any model except
 * Anthropic's, which it bills as paid API tokens.
 */
const CODEX_PROVIDER = /^(openai-pool|openai-codex(-[2-4])?)$/;
const CODEX_MODELS = ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna"];
const XAI_PROVIDER = /^(xai-pool|xai(-2)?)$/;
const OPENROUTER_PROVIDER = /^(openrouter-pool|openrouter(-2)?)$/;
const anthropicModel = /(^|\/)~?anthropic\//;

function approved(model: ExtensionContext["model"]) {
	const provider = model?.provider ?? "";
	const id = model?.id ?? "";
	if (CODEX_PROVIDER.test(provider)) return CODEX_MODELS.includes(id);
	if (XAI_PROVIDER.test(provider)) return id !== "";
	if (OPENROUTER_PROVIDER.test(provider)) return id !== "" && !anthropicModel.test(id);
	return false;
}
const blockedRoute = "Model policy: Pi uses only OpenAI, Grok and OpenRouter (never Anthropic); select one and sign in with /login.";

function allowsInference(ctx: ExtensionContext) {
	if (approved(ctx.model)) return true;
	ctx.ui.notify(blockedRoute, "error");
	if (!ctx.hasUI) console.error(blockedRoute);
	return false;
}

export default function (pi: ExtensionAPI) {
	let hadError = false;
	let errorText = "";

	// Pi may skip an unauthenticated default and pick any authenticated
	// provider. Consume input before that implicit selection can spend.
	pi.on("input", (_event, ctx) => {
		if (allowsInference(ctx)) return;
		return { action: "handled" };
	});
	// Extension-originated agent requests also carry the native abort signal.
	// Throwing here would fail open: Pi catches provider-hook exceptions.
	pi.on("before_provider_request", (_event, ctx) => {
		if (!allowsInference(ctx)) ctx.abort();
	});
	// Native summaries bypass both input and the agent payload hook.
	pi.on("session_before_compact", (_event, ctx) => {
		if (!allowsInference(ctx)) return { cancel: true };
	});
	pi.on("session_before_tree", (event, ctx) => {
		if (event.preparation.userWantsSummary && !allowsInference(ctx)) return { cancel: true };
	});

	pi.on("agent_end", async (event) => {
		const error = runError((event as { messages?: unknown })?.messages);
		hadError = error !== undefined;
		if (error) errorText = error;
	});

	pi.on("agent_settled", async (_event, ctx) => {
		const failed = hadError;
		const err = errorText;
		hadError = false;
		errorText = "";
		if (!failed) return;
		const from = modelKey(ctx.model);
		const decision = nextInChain(CHAIN, from);
		if (!decision) return;
		if (decision.action === "exhausted") {
			ctx.ui.notify(
				`failover: ${from} failed (${summarize(err)}) and the fallback chain is exhausted; check provider status`,
				"error",
			);
			return;
		}
		const slash = decision.key.indexOf("/");
		const model = ctx.modelRegistry.find(
			decision.key.slice(0, slash),
			decision.key.slice(slash + 1),
		);
		if (!model) {
			ctx.ui.notify(`failover: fallback model ${decision.key} not found`, "error");
			return;
		}
		const ok = await pi.setModel(model);
		if (!ok) {
			ctx.ui.notify(`failover: no auth for fallback model ${decision.key}`, "error");
			return;
		}
		ctx.ui.notify(
			`failover: ${from} failed (${summarize(err)}) — now on ${decision.key} (${decision.link + 1}/${CHAIN.length} in chain); re-send your prompt`,
			"warning",
		);
	});
}
