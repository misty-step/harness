/**
 * Pure unit tests for extensions/failover/decide.ts. Run with
 * `bun test extensions/` — same contract as extensions/loc/loc.test.ts:
 * brain-only, no harness import.
 */
import { expect, test } from "bun:test";
import { modelKey, nextInChain, runError, summarize } from "./decide.ts";

const CHAIN = [
	"cerebras/qwen-3.8-27b",
	"openrouter/deepseek/deepseek-v4.1-flash",
	"openrouter/inception/mercury-2.5",
];

test("modelKey joins provider and modelId", () => {
	expect(modelKey({ provider: "cerebras", id: "qwen-3.8-27b" })).toBe(
		"cerebras/qwen-3.8-27b",
	);
});

test("modelKey falls back to modelId", () => {
	expect(modelKey({ provider: "cerebras", modelId: "qwen-3.8-27b" })).toBe(
		"cerebras/qwen-3.8-27b",
	);
});

test("modelKey is empty without a full identity", () => {
	expect(modelKey(null)).toBe("");
	expect(modelKey(undefined)).toBe("");
	expect(modelKey({})).toBe("");
	expect(modelKey({ provider: "cerebras" })).toBe("");
	expect(modelKey({ id: "qwen-3.8-27b" })).toBe("");
});

test("runError surfaces the last assistant message's errorMessage", () => {
	const messages = [
		{ role: "assistant", content: [] },
		{ role: "user", content: [] },
		{ role: "assistant", content: [], errorMessage: "429 ... out of stock" },
	];
	expect(runError(messages)).toBe("429 ... out of stock");
});

test("runError is undefined when the last assistant message is clean", () => {
	const messages = [
		{ role: "assistant", content: [], errorMessage: "429" },
		{ role: "assistant", content: [] },
	];
	expect(runError(messages)).toBeUndefined();
});

test("runError ignores aborts, tool errors, and non-array input", () => {
	const messages = [
		{ role: "user", content: [] },
		{ role: "toolResult", status: "error" },
		{ role: "assistant", content: [], stopReason: "aborted" },
	];
	expect(runError(messages)).toBeUndefined();
	expect(runError(null)).toBeUndefined();
	expect(runError("nope")).toBeUndefined();
	expect(runError([])).toBeUndefined();
});

test("chain: a run that dies on a link advances to the next link", () => {
	expect(nextInChain(CHAIN, CHAIN[0])).toEqual({
		action: "advance",
		key: "openrouter/deepseek/deepseek-v4.1-flash",
		link: 1,
	});
	expect(nextInChain(CHAIN, CHAIN[1])).toEqual({
		action: "advance",
		key: "openrouter/inception/mercury-2.5",
		link: 2,
	});
});

test("chain: a run that dies on the last link exhausts the chain", () => {
	expect(nextInChain(CHAIN, CHAIN[2])).toEqual({ action: "exhausted" });
});

test("chain: a longer chain walks link by link to exhaustion", () => {
	const four = [...CHAIN, "openai/gpt-5.5"];
	expect(nextInChain(four, four[2])).toEqual({
		action: "advance",
		key: "openai/gpt-5.5",
		link: 3,
	});
	expect(nextInChain(four, four[3])).toEqual({ action: "exhausted" });
});

test("chain: never fires for a model the user chose outside the chain", () => {
	expect(nextInChain(CHAIN, "openai/gpt-5.5")).toBeNull();
	expect(nextInChain(CHAIN, "")).toBeNull();
});

test("chain: keyed to the current model, so it cannot drift", () => {
	// After an exhaustion the user explicitly re-selects the primary: the
	// walk resumes from that link (forward from where the user put it).
	expect(nextInChain(CHAIN, CHAIN[0])).toEqual({
		action: "advance",
		key: CHAIN[1],
		link: 1,
	});
	// A manual jump straight to the tail also exhausts on the next failure.
	expect(nextInChain(CHAIN, CHAIN[2])).toEqual({ action: "exhausted" });
});

test("summarize clamps to one short line", () => {
	const raw =
		"line one\n\n" +
		"the provider is overloaded, rate limited, please retry shortly ".repeat(4);
	const out = summarize(raw);
	expect(out.includes("\n")).toBe(false);
	expect(out.length).toBeLessThanOrEqual(140);
	expect(out.endsWith("…")).toBe(true);
});

test("summarize leaves short messages untouched", () => {
	expect(summarize("429 ... out of stock")).toBe("429 ... out of stock");
});