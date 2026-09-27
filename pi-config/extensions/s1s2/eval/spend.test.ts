import { expect, test } from "bun:test";
import { pricedBound, worstCallUsd } from "./spend.ts";

const listing = (...endpoints: unknown[]) => ({ data: { endpoints } });

test("Jev reserves provider context even when its submitted JSON is tiny", () => {
	const bound = pricedBound("typesafe/jev-1.13", listing({ context_length: 32_000, pricing: { prompt: "0.000000042", completion: "0" } }));
	// A real 214-byte Jev call billed 294 input tokens at this rate; reserving by bytes alone gave $0.000008988.
	expect(worstCallUsd(bound, 214, true)).toBeGreaterThanOrEqual(294 * 0.000000042);
	expect(worstCallUsd(bound, 214, true)).toBeCloseTo(0.001344, 9);
	// Larger requests still increase the reservation instead of truncating at context size.
	expect(worstCallUsd(bound, 40_000, true)).toBeCloseTo(0.00168, 9);
});

test("model calls reserve each token kind at its dearest listed rate and the full completion ceiling", () => {
	const bound = pricedBound("sample/model", listing({
		tag: "pinned-provider",
		context_length: 8192,
		max_completion_tokens: 1000,
		// Input can bill at the cache-write rate; output at the dearest time window.
		pricing: { prompt: "0.000001", completion: "0.000002", input_cache_write: "0.000005", overrides: [
			{ prompt: "0.000003", completion: "0.000004", request: "0.0001" },
		] },
	}), "pinned-provider");
	expect(worstCallUsd(bound, 214, false)).toBeCloseTo(0.00517, 9);
	expect(() => pricedBound("sample/model", listing({ tag: "other", context_length: 8192 }), "pinned-provider")).toThrow("cannot bound the cost");
});

test("a malformed or incomplete listing stops pricing instead of counting what is missing as free", () => {
	const cheap = { tag: "pinned-provider", context_length: 8192, pricing: { prompt: "0.000001", completion: "0.000002" } };
	// Pricing only the cheap endpoint would under-reserve every call routed to the dearer one.
	expect(() => pricedBound("sample/model", listing(cheap, { ...cheap, max_completion_tokens: "131072" }), "pinned-provider")).toThrow("no valid endpoint list");
	expect(() => pricedBound("sample/model", listing(cheap, { ...cheap, pricing: { prompt: "0.000009", completion: "N/A" } }), "pinned-provider")).toThrow("unreadable price");
	// An omitted base rate, or an endpoint without a size, would reserve that part as zero.
	expect(() => pricedBound("sample/model", listing({ ...cheap, pricing: { prompt: "0.000001" } }), "pinned-provider")).toThrow("base prompt and completion");
	expect(() => pricedBound("sample/model", listing(cheap, { tag: "pinned-provider", max_completion_tokens: null, pricing: { prompt: "0.000009", completion: "0.000009" } }), "pinned-provider")).toThrow("no context length");
});
