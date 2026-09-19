import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	CONTINUATION_PROMPT,
	CONTINUATION_QUESTIONS,
	CONTINUATION_VERSION,
	NUDGE_MESSAGE,
	decideNudge,
	redactText,
	renderNudgeMessage,
} from "./continuation.ts";

/**
 * The frozen wording, repeated here on purpose: the assertion is the exact
 * string plus the normalized SHA-256 recorded in the PR that shipped it.
 * If either side drifts, one of these fails.
 */
const EXPECTED_PROMPT = `would a gentle nudge help the agent advance useful work within the user’s existing request right now?

consider unfinished work, including requests carried forward from earlier turns. answering the latest message doesn’t necessarily finish the request. if the work is complete, the user is still choosing a direction, or progress requires permission, information, or an external event, don’t nudge.

if there was a previous nudge, consider what happened afterward. further useful progress can justify another nudge; repeating the same promise or an already-explained blocker does not.`;

const EXPECTED_PROMPT_SHA256 = "6a8197ba1ce18b08dafca9450d89943fe2ed28d6b93d3c508d23c4a58f2496e0";

describe("continuation prompt", () => {
	test("is byte-exact, three paragraphs, no trailing newline", () => {
		expect(CONTINUATION_PROMPT).toBe(EXPECTED_PROMPT);
		expect(CONTINUATION_PROMPT.endsWith("\n")).toBe(false);
		expect(CONTINUATION_PROMPT.includes("\u2019")).toBe(true);
		expect(CONTINUATION_PROMPT.split("\n\n")).toHaveLength(3);
		expect(CONTINUATION_PROMPT.length).toBe(584);
		expect(new TextEncoder().encode(CONTINUATION_PROMPT).length).toBe(590);
	});

	test("matches the normalized sha256 recorded with the version", () => {
		const digest = createHash("sha256").update(CONTINUATION_PROMPT, "utf8").digest("hex");
		expect(digest).toBe(EXPECTED_PROMPT_SHA256);
	});

	test("asks one Choice question whose instructions are the frozen prompt", () => {
		const question = CONTINUATION_QUESTIONS.continuation;
		expect(question.type).toBe("choice");
		expect(question.instructions).toBe(CONTINUATION_PROMPT);
		if (question.type !== "choice") throw new Error("unreachable");
		expect(Object.keys(question.criteria).sort()).toEqual(["no_nudge", "nudge"]);
	});

	test("versions the wording", () => {
		expect(CONTINUATION_VERSION).toBe("continuation-v1");
	});
});

describe("decideNudge", () => {
	test("nudges only on a confident nudge choice", () => {
		expect(decideNudge({ choice: "nudge", confidence: 0.9 })).toEqual({ nudge: true, reason: "nudge" });
		expect(
			decideNudge(
				{ type: "choice", choice: "nudge", probabilities: { nudge: 0.93 }, confidence: 0.87 },
			),
		).toEqual({ nudge: true, reason: "nudge" });
	});

	test("does not nudge on no_nudge, low confidence, or missing confidence", () => {
		expect(decideNudge({ choice: "no_nudge", confidence: 0.99 }).nudge).toBe(false);
		expect(decideNudge({ choice: "no_nudge", confidence: 0.99 }).reason).toBe("choice-no_nudge");
		expect(decideNudge({ choice: "nudge", confidence: 0.49 }, { minConfidence: 0.5 }).nudge).toBe(false);
		expect(decideNudge({ choice: "nudge", confidence: 0.49 }, { minConfidence: 0.5 }).reason).toContain("low-confidence");
		expect(decideNudge({ choice: "nudge" }).nudge).toBe(false);
		expect(decideNudge({ choice: "nudge", confidence: Number.NaN }).nudge).toBe(false);
	});

	test("fails toward no_nudge on malformed answers", () => {
		for (const malformed of [null, undefined, "nudge", 42, {}, { choice: 7 }, { choices: ["nudge"] }]) {
			expect(decideNudge(malformed).nudge).toBe(false);
		}
		expect(decideNudge({ choice: "maybe", confidence: 1 }).reason).toBe("unknown-choice:maybe");
	});

	test("honours a stricter minimum confidence", () => {
		expect(decideNudge({ choice: "nudge", confidence: 0.8 }, { minConfidence: 0.9 }).nudge).toBe(false);
		expect(decideNudge({ choice: "nudge", confidence: 0.95 }, { minConfidence: 0.9 }).nudge).toBe(true);
	});
});

describe("redactText", () => {
	test("masks common credential shapes", () => {
		const cases: Array<[string, string]> = [
			["key sk-abcdefghijklmnopqrstuvwx", "[REDACTED]"],
			["Authorization: Bearer abcdefgh12345678", "[REDACTED]"],
			["aws AKIAIOSFODNN7EXAMPLE2", "[REDACTED]"],
			["token ghp_abcdefghijklmnopqrstuvwxyz012345", "[REDACTED]"],
			["slack xoxb-1234567890-abcdef", "[REDACTED]"],
		];
		for (const [input, marker] of cases) {
			const masked = redactText(input, 500);
			expect(masked).toContain(marker);
			expect(masked).not.toContain(input.split(" ").pop() as string);
		}
	});

	test("masks an entire private key block", () => {
		const block = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ==\n-----END OPENSSH PRIVATE KEY-----";
		const masked = redactText(`before ${block} after`, 500);
		expect(masked).toBe("before [REDACTED PRIVATE KEY] after");
	});

	test("clips ordinary text to the limit and leaves it otherwise intact", () => {
		expect(redactText("hello world", 5)).toBe("hello");
		expect(redactText("hello world", 500)).toBe("hello world");
		expect(redactText("hello", 0)).toBe("");
		expect(redactText("😀😀😀", 2)).toBe("😀😀");
	});
});

describe("NUDGE_MESSAGE", () => {
	test("is the fixed advisory template", () => {
		expect(renderNudgeMessage()).toBe(NUDGE_MESSAGE);
		expect(NUDGE_MESSAGE.startsWith("[continuation] Advisory continuation check")).toBe(true);
		expect(NUDGE_MESSAGE).toContain("not a new request, not a tool or permission gate");
		expect(NUDGE_MESSAGE).toContain("never authorization for new work");
		expect(NUDGE_MESSAGE.endsWith("finish normally.")).toBe(true);
	});
});