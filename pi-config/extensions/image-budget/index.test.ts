/**
 * Wiring tests for extensions/image-budget/index.ts. Run with
 * `bun test extensions/`. The budget is injected so these tests never build a
 * 15 MB payload, and only small images reach the compressor (no ffmpeg).
 */
import { expect, test } from "bun:test";
import { registerImageBudget } from "./index.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;

function payload(bytes: number): string {
	return Buffer.alloc(bytes, 7).toString("base64");
}

function harness(budgetBytes: number) {
	const handlers = new Map<string, Handler>();
	const statuses: Array<[string, string | undefined]> = [];
	const notifications: Array<{ message: string; level: string }> = [];
	const pi = {
		on(event: string, handler: Handler) {
			handlers.set(event, handler);
		},
	} as never;
	const ctx = {
		ui: {
			setStatus(key: string, value: string | undefined) {
				statuses.push([key, value]);
			},
			notify(message: string, level: string) {
				notifications.push({ message, level });
			},
		},
	};
	registerImageBudget(pi, budgetBytes);
	return { handlers, statuses, notifications, ctx };
}

function conversation(imageBytes: number[]) {
	return imageBytes.map((bytes, index) => ({
		role: "toolResult",
		toolName: "read",
		toolCallId: String(index),
		content: [
			{ type: "text", text: "Read image file [image/png]" },
			{ type: "image", data: payload(bytes), mimeType: "image/png" },
		],
	}));
}

test("context drops the oldest images over budget and announces once", async () => {
	const { handlers, statuses, notifications, ctx } = harness(500);
	const handler = handlers.get("context")!;

	const first = conversation([400, 400, 400]);
	const result = (await handler({ messages: first }, ctx)) as { messages: unknown[] };
	expect(result.messages).toBe(first);
	expect((first[0].content[1] as { text: string }).text).toContain("omitted");
	expect((first[1].content[1] as { text: string }).text).toContain("omitted");
	expect(first[2].content[1]).toMatchObject({ type: "image" });
	expect(statuses.at(-1)).toEqual(["image-budget", "img-budget 2 dropped"]);
	expect(notifications).toHaveLength(1);
	expect(notifications[0].level).toBe("warning");

	// A later request with the same history re-drops the same images; no repeat noise.
	await handler({ messages: conversation([400, 400, 400]) }, ctx);
	expect(notifications).toHaveLength(1);
});

test("context announces again when the drop count grows", async () => {
	const { handlers, notifications, ctx } = harness(500);
	const handler = handlers.get("context")!;
	await handler({ messages: conversation([400, 400, 400]) }, ctx);
	await handler({ messages: conversation([400, 400, 400, 400]) }, ctx);
	expect(notifications.map((n) => n.message)).toHaveLength(2);
});

test("context leaves a conversation under budget alone and clears the status", async () => {
	const { handlers, statuses, notifications, ctx } = harness(500);
	const handler = handlers.get("context")!;

	const messages = conversation([100, 100]);
	const result = await handler({ messages }, ctx);

	expect(result).toBeUndefined();
	expect(statuses.at(-1)).toEqual(["image-budget", undefined]);
	expect(notifications).toHaveLength(0);
	expect(messages[0].content[1]).toMatchObject({ type: "image" });
});

test("tool_result leaves a small image untouched", async () => {
	const { handlers, ctx } = harness(1024);
	const handler = handlers.get("tool_result")!;
	const content = [{ type: "text", text: "Read image file [image/png]" }, { type: "image", data: payload(1000) }];
	expect(await handler({ toolName: "read", content }, ctx)).toBeUndefined();
});

test("tool_result ignores results without images", async () => {
	const { handlers, ctx } = harness(1024);
	const handler = handlers.get("tool_result")!;
	expect(await handler({ toolName: "bash", content: [{ type: "text", text: "ok" }] }, ctx)).toBeUndefined();
	expect(await handler({ toolName: "bash", content: "plain string" }, ctx)).toBeUndefined();
});
