/**
 * Pure compact-hint decisions for extensions/compact-hint. No pi imports and
 * no provider imports, so it is unit-tested with `bun test` (decide.test.ts).
 * Same split as failover and loc: this module only reasons; index.ts talks to
 * pi and to the System One provider.
 *
 * Policy (ADR-023): hint-only by default; automatic compaction requires an
 * explicit environment opt-in and a fully interactive (tui) session. Print and
 * JSON runs are inert — advice has nobody to read it. The upstream package's
 * kill switch (COMPACT_ADVISER_DISABLE) disables this extension too, so one
 * variable silences both.
 */

export const HINT_PREFIX = "compact-hint";
/** Do not judge more often than this. */
export const DEFAULT_COOLDOWN_MS = 60_000;
/** Below this context size the advice has nobody to help. */
export const DEFAULT_MIN_CONTEXT_TOKENS = 40_000;
/** Explicit opt-in for automatic compaction. Unset means hint-only. */
export const AUTO_ENV = "PI_COMPACT_HINT_AUTO";

export type ExtensionMode = "tui" | "rpc" | "json" | "print";

export type SkipReason = "disabled" | "unattended" | "unknown-usage" | "below-minimum" | "cooldown";

export interface GateInput {
	mode: ExtensionMode;
	disabled: boolean;
	autoOptIn: boolean;
	tokens: number | null;
	contextWindow: number | null;
	lastJudgeMs: number | null;
	nowMs: number;
	minContextTokens?: number;
	cooldownMs?: number;
}

export type GateDecision =
	| { action: "judge"; auto: boolean; usage: number }
	| { action: "skip"; reason: SkipReason };

/**
 * The cheap local gates before any provider call: kill switch, unattended
 * modes, unknown usage, minimum context, cooldown. Auto is allowed only when
 * explicitly opted in AND the session is fully interactive; every other
 * combination is a hint.
 */
export function gate(input: GateInput): GateDecision {
	if (input.disabled) return { action: "skip", reason: "disabled" };
	if (input.mode === "print" || input.mode === "json") return { action: "skip", reason: "unattended" };
	const { tokens, contextWindow } = input;
	if (
		typeof tokens !== "number" ||
		!Number.isFinite(tokens) ||
		typeof contextWindow !== "number" ||
		!Number.isFinite(contextWindow) ||
		contextWindow <= 0
	) {
		return { action: "skip", reason: "unknown-usage" };
	}
	if (tokens < (input.minContextTokens ?? DEFAULT_MIN_CONTEXT_TOKENS)) {
		return { action: "skip", reason: "below-minimum" };
	}
	const cooldown = input.cooldownMs ?? DEFAULT_COOLDOWN_MS;
	if (input.lastJudgeMs !== null && input.nowMs - input.lastJudgeMs < cooldown) {
		return { action: "skip", reason: "cooldown" };
	}
	return { action: "judge", auto: input.autoOptIn && input.mode === "tui", usage: tokens / contextWindow };
}

/** Truthy spellings of the explicit auto opt-in; anything else is off. */
export function autoOptedIn(env: Record<string, string | undefined> = process.env): boolean {
	const raw = (env[AUTO_ENV] ?? "").trim().toLowerCase();
	return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/** One line for the operator. Never sent to the model. */
export function hintLine(percent: number | null, auto: boolean): string {
	const where = typeof percent === "number" && Number.isFinite(percent) ? ` (${Math.round(percent)}% context used)` : "";
	const action = auto ? "compacting automatically" : "run /compact to save tokens";
	return `${HINT_PREFIX}: work appears completed or recorded — ${action}${where}.`;
}

/** One line for the status command. */
export function statusLine(input: {
	mode: ExtensionMode;
	disabled: boolean;
	autoOptIn: boolean;
	tokens: number | null;
	contextWindow: number | null;
	lastVerdict: string | null;
}): string {
	const auto = input.autoOptIn && input.mode === "tui" ? "auto" : "hint";
	const context =
		typeof input.tokens === "number" && typeof input.contextWindow === "number" && input.contextWindow > 0
			? `${input.tokens}/${input.contextWindow} tokens`
			: "context unknown";
	const last = input.lastVerdict ? `last: ${input.lastVerdict}` : "no judgment yet";
	return `${HINT_PREFIX}: mode=${input.disabled ? "off" : auto} (${input.mode}), ${context}, ${last}`;
}
