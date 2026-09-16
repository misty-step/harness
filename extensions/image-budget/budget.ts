/**
 * Pure image-budget logic for extensions/image-budget. No runtime imports, so
 * it is unit-tested with `bun test` (see budget.test.ts). Same split as loc,
 * web-search, and failover: this module only reasons; index.ts talks to pi and
 * to ffmpeg.
 *
 * Why a budget exists (ADR-019): a request that carries more than 30 MB of
 * image content is rejected with HTTP 413, "Downloaded image content cannot
 * exceed 30MB". The offending content is the whole conversation, not one tool
 * result, so the session cannot recover on its own — every later request
 * re-sends the same history and fails the same way. The budget is the
 * invariant that makes that state unreachable.
 *
 * The unit is decoded bytes: the quantity the provider counts, and 4/3
 * smaller than the base64 pi sends, so a decoded-byte budget is the
 * conservative reading. The default sits well under the smallest ceiling we
 * know of, leaving room for text, tool schemas, and images added later.
 */

/** Decoded byte length of a base64 payload. */
export function decodedBytes(base64: string): number {
	const len = base64.length;
	if (len === 0) return 0;
	const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
	return Math.max(0, Math.floor((len * 3) / 4) - padding);
}

/** An inline image content block, as pi-ai defines it. */
export interface ImageContent {
	type: "image";
	data: string;
	mimeType?: string;
}

export function isImageContent(part: unknown): part is ImageContent {
	if (typeof part !== "object" || part === null) return false;
	const candidate = part as { type?: unknown; data?: unknown };
	return candidate.type === "image" && typeof candidate.data === "string";
}

/** Replaces a dropped image, so the model knows one was there and was withheld. */
export const DROPPED_IMAGE_TEXT = "[image omitted by image-budget]";

/**
 * Default request budget, in decoded bytes. OpenRouter's ceiling is 30 MB;
 * this leaves half of it for everything the budget does not count.
 */
export const DEFAULT_BUDGET_BYTES = 15 * 1024 * 1024;

export interface BudgetOutcome {
	/** Image bytes the conversation held before the pass. */
	bytesBefore: number;
	/** Image bytes retained for this request. Never above the budget. */
	bytesAfter: number;
	/** Images replaced by DROPPED_IMAGE_TEXT. */
	dropped: number;
	/** Images still inline. */
	kept: number;
}

interface Slot {
	container: unknown[];
	index: number;
	bytes: number;
}

/**
 * Enforce the budget on `messages` in place. The caller passes the context
 * hook's deep copy, so the session file is never touched — a session that
 * already holds too much history is repaired for this request and the next.
 *
 * Oldest images go first, so the most recent screenshots — the ones a live
 * diagnosis needs — survive. Dropping a block replaces it with a text block,
 * which keeps every message's content array non-empty and its shape valid.
 */
export function enforceImageBudget(
	messages: readonly unknown[],
	budgetBytes: number = DEFAULT_BUDGET_BYTES,
): BudgetOutcome {
	const slots: Slot[] = [];
	for (const message of messages) {
		const content = (message as { content?: unknown } | null)?.content;
		if (!Array.isArray(content)) continue;
		content.forEach((part, index) => {
			if (isImageContent(part)) {
				slots.push({ container: content, index, bytes: decodedBytes(part.data) });
			}
		});
	}

	let total = slots.reduce((sum, slot) => sum + slot.bytes, 0);
	const bytesBefore = total;
	let dropped = 0;
	for (const slot of slots) {
		if (total <= budgetBytes) break;
		slot.container[slot.index] = { type: "text", text: DROPPED_IMAGE_TEXT };
		total -= slot.bytes;
		dropped += 1;
	}

	return { bytesBefore, bytesAfter: total, dropped, kept: slots.length - dropped };
}
