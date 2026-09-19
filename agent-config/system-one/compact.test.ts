import { describe, expect, test } from "bun:test";
import {
	buildCompactState,
	COMPACT_FLOOR_MAX,
	COMPACT_FLOOR_MIN,
	COMPACT_HINT,
	COMPACT_MIN_CONTEXT_TOKENS,
	compactDisabled,
	compactFloor,
	compactQualifies,
	compactScore,
	evaluateCompact,
	redactCompactText,
	type CompactMessage,
} from "./compact.ts";
import type { Answer, SystemOneProvider } from "./engine.ts";

const choice = (name: string, probabilities: Record<string, number>, confidence = 0.9) => ({
	type: "choice" as const,
	choice: name,
	probabilities,
	confidence,
});

const finishedHandsOn: Record<string, Answer> = {
	done: choice("finished", { finished: 0.95, not_finished: 0.03, unclear: 0.02 }),
	shape: choice("hands_on", { hands_on: 0.9, coordinating: 0.08, unclear: 0.02 }),
};

const finishedCoordinating: Record<string, Answer> = {
	done: choice("finished", { finished: 0.98, not_finished: 0.01, unclear: 0.01 }),
	shape: choice("coordinating", { hands_on: 0.2, coordinating: 0.78, unclear: 0.02 }),
};

class FakeProvider implements SystemOneProvider {
	readonly name = "openrouter" as const;
	calls = 0;
	lastQuestions: Record<string, unknown> = {};
	constructor(private readonly result: Record<string, Answer> | Error) {}
	async evaluate(state: string, questions: Record<string, unknown>): Promise<Record<string, Answer>> {
		this.calls += 1;
		this.lastQuestions = questions;
		if (this.result instanceof Error) throw this.result;
		return this.result;
	}
}

describe("compact floor", () => {
	test("is strict while the window is mostly empty and unknown usage is strictest", () => {
		expect(compactFloor(0)).toBe(COMPACT_FLOOR_MAX);
		expect(compactFloor(0.05)).toBe(COMPACT_FLOOR_MAX);
		expect(compactFloor(0.1)).toBe(COMPACT_FLOOR_MAX);
		expect(compactFloor(Number.NaN)).toBe(COMPACT_FLOOR_MAX);
		expect(compactFloor(-1)).toBe(COMPACT_FLOOR_MAX);
	});

	test("relaxes linearly between the strict and loose anchors", () => {
		expect(compactFloor(0.5)).toBe(0.7);
		expect(compactFloor(0.9)).toBe(COMPACT_FLOOR_MIN);
		expect(compactFloor(1.5)).toBe(COMPACT_FLOOR_MIN);
	});
});

describe("compact score", () => {
	test("finished hands-on units score near 1, coordinating near 0.5, unfinished near 0", () => {
		expect(compactScore(finishedHandsOn.done as never, finishedHandsOn.shape as never)).toBeCloseTo(0.95 * 0.95, 3);
		expect(compactScore(finishedCoordinating.done as never, finishedCoordinating.shape as never)).toBeCloseTo(0.98 * 0.6, 3);
		expect(
			compactScore(
				choice("not_finished", { finished: 0.05, not_finished: 0.9, unclear: 0.05 }) as never,
				finishedHandsOn.shape as never,
			),
		).toBeCloseTo(0.0475, 3);
	});

	test("missing probability mass counts as zero, so an unusable answer cannot hint", () => {
		expect(compactScore(choice("finished", {}) as never, choice("hands_on", {}) as never)).toBe(0);
	});

	test("qualification is the score clearing the usage-dependent floor", () => {
		expect(compactQualifies(0.9, 0)).toBe(true);
		expect(compactQualifies(0.89, 0)).toBe(false);
		expect(compactQualifies(0.5, 0.9)).toBe(true);
		expect(compactQualifies(0.5, 0)).toBe(false);
	});
});

describe("compact kill switch", () => {
	test("accepts the upstream truthy spellings and nothing else", () => {
		expect(compactDisabled({ COMPACT_ADVISER_DISABLE: "1" })).toBe(true);
		expect(compactDisabled({ COMPACT_ADVISER_DISABLE: " TRUE " })).toBe(true);
		expect(compactDisabled({ COMPACT_ADVISER_DISABLE: "yes" })).toBe(true);
		expect(compactDisabled({ COMPACT_ADVISER_DISABLE: "on" })).toBe(true);
		expect(compactDisabled({ COMPACT_ADVISER_DISABLE: "0" })).toBe(false);
		expect(compactDisabled({})).toBe(false);
	});
});

describe("evaluateCompact", () => {
	test("hints a finished hands-on unit against the strict floor", async () => {
		const provider = new FakeProvider(finishedHandsOn);
		const verdict = await evaluateCompact({ state: { recent: [] }, usage: 0.2, tokens: 80_000, provider });
		expect(provider.calls).toBe(1);
		expect(verdict.enabled).toBe(true);
		expect(verdict.qualified).toBe(true);
		expect(verdict.hint).toBe(COMPACT_HINT);
		expect(verdict.reason).toBe("qualified");
		expect(verdict.floor).toBe(0.85);
		expect(Object.keys(provider.lastQuestions)).toEqual(["done", "shape"]);
	});

	test("keeps a finished coordinating unit below the strict floor but above the loose one", async () => {
		const strict = await evaluateCompact({ state: {}, usage: 0.05, tokens: 80_000, provider: new FakeProvider(finishedCoordinating) });
		expect(strict.qualified).toBe(false);
		expect(strict.reason).toBe("below-floor");
		expect(strict.hint).toBeNull();
		const loose = await evaluateCompact({ state: {}, usage: 0.95, tokens: 80_000, provider: new FakeProvider(finishedCoordinating) });
		expect(loose.qualified).toBe(true);
		expect(loose.floor).toBe(COMPACT_FLOOR_MIN);
	});

	test("fails open on provider errors without throwing or hinting", async () => {
		const verdict = await evaluateCompact({ state: {}, usage: 0.5, provider: new FakeProvider(new Error("503 upstream")) });
		expect(verdict.qualified).toBe(false);
		expect(verdict.hint).toBeNull();
		expect(verdict.reason).toBe("provider-error");
		expect(verdict.error).toContain("503");
	});

	test("treats non-choice answers as unusable instead of guessing", async () => {
		const verdict = await evaluateCompact({
			state: {},
			usage: 0.5,
			provider: new FakeProvider({ done: { type: "noul", probability: 0.9, confidence: 0.8 } }),
		});
		expect(verdict.reason).toBe("unusable-answers");
		expect(verdict.hint).toBeNull();
	});

	test("skips the call entirely below the minimum context and when disabled", async () => {
		const small = new FakeProvider(finishedHandsOn);
		const skipped = await evaluateCompact({ state: {}, usage: 0, tokens: COMPACT_MIN_CONTEXT_TOKENS - 1, provider: small });
		expect(skipped.reason).toBe("below-minimum");
		expect(small.calls).toBe(0);
		const disabled = new FakeProvider(finishedHandsOn);
		const off = await evaluateCompact({ state: {}, usage: 0.5, provider: disabled, disabled: true });
		expect(off.reason).toBe("disabled");
		expect(off.enabled).toBe(false);
		expect(disabled.calls).toBe(0);
	});

	test("refuses an oversized state without calling the provider", async () => {
		const provider = new FakeProvider(finishedHandsOn);
		const verdict = await evaluateCompact({ state: { blob: "x".repeat(33_000) }, usage: 0.5, provider });
		expect(verdict.reason).toBe("oversize");
		expect(provider.calls).toBe(0);
	});

	test("reports no-provider without a key instead of fabricating a judgment", async () => {
		const verdict = await evaluateCompact({ state: {}, usage: 0.5, provider: null });
		expect(verdict.enabled).toBe(false);
		expect(verdict.reason).toBe("no-provider");
		expect(verdict.score).toBeNull();
	});
});

describe("compact state builder", () => {
	test("redacts credential shapes before state leaves the machine", () => {
		const fakeKey = ["sk", "live", "51Abcdef1234567890abcdef123456"].join("_");
		expect(redactCompactText(`OPENROUTER_API_KEY=${fakeKey}`)).toBe("OPENROUTER_API_KEY=[REDACTED]");
		expect(redactCompactText(`token: ${fakeKey}`)).not.toContain(fakeKey);
		expect(redactCompactText("Bearer abcdefghijklmnop")).toBe("[REDACTED]");
	});

	test("keeps user constraints and the newest messages under the byte cap", () => {
		const messages: CompactMessage[] = [
			{ role: "user", text: "keep the change small" },
			{ role: "assistant", text: "a".repeat(1_500) },
			{ role: "toolResult", text: "x".repeat(4_000), tool: "terminal" },
			{ role: "assistant", text: "final answer" },
		];
		const { state, bytes, truncated } = buildCompactState(messages, { maxBytes: 2_000 });
		expect(state.userConstraints).toEqual([{ role: "user", text: "keep the change small" }]);
		expect(state.recent.at(-1)?.text).toBe("final answer");
		expect(state.coverage.omittedMessages).toBeGreaterThan(0);
		expect(truncated).toBe(true);
		expect(bytes).toBeLessThanOrEqual(2_000);
	});

	test("marks tool errors and keeps the summary", () => {
		const { state } = buildCompactState(
			[{ role: "toolResult", text: "boom", tool: "terminal", error: true }],
			{ previousSummary: "older work summarized" },
		);
		expect(state.recent[0]).toEqual({ role: "toolResult", text: "boom", tool: "terminal", error: true });
		expect(state.previousSummary).toBe("older work summarized");
		expect(state.coverage.redacted).toBe(false);
	});
});
