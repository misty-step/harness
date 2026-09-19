import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { NUDGE_MESSAGE } from "./continuation.ts";
import { MARKER_TYPE, type BranchEntry } from "./decide.ts";
import {
	registerContinuationNudge,
	type ContinuationDeps,
	type ResolvedProvider,
} from "./index.ts";
import type { Answer, Question } from "./engine.ts";

type Listener = (event: unknown, ctx: ExtensionContext) => unknown;
type CommandHandler = (args: string, ctx: ExtensionContext) => Promise<void>;

interface Harness {
	pi: ExtensionAPI;
	ctx: ExtensionContext;
	listeners: Map<string, Listener>;
	commands: Map<string, { handler: CommandHandler }>;
	messages: Array<{ message: Record<string, unknown>; options?: Record<string, unknown> }>;
	entries: Array<{ customType: string; data: Record<string, unknown> }>;
	statuses: Map<string, string | undefined>;
	notifications: string[];
}

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

function makeHarness(entries: BranchEntry[] = [], options: {
	deps?: ContinuationDeps;
	providerAuth?: boolean;
	isIdle?: boolean;
	pending?: boolean;
} = {}): Harness {
	const listeners = new Map<string, Listener>();
	const commands = new Map<string, { handler: CommandHandler }>();
	const messages: Harness["messages"] = [];
	const recordedEntries: Harness["entries"] = [];
	const statuses = new Map<string, string | undefined>();
	const notifications: string[] = [];

	const pi = {
		on: (event: string, handler: Listener) => {
			listeners.set(event, handler);
		},
		registerCommand: (name: string, definition: { handler: CommandHandler }) => {
			commands.set(name, definition);
		},
		sendMessage: (message: Record<string, unknown>, opts?: Record<string, unknown>) => {
			messages.push({ message, options: opts });
		},
		appendEntry: (customType: string, data: Record<string, unknown>) => {
			recordedEntries.push({ customType, data });
		},
	} as unknown as ExtensionAPI;

	const ctx = {
		hasUI: false,
		cwd: process.cwd(),
		isIdle: () => options.isIdle ?? true,
		hasPendingMessages: () => options.pending ?? false,
		sessionManager: { getBranch: () => entries, getEntries: () => entries },
		modelRegistry: {
			getProviderAuth: async (_provider: string) =>
				options.providerAuth === false ? undefined : { auth: { apiKey: "test-key" } },
		},
		ui: {
			setStatus: (key: string, value: string | undefined) => {
				statuses.set(key, value);
			},
			notify: (text: string) => {
				notifications.push(text);
			},
		},
	} as unknown as ExtensionContext;

	registerContinuationNudge(pi, options.deps);
	return { pi, ctx, listeners, commands, messages, entries: recordedEntries, statuses, notifications };
}

async function settle(harness: Harness): Promise<void> {
	await harness.listeners.get("agent_settled")?.({}, harness.ctx);
}

const ENV_KEYS = [
	"PI_CODING_AGENT_DIR",
	"OPENROUTER_API_KEY",
	"TYPESAFE_API_KEY",
	"JEV_NUDGE_MODE",
	"JEV_NUDGE_MAX",
	"JEV_NUDGE_MIN_CONF",
	"JEV_NUDGE_PROVIDER",
] as const;

let savedEnv: Record<string, string | undefined> = {};
let agentDir = "";

function scratchRoot(): string {
	const root = process.env.TMPDIR?.trim() || join(homedir(), ".cache", "tmp");
	mkdirSync(root, { recursive: true });
	return root;
}

beforeEach(() => {
	savedEnv = {};
	for (const key of ENV_KEYS) {
		savedEnv[key] = process.env[key];
		delete process.env[key];
	}
	agentDir = mkdtempSync(join(scratchRoot(), "continuation-nudge-"));
	process.env.PI_CODING_AGENT_DIR = agentDir;
});

afterEach(() => {
	for (const key of ENV_KEYS) {
		if (savedEnv[key] === undefined) delete process.env[key];
		else process.env[key] = savedEnv[key];
	}
	rmSync(agentDir, { recursive: true, force: true });
});

function logRecords(): Array<Record<string, unknown>> {
	const path = join(agentDir, "continuation-nudge.jsonl");
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8")
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function statusFile(): Record<string, unknown> | null {
	const path = join(agentDir, "continuation-nudge-status.json");
	if (!existsSync(path)) return null;
	return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function fakeProvider(
	evaluate: (state: string, questions: Record<string, Question>, timeoutMs?: number) => Promise<Record<string, Answer>>,
): ContinuationDeps {
	return {
		resolveProvider: async (): Promise<ResolvedProvider> => ({
			provider: { name: "heuristic", evaluate },
			source: "fake",
			keyResolved: true,
			stub: false,
		}),
	};
}

const NUDGE_ANSWER: Record<string, Answer> = {
	continuation: { type: "choice", choice: "nudge", probabilities: { nudge: 1 }, confidence: 0.9 },
};

describe("registration", () => {
	test("registers the settle hook, session_start, and /continuation", () => {
		const harness = makeHarness();
		expect(harness.listeners.has("agent_settled")).toBe(true);
		expect(harness.listeners.has("session_start")).toBe(true);
		expect(harness.commands.has("continuation")).toBe(true);
	});
});

describe("nudge emission", () => {
	test("injects the fixed message and marker when Jev says nudge", async () => {
		process.env.JEV_NUDGE_PROVIDER = "stub-nudge";
		const harness = makeHarness([user("draft the memo"), assistant("I will draft it now.")]);
		await settle(harness);

		expect(harness.messages).toHaveLength(1);
		expect(harness.messages[0].message.customType).toBe("continuation-nudge");
		expect(harness.messages[0].message.content).toBe(NUDGE_MESSAGE);
		expect(harness.messages[0].message.display).toBe(true);
		expect(harness.messages[0].options).toEqual({ deliverAs: "followUp", triggerTurn: true });

		expect(harness.entries).toHaveLength(1);
		expect(harness.entries[0].customType).toBe(MARKER_TYPE);
		expect(harness.entries[0].data.attempt).toBe(1);

		const records = logRecords();
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({ decision: "nudge", reason: "nudge", attempt: 1, stub: true });
	});

	test("covers a non-code premature stop (memo in chat, no edits, carried-forward work)", async () => {
		process.env.JEV_NUDGE_PROVIDER = "stub-nudge";
		const harness = makeHarness([
			user("Write the incident memo and put it in NOTES.md."),
			assistant("Drafting the memo now."),
		]);
		await settle(harness);
		expect(harness.messages).toHaveLength(1);
		expect(harness.entries).toHaveLength(1);

		const inverse = makeHarness(
			[user("Write the incident memo and put it in NOTES.md."), assistant("Drafting the memo now.")],
			{},
		);
		process.env.JEV_NUDGE_PROVIDER = "stub-silence";
		await settle(inverse);
		expect(inverse.messages).toHaveLength(0);
		expect(inverse.entries).toHaveLength(0);
		expect(logRecords().some((record) => record.reason === "choice-no_nudge")).toBe(true);
	});
});

describe("suppression", () => {
	test("does not nudge when Jev says no_nudge", async () => {
		process.env.JEV_NUDGE_PROVIDER = "stub-silence";
		const harness = makeHarness([user("request"), assistant("I need your decision before proceeding.")]);
		await settle(harness);
		expect(harness.messages).toHaveLength(0);
		expect(harness.entries).toHaveLength(0);
	});

	test("does not nudge an aborted or errored stop", async () => {
		process.env.JEV_NUDGE_PROVIDER = "stub-nudge";
		for (const stopReason of ["aborted", "error"]) {
			const harness = makeHarness([user("request"), assistant("partial", stopReason)]);
			await settle(harness);
			expect(harness.messages).toHaveLength(0);
			expect(logRecords().some((record) => record.reason === `stop-reason-${stopReason}`)).toBe(true);
		}
	});

	test("does not nudge while messages are pending", async () => {
		process.env.JEV_NUDGE_PROVIDER = "stub-nudge";
		const harness = makeHarness([user("request"), assistant("answer")], { pending: true });
		await settle(harness);
		expect(harness.messages).toHaveLength(0);
		expect(logRecords()[0].reason).toBe("pending-messages");
	});

	test("does not nudge and writes no log when mode is off", async () => {
		process.env.JEV_NUDGE_PROVIDER = "stub-nudge";
		process.env.JEV_NUDGE_MODE = "off";
		const harness = makeHarness([user("request"), assistant("answer")]);
		await settle(harness);
		expect(harness.messages).toHaveLength(0);
		expect(existsSync(join(agentDir, "continuation-nudge.jsonl"))).toBe(false);
	});

	test("skips without a key and never falls back to TYPESAFE_API_KEY", async () => {
		process.env.TYPESAFE_API_KEY = "typesafe-direct-key-must-not-be-used";
		const harness = makeHarness([user("request"), assistant("answer")], { providerAuth: false });
		await settle(harness);
		expect(harness.messages).toHaveLength(0);
		expect(statusFile()?.mode).toBe("no-key");
		expect(statusFile()?.key_resolved).toBe(false);
	});

	test("suppresses a second nudge with zero progress since the marker, without calling the provider", async () => {
		let calls = 0;
		const harness = makeHarness([user("request"), assistant("answer"), marker(1)], {
			deps: fakeProvider(async () => {
				calls += 1;
				return NUDGE_ANSWER;
			}),
		});
		await settle(harness);
		expect(calls).toBe(0);
		expect(harness.messages).toHaveLength(0);
		expect(harness.entries).toHaveLength(0);
		expect(logRecords()[0].reason).toBe("no-progress-since-nudge");
	});

	test("allows a second nudge once a tool result followed the marker", async () => {
		process.env.JEV_NUDGE_PROVIDER = "stub-nudge";
		const harness = makeHarness([
			user("request"),
			assistant("answer"),
			marker(1),
			tool("edit", "NOTES.md updated"),
			assistant("more work needed"),
		]);
		await settle(harness);
		expect(harness.messages).toHaveLength(1);
		expect(harness.entries[0].data.attempt).toBe(2);
	});

	test("stops at the per-prompt bound", async () => {
		process.env.JEV_NUDGE_PROVIDER = "stub-nudge";
		const harness = makeHarness([
			user("request"),
			assistant("answer"),
			marker(1),
			tool("edit", "a"),
			marker(2),
			tool("edit", "b"),
			assistant("still going"),
		]);
		await settle(harness);
		expect(harness.messages).toHaveLength(0);
		expect(logRecords()[0].reason).toBe("max-nudges");
	});

	test("honours JEV_NUDGE_MAX=0", async () => {
		process.env.JEV_NUDGE_PROVIDER = "stub-nudge";
		process.env.JEV_NUDGE_MAX = "0";
		const harness = makeHarness([user("request"), assistant("answer")]);
		await settle(harness);
		expect(harness.messages).toHaveLength(0);
		expect(logRecords()[0].reason).toBe("max-nudges");
	});
});

describe("fail-open and redaction", () => {
	test("fails open and records the error when the provider throws", async () => {
		const harness = makeHarness([user("request"), assistant("answer")], {
			deps: fakeProvider(async () => {
				throw new Error("network down");
			}),
		});
		await settle(harness);
		expect(harness.messages).toHaveLength(0);
		expect(harness.entries).toHaveLength(0);
		expect(logRecords()[0]).toMatchObject({ decision: "no_nudge", reason: "provider-error" });
	});

	test("redacts secrets from the serialized state and stays under the cap", async () => {
		let captured = "";
		const harness = makeHarness(
			[
				user("request sk-abcdefghijklmnop"),
				tool("bash", "curl -H 'Authorization: Bearer abcdefgh12345678'"),
				assistant("used sk-abcdefghijklmnop and AKIAIOSFODNN7EXAMPLE2"),
			],
			{
				deps: fakeProvider(async (state) => {
					captured = state;
					return NUDGE_ANSWER;
				}),
			},
		);
		await settle(harness);
		expect(captured.length).toBeLessThan(2500);
		expect(captured).not.toContain("sk-abcdefghijklmnop");
		expect(captured).not.toContain("abcdefgh12345678");
		expect(captured).not.toContain("AKIAIOSFODNN7EXAMPLE2");
		expect(captured).toContain("[REDACTED]");
		expect(harness.messages).toHaveLength(1);
	});
});

describe("session lifecycle and command", () => {
	test("session_start writes load evidence and resets span state", async () => {
		process.env.JEV_NUDGE_PROVIDER = "stub-nudge";
		const first = makeHarness([user("request"), assistant("answer")]);
		await settle(first);
		expect(first.entries[0].data.attempt).toBe(1);

		await first.listeners.get("session_start")?.({ reason: "new" }, first.ctx);
		const status = statusFile();
		expect(status?.mode).toBe("on");
		expect(status?.key_resolved).toBe(false);
		expect(typeof status?.loaded_at).toBe("string");
		expect(status?.version).toBe("continuation-v1");

		const second = makeHarness([user("fresh request"), assistant("fresh answer")]);
		await settle(second);
		expect(second.entries[0].data.attempt).toBe(1);
	});

	test("/continuation reports mode, key source, bounds, markers, and last decision", async () => {
		process.env.JEV_NUDGE_PROVIDER = "stub-nudge";
		const harness = makeHarness([user("request"), assistant("answer"), marker(1), tool("edit", "a")]);
		const command = harness.commands.get("continuation");
		expect(command).toBeDefined();
		await command?.handler("", harness.ctx);
		const report = harness.messages[0].message.content as string;
		expect(report).toContain("mode: on");
		expect(report).toContain("key resolved: no (stub-nudge, test stub)");
		expect(report).toContain("max nudges per prompt: 2");
		expect(report).toContain("nudges this prompt span: 1");
		expect(report).toContain("last decision:");
	});

	test("the command never prints a resolved key value", async () => {
		const harness = makeHarness([user("request"), assistant("answer")]);
		await harness.listeners.get("session_start")?.({ reason: "startup" }, harness.ctx);
		await harness.commands.get("continuation")?.handler("", harness.ctx);
		const report = harness.messages[0].message.content as string;
		expect(report).not.toContain("test-key");
		expect(report).toContain("key resolved: yes (modelRegistry)");
	});
});