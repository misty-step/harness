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
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { modelKey, nextInChain, runError, summarize } from "./decide.ts";

/**
 * The fallback chain, in order; a failure advances from the current model's
 * link. Operator model policy (2026-09-25): Opus 5.5 first, then GPT-6 Sol and
 * Luna at max, then the existing paid OpenRouter recovery. Grok is last in the
 * policy and Pi reaches it only through a paid API key, so it is not a link.
 * The subscription links apply once Pi-native Anthropic and Codex logins are
 * ready and `./install` selects the Opus startup default; until then startup
 * is DeepSeek flash and a failure advances to mercury. Every link must be a
 * model the session can resolve and authenticate, with a modelThinkingLevels
 * entry so a switch keeps posture. Cerebras is out of the fleet (operator
 * 2026-09-18: too expensive). Extend by editing this list and redeploying
 * (ADR-013).
 */
const CHAIN = [
	"anthropic/claude-opus-5-5",
	"openai-codex/gpt-6-sol",
	"openai-codex/gpt-6-luna",
	"openrouter/deepseek/deepseek-v4.1-flash",
	"openrouter/inception/mercury-2.5",
];

export default function (pi: ExtensionAPI) {
	let hadError = false;
	let errorText = "";

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
