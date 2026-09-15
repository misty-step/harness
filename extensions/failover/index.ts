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
 * automatic return. A run that dies on the last link reports chain
 * exhaustion instead of looping. The extension never touches a model the
 * user chose. Removing this directory leaves stock pi behavior (retry +
 * compaction) intact.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { modelKey, nextInChain, runError, summarize } from "./decide.ts";

/**
 * The fallback chain, in order. The first link must match the startup
 * default in the repo's settings.json; every link must be a model the
 * session can resolve and authenticate (and thinking models should carry a
 * modelThinkingLevels entry so the switch keeps posture). Extend by editing
 * this list and redeploying (ADR-013).
 */
const CHAIN = [
	"cerebras/qwen-3.8-27b",
	"openrouter/inception/mercury-2.5",
];

export default function (pi: ExtensionAPI) {
	let hadError = false;
	let errorText = "";
	let position = 0;

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
		const decision = nextInChain(CHAIN, position, modelKey(ctx.model));
		if (!decision) return;
		if (decision.action === "exhausted") {
			ctx.ui.notify(
				`failover: ${CHAIN[position]} failed (${summarize(err)}) and the fallback chain is exhausted; check provider status`,
				"error",
			);
			return;
		}
		const from = CHAIN[position];
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
		position = decision.position;
		ctx.ui.notify(
			`failover: ${from} failed (${summarize(err)}) — now on ${decision.key} (${position + 1}/${CHAIN.length} in chain); re-send your prompt`,
			"warning",
		);
	});
}
