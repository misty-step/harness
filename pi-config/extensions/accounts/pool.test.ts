import { expect, test } from "bun:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AssistantMessageEvent, AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { blockedUntil, pickMember, rotate, type PoolState, type PoolStore } from "./pool.ts";

const NOW = 1_000_000;

/** Minimal stand-in for pi-ai's event stream (not resolvable under bun test). */
function createAssistantMessageEventStream(): AssistantMessageEventStream {
	const events: AssistantMessageEvent[] = [];
	let wake: (() => void) | undefined;
	let finished = false;
	let final!: (m: AssistantMessage) => void;
	const result = new Promise<AssistantMessage>((resolve) => { final = resolve; });
	return {
		push(event: AssistantMessageEvent) {
			events.push(event);
			if (event.type === "done") { finished = true; final(event.message); }
			if (event.type === "error") { finished = true; final(event.error); }
			wake?.();
		},
		result: () => result,
		async *[Symbol.asyncIterator]() {
			for (;;) {
				const next = events.shift();
				if (next) { yield next; continue; }
				if (finished) return;
				await new Promise<void>((resolve) => { wake = resolve; });
			}
		},
	} as unknown as AssistantMessageEventStream;
}

test("US-045 a stated reset blocks until then; unknown limits use a default; other failures do not block", () => {
	expect(blockedUntil("You have hit your ChatGPT usage limit. Try again in ~90 min.", NOW)).toBe(NOW + 90 * 60_000);
	expect(blockedUntil("429 rate limit, retry after 30s", NOW)).toBe(NOW + 30_000);
	expect(blockedUntil("429 too many requests", NOW)).toBe(NOW + 5 * 60_000);
	expect(blockedUntil("insufficient credits", NOW)).toBe(NOW + 60 * 60_000);
	expect(blockedUntil('403: {"message":"Key limit exceeded (weekly limit)."}', NOW)).toBe(NOW + 60 * 60_000);
	expect(blockedUntil("400 invalid request", NOW)).toBeUndefined();
});

test("US-045 pick keeps the sticky account, skips blocked, and prefers least recently used", () => {
	const state: PoolState = { a: { lastUsed: 5 }, b: { lastUsed: 1 }, c: { blockedUntil: NOW + 1, lastUsed: 0 } };
	expect(pickMember(["a", "b", "c"], state, NOW, new Set())).toBe("b");
	expect(pickMember(["a", "b", "c"], state, NOW, new Set(), "a")).toBe("a");
	expect(pickMember(["a", "b", "c"], state, NOW, new Set(), "c")).toBe("b");
	expect(pickMember(["a", "b", "c"], state, NOW + 2, new Set(["b"]))).toBe("c");
	expect(pickMember(["c"], state, NOW, new Set())).toBeUndefined();
});

function memoryStore(): PoolStore & { state: PoolState } {
	const state: PoolState = {};
	return { state, read: () => structuredClone(state), update: (m, p) => { state[m] = { ...state[m], ...p }; } };
}

const msg = (over: Partial<AssistantMessage>): AssistantMessage => ({
	role: "assistant", content: [], api: "openai-responses", provider: "x", model: "m", stopReason: "stop", timestamp: 0,
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, ...over,
});

function member(error?: string) {
	const s = createAssistantMessageEventStream();
	queueMicrotask(() => {
		if (error) s.push({ type: "error", reason: "error", error: msg({ stopReason: "error", errorMessage: error }) });
		else { s.push({ type: "start", partial: msg({}) }); s.push({ type: "done", reason: "stop", message: msg({ content: [{ type: "text", text: "ok" }] }) }); }
	});
	return s;
}

test("US-045 a limited account is blocked until its reset and the same request is served by the next", async () => {
	const store = memoryStore();
	const sticky: { member?: string } = {};
	const served: string[] = [];
	const result = await rotate({
		poolId: "p", out: createAssistantMessageEventStream(), members: ["a", "b"], store, model: { id: "m", api: "openai-responses" },
		start: (m) => member(m === "a" ? "usage limit. Try again in ~10 min." : undefined),
		onServe: (m) => served.push(m),
	}, sticky).result();
	expect(served).toEqual(["a", "b"]);
	expect(result.stopReason).toBe("stop");
	expect(store.state.a.blockedUntil).toBeGreaterThan(Date.now() + 9 * 60_000);
	expect(sticky.member).toBe("b");
});

test("US-045 a non-capacity failure is surfaced without blocking or rotating; all-blocked reports it", async () => {
	const store = memoryStore();
	const served: string[] = [];
	const bad = await rotate({ poolId: "p", out: createAssistantMessageEventStream(), members: ["a", "b"], store, model: { id: "m", api: "openai-responses" },
		start: () => member("400 invalid request"), onServe: (m) => served.push(m) }, {}).result();
	expect(bad.errorMessage).toBe("400 invalid request");
	expect(served).toEqual(["a"]);
	expect(store.state.a.blockedUntil).toBeUndefined();

	const all = await rotate({ poolId: "p", out: createAssistantMessageEventStream(), members: ["a", "b"], store: memoryStore(), model: { id: "m", api: "openai-responses" },
		start: () => member("429 too many requests") }, {}).result();
	expect(all.errorMessage).toContain("every account is blocked or signed out");
});
