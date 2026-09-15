import { describe, expect, test } from "bun:test";
import { modelKey, runError, shouldFailover, summarize } from "./decide.ts";

describe("modelKey", () => {
	test("joins provider and id", () => {
		expect(modelKey({ provider: "cerebras", id: "qwen-3.8-27b" })).toBe(
			"cerebras/qwen-3.8-27b",
		);
	});
	test("accepts the modelId spelling", () => {
		expect(modelKey({ provider: "openrouter", modelId: "inception/mercury-2.5" })).toBe(
			"openrouter/inception/mercury-2.5",
		);
	});
	test("prefers id over modelId when both are present", () => {
		expect(modelKey({ provider: "p", id: "a", modelId: "b" })).toBe("p/a");
	});
	test("returns empty string when the model cannot be named", () => {
		expect(modelKey(undefined)).toBe("");
		expect(modelKey(null)).toBe("");
		expect(modelKey({})).toBe("");
		expect(modelKey({ provider: "p" })).toBe("");
	});
});

describe("runError", () => {
	const assistant = (errorMessage?: string) => ({
		role: "assistant",
		...(errorMessage === undefined ? {} : { errorMessage }),
	});

	test("absent or non-array messages settle cleanly", () => {
		expect(runError(undefined)).toBeUndefined();
		expect(runError(null)).toBeUndefined();
		expect(runError("nope")).toBeUndefined();
		expect(runError([])).toBeUndefined();
	});
	test("a clean run has no error even after a failed tool", () => {
		expect(
			runError([
				{ role: "toolResult", toolName: "bash", isError: true },
				assistant(),
			]),
		).toBeUndefined();
	});
	test("returns the last assistant message's error", () => {
		expect(
			runError([
				assistant("402 status code (no body)"),
				{ role: "toolResult", toolName: "bash" },
				assistant("boom"),
			]),
		).toBe("boom");
	});
	test("an errored assistant that did not end the run does not count", () => {
		expect(runError([assistant("first dead"), assistant("")])).toBeUndefined();
	});
	test("a whitespace-only error settles cleanly", () => {
		expect(runError([assistant("   ")])).toBeUndefined();
	});
	test("a non-string errorMessage settles cleanly", () => {
		expect(runError([{ role: "assistant", errorMessage: 429 }])).toBeUndefined();
	});
});

describe("shouldFailover", () => {
	const primary = "cerebras/qwen-3.8-27b";

	test("switches when the primary run died and we have not switched yet", () => {
		expect(
			shouldFailover({ hadError: true, alreadyFailedOver: false }, primary, primary),
		).toBe(true);
	});
	test("clean runs never switch", () => {
		expect(
			shouldFailover({ hadError: false, alreadyFailedOver: false }, primary, primary),
		).toBe(false);
	});
	test("a user-chosen model is never yanked", () => {
		expect(
			shouldFailover(
				{ hadError: true, alreadyFailedOver: false },
				"openrouter/other-model",
				primary,
			),
		).toBe(false);
	});
	test("an unknown current model never switches", () => {
		expect(
			shouldFailover({ hadError: true, alreadyFailedOver: false }, "", primary),
		).toBe(false);
	});
	test("never switches twice (no flapping)", () => {
		expect(
			shouldFailover({ hadError: true, alreadyFailedOver: true }, primary, primary),
		).toBe(false);
	});
});

describe("summarize", () => {
	test("collapses whitespace and trims", () => {
		expect(summarize("  402\nstatus code\n(no body)  ")).toBe(
			"402 status code (no body)",
		);
	});
	test("short messages pass through", () => {
		expect(summarize("boom", 40)).toBe("boom");
	});
	test("clamps long messages with an ellipsis", () => {
		const s = summarize("a".repeat(500), 100);
		expect(s.length).toBe(100);
		expect(s.endsWith("…")).toBe(true);
	});
});