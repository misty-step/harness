/**
 * Pure unit tests for extensions/failover/decide.ts. Run with
 * `bun test extensions/` — same contract as extensions/loc/loc.test.ts:
 * brain-only, no harness import.
 */
import { expect, test } from "bun:test";
import { modelKey, nextInChain, runError, summarize } from "./decide.ts";

const CHAIN = ["cerebras/qwen-3.8-27b", "openrouter/inception/mercury-2.5"];

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
	expect(nextInChain(CHAIN, 0, CHAIN[0])).toEqual({
		action: "advance",
		key: "openrouter/inception/mercury-2.5",
		position: 1,
	});
});

test("chain: a run that dies on the last link exhausts the chain", () => {
	expect(nextInChain(CHAIN, 1, CHAIN[1])).toEqual({ action: "exhausted" });
});

test("chain: a longer chain walks link by link to exhaustion", () => {
	const three = [...CHAIN, "openai/gpt-5.5"];
	expect(nextInChain(three, 0, three[0])).toEqual({
		action: "advance",
		key: CHAIN[1],
		position: 1,
	});
	expect(nextInChain(three, 1, three[1])).toEqual({
		action: "advance",
		key: "openai/gpt-5.5",
		position: 2,
	});
	expect(nextInChain(three, 2, three[2])).toEqual({ action: "exhausted" });
});

test("chain: never fires for a model the user chose outside the chain", () => {
	expect(nextInChain(CHAIN, 0, "openai/gpt-5.5")).toBeNull();
	// Drifted position: the run is on the primary while the walk thinks it is
	// past it — staying put is the safe thing.
	expect(nextInChain(CHAIN, 1, "cerebras/qwen-3.8-27b")).toBeNull();
});

test("chain: never fires for an unnameable model or drifted position", () => {
	expect(nextInChain(CHAIN, 0, "")).toBeNull();
	expect(nextInChain(CHAIN, 2, "x/y")).toBeNull();
	expect(nextInChain(CHAIN, -1, "x/y")).toBeNull();
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