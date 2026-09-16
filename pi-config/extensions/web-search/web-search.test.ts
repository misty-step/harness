import { describe, expect, test } from "bun:test";
import { formatResults, SNIPPET_CHARS, type ExaResult } from "./format.ts";

function result(overrides: Partial<ExaResult> & { url: string }): ExaResult {
	return { title: undefined, ...overrides } as ExaResult;
}

describe("formatResults", () => {
	test("renders rank, title, url, and date per result", () => {
		const out = formatResults(
			[
				result({
					url: "https://example.com/a",
					title: "First",
					publishedDate: "2026-08-01T12:00:00.000Z",
					highlights: ["hello world"],
				}),
			],
			false,
		);
		expect(out).toBe("1. First (2026-08-01)\n   https://example.com/a\n   hello world");
	});

	test("multiple results are separated by one blank line", () => {
		const out = formatResults(
			[result({ url: "https://a.x", title: "A" }), result({ url: "https://b.x", title: "B" })],
			false,
		);
		expect(out).toBe("1. A\n   https://a.x\n\n2. B\n   https://b.x");
	});

	test("falls back to url as title when title is missing", () => {
		const out = formatResults([result({ url: "https://bare.x" })], false);
		expect(out).toBe("1. https://bare.x\n   https://bare.x");
	});

	test("joins highlights and clamps snippet to 300 chars", () => {
		const long = "x".repeat(500);
		const out = formatResults([result({ url: "https://a.x", highlights: [long, long] })], false);
		const snippetLine = out.split("\n")[2];
		expect(snippetLine).toContain("…");
		expect(snippetLine.length).toBeLessThanOrEqual(3 + SNIPPET_CHARS + 1);
	});

	test("falls back to text when no highlights are present", () => {
		const out = formatResults([result({ url: "https://a.x", text: "body copy" })], false);
		expect(out).toContain("body copy");
	});

	test("full_text mode uses page text, clamped per page", () => {
		const longText = "y".repeat(5000);
		const out = formatResults([result({ url: "https://a.x", text: longText, highlights: ["nope"] })], true);
		expect(out).not.toContain("nope");
		expect(out).toContain("…");
	});

	test("full_text mode ignores text when empty and uses highlights", () => {
		const out = formatResults([result({ url: "https://a.x", text: "  ", highlights: ["hl"] })], true);
		expect(out).toContain("hl");
	});

	test("total output is capped for many full-text results", () => {
		const many = Array.from({ length: 10 }, (_, i) =>
			result({ url: `https://a${i}.x`, title: `T${i}`, text: "z".repeat(4000) }),
		);
		const out = formatResults(many, true);
		expect(out).toContain("… (output truncated)");
		expect(out.length).toBeLessThan(12000 + 50);
	});

	test("empty input renders empty string", () => {
		expect(formatResults([], false)).toBe("");
	});
});