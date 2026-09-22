/**
 * Pure unit tests for extensions/image-budget/budget.ts. Run with
 * `bun test extensions/` — same contract as extensions/failover/decide.test.ts:
 * brain-only, no harness import, no ffmpeg.
 */
import { expect, test } from "bun:test";
import {
	DEFAULT_BUDGET_BYTES,
	DROPPED_IMAGE_TEXT,
	decodedBytes,
	enforceImageBudget,
	isImageContent,
} from "./budget.ts";

/** Base64 for an image payload of exactly `bytes` decoded bytes. */
function payload(bytes: number): string {
	return Buffer.alloc(bytes, 7).toString("base64");
}

function imagePart(bytes: number) {
	return { type: "image", data: payload(bytes), mimeType: "image/png" };
}

function toolResult(...content: unknown[]) {
	return { role: "toolResult", toolName: "read", content };
}

function userMessage(...content: unknown[]) {
	return { role: "user", content };
}

test("decodedBytes matches the base64 decode length for every remainder", () => {
	expect(decodedBytes("")).toBe(0);
	for (const bytes of [1, 2, 3, 4, 5, 1000, 1_000_001]) {
		expect(decodedBytes(payload(bytes))).toBe(bytes);
	}
});

test("isImageContent accepts inline images only", () => {
	expect(isImageContent(imagePart(3))).toBe(true);
	expect(isImageContent({ type: "text", text: "hi" })).toBe(false);
	expect(isImageContent({ type: "image" })).toBe(false);
	expect(isImageContent({ type: "image", source: { data: "x" } })).toBe(false);
	expect(isImageContent(null)).toBe(false);
	expect(isImageContent("image")).toBe(false);
});

test("enforceImageBudget leaves a conversation under budget untouched", () => {
	const messages = [userMessage({ type: "text", text: "go" }), toolResult(imagePart(1000))];
	const outcome = enforceImageBudget(messages, 10_000);
	expect(outcome.dropped).toBe(0);
	expect(outcome.bytesBefore).toBe(1000);
	expect(outcome.bytesAfter).toBe(1000);
	expect(outcome.kept).toBe(1);
	expect(messages[1].content[0]).toEqual(imagePart(1000));
});

test("enforceImageBudget drops oldest images first and keeps the newest", () => {
	const old = toolResult(imagePart(400), { type: "text", text: "old" });
	const middle = toolResult(imagePart(400));
	const recent = toolResult(imagePart(400));
	const messages = [old, middle, recent];

	const outcome = enforceImageBudget(messages, 500);

	expect(outcome.bytesBefore).toBe(1200);
	expect(outcome.bytesAfter).toBe(400);
	expect(outcome.dropped).toBe(2);
	expect(outcome.kept).toBe(1);
	expect(old.content[0]).toEqual({ type: "text", text: DROPPED_IMAGE_TEXT });
	expect(middle.content[0]).toEqual({ type: "text", text: DROPPED_IMAGE_TEXT });
	expect(recent.content[0]).toEqual(imagePart(400));
});

test("enforceImageBudget keeps surrounding text blocks and message shape", () => {
	const message = toolResult(
		{ type: "text", text: "Read image file [image/png]" },
		imagePart(800),
	);
	const outcome = enforceImageBudget([message], 100);

	expect(outcome.dropped).toBe(1);
	expect(outcome.bytesAfter).toBe(0);
	expect(message.content).toEqual([
		{ type: "text", text: "Read image file [image/png]" },
		{ type: "text", text: DROPPED_IMAGE_TEXT },
	]);
});

test("enforceImageBudget drops every image when the budget is zero", () => {
	const messages = [toolResult(imagePart(10)), userMessage(imagePart(20))];
	const outcome = enforceImageBudget(messages, 0);
	expect(outcome.dropped).toBe(2);
	expect(outcome.kept).toBe(0);
	expect(outcome.bytesAfter).toBe(0);
});

test("enforceImageBudget never exceeds the budget across many messages", () => {
	const budget = 2500;
	const messages = Array.from({ length: 40 }, () => toolResult(imagePart(300)));
	const before = messages.flatMap((m) => (m.content as unknown[]).length);

	const outcome = enforceImageBudget(messages, budget);

	expect(outcome.bytesBefore).toBe(12_000);
	expect(outcome.bytesAfter).toBeLessThanOrEqual(budget);
	expect(outcome.kept).toBe(8);
	const after = messages.flatMap((m) => (m.content as unknown[]).length);
	expect(after).toEqual(before); // every block replaced, none removed
});

test("enforceImageBudget ignores non-array content", () => {
	const messages = [{ role: "user", content: "plain text" }, { role: "bashExecution", output: "x" }];
	const outcome = enforceImageBudget(messages, 0);
	expect(outcome).toEqual({ bytesBefore: 0, bytesAfter: 0, dropped: 0, kept: 0 });
});

test("the default budget leaves headroom under OpenRouter's 30 MB ceiling", () => {
	expect(DEFAULT_BUDGET_BYTES).toBeLessThan(30 * 1024 * 1024);
	expect(DEFAULT_BUDGET_BYTES).toBeGreaterThanOrEqual(10 * 1024 * 1024);
});
