/**
 * Pure failover decisions for extensions/failover. No runtime imports,
 * unit-tested with `bun test` (see decide.test.ts). Mirrors the loc and
 * web-search split: this module reasons, index.ts talks to the harness.
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
 * The errorMessage of the *last* assistant message in a run. Present means the
 * run ended on a provider failure; user aborts and tool errors leave the last
 * assistant message error-free, so they settle as clean. Absent means the run
 * settled cleanly.
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

export interface FailoverState {
	/** agent_end saw a provider error on the run that just finished. */
	hadError: boolean;
	/** We already switched this session; never flap back. */
	alreadyFailedOver: boolean;
}

/**
 * Switch iff the finished run died, we are still on the primary, and we have
 * not already switched. A current model that is not the primary means the
 * user chose their own model and we do not second-guess it.
 */
export function shouldFailover(
	state: FailoverState,
	currentKey: string,
	primaryKey: string,
): boolean {
	return (
		state.hadError &&
		!state.alreadyFailedOver &&
		currentKey !== "" &&
		currentKey === primaryKey
	);
}

/** One line, trimmed and clamped, for a status notification. */
export function summarize(message: string, maxChars = 140): string {
	const oneLine = message.replace(/\s+/g, " ").trim();
	if (oneLine.length <= maxChars) return oneLine;
	return `${oneLine.slice(0, maxChars - 1)}…`;
}