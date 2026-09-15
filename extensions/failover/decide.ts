/**
 * Pure failover decisions for extensions/failover. No runtime imports, so it
 * is unit-tested with `bun test` (see decide.test.ts). Same split as loc and
 * web-search: this module only reasons; index.ts talks to pi.
 */

export interface ModelRef {
	provider?: string;
	id?: string;
	/** Some model objects spell it modelId. */
	modelId?: string;
}

/** "provider/modelId" for a model object, or "" when it cannot be named. */
export function modelKey(model: ModelRef | null | undefined): string {
	if (!model) return "";
	const provider = model.provider ?? "";
	const id = model.id ?? model.modelId ?? "";
	if (!provider || !id) return "";
	return `${provider}/${id}`;
}

/**
 * The errorMessage of the *last* assistant message in a run. Present means
 * the run ended in a provider failure; user aborts and tool errors leave the
 * last assistant message error-free, so they settle clean. Absent means the
 * run settled clean.
 */
export function runError(messages: unknown): string | undefined {
	if (!Array.isArray(messages)) return undefined;
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i] as
			| { role?: unknown; errorMessage?: unknown }
			| null;
		if (!m || m.role !== "assistant") continue;
		if (typeof m.errorMessage === "string" && m.errorMessage.trim() !== "") {
			return m.errorMessage;
		}
		return undefined;
	}
	return undefined;
}

/**
 * Where a failed run goes next along the fallback chain (ADR-013).
 *
 * `null` — no action: the session is not on the chain's current link, either
 * because the user chose another model (never second-guessed) or because
 * state drifted; staying put is the safe thing.
 * `advance` — the session is on `chain[position]`; switch to the next link.
 * `exhausted` — the session is on the last link; nothing left to switch to.
 */
export type ChainDecision =
	| { action: "advance"; key: string; position: number }
	| { action: "exhausted" }
	| null;

export function nextInChain(
	chain: readonly string[],
	position: number,
	currentKey: string,
): ChainDecision {
	if (position < 0 || position >= chain.length) return null;
	if (currentKey !== chain[position]) return null;
	if (position + 1 < chain.length) {
		return { action: "advance", key: chain[position + 1], position: position + 1 };
	}
	return { action: "exhausted" };
}

/** One line, trimmed and clamped, for a status notification. */
export function summarize(message: string, maxChars = 140): string {
	const oneLine = message.replace(/\s+/g, " ").trim();
	if (oneLine.length <= maxChars) return oneLine;
	return `${oneLine.slice(0, maxChars - 1)}…`;
}