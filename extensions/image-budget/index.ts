/**
 * image-budget — a hard ceiling on inline image bytes per request (ADR-019).
 *
 * Two independent jobs, in order of authority:
 *
 * 1. `context` (the invariant, fail-closed). Before every LLM call, enforce a
 *    total decoded-image budget on the outgoing messages, dropping the oldest
 *    images first. This makes the OpenRouter 413 ("Downloaded image content
 *    cannot exceed 30MB") unreachable, and it also repairs a session that
 *    already holds too much history: only the request is trimmed, so the next
 *    prompt in that same session succeeds.
 * 2. `tool_result` (the optimization, fail-open). Shrink a large image with
 *    ffmpeg as it arrives, so the budget is rarely reached and the session
 *    file stops growing by megabytes per screenshot. If ffmpeg is missing or
 *    fails, the image is left alone and job 1 still holds the line.
 *
 * Removing this directory restores stock pi behavior: images accumulate until
 * the provider refuses the request.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_BUDGET_BYTES, enforceImageBudget, isImageContent } from "./budget.ts";
import { shrinkImage } from "./compress.ts";

const STATUS_KEY = "image-budget";

function mb(bytes: number): string {
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function (pi: ExtensionAPI) {
	registerImageBudget(pi);
}

/** The wiring, with the budget injectable so the tests can stay small. */
export function registerImageBudget(
	pi: ExtensionAPI,
	budgetBytes: number = DEFAULT_BUDGET_BYTES,
): void {
	// The drop count grows as history grows; announce each new one once, and
	// stay quiet on the passes that only re-drop what is already dropped.
	let announcedDrops = 0;

	pi.on("context", async (event, ctx) => {
		const outcome = enforceImageBudget(event.messages, budgetBytes);
		if (outcome.dropped === 0) {
			announcedDrops = 0;
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}
		if (outcome.dropped !== announcedDrops) {
			announcedDrops = outcome.dropped;
			ctx.ui.setStatus(STATUS_KEY, `img-budget ${outcome.dropped} dropped`);
			ctx.ui.notify(
				`image-budget: dropped ${outcome.dropped} old image(s) — request held ` +
					`${mb(outcome.bytesBefore)} of the ${mb(budgetBytes)} budget. ` +
					"The session file is unchanged; re-read a file if you need to see it again.",
				"warning",
			);
		}
		return { messages: event.messages };
	});

	pi.on("tool_result", async (event) => {
		const content = event.content;
		if (!Array.isArray(content) || !content.some(isImageContent)) return;
		let changed = false;
		const next: unknown[] = [];
		for (const part of content) {
			if (!isImageContent(part)) {
				next.push(part);
				continue;
			}
			const shrunk = await shrinkImage(part);
			next.push(shrunk ?? part);
			if (shrunk) changed = true;
		}
		if (!changed) return;
		return { content: next };
	});
}
