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
 * link. Operator model policy (2026-09-28): Sonnet 5.5 medium, then GPT-6 Sol
 * xhigh and Luna max through Pi-native subscription logins. Paid
 * DeepSeek/Mercury recovery is retired; missing authentication never opts
 * into a paid route. Opus is deliberately outside this chain, so explicitly
 * selected visual work cannot fall through to a non-Opus model. Grok is
 * read-only recovery only and is not a builder link. Pi has no native
 * Antigravity provider, so OMP's Gemini subscription tail is not available.
 * Each link has a modelThinkingLevels entry in settings.json (ADR-011/013).
 */
const CHAIN = [
	"anthropic/claude-sonnet-5-5",
	"openai-codex/gpt-6-sol",
	"openai-codex/gpt-6-luna",
];

const subscription = [...CHAIN, "anthropic/claude-opus-5-5", "openai-codex/gpt-6-astra"];
/**
 * Extra Codex logins from extensions/accounts (ADR-024) run the same approved
 * models. Listed rather than pattern-matched, so an unlisted or custom
 * provider id stays refused. Slots sit outside CHAIN: a failure on a slot the
 * user chose does not move the session.
 */
const ACCOUNT_SLOTS = ["openai-codex-2", "openai-codex-3", "openai-codex-4"];
const approved = [
	...subscription,
	...subscription
		.filter((key) => key.startsWith("openai-codex/"))
		.flatMap((key) => ACCOUNT_SLOTS.map((slot) => `${slot}/${key.slice("openai-codex/".length)}`)),
];
const blockedRoute = "Model policy: select an approved subscription model and sign in with /login; paid startup fallback is disabled.";

function allowsInference(ctx: ExtensionContext) {
	if (approved.includes(modelKey(ctx.model))) return true;
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
