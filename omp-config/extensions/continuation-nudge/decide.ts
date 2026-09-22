/**
 * continuation-nudge/decide — pure guard, span, and state logic.
 *
 * No pi imports: every function takes plain branch entries and returns plain
 * data, so the whole guard matrix runs under `bun test` with no session,
 * network, or UI. `index.ts` owns the harness edge (events, filesystem,
 * provider call).
 *
 * The span is one user prompt: the last real user-role message and everything
 * after it. Nudge markers recorded inside that span bound the loop; a marker
 * from before the latest user prompt does not count against the new request.
 */

import { decideNudge, redactText } from "./continuation.ts";

/** Marker entry type persisted for each emitted nudge. */
export const MARKER_TYPE = "continuation-nudge/marker";
/** Serialized-state character cap for one classifier call. */
export const STATE_MAX_CHARS = 2500;
export const USER_PREVIEW_CHARS = 500;
export const RESPONSE_PREVIEW_CHARS = 500;
export const TOOL_PREVIEW_CHARS = 120;
export const MAX_RECENT_TOOLS = 6;

export interface BranchEntry {
	type?: string;
	customType?: string;
	data?: unknown;
	timestamp?: string;
	message?: {
		role?: string;
		content?: unknown;
		stopReason?: string;
		toolName?: string;
		isError?: boolean;
	};
}

export interface ToolProgress {
	index: number;
	tool: string;
	preview: string;
	isError: boolean;
}

export interface NudgeMarker {
	index: number;
	attempt: number;
	ts?: string;
}

export interface SessionAnalysis {
	/** First real user message on the branch (the original request). */
	firstUserText: string;
	/** Last real user message on the branch (the carried-forward request). */
	userText: string;
	/** Last assistant text on the branch. */
	assistantText: string;
	stopReason?: string;
	/** Nudge markers inside the current user-prompt span, oldest first. */
	markers: NudgeMarker[];
	/** Tool results inside the current user-prompt span, oldest first. */
	toolResults: ToolProgress[];
	/** Next attempt number for this span (markers in span + 1). */
	attempt: number;
	/** Last marker in this span, if any. */
	previous: NudgeMarker | null;
	/** Tool results after the previous marker (all span tools when none). */
	toolsSincePrevious: ToolProgress[];
}

/** Concatenate the text parts of a message content value. */
export function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const part of content) {
		if (part === null || typeof part !== "object") continue;
		const typed = part as { type?: unknown; text?: unknown };
		if (typed.type === "text" && typeof typed.text === "string") parts.push(typed.text);
	}
	return parts.join("\n");
}

function markerFromEntry(entry: BranchEntry, index: number): NudgeMarker | null {
	if (entry.type !== "custom" || entry.customType !== MARKER_TYPE) return null;
	const data = (entry.data ?? {}) as { attempt?: unknown; ts?: unknown };
	const attempt = typeof data.attempt === "number" && Number.isFinite(data.attempt) ? data.attempt : 1;
	return { index, attempt, ts: typeof data.ts === "string" ? data.ts : entry.timestamp };
}

function toolFromEntry(entry: BranchEntry, index: number): ToolProgress {
	const message = entry.message ?? {};
	return {
		index,
		tool: typeof message.toolName === "string" && message.toolName ? message.toolName : "tool",
		preview: contentText(message.content),
		isError: message.isError === true,
	};
}

/**
 * Walk the branch once and derive everything the guards and state need.
 * `firstUserText` preserves the original request; `userText` is the latest
 * one, so carried-forward work is visible to the classifier.
 */
export function analyzeSession(entries: readonly BranchEntry[]): SessionAnalysis {
	let firstUserText = "";
	let userText = "";
	let lastUserIndex = -1;
	let assistantText = "";
	let stopReason: string | undefined;
	const markers: NudgeMarker[] = [];
	const toolResults: ToolProgress[] = [];

	entries.forEach((entry, index) => {
		if (entry.type === "message" && entry.message?.role === "user") {
			const text = contentText(entry.message.content).trim();
			if (!text) return;
			if (!firstUserText) firstUserText = text;
			userText = text;
			lastUserIndex = index;
			return;
		}
		if (entry.type === "message" && entry.message?.role === "assistant") {
			const text = contentText(entry.message.content).trim();
			if (text) assistantText = text;
			if (entry.message.stopReason !== undefined) stopReason = entry.message.stopReason;
			return;
		}
		if (entry.type === "message" && entry.message?.role === "toolResult") {
			toolResults.push(toolFromEntry(entry, index));
			return;
		}
		if (entry.type === "custom") {
			const marker = markerFromEntry(entry, index);
			if (marker) markers.push(marker);
		}
	});

	const spanMarkers = markers.filter((marker) => marker.index > lastUserIndex);
	const spanTools = toolResults.filter((tool) => tool.index > lastUserIndex);
	const previous = spanMarkers.length > 0 ? spanMarkers[spanMarkers.length - 1] : null;
	const toolsSincePrevious = previous ? spanTools.filter((tool) => tool.index > previous.index) : spanTools;

	return {
		firstUserText,
		userText,
		assistantText,
		stopReason,
		markers: spanMarkers,
		toolResults: spanTools,
		attempt: spanMarkers.length + 1,
		previous,
		toolsSincePrevious,
	};
}

export interface GuardInput {
	mode: "on" | "off";
	isIdle: boolean;
	hasPendingMessages: boolean;
	analysis: SessionAnalysis;
	maxNudges: number;
	/**
	 * OMP: the terminal `agent_end` (`willContinue !== true`) already means OMP
	 * will not continue automatically, and OMP's `isIdle()` is false during
	 * the event by construction. Deferring a macrotask to re-read it is not
	 * reliable (print mode exits at the event), so the adapter marks the
	 * settled event and this check is skipped. `hasPendingMessages()` still
	 * guards queued work.
	 */
	settledEvent?: boolean;
}

export type GuardResult = { proceed: true } | { proceed: false; reason: string };

/**
 * The full deterministic guard set. All conditions are required; the first
 * failing condition names the skip reason for the log. `mode: "off"` is the
 * only silent skip — a disabled operator expects stock behavior, not a log
 * trail.
 */
export function evaluateGuards(input: GuardInput): GuardResult {
	if (input.mode === "off") return { proceed: false, reason: "mode-off" };
	if (!input.isIdle && input.settledEvent !== true) return { proceed: false, reason: "not-idle" };
	if (input.hasPendingMessages) return { proceed: false, reason: "pending-messages" };
	if (!input.analysis.userText) return { proceed: false, reason: "no-user-request" };
	if (!input.analysis.assistantText) return { proceed: false, reason: "no-terminal-answer" };
	if (input.analysis.stopReason === "aborted") return { proceed: false, reason: "stop-reason-aborted" };
	if (input.analysis.stopReason === "error") return { proceed: false, reason: "stop-reason-error" };
	if (input.analysis.markers.length >= input.maxNudges) return { proceed: false, reason: "max-nudges" };
	if (input.analysis.previous && input.analysis.toolsSincePrevious.length === 0) {
		return { proceed: false, reason: "no-progress-since-nudge" };
	}
	return { proceed: true };
}

/**
 * Map one Jev answer to a nudge decision. Thin by design: the shape rules
 * live in the shared module and are exercised by the shared test matrix.
 */
export function decideFromAnswer(answer: unknown, minConfidence: number): { nudge: boolean; reason: string } {
	return decideNudge(answer, { minConfidence });
}

export interface ContinuationState {
	continuation_check: {
		version: string;
		attempt: number;
		user_request_preview: string;
		final_response_preview: string;
		recent_tools: { tool: string; preview: string }[];
		previous_nudge: null | { attempt: number; tools_since: string[]; new_tools: number };
	};
}

/**
 * Build the bounded classifier state. Redaction and clipping happen here, so
 * an unredacted transcript never reaches the serializer.
 */
export function buildState(input: {
	version: string;
	attempt: number;
	analysis: SessionAnalysis;
}): ContinuationState {
	const { analysis } = input;
	const original = analysis.firstUserText;
	const latest = analysis.userText;
	const requestPreview =
		original && latest && original !== latest ? `original: ${original}\nlatest: ${latest}` : latest;
	const recentTools = analysis.toolResults
		.slice(-MAX_RECENT_TOOLS)
		.map((tool) => ({ tool: tool.tool, preview: redactText(tool.preview, TOOL_PREVIEW_CHARS) }));
	const toolsSince = analysis.toolsSincePrevious.map((tool) => tool.tool);

	return {
		continuation_check: {
			version: input.version,
			attempt: input.attempt,
			user_request_preview: redactText(requestPreview, USER_PREVIEW_CHARS),
			final_response_preview: redactText(analysis.assistantText, RESPONSE_PREVIEW_CHARS),
			recent_tools: recentTools,
			previous_nudge: analysis.previous
				? {
						attempt: analysis.previous.attempt,
						tools_since: toolsSince,
						new_tools: toolsSince.length,
					}
				: null,
		},
	};
}

/**
 * Serialize under the character cap. The only permitted levers are dropping
 * the oldest recent tools, halving the previews, and dropping the oldest
 * `tools_since` names — never adding detail. Returns `null` when even the
 * cleared skeleton cannot fit: the cap is a data-minimization boundary, so
 * oversize state fails closed (the caller skips the Jev call) rather than
 * sending more than declared.
 */
export function serializeState(state: ContinuationState, maxChars = STATE_MAX_CHARS): string | null {
	const slim = JSON.parse(JSON.stringify(state)) as ContinuationState;
	let json = JSON.stringify(slim);
	const shrink = (): boolean => {
		const check = slim.continuation_check;
		if (check.recent_tools.length > 0) {
			check.recent_tools.shift();
			return true;
		}
		const longest =
			check.user_request_preview.length >= check.final_response_preview.length
				? "user_request_preview"
				: "final_response_preview";
		if (check[longest].length > 0) {
			check[longest] = check[longest].slice(0, Math.floor(check[longest].length / 2));
			return true;
		}
		if (check.previous_nudge && check.previous_nudge.tools_since.length > 0) {
			check.previous_nudge.tools_since.shift();
			check.previous_nudge.new_tools = check.previous_nudge.tools_since.length;
			return true;
		}
		return false;
	};
	while (json.length > maxChars && shrink()) json = JSON.stringify(slim);
	if (json.length > maxChars) {
		// Last resort: keep only the fixed skeleton. If that still exceeds the
		// cap, the caller must not send anything.
		slim.continuation_check.recent_tools = [];
		slim.continuation_check.user_request_preview = "";
		slim.continuation_check.final_response_preview = "";
		if (slim.continuation_check.previous_nudge) {
			slim.continuation_check.previous_nudge = {
				attempt: slim.continuation_check.previous_nudge.attempt,
				tools_since: [],
				new_tools: 0,
			};
		}
		json = JSON.stringify(slim);
	}
	return json.length <= maxChars ? json : null;
}