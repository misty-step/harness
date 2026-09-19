import { describe, expect, test } from "bun:test";
import { autoOptedIn, DEFAULT_COOLDOWN_MS, DEFAULT_MIN_CONTEXT_TOKENS, gate, hintLine, statusLine } from "./decide.ts";

const base = {
	mode: "tui" as const,
	disabled: false,
	autoOptIn: false,
	tokens: 100_000,
	contextWindow: 200_000,
	lastJudgeMs: null,
	nowMs: 1_000_000,
};

describe("compact-hint gate", () => {
	test("judges a settled interactive turn and reports the usage fraction", () => {
		const decision = gate(base);
		expect(decision).toEqual({ action: "judge", auto: false, usage: 0.5 });
	});

	test("allows auto only with the explicit opt-in in a fully interactive session", () => {
		expect(gate({ ...base, autoOptIn: true })).toEqual({ action: "judge", auto: true, usage: 0.5 });
		expect(gate({ ...base, mode: "rpc", autoOptIn: true })).toEqual({ action: "judge", auto: false, usage: 0.5 });
	});

	test("stays inert when disabled, unattended, unknown, small, or cooling down", () => {
		expect(gate({ ...base, disabled: true })).toEqual({ action: "skip", reason: "disabled" });
		expect(gate({ ...base, mode: "print" })).toEqual({ action: "skip", reason: "unattended" });
		expect(gate({ ...base, mode: "json" })).toEqual({ action: "skip", reason: "unattended" });
		expect(gate({ ...base, tokens: null })).toEqual({ action: "skip", reason: "unknown-usage" });
		expect(gate({ ...base, contextWindow: 0 })).toEqual({ action: "skip", reason: "unknown-usage" });
		expect(gate({ ...base, tokens: DEFAULT_MIN_CONTEXT_TOKENS - 1 })).toEqual({ action: "skip", reason: "below-minimum" });
		expect(gate({ ...base, lastJudgeMs: base.nowMs - (DEFAULT_COOLDOWN_MS - 1) })).toEqual({ action: "skip", reason: "cooldown" });
		expect(gate({ ...base, lastJudgeMs: base.nowMs - DEFAULT_COOLDOWN_MS })).toEqual({ action: "judge", auto: false, usage: 0.5 });
	});

	test("the kill switch wins over every other input", () => {
		expect(gate({ ...base, disabled: true, autoOptIn: true, lastJudgeMs: null })).toEqual({ action: "skip", reason: "disabled" });
	});
});

describe("compact-hint opt-in", () => {
	test("accepts truthy spellings only", () => {
		expect(autoOptedIn({ PI_COMPACT_HINT_AUTO: "1" })).toBe(true);
		expect(autoOptedIn({ PI_COMPACT_HINT_AUTO: " On " })).toBe(true);
		expect(autoOptedIn({ PI_COMPACT_HINT_AUTO: "true" })).toBe(true);
		expect(autoOptedIn({ PI_COMPACT_HINT_AUTO: "yes" })).toBe(true);
		expect(autoOptedIn({ PI_COMPACT_HINT_AUTO: "0" })).toBe(false);
		expect(autoOptedIn({})).toBe(false);
	});
});

describe("compact-hint lines", () => {
	test("the hint names the action and the context load", () => {
		expect(hintLine(62.4, false)).toBe("compact-hint: work appears completed or recorded — run /compact to save tokens (62% context used).");
		expect(hintLine(null, true)).toBe("compact-hint: work appears completed or recorded — compacting automatically.");
	});

	test("the status line reports mode, context, and the last judgment", () => {
		expect(statusLine({ mode: "tui", disabled: false, autoOptIn: false, tokens: 50_000, contextWindow: 200_000, lastVerdict: null })).toBe(
			"compact-hint: mode=hint (tui), 50000/200000 tokens, no judgment yet",
		);
		expect(statusLine({ mode: "tui", disabled: false, autoOptIn: true, tokens: null, contextWindow: null, lastVerdict: "below-floor" })).toBe(
			"compact-hint: mode=auto (tui), context unknown, last: below-floor",
		);
		expect(statusLine({ mode: "print", disabled: true, autoOptIn: false, tokens: 1, contextWindow: 2, lastVerdict: "qualified" })).toBe(
			"compact-hint: mode=off (print), 1/2 tokens, last: qualified",
		);
	});
});
