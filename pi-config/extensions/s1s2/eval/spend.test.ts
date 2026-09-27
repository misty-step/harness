import { expect, test } from "bun:test";
import { pricedBound, worstCallUsd } from "./spend.ts";

test("Jev reserves provider context even when its submitted JSON is tiny", () => {
	const bound = pricedBound("typesafe/jev-1.13", [{
		context_length: 32_000,
		pricing: { prompt: "0.000000042", completion: "0" },
	}]);
	// The observed 214-byte Jev request was billed above its old $0.000008988 reserve.
	expect(worstCallUsd(bound, 214, true)).toBeCloseTo(0.001344, 9);
	expect(worstCallUsd(bound, 214, true)).toBeGreaterThan(0.000012);
	// Larger requests still increase the reservation instead of truncating at context size.
	expect(worstCallUsd(bound, 40_000, true)).toBeCloseTo(0.00168, 9);
});

test("model calls reserve their payload and maximum completion at the dearest override", () => {
	const bound = pricedBound("sample/model", [{
		tag: "pinned-provider",
		context_length: 8192,
		max_completion_tokens: 1000,
		pricing: { prompt: "0.000001", completion: "0.000002", overrides: [
			{ prompt: "0.000003", completion: "0.000004", request: "0.0001" },
		] },
	}], "pinned-provider");
	expect(worstCallUsd(bound, 214, false)).toBeCloseTo(0.004742, 9);
	expect(() => pricedBound("sample/model", [{ tag: "other", context_length: 8192 }], "pinned-provider")).toThrow("cannot bound the cost");
});
