/**
 * failover — one-shot model failover for pi.
 *
 * When the turn a user submits dies on the primary model — a provider error,
 * after stock retry-with-backoff and compaction recovery have finished, as
 * known by agent_settled — the session is switched to the fallback model and
 * a warning notification is shown. The user re-sends the prompt; we do not
 * re-send it, because a run that dies mid-turn may have already executed
 * tools (ADR-011).
 *
 * The switch happens at most once per session: no flapping, no automatic
 * return to the primary. It does nothing on a clean run, on a run the user
 * aborted, or while the user has chosen a model other than the primary.
 * Removing this directory leaves stock pi behavior (retry + compaction)
 * intact.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { modelKey, runError, shouldFailover, summarize } from "./decide.ts";

/**
 * Must match the startup default in the repo's settings.json. If the session
 * is on any other model, this extension never fires.
 */
const PRIMARY = "cerebras/qwen-3.8-27b";
const FALLBACK = "openrouter/inception/mercury-2.5";

export default function (pi: ExtensionAPI) {
	let hadError = false;
	let errorText = "";
	let failedOver = false;

	pi.on("agent_end", async (event) => {
		const error = runError((event as { messages?: unknown })?.messages);
		hadError = error !== undefined;
		if (error) errorText = error;
	});

	pi.on("agent_settled", async (_event, ctx) => {
		const currentKey = modelKey(ctx.model);
		const failed = hadError;
		const err = errorText;
		hadError = false;
		errorText = "";
		if (
			!shouldFailover(
				{ hadError: failed, alreadyFailedOver: failedOver },
				currentKey,
				PRIMARY,
			)
		) {
			return;
		}
		const slash = FALLBACK.indexOf("/");
		const model = ctx.modelRegistry.find(
			FALLBACK.slice(0, slash),
			FALLBACK.slice(slash + 1),
		);
		if (!model) {
			ctx.ui.notify(`failover: fallback model ${FALLBACK} not found`, "error");
			return;
		}
		const ok = await pi.setModel(model);
		if (!ok) {
			ctx.ui.notify(`failover: no auth for fallback model ${FALLBACK}`, "error");
			return;
		}
		failedOver = true;
		ctx.ui.notify(
			`failover: ${PRIMARY} failed (${summarize(err)}) — now on ${FALLBACK}; re-send your prompt`,
			"warning",
		);
	});
}