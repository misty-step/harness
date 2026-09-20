/**
 * continuation — bounded continuation-nudge judgment (harness-neutral).
 *
 * Answers one question after a harness has settled: would a gentle nudge help
 * the agent advance useful work inside the user's *existing* request? The
 * judgment is advisory only. Code owns everything else: the guard set, the
 * per-prompt bound, tool-progress evidence, the injected message, and the
 * fail-open default. A provider error, a missing key, a low-confidence
 * answer, or an unusable answer never triggers a nudge and never blocks a
 * turn.
 *
 * The question wording is byte-frozen (`CONTINUATION_VERSION`). It is the
 * `instructions` field, three paragraphs, U+2019 apostrophes, no trailing
 * newline. `continuation.test.ts` asserts the exact string and its SHA-256,
 * so any edit that drifts the wording fails the suite.
 *
 * Redaction here is best-effort accident prevention, not disclosure control:
 * treat serialized state as untrusted and never send file contents, whole
 * transcripts, or credentials.
 */

import type { Question } from "./engine.ts";

/** Frozen question wording version. Bump only with the test hash. */
export const CONTINUATION_VERSION = "continuation-v1";

/**
 * The classifier question. Byte-exact, three paragraphs, no trailing newline.
 * U+2019 apostrophes on "user’s", "doesn’t", and "don’t".
 */
export const CONTINUATION_PROMPT = `would a gentle nudge help the agent advance useful work within the user’s existing request right now?

consider unfinished work, including requests carried forward from earlier turns. answering the latest message doesn’t necessarily finish the request. if the work is complete, the user is still choosing a direction, or progress requires permission, information, or an external event, don’t nudge.

if there was a previous nudge, consider what happened afterward. further useful progress can justify another nudge; repeating the same promise or an already-explained blocker does not.`;

/**
 * One Choice question. `nudge` is the only action label; every other outcome
 * is `no_nudge` so probability mass cannot land on an implicit action.
 */
export const CONTINUATION_QUESTIONS: Record<string, Question> = {
	continuation: {
		type: "choice",
		instructions: CONTINUATION_PROMPT,
		criteria: {
			nudge: "a gentle nudge would help the agent advance useful work within the existing request right now",
			no_nudge:
				"no nudge: work complete, direction undecided, or progress gated on permission, information, or an external event (or a previous nudge saw no further progress)",
		},
	},
};

/**
 * The fixed advisory message injected on a nudge. Never generated, never
 * enriched with classifier probabilities, and never authorization for new
 * work outside the user's existing request.
 */
export const NUDGE_MESSAGE =
	"[continuation] Advisory continuation check — not a new request, not a tool or permission gate, and never authorization for new work. If the user's existing request still has unfinished, actionable work, continue it now. If the request is complete, a decision is pending, or progress needs permission, information, or an external event, finish normally.";

export type NudgeDecision = { nudge: boolean; reason: string };

/**
 * Decide from one Jev answer for key `continuation`. Accepts both the raw
 * engine answer (`{type:"choice", choice, probabilities, confidence}`) and a
 * compacted `{choice, confidence}` shape. Fail-closed toward no-nudge: a
 * missing choice, an unknown label, or a missing/non-finite confidence never
 * nudges.
 */
export function decideNudge(answer: unknown, opts: { minConfidence?: number } = {}): NudgeDecision {
	const minConfidence = opts.minConfidence ?? 0.5;
	if (answer === null || typeof answer !== "object") return { nudge: false, reason: "missing-answer" };

	const record = answer as Record<string, unknown>;
	const choice = typeof record.choice === "string" ? record.choice.trim() : "";
	if (!choice) return { nudge: false, reason: "missing-choice" };
	if (choice !== "nudge") {
		return { nudge: false, reason: choice === "no_nudge" ? "choice-no_nudge" : `unknown-choice:${choice}` };
	}

	const confidence = record.confidence;
	if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
		return { nudge: false, reason: "missing-confidence" };
	}
	if (confidence < minConfidence) return { nudge: false, reason: `low-confidence:${confidence}` };
	return { nudge: true, reason: "nudge" };
}

/** The fixed advisory message, as a function so callers do not mutate it. */
export function renderNudgeMessage(): string {
	return NUDGE_MESSAGE;
}

const PRIVATE_KEY_BLOCK = /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g;
const TOKEN_PATTERNS = [
	/\bsk[-_][A-Za-z0-9_-]{8,}\b/g,
	/\bAKIA[0-9A-Z]{12,}\b/g,
	/\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
	/\bxox[baprs]-[A-Za-z0-9-]{8,}\b/g,
	/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
];

/**
 * Redact common credential shapes, then clip to `limit` characters
 * (code-point safe). Credential redaction runs before clipping so a secret
 * cut in half is still masked.
 */
export function redactText(text: string, limit: number): string {
	if (typeof text !== "string" || text.length === 0 || limit <= 0) return "";
	let masked = text.replace(PRIVATE_KEY_BLOCK, "[REDACTED PRIVATE KEY]");
	for (const pattern of TOKEN_PATTERNS) masked = masked.replace(pattern, "[REDACTED]");
	return Array.from(masked).slice(0, limit).join("");
}