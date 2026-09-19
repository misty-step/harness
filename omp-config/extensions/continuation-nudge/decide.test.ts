import { describe, expect, test } from "bun:test";
import {
	MARKER_TYPE,
	STATE_MAX_CHARS,
	analyzeSession,
	buildState,
	contentText,
	decideFromAnswer,
	evaluateGuards,
	serializeState,
	type BranchEntry,
} from "./decide.ts";

function user(text: string): BranchEntry {
	return { type: "message", message: { role: "user", content: text } };
}

function assistant(text: string, stopReason = "stop"): BranchEntry {
	return { type: "message", message: { role: "assistant", content: [{ type: "text", text }], stopReason } };
}

function tool(name: string, text: string, isError = false): BranchEntry {
	return { type: "message", message: { role: "toolResult", toolName: name, content: [{ type: "text", text }], isError } };
}

function marker(attempt: number): BranchEntry {
	return { type: "custom", customType: MARKER_TYPE, data: { attempt, ts: "2026-01-01T00:00:00.000Z", version: "continuation-v1" } };
}

describe("contentText", () => {
	test("joins text parts and ignores non-text", () => {
		expect(contentText("hello")).toBe("hello");
		expect(contentText([{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }])).toBe("a\nb");
		expect(contentText(undefined)).toBe("");
	});
});

describe("analyzeSession", () => {
	test("keeps the original and the latest user request", () => {
		const analysis = analyzeSession([
			user("first request"),
			assistant("working"),
			user("latest request"),
			assistant("done"),
		]);
		expect(analysis.firstUserText).toBe("first request");
		expect(analysis.userText).toBe("latest request");
		expect(analysis.assistantText).toBe("done");
		expect(analysis.stopReason).toBe("stop");
	});

	test("span markers and tools reset at the latest user prompt", () => {
		const analysis = analyzeSession([
			user("old request"),
			assistant("old answer"),
			marker(1),
			tool("read", "old tool"),
			user("new request"),
			assistant("new answer"),
			marker(2),
			tool("edit", "new tool"),
		]);
		expect(analysis.markers.map((m) => m.attempt)).toEqual([2]);
		expect(analysis.toolResults.map((t) => t.tool)).toEqual(["edit"]);
		expect(analysis.attempt).toBe(2);
		expect(analysis.previous?.attempt).toBe(2);
	});

	test("toolsSincePrevious only counts tools after the last marker", () => {
		const analysis = analyzeSession([
			user("request"),
			tool("read", "before marker"),
			assistant("answer"),
			marker(1),
			tool("edit", "after marker"),
			tool("bash", "also after"),
		]);
		expect(analysis.toolsSincePrevious.map((t) => t.tool)).toEqual(["edit", "bash"]);
	});

	test("with no marker, every span tool is progress since (none)", () => {
		const analysis = analyzeSession([user("request"), tool("read", "a"), assistant("answer")]);
		expect(analysis.previous).toBeNull();
		expect(analysis.toolsSincePrevious.map((t) => t.tool)).toEqual(["read"]);
		expect(analysis.attempt).toBe(1);
	});
});

describe("evaluateGuards", () => {
	const base = analyzeSession([user("request"), assistant("answer")]);
	const open = {
		mode: "on" as const,
		isIdle: true,
		hasPendingMessages: false,
		analysis: base,
		maxNudges: 2,
	};

	test("passes when every condition holds", () => {
		expect(evaluateGuards(open)).toEqual({ proceed: true });
	});

	test("names each skip reason", () => {
		expect(evaluateGuards({ ...open, mode: "off" }).reason).toBe("mode-off");
		expect(evaluateGuards({ ...open, isIdle: false }).reason).toBe("not-idle");
		expect(evaluateGuards({ ...open, hasPendingMessages: true }).reason).toBe("pending-messages");
		expect(
			evaluateGuards({ ...open, analysis: analyzeSession([assistant("answer")]) }).reason,
		).toBe("no-user-request");
		expect(
			evaluateGuards({ ...open, analysis: analyzeSession([user("request")]) }).reason,
		).toBe("no-terminal-answer");
		expect(
			evaluateGuards({ ...open, analysis: analyzeSession([user("request"), assistant("a", "aborted")]) }).reason,
		).toBe("stop-reason-aborted");
		expect(
			evaluateGuards({ ...open, analysis: analyzeSession([user("request"), assistant("a", "error")]) }).reason,
		).toBe("stop-reason-error");
		expect(evaluateGuards({ ...open, maxNudges: 0 }).reason).toBe("max-nudges");
	});

	test("suppresses a repeat nudge with zero progress since the marker", () => {
		const analysis = analyzeSession([user("request"), assistant("answer"), marker(1)]);
		expect(evaluateGuards({ ...open, analysis }).reason).toBe("no-progress-since-nudge");
	});

	test("allows a second nudge once a tool result followed the marker", () => {
		const analysis = analyzeSession([user("request"), assistant("answer"), marker(1), tool("edit", "done")]);
		expect(evaluateGuards({ ...open, analysis })).toEqual({ proceed: true });
	});

	test("treats a settled OMP event as idle evidence", () => {
		expect(evaluateGuards({ ...open, isIdle: false, settledEvent: true })).toEqual({ proceed: true });
	});

	test("bounds at max markers even with progress", () => {
		const analysis = analyzeSession([
			user("request"),
			assistant("answer"),
			marker(1),
			tool("edit", "done"),
			marker(2),
			tool("edit", "done again"),
		]);
		expect(analysis.markers).toHaveLength(2);
		expect(evaluateGuards({ ...open, analysis }).reason).toBe("max-nudges");
	});
});

describe("buildState and serializeState", () => {
	test("preserves original and latest request plus recent tools", () => {
		const analysis = analyzeSession([
			user("original memo request"),
			assistant("intent"),
			user("carry it forward"),
			assistant("still working"),
			tool("read", "src/app.ts"),
			tool("edit", "NOTES.md"),
		]);
		const state = buildState({ version: "continuation-v1", attempt: 1, analysis });
		const check = state.continuation_check;
		expect(check.user_request_preview).toBe("original: original memo request\nlatest: carry it forward");
		expect(check.final_response_preview).toBe("still working");
		expect(check.recent_tools).toEqual([
			{ tool: "read", preview: "src/app.ts" },
			{ tool: "edit", preview: "NOTES.md" },
		]);
		expect(check.previous_nudge).toBeNull();
		expect(check.attempt).toBe(1);
	});

	test("caps recent tools at six and previews at their clip", () => {
		const entries: BranchEntry[] = [user("request")];
		for (let i = 0; i < 8; i += 1) entries.push(tool(`tool${i}`, `preview ${i} `.repeat(40)));
		entries.push(assistant("answer"));
		const state = buildState({ version: "continuation-v1", attempt: 1, analysis: analyzeSession(entries) });
		expect(state.continuation_check.recent_tools).toHaveLength(6);
		for (const entry of state.continuation_check.recent_tools) {
			expect(entry.preview.length).toBeLessThanOrEqual(120);
		}
	});

	test("redacts secrets before serializing", () => {
		const analysis = analyzeSession([
			user("request sk-abcdefghijklmnop"),
			tool("bash", "curl -H 'Authorization: Bearer abcdefgh12345678'"),
			assistant("key was sk-abcdefghijklmnop and AKIAIOSFODNN7EXAMPLE2"),
		]);
		const serialized = serializeState(buildState({ version: "continuation-v1", attempt: 1, analysis }));
		expect(serialized).not.toContain("sk-abcdefghijklmnop");
		expect(serialized).not.toContain("abcdefgh12345678");
		expect(serialized).not.toContain("AKIAIOSFODNN7EXAMPLE2");
		expect(serialized).toContain("[REDACTED]");
	});

	test("serialized state stays valid JSON under the character cap", () => {
		const analysis = analyzeSession([
			user("request ".repeat(200)),
			tool("bash", "tool output ".repeat(300)),
			assistant("response ".repeat(400)),
		]);
		const serialized = serializeState(buildState({ version: "continuation-v1", attempt: 3, analysis }));
		expect(serialized).not.toBeNull();
		expect((serialized as string).length).toBeLessThanOrEqual(STATE_MAX_CHARS);
		const parsed = JSON.parse(serialized as string) as { continuation_check: { attempt: number } };
		expect(parsed.continuation_check.attempt).toBe(3);
	});

	test("fails closed when even the cleared skeleton cannot fit the cap", () => {
		const analysis = analyzeSession([user("request"), assistant("response")]);
		const state = buildState({ version: "continuation-v1", attempt: 1, analysis });
		expect(serializeState(state, 10)).toBeNull();
	});

	test("records prior-nudge progress when present", () => {
		const analysis = analyzeSession([user("request"), assistant("answer"), marker(1), tool("edit", "done")]);
		const state = buildState({ version: "continuation-v1", attempt: 2, analysis });
		expect(state.continuation_check.previous_nudge).toEqual({ attempt: 1, tools_since: ["edit"], new_tools: 1 });
	});
});

describe("decideFromAnswer", () => {
	test("delegates the shape rules to the shared decider", () => {
		expect(decideFromAnswer({ choice: "nudge", confidence: 0.9 }, 0.5)).toEqual({ nudge: true, reason: "nudge" });
		expect(decideFromAnswer({ choice: "nudge", confidence: 0.4 }, 0.5).nudge).toBe(false);
		expect(decideFromAnswer(undefined, 0.5).nudge).toBe(false);
	});
});