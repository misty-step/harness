/**
 * US-029 contracts for the s1s2 System 1 layer: a Jev outage leaves raw Pi
 * behavior, `S1S2_MODE=off` is inert, triage never hides failure lines or the
 * full-output path, the done-gate only offers side-effect-free checks and only
 * trusts a check whose exit status is its verdict, Jev never receives
 * credential-shaped text, and System 1's authority stays bounded and abstains
 * when unsure. The advisor stays within its consult budget, never drops another
 * handler's notes, sends only what is new, and fails open.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import s1s2 from "./index.ts";
import { AdvisorConversation, parseAdvice, worthDelivering } from "./advisor.ts";
import { briefState, doneQuestions, doneState, monitorState, NOTES, pickBriefFiles, pickCheck, pickNote, triageState } from "./questions.ts";
import { discoverChecks, planTriage, renderTriage, type Candidate } from "./sensors.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

let dir: string;
const saved = { ...process.env };
const originalFetch = globalThis.fetch;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "s1s2-test-"));
	for (const name of ["S1S2_MODE", "S1S2_RUN_DIR", "OPENROUTER_API_KEY"]) delete process.env[name];
	process.env.S1S2_RUN_DIR = join(dir, "run");
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	process.env = { ...saved };
	rmSync(dir, { recursive: true, force: true });
});

function load(): Map<string, Handler> {
	const handlers = new Map<string, Handler>();
	s1s2({ on: (name: string, handler: Handler) => handlers.set(name, handler) } as unknown as ExtensionAPI);
	return handlers;
}

function repo(): string {
	const root = join(dir, "repo");
	mkdirSync(join(root, "src"), { recursive: true });
	writeFileSync(join(root, "src/pricing.ts"), "export function applyDiscount(price: number, percent: number) {\n\treturn price - price * percent;\n}\n");
	writeFileSync(join(root, "src/pricing.test.ts"), 'import { test } from "bun:test";\ntest("discount", () => {});\n');
	const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
	git("init", "-q");
	git("add", "-A");
	git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "init");
	return root;
}

function context(cwd: string, apiKey?: string): ExtensionContext {
	return {
		cwd,
		modelRegistry: { getProviderAuth: async () => (apiKey ? { auth: { apiKey } } : undefined) },
		sessionManager: { getSessionId: () => "test-session" },
	} as unknown as ExtensionContext;
}

/** Stub the Decisions endpoint: Noul 0.95, Score level 1, and the named choice for each Choice question id. */
function stubJev(choices: Record<string, string>): void {
	globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
		const { questions } = JSON.parse(String(init?.body)) as { questions: Record<string, { type: string }> };
		const answers = Object.fromEntries(
			Object.entries(questions).map(([id, question]) => [
				id,
				question.type === "noul"
					? { type: "noul", noul: 0.95 }
					: question.type === "score"
						? { type: "score", score: 1, probabilities: { "1": 1 }, confidence: 1 }
						: { type: "choice", choice: choices[id], probabilities: { [choices[id]]: 0.95 }, confidence: 0.95 },
			]),
		);
		return new Response(JSON.stringify({ model: "typesafe/jev-1.13-20260917", answers }), { status: 200 });
	}) as unknown as typeof fetch;
}

function bash(id: string, command: string, isError: boolean, text = "done") {
	return { type: "tool_result", toolCallId: id, toolName: "bash", input: { command }, content: [{ type: "text", text }], isError };
}

function longOutput(): string {
	return Array.from({ length: 300 }, (_, i) =>
		i === 150 ? "FAIL src/pricing.test.ts > discount: expected 150, received -4800" : `ok ${i}: routine progress line with enough text to be long`,
	).join("\n");
}

const settle = { type: "agent_before_settle", outcome: "completed", entries: [], continue: false, context: { canContinue: false } };
const start = (prompt: string) => ({ type: "before_agent_start", prompt, systemPromptOptions: { sections: {} as Record<string, string> } });

describe("US-029 fail-open and inert modes", () => {
	test("a Jev outage adds no briefing, leaves bash output unchanged, and requests no continuation", async () => {
		const cwd = repo();
		globalThis.fetch = (async () => new Response("upstream unavailable", { status: 503 })) as unknown as typeof fetch;
		const handlers = load();
		const ctx = context(cwd, "test-key");
		await handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, ctx);
		expect(await handlers.get("before_agent_start")?.(start("Fix `applyDiscount` in `src/pricing.ts`."), ctx)).toBeUndefined();
		expect(await handlers.get("tool_result")?.(bash("call-1", "bun test", true, longOutput()), ctx)).toBeUndefined();
		writeFileSync(join(cwd, "src/pricing.ts"), "export function applyDiscount(price: number, percent: number) {\n\treturn price - (price * percent) / 100;\n}\n");
		expect(await handlers.get("agent_before_settle")?.(settle, ctx)).toBeUndefined();

		const log = readFileSync(join(dir, "run", "s1s2.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
		const outcomes = log.filter((entry) => entry.battery).map((entry) => `${entry.battery}:${entry.action}`);
		expect(outcomes).toEqual(["brief:fail_open", "triage:fail_open", "done:fail_open"]);
	});

	test("without a credential the System 2 prompt is untouched and no battery acts", async () => {
		const cwd = repo();
		const handlers = load();
		const ctx = context(cwd);
		await handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, ctx);
		const event = start("Fix `applyDiscount`.");
		expect(await handlers.get("before_agent_start")?.(event, ctx)).toBeUndefined();
		expect(event.systemPromptOptions.sections).toEqual({});
	});

	test("S1S2_MODE=off registers no handlers", () => {
		process.env.S1S2_MODE = "off";
		expect(load().size).toBe(0);
	});
});

describe("US-029 deterministic safety", () => {
	test("triage always shows head, tail, and failure lines, and every elision names the full output", () => {
		const plan = planTriage(longOutput());
		expect(plan).not.toBeNull();
		if (!plan) return;
		const { text, shown } = renderTriage(plan, new Set(), "/spill/call-1.txt");
		expect(text).toContain("ok 0: routine");
		expect(text).toContain("ok 299: routine");
		expect(text).toContain("FAIL src/pricing.test.ts > discount: expected 150, received -4800");
		const markers = text.split("\n").filter((line) => line.startsWith("[… S1 elided"));
		expect(markers.length).toBeGreaterThan(0);
		expect(markers.every((line) => line.endsWith("full output: /spill/call-1.txt]"))).toBe(true);
		expect(shown).toBeLessThan(300);
	});

	test("check discovery offers only scripts that neither fix, write, deploy, nor watch", () => {
		const cwd = repo();
		writeFileSync(
			join(cwd, "package.json"),
			JSON.stringify({
				scripts: {
					test: "vitest run",
					"test:watch": "vitest --watch",
					lint: "eslint --fix .",
					typecheck: "tsc --noEmit",
					verify: "wrangler deploy --dry-run=false",
					build: "tsc -p .",
				},
			}),
		);
		expect(discoverChecks(cwd, []).map((check) => check.command)).toEqual(["npm run test", "npm run typecheck"]);
	});

	test("only a check whose exit status is its verdict marks the current changes verified", async () => {
		const cwd = repo();
		stubJev({ completion: "complete", check: "none_suitable" });
		const handlers = load();
		const ctx = context(cwd, "test-key");
		await handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, ctx);
		let edit = 0;
		const settlesAfter = async (command: string): Promise<boolean> => {
			await handlers.get("before_agent_start")?.(start("Fix `applyDiscount`."), ctx);
			writeFileSync(join(cwd, "src/pricing.ts"), `export const edit = ${++edit};\n`);
			await handlers.get("tool_result")?.({ type: "tool_result", toolCallId: `w${edit}`, toolName: "write", input: { path: "src/pricing.ts" }, content: [], isError: false }, ctx);
			await handlers.get("tool_result")?.(bash(`b${edit}`, command, false), ctx);
			const result = (await handlers.get("agent_before_settle")?.(settle, ctx)) as { continue?: boolean } | undefined;
			return result?.continue !== true;
		};
		expect(await settlesAfter("cat src/pricing.test.ts")).toBe(false);
		expect(await settlesAfter("echo test > notes.txt")).toBe(false);
		expect(await settlesAfter("bun test ./src/pricing.test.ts 2>&1 | tail -5")).toBe(false);
		expect(await settlesAfter("bun test ./src/pricing.test.ts; echo done")).toBe(false);
		expect(await settlesAfter("cd src && bun test ./pricing.test.ts 2>&1")).toBe(true);
	});

	test("an edit made through bash counts as an edit for the monitor", async () => {
		const cwd = repo();
		stubJev({ note: "none", completion: "complete", check: "none_suitable" });
		const handlers = load();
		const ctx = context(cwd, "test-key");
		await handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, ctx);
		await handlers.get("before_agent_start")?.(start("Fix `applyDiscount`."), ctx);
		for (let turn = 1; turn <= 8; turn++) {
			await handlers.get("turn_start")?.({ type: "turn_start", turnIndex: turn - 1, timestamp: 0 }, ctx);
			if (turn === 7) writeFileSync(join(cwd, "src/pricing.ts"), "export const patched = true;\n");
			const result = bash(`t${turn}`, turn === 7 ? "python3 patch.py" : "ls src", false);
			await handlers.get("tool_result")?.(result, ctx);
			await handlers.get("turn_end")?.({ type: "turn_end", turnIndex: turn - 1, toolResults: [result], entries: [] }, ctx);
		}
		const log = readFileSync(join(dir, "run", "s1s2.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
		expect(log.find((entry) => entry.battery === "monitor")?.facts.turnsSinceEdit).toBe(1);
	});

	test("System 1's credential is removed from the environment tool subprocesses inherit", async () => {
		const cwd = repo();
		stubJev({ completion: "complete", check: "none_suitable" });
		process.env.S1S2_JEV_KEY = "jev-test-key";
		process.env.OPENROUTER_API_KEY = "openrouter-test-key";
		const handlers = load();
		const ctx = { ...context(cwd), model: { provider: "openai-codex", id: "gpt-6-luna" } } as unknown as ExtensionContext;
		await handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, ctx);
		await handlers.get("before_agent_start")?.(start("Fix `applyDiscount`."), ctx);
		expect(process.env.S1S2_JEV_KEY).toBeUndefined();
		expect(process.env.OPENROUTER_API_KEY).toBeUndefined();
		const log = readFileSync(join(dir, "run", "s1s2.jsonl"), "utf8");
		expect(log).toContain('"battery":"brief"');
		expect(log).not.toContain('"reason":"no_key"');
	});

	test("every Jev state and question masks credential-shaped text", () => {
		const secret = "sk-live_abcdefghijklmnopqrstuv";
		const text = `use Bearer ${secret} and ${secret}`;
		const states = [
			briefState(text, [{ path: `keys/${secret}.pem`, terms: [secret], hits: [`L1: token = "${secret}"`], prior: 1 }]),
			triageState(text, `curl -H "Authorization: Bearer ${secret}"`, text, [{ id: "k0", start: 0, end: 1, text }]),
			monitorState(text, 3, [{ turn: 1, summary: `bash: export KEY=${secret}`, ok: false }], {
				repeatedFailures: 0,
				errorStreak: 1,
				turnsSinceEdit: 1,
			}),
			doneState(text, text, [`config/${secret}.json`], ` config/${secret}.json | 2 +-`, false, [
				{ command: `bun test ./tests/${secret}.test.ts`, why: `tests for config/${secret}.json` },
			]),
			doneQuestions([{ command: `bun test ./tests/${secret}.test.ts`, why: `tests for config/${secret}.json` }]),
		];
		for (const state of states) expect(JSON.stringify(state)).not.toContain("abcdefghijklmnop");
	});
});

describe("US-029 bounded authority", () => {
	test("even when Jev always urges action, a prompt gets at most three notes and two continuations", async () => {
		const cwd = repo();
		stubJev({ note: "change_approach", completion: "unfinished", check: "none_suitable" });
		const handlers = load();
		const ctx = context(cwd, "test-key");
		await handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, ctx);
		await handlers.get("before_agent_start")?.(start("Fix `applyDiscount`."), ctx);

		let notes = 0;
		for (let turn = 0; turn < 20; turn++) {
			await handlers.get("turn_start")?.({ type: "turn_start", turnIndex: turn, timestamp: 0 }, ctx);
			const failing = bash(`c${turn}`, "make", true, "no rule");
			await handlers.get("tool_result")?.(failing, ctx);
			const result = (await handlers.get("turn_end")?.({ type: "turn_end", turnIndex: turn, toolResults: [failing], entries: [] }, ctx)) as
				| { entries?: unknown[] }
				| undefined;
			if (result?.entries?.length) notes++;
		}
		expect(notes).toBe(3);

		writeFileSync(join(cwd, "src/pricing.ts"), "export const changed = true;\n");
		const continued: boolean[] = [];
		for (let attempt = 0; attempt < 4; attempt++) {
			const result = (await handlers.get("agent_before_settle")?.(settle, ctx)) as { continue?: boolean } | undefined;
			continued.push(result?.continue === true);
		}
		expect(continued).toEqual([true, true, false, false]);
		// The decision log names repository paths and outcomes, never prompt text.
		expect(readFileSync(join(dir, "run", "s1s2.jsonl"), "utf8")).not.toContain("applyDiscount");
	});

	test("uncertain, escaped, or confidence-free answers never act", () => {
		const choice = (picked: string, p: number, confidence?: number) => ({
			type: "choice" as const,
			choice: picked,
			probabilities: { [picked]: p },
			confidence,
		});
		expect(pickNote({ note: choice("change_approach", 0.9) }, true)).toBeNull();
		expect(pickNote({ note: choice("none", 0.99, 0.99) }, true)).toBeNull();
		expect(pickNote({ note: choice("change_approach", 0.9, 0.9), stuck: { type: "noul", probability: 0.5, confidence: 0 } }, false)).toBeNull();
		expect(pickNote({ note: choice("change_approach", 0.9, 0.9) }, true)).toBe("change_approach");

		const checks = [{ command: "npm run test", why: "declared" }];
		expect(pickCheck({ check: choice("none_suitable", 0.99, 0.99) }, checks)).toBeNull();
		expect(pickCheck({ check: choice("c0", 0.4, 0.9) }, checks)).toBeNull();
		expect(pickCheck({ check: choice("c7", 0.99, 0.99) }, checks)).toBeNull();
		expect(pickCheck({ check: choice("c0", 0.8, 0.6) }, checks)?.check.command).toBe("npm run test");

		const candidates: Candidate[] = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"].map((path) => ({ path, terms: [], hits: [], prior: 1 }));
		const file = (p: number) => ({ type: "noul" as const, probability: p, confidence: Math.abs(p - 0.5) * 2 });
		const picked = pickBriefFiles(candidates, {
			scope: { type: "score", score: 0, probabilities: { "0": 1 }, confidence: 1 },
			f0: file(0.4),
			f1: file(0.9),
			f2: file(0.8),
			f3: file(0.7),
			f4: file(0.6),
		});
		expect(picked.map((pick) => pick.path)).toEqual(["b.ts", "c.ts", "d.ts"]);
	});
});

type Entry = { customType?: string; content?: unknown };
type Boundary = { entries?: Entry[]; continue?: boolean } | undefined;

/** A model registry whose advisor model answers with `replies` in turn (the last one repeats); an Error reply throws. */
function advisorContext(cwd: string, replies: (string | Error)[]) {
	const requests: { role: string; content: unknown }[][] = [];
	const ctx = {
		...context(cwd),
		modelRegistry: {
			getProviderAuth: async () => ({ auth: { apiKey: "test-key" } }),
			find: (provider: string, id: string) => ({ provider, id }),
			streamSimple: (_model: unknown, request: { messages: { role: string; content: unknown }[] }) => {
				requests.push(request.messages);
				const reply = replies[Math.min(requests.length - 1, replies.length - 1)];
				return {
					result: async () => {
						if (reply instanceof Error) throw reply;
						return { role: "assistant", content: [{ type: "text", text: reply }], stopReason: "stop", usage: { input: 10, output: 5, cacheRead: 0, cost: { total: 0.001 } } };
					},
				};
			},
		},
	} as unknown as ExtensionContext;
	return { ctx, requests };
}

const logOf = () => readFileSync(join(dir, "run", "s1s2.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
/** Let every queued continuation run: the stubbed advisor answers without I/O, so a background review finishes before the next macrotask. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("US-029 advisor battery", () => {
	test("gated: consults after the first edit, stays within six consults with the last kept for the final review, sends System 2 back once, and keeps every other note", async () => {
		const cwd = repo();
		stubJev({ note: "change_approach", completion: "complete", check: "none_suitable" });
		process.env.S1S2_ADVISOR = "gated";
		const handlers = load();
		const { ctx, requests } = advisorContext(cwd, ['{"severity":"concern","advice":"Cover a zero percent discount in src/pricing.test.ts."}']);
		await handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, ctx);
		await handlers.get("before_agent_start")?.(start("Fix `applyDiscount`."), ctx);
		const prior: Entry = { customType: "other/extension", content: "kept" };
		const added: string[][] = [];
		for (let turn = 1; turn <= 20; turn++) {
			await handlers.get("turn_start")?.({ type: "turn_start", turnIndex: turn - 1, timestamp: 0 }, ctx);
			if (turn === 1) {
				writeFileSync(join(cwd, "src/pricing.ts"), "export const edited = true;\n");
				await handlers.get("tool_result")?.({ type: "tool_result", toolCallId: "w1", toolName: "write", input: { path: "src/pricing.ts" }, content: [], isError: false }, ctx);
			}
			const failing = bash(`c${turn}`, "make", true, "no rule");
			await handlers.get("tool_result")?.(failing, ctx);
			const result = (await handlers.get("turn_end")?.({ type: "turn_end", turnIndex: turn - 1, toolResults: [failing], entries: [prior] }, ctx)) as Boundary;
			const entries = result?.entries ?? [prior];
			expect(entries[0]).toBe(prior);
			added.push(entries.slice(1).map((entry) => entry.customType ?? ""));
		}
		expect(requests.length).toBe(5);
		expect(added[0]).toEqual(["s1s2/advisor"]);
		expect(added.some((kinds) => kinds.includes("s1s2/note") && kinds.includes("s1s2/advisor"))).toBe(true);

		const settles: Boundary[] = [];
		for (let attempt = 0; attempt < 3; attempt++) settles.push((await handlers.get("agent_before_settle")?.(settle, ctx)) as Boundary);
		expect(requests.length).toBe(6);
		expect(settles[0]?.continue).toBe(true);
		expect(String(settles[0]?.entries?.at(-1)?.content)).toStartWith("S1 advisor (concern)");
		expect(settles.slice(1).some((result) => String(result?.entries?.at(-1)?.content ?? "").startsWith("S1 advisor"))).toBe(false);
		expect(logOf().filter((entry) => entry.battery === "advisor").map((entry) => entry.trigger)).toEqual(["first_edit", "gate", "gate", "gate", "gate", "settle"]);
	});

	test("an advisor failure delivers nothing and leaves the done gate in charge", async () => {
		const cwd = repo();
		stubJev({ note: "none", completion: "complete", check: "none_suitable" });
		process.env.S1S2_ADVISOR = "gated";
		const handlers = load();
		const { ctx } = advisorContext(cwd, [new Error("upstream 503")]);
		await handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, ctx);
		await handlers.get("before_agent_start")?.(start("Fix `applyDiscount`."), ctx);
		writeFileSync(join(cwd, "src/pricing.ts"), "export const edited = true;\n");
		await handlers.get("tool_result")?.({ type: "tool_result", toolCallId: "w1", toolName: "write", input: { path: "src/pricing.ts" }, content: [], isError: false }, ctx);
		const turnEnd = (await handlers.get("turn_end")?.({ type: "turn_end", turnIndex: 0, toolResults: [{}], entries: [] }, ctx)) as Boundary;
		expect(turnEnd?.entries ?? []).toEqual([]);
		const settled = (await handlers.get("agent_before_settle")?.(settle, ctx)) as Boundary;
		expect(settled?.entries?.at(-1)?.content).toBe(NOTES.unverified);
		expect(logOf().filter((entry) => entry.battery === "advisor").map((entry) => entry.action)).toEqual(["fail_open", "fail_open"]);
	});

	test("every turn: a review lands at the next step, and only a blocker sends System 2 back", async () => {
		const cwd = repo();
		stubJev({ note: "none", completion: "complete", check: "none_suitable" });
		process.env.S1S2_ADVISOR = "every";
		const handlers = load();
		const { ctx } = advisorContext(cwd, ['{"severity":"nit","advice":"Name the magic number."}', '{"severity":"blocker","advice":"The discount is still subtracted twice."}']);
		await handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, ctx);
		await handlers.get("before_agent_start")?.(start("Fix `applyDiscount`."), ctx);
		writeFileSync(join(cwd, "src/pricing.ts"), "export const edited = true;\n");
		const step = async (turn: number) => {
			const result = bash(`t${turn}`, "ls src", false);
			await handlers.get("tool_result")?.(result, ctx);
			return (await handlers.get("turn_end")?.({ type: "turn_end", turnIndex: turn, toolResults: [result], entries: [] }, ctx)) as Boundary;
		};
		expect((await step(0))?.entries ?? []).toEqual([]);
		await flush();
		expect((await step(1))?.entries?.map((entry) => entry.content)).toEqual(["S1 advisor (nit): Name the magic number."]);
		const settled = (await handlers.get("agent_before_settle")?.(settle, ctx)) as Boundary;
		expect(settled?.continue).toBe(true);
		expect(settled?.entries?.at(-1)?.content).toBe("S1 advisor (blocker): The discount is still subtracted twice.");
	});

	test("the advisor conversation sends only what is new, and resends it after a failed consult", () => {
		const conversation = new AdvisorConversation();
		const card = (turn: number) => ({ turn, text: `[turn ${turn}] bash: step ${turn} -> ok` });
		const reply = { role: "assistant", content: [{ type: "text", text: "{}" }] } as never;
		expect(conversation.open("Fix it.", [card(1)], "diff one", "first")).toHaveLength(1);
		conversation.close(reply, "{}");
		const second = conversation.open("Fix it.", [card(1), card(2)], "diff one", "second");
		const delta = String(second.at(-1)?.content);
		expect(second).toHaveLength(3);
		expect(delta).toContain("step 2");
		expect(delta).not.toContain("step 1");
		expect(delta).not.toContain("Fix it.");
		expect(delta).toContain("unchanged since your last review");
		conversation.close(null, "");
		const third = String(conversation.open("Fix it.", [card(1), card(2), card(3)], "diff two", "third").at(-1)?.content);
		expect(third).toContain("step 2");
		expect(third).toContain("diff two");
	});

	test("advice parses from prose or fences and is delivered only when it says something", () => {
		expect(parseAdvice('Review done.\n```json\n{"severity":"concern","advice":"Handle {percent} over 100."}\n```')).toEqual({ severity: "concern", advice: "Handle {percent} over 100." });
		expect(parseAdvice('{"severity":"urgent","advice":"x"}')).toBeNull();
		expect(parseAdvice("Looks fine to me.")).toBeNull();
		expect(parseAdvice('{"severity":"concern","advice":"Add SKILL.md under agent-config/skills/session-close/ and\nwire the refere')).toEqual({ severity: "concern", advice: "Add SKILL.md under agent-config/skills/session-close/ and\nwire the refere" });
		expect(worthDelivering(parseAdvice('{"severity":"none","advice":"All good."}'))).toBe(false);
		expect(worthDelivering(parseAdvice('{"severity":"nit","advice":""}'))).toBe(false);
	});
});
