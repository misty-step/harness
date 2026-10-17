import { expect, test } from "bun:test";
import register, { redact } from "./index.ts";

// TruffleHog's documented fake OpenAI key, split so this file never matches a scanner.
const FAKE = "sk-SDAPGGZUyVr7SYJpSODg" + "T3Blbk" + "FJ" + "M1fIItFASvyIsaCKUs19";

function handler() {
	const handlers = new Map<string, (event: unknown) => unknown>();
	register({ on: (name: string, fn: (event: unknown) => unknown) => handlers.set(name, fn) } as never);
	return handlers.get("tool_result")!;
}

test("a fake sk- key in a tool result is redacted in what OMP stores", () => {
	const event = {
		type: "tool_result",
		toolName: "read",
		toolCallId: "call-1",
		input: { path: "fixture.env" },
		isError: false,
		content: [{ type: "text", text: `OPENAI_API_KEY=${FAKE}\nPORT=8080\n` }, { type: "image", data: "AAAA", mimeType: "image/png" }],
		details: { output: `export OPENAI_API_KEY=${FAKE}`, lines: [1, 2] },
	};
	const result = handler()(event) as { content: unknown; details: unknown };
	const stored = JSON.stringify(result);
	expect(stored).not.toContain(FAKE);
	expect(stored).toContain("OPENAI_API_KEY=[REDACTED:sk]\\nPORT=8080");
	expect(result.content).toContainEqual(event.content[1]);
	expect(result.details).toEqual({ output: "export OPENAI_API_KEY=[REDACTED:sk]", lines: [1, 2] });
});

test("clean tool results pass through untouched", () => {
	const event = { type: "tool_result", toolName: "bash", toolCallId: "c", input: {}, isError: false,
		content: [{ type: "text", text: "sk-short and skill-name are fine" }], details: undefined };
	expect(handler()(event)).toBeUndefined();
	expect(redact("ghp_" + "a".repeat(36))).toBe("[REDACTED:github]");
});
