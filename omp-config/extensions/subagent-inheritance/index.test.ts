import { expect, mock, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Scope = {
	chains: Record<string, string[]>;
	disabled: string[];
	modelFallback?: boolean;
	rejectRecoveryPin?: boolean;
	ignoreRecoveryPin?: boolean;
	extensionChanges?: Record<string, () => void>;
};
const scopes = new Map<string, Scope>();
let nextScope = 0;
// Standalone tests exercise the native record-merge and scoped-setting boundary;
// the smoke run separately proves OMP's real async-local child scope.
mock.module("@oh-my-pi/pi-coding-agent/config/registry", () => ({
	lookup: (id: string) => id === "retry.fallbackChains" ? {
		get: (scope: Scope) => scope.chains,
		override: (scope: Scope, value: Scope["chains"]) => {
			if (scope.rejectRecoveryPin) throw new Error("Recovery override refused");
			if (!scope.ignoreRecoveryPin) scope.chains = { ...scope.chains, ...value };
		},
	} : id === "retry.modelFallback" ? {
		get: (scope: Scope) => scope.modelFallback ?? true,
		override: (scope: Scope, value: boolean) => { scope.modelFallback = value; },
	} : id === "task.disabledAgents" ? {
		get: (scope: Scope) => scope.disabled,
		override: (scope: Scope, value: string[]) => { scope.disabled = value; },
	} : id === "extensions" || id === "disabledExtensions" ? {
		listen: (scope: Scope, callback: () => void) => {
			(scope.extensionChanges ??= {})[id] = callback;
			return () => { delete scope.extensionChanges?.[id]; };
		},
	} : undefined,
}));
mock.module("@oh-my-pi/pi-coding-agent/config/settings", () => ({
	findScopedSettings: (cwd: string) => scopes.get(cwd),
}));
const { default: registerSubagentInheritance } = await import("./index.ts");

type ParentModel = { provider: string; id: string };
type Identity = { id: string; name: string; parentId?: string };
type Entry = { type: string; agent?: string; resolvedModel?: string; customType?: string; data?: unknown };
type SpawnHook = (event: { agent: string; invocationKind: "task" | "eval"; spawnKey?: string; modelRole?: string; patterns: string[] }, ctx: {
	agent: Identity;
	model?: ParentModel;
	modelRegistry: { find: (provider: string, id: string) => ParentModel | undefined; getApiKey: () => Promise<string | undefined> };
	abort: () => void;
}) => unknown;
type ToolHook = (event: { toolName: string; input: Record<string, unknown> }) => unknown;
type StartContext = {
	cwd: string;
	model?: ParentModel;
	agent: Identity;
	sessionManager: { getEntries: () => Entry[] };
};
type StartHook = (event: unknown, ctx: StartContext) => unknown;
type RequestHook = (event: unknown, ctx: {
	model?: ParentModel; agent: Identity; sessionManager: { getEntries: () => Entry[] }; abort: () => void;
}) => unknown;

function hooks(auth = async (): Promise<string | undefined> => "test-key", catalog = true,
	scope: Scope = { chains: { default: ["openai-codex/gpt-6.1-sol:high"] },
		disabled: ["reviewer", "security-reviewer", "designer", "foreign-agent"] }) {
	const state = { level: "max", aborted: false };
	let spawn: SpawnHook | undefined;
	let toolCall: ToolHook | undefined;
	let start: StartHook | undefined;
	let request: RequestHook | undefined;
	let sessionModel: ParentModel | undefined;
	const cwd = `scope-${nextScope++}`;
	const identity: Identity = { id: cwd, name: "main" };
	const entries: Entry[] = [];
	const manager = { getEntries: () => entries };
	let nextSpawn = 0;
	scopes.set(cwd, scope);
	registerSubagentInheritance({
		on(event: string, callback: SpawnHook | ToolHook | StartHook | RequestHook) {
			if (event === "before_subagent_spawn") spawn = callback as SpawnHook;
			else if (event === "tool_call") toolCall = callback as ToolHook;
			else if (event === "session_start") start = callback as StartHook;
			else if (event === "before_provider_request") request = callback as RequestHook;
			else if (event === "session_shutdown") return;
			else throw new Error(`Unexpected hook: ${event}`);
		},
		getThinkingLevel() { return state.level; },
		setThinkingLevel(value: string) { state.level = value; },
		appendEntry(customType: string, data: unknown) { entries.push({ type: "custom", customType, data }); },
	} as unknown as ExtensionAPI);
	if (!start) throw new Error("Session-start guard was not registered");
	start({}, { cwd, agent: { ...identity }, sessionManager: { getEntries: () => [] } });
	return {
		scope,
		cwd,
		state,
		entries,
		async start(agent: string, model: ParentModel, author = { provider: "openai-codex", id: "gpt-6.1-sol" }) {
			if (!start) throw new Error("Session-start guard was not registered");
			const sender = hooks();
			await sender.select(agent, author, "max", "task", identity.id);
			identity.name = agent;
			identity.parentId = sender.cwd;
			sessionModel = model;
			entries.push({ type: "session_init", agent, resolvedModel: `${model.provider}/${model.id}:max` });
			start({}, { cwd, model, agent: { ...identity }, sessionManager: manager });
		},
		revive(agent: string, model: ParentModel) {
			if (!start) throw new Error("Session-start guard was not registered");
			identity.name = agent;
			sessionModel = model;
			entries.push({ type: "session_init", agent, resolvedModel: `${model.provider}/${model.id}:max` });
			start({}, { cwd, model, agent: { ...identity }, sessionManager: manager });
		},
		request(model = sessionModel) {
			if (!request) throw new Error("Provider-request guard was not registered");
			return request({}, { model, agent: identity, sessionManager: manager, abort: () => { state.aborted = true; } });
		},
		select(agent: string, parent: ParentModel | undefined, thinking: string,
			invocationKind: "task" | "eval" = "task", spawnKey = `${cwd}-spawn-${nextSpawn++}`,
			patterns: string[] = [], modelRole?: string) {
			state.level = thinking;
			if (!spawn) throw new Error("Subagent spawn hook was not registered");
			return spawn({ agent, invocationKind, spawnKey, patterns, modelRole }, {
				agent: identity,
				model: parent,
				abort: () => { state.aborted = true; },
				modelRegistry: {
					find: (provider: string, id: string) => catalog ? { provider, id } : undefined,
					getApiKey: auth,
				},
			});
		},
		call(input: Record<string, unknown>, toolName = "task") {
			if (!toolCall) throw new Error("Task tool-call guard was not registered");
			return toolCall({ toolName, input });
		},
	};
}

test("ordinary task agents keep configured routes instead of inheriting an expensive parent", async () => {
	const { select } = hooks();
	for (const agent of ["task", "scout", "sonic"]) {
		expect(await select(agent, { provider: "openai-codex", id: "gpt-6-astra" }, "max")).toBeUndefined();
	}
	expect(await select("task", undefined, "max")).toBeUndefined();
});

test("an explicitly tagged task model and non-task dispatch keep their own selection", async () => {
	const { select } = hooks();
	const parent = { provider: "anthropic", id: "claude-opus-5-5" };
	expect(await select("m1", parent, "max")).toBeUndefined();
});

test("designer routes to Opus high from any parent and preserves higher Opus effort", async () => {
	const { select } = hooks();
	const opus = { provider: "anthropic", id: "claude-opus-5-5" };
	expect(await select("designer", opus, "medium")).toEqual({ model: "anthropic/claude-opus-5-5:high" });
	expect(await select("designer", opus, "xhigh")).toEqual({ model: "anthropic/claude-opus-5-5:xhigh" });
	expect(await select("designer", opus, "max")).toEqual({ model: "anthropic/claude-opus-5-5:max" });
	expect(await select("designer", { provider: "anthropic", id: "claude-sonnet-5-5" }, "medium"))
		.toEqual({ model: "anthropic/claude-opus-5-5:high" });
	expect(await select("designer", { provider: "openai-codex", id: "gpt-6-astra" }, "max"))
		.toEqual({ model: "anthropic/claude-opus-5-5:high" });
	expect(await select("designer", undefined, "max")).toEqual({ model: "anthropic/claude-opus-5-5:high" });
});

test("designer blocks missing catalog, absent auth and failed auth rather than using the parent", async () => {
	const parent = { provider: "openai-codex", id: "gpt-6-astra" };
	for (const guard of [
		hooks(async () => undefined),
		hooks(async () => { throw new Error("credential lookup failed"); }),
		hooks(async () => "test-key", false),
	]) {
		expect(await guard.select("designer", parent, "medium")).toMatchObject({ block: true });
	}
});

test("reviewers retain Sonnet high for task and eval dispatch regardless of author", async () => {
	const { select } = hooks();
	for (const agent of ["reviewer", "security-reviewer"]) {
		for (const invocation of ["task", "eval"] as const) {
			for (const parent of [undefined, { provider: "openai-codex", id: "gpt-6.1-sol" },
				{ provider: "anthropic", id: "claude-opus-5-5" }, { provider: "custom", id: "unknown" }]) {
				expect(await select(agent, parent, "max", invocation)).toEqual({ model: "anthropic/claude-sonnet-5-5:high" });
			}
		}
	}
});

test("reviewers refuse unavailable Sonnet catalog or authentication", async () => {
	for (const agent of ["reviewer", "security-reviewer"]) {
		for (const guard of [
			hooks(async () => undefined),
			hooks(async () => { throw new Error("credential lookup failed"); }),
			hooks(async () => "test-key", false),
		]) {
			expect(await guard.select(agent, { provider: "openai-codex", id: "gpt-6.1-sol" }, "high"))
				.toMatchObject({ block: true });
		}
	}
});

test("per-item low effort cannot lower designer below the visual minimum", () => {
	const { call } = hooks();
	expect(call({ context: "Visual review", tasks: [
		{ agent: "task", task: "Inspect code", effort: "lo" },
		{ agent: "designer", task: "Inspect design", effort: "lo" },
	] })).toMatchObject({ block: true });
	expect(call({ agent: "designer", task: "Inspect design", effort: "med" })).toMatchObject({ block: true });
	expect(call({ agent: "designer", task: "Inspect design", effort: "hi" })).toBeUndefined();
	expect(call({ agent: "task", task: "Inspect code", effort: "lo" })).toBeUndefined();
});

test("child recovery pin empties inherited exact, effort and wildcard chains without mutating the engineer", async () => {
	const parent = hooks();
	const initial = {
		default: ["openai-codex/gpt-6.1-sol:high"],
		"anthropic/claude-sonnet-5-5": ["openai-codex/gpt-6.1-sol:high"],
		"anthropic/claude-sonnet-5-5:high": ["openai-codex/gpt-6.1-sol:medium"],
		"anthropic/*": ["openai-codex/gpt-6.1-sol:high"],
	};
	const child = hooks(undefined, true, { chains: { ...initial }, disabled: ["reviewer", "foreign-agent"] });
	await child.start("reviewer", { provider: "anthropic", id: "claude-sonnet-5-5" });
	expect(child.scope.chains).toEqual(Object.fromEntries(
		[...Object.keys(initial), "reviewer", "security-reviewer"].map(key => [key, []])));
	expect(child.state.level).toBe("high");
	expect(child.scope.disabled).toEqual(["foreign-agent"]);
	expect(parent.scope.chains).toEqual({ default: ["openai-codex/gpt-6.1-sol:high"] });
});

test("security reviewer pins Sonnet high even when the task requested maximum thinking", async () => {
	const child = hooks();
	await child.start("security-reviewer", { provider: "anthropic", id: "claude-sonnet-5-5" });
	expect(child.state.level).toBe("high");
	expect(child.scope.chains).toEqual({ default: [], reviewer: [], "security-reviewer": [] });
});

test("failed or ineffective child recovery pin aborts before a provider request and refuses another specialist spawn", async () => {
	for (const failure of [{ rejectRecoveryPin: true }, { ignoreRecoveryPin: true }]) {
		const child = hooks(undefined, true, {
			chains: { "anthropic/*": ["openai-codex/gpt-6.1-sol:high"] },
			disabled: ["reviewer", "foreign-agent"], ...failure,
		});
		await child.start("reviewer", { provider: "anthropic", id: "claude-sonnet-5-5" });
		await expect(child.request()).rejects.toThrow("review aborted");
		expect(child.state.aborted).toBe(true);
		expect(await child.select("reviewer", { provider: "openai-codex", id: "gpt-6.1-sol" }, "high"))
			.toMatchObject({ block: true });
	}
});

test("missing scoped settings keeps protected dispatch closed and aborts a revived reviewer", async () => {
	const guard = hooks();
	scopes.delete(guard.cwd);
	await guard.start("reviewer", { provider: "anthropic", id: "claude-sonnet-5-5" });
	expect(await guard.select("reviewer", { provider: "openai-codex", id: "gpt-6.1-sol" }, "high"))
		.toMatchObject({ block: true });
	await expect(guard.request()).rejects.toThrow("review aborted");
	expect(guard.state.aborted).toBe(true);
});

test("SDK startup substitution and later model changes cannot produce a reviewer request", async () => {
	const substituted = hooks();
	await substituted.start("reviewer", { provider: "openai-codex", id: "gpt-6.1-sol" });
	await expect(substituted.request()).rejects.toThrow("review aborted");
	expect(substituted.state.aborted).toBe(true);
	const child = hooks();
	await child.start("reviewer", { provider: "anthropic", id: "claude-sonnet-5-5" });
	await expect(child.request({ provider: "openai-codex", id: "gpt-6.1-sol" })).rejects.toThrow("review aborted");
	expect(child.state.aborted).toBe(true);
});

test("extension changes revoke protected permission even while specialist authentication is pending", async () => {
	const auth = Promise.withResolvers<string>();
	const guard = hooks(() => auth.promise);
	const selection = guard.select("reviewer", { provider: "openai-codex", id: "gpt-6.1-sol" }, "high");
	guard.scope.extensionChanges?.disabledExtensions?.();
	auth.resolve("test-key");
	expect(await selection).toMatchObject({ block: true });
	expect(guard.scope.disabled).toEqual(["foreign-agent", "reviewer", "security-reviewer", "designer"]);
});

test("persisted caller pin refuses cold startup on the SDK's substituted model", async () => {
	const child = hooks();
	await child.start("reviewer", { provider: "anthropic", id: "claude-sonnet-5-5" });
	child.revive("reviewer", { provider: "openai-codex", id: "gpt-6.1-sol" });
	await expect(child.request()).rejects.toThrow("review aborted");
	expect(child.state.aborted).toBe(true);
});

test("a reviewer without caller correlation or a persisted pin cannot request a model", async () => {
	const child = hooks();
	child.revive("reviewer", { provider: "openai-codex", id: "gpt-6.1-sol" });
	await expect(child.request()).rejects.toThrow("review aborted");
	expect(child.state.aborted).toBe(true);
});

test("a concurrent duplicate spawn identity cannot replace the first caller's review decision", async () => {
	const parent = hooks();
	await parent.select("reviewer", { provider: "openai-codex", id: "gpt-6.1-sol" }, "high", "task", "pending-review");
	expect(await parent.select("reviewer", { provider: "anthropic", id: "claude-opus-5-5" }, "high", "task", "pending-review"))
		.toMatchObject({ block: true });
});

test("same-model high review requests remain allowed without cross-model recovery", async () => {
	for (const agent of ["reviewer", "security-reviewer"]) {
		const child = hooks();
		await child.start(agent, { provider: "anthropic", id: "claude-sonnet-5-5" });
		await expect(child.request()).resolves.toBeUndefined();
		expect(child.state.level).toBe("high");
		expect(child.scope.modelFallback).toBe(false);
		expect(child.state.aborted).toBe(false);
	}
});

test("reviewer thinking drift and obsolete persisted Grok pins abort before a provider request", async () => {
	for (const agent of ["reviewer", "security-reviewer"]) {
		const child = hooks();
		await child.start(agent, { provider: "anthropic", id: "claude-sonnet-5-5" });
		child.state.level = "max";
		await expect(child.request()).rejects.toThrow("review aborted");
		expect(child.state.aborted).toBe(true);
		const obsolete = hooks();
		obsolete.entries.push({ type: "custom", customType: "harness:reviewer-model-pin", data: "cursor/grok-4.7" });
		obsolete.revive(agent, { provider: "cursor", id: "grok-4.7" });
		await expect(obsolete.request()).rejects.toThrow("review aborted");
		expect(obsolete.state.aborted).toBe(true);
	}
});

const GROK = { provider: "xai-oauth", id: "grok-4.20" };
// Fixed policy fixture, independent of the query: an incompatible hold must
// fail rather than being echoed into a permissive fake response.
function centralAnswer(taskKind = "build") {
	return {
		schema_version: 1, policy_version: "K-20261012-2", ok: true,
		request: { task_kind: taskKind, harness: "omp", model_hold: "xai-oauth/grok-4.20",
			family_hold: null, eligible_models: ["xai-oauth/grok-4.20"] },
		choice: { provider: "xai-oauth", model: "grok-4.20", reasoning: "high",
			selector: "xai-oauth/grok-4.20:high", billing: "plan" },
		fallback_gate: { allowed: true, families: {
			anthropic: { low: true, no_near_reset: true },
			openai: { low: true, no_near_reset: true },
		} },
	};
}

test("restricted startup holds cannot enter ordinary recovery or a substituted primary", async () => {
	const guard = hooks(undefined, true, {
		chains: { default: ["openai-codex/gpt-6-astra:xhigh"], "google-antigravity/*": ["openai-codex/gpt-6.1-sol:xhigh"] },
		disabled: [],
	});
	guard.revive("main", { provider: "google-antigravity", id: "gemini-3.8-flash" });
	expect(guard.scope.modelFallback).toBe(false);
	expect(Object.values(guard.scope.chains).every(chain => chain.length === 0)).toBe(true);
	await expect(guard.request({ provider: "openai-codex", id: "gpt-6-astra" })).rejects.toThrow("hold changed");
	expect(guard.state.aborted).toBe(true);
});

async function withCentralRoute(
	response: (url: URL) => Response | Promise<Response>, exercise: (reads: URL[]) => Promise<void>,
) {
	const reads: URL[] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1", port: 0,
		fetch(request) {
			const url = new URL(request.url);
			reads.push(url);
			return response(url);
		},
	});
	const previous = process.env.AI_USAGE_ROUTER_URL;
	process.env.AI_USAGE_ROUTER_URL = server.url.origin;
	try {
		await exercise(reads);
	} finally {
		if (previous === undefined) delete process.env.AI_USAGE_ROUTER_URL;
		else process.env.AI_USAGE_ROUTER_URL = previous;
		server.stop(true);
	}
}

test("policy2 open exact route permits restricted requests and queries only the held native model", async () => {
	for (const [agent, kind] of [
		["task", "build"], ["scout", "research"], ["sonic", "mechanical"], ["designer", "design"],
	]) {
		await withCentralRoute(() => Response.json(centralAnswer(kind)), async reads => {
			const guard = hooks();
			guard.revive(agent, GROK);
			guard.state.level = "high";
			await expect(guard.request()).resolves.toBeUndefined();
			expect(guard.state.aborted).toBe(false);
			expect(reads).toHaveLength(1);
			expect(reads[0].pathname).toBe("/v1/route");
			expect([...reads[0].searchParams]).toEqual([
				["task_kind", kind], ["harness", "omp"],
				["model_hold", "xai-oauth/grok-4.20"], ["eligible_model", "xai-oauth/grok-4.20"],
			]);
		});
	}
});

test("closed unknown stale old missing and incompatible answers cannot reach a restricted provider or fallback", async () => {
	const closed = centralAnswer();
	closed.fallback_gate.allowed = false;
	const old = { ...centralAnswer(), policy_version: "K-20261012-1" };
	const unknown = { ...centralAnswer(), ok: false, choice: null,
		fallback_gate: { allowed: false, families: { anthropic: { low: null, no_near_reset: null } } } };
	const stale = { ...unknown, reason: "Stale quota evidence." };
	const wrongHold = centralAnswer();
	wrongHold.request.model_hold = "anthropic/claude-sonnet-5-5";
	for (const answer of [
		closed, old, unknown, stale, { ...centralAnswer(), fallback_gate: undefined },
		{ ...centralAnswer(), choice: null }, { ...centralAnswer(), schema_version: 2 }, wrongHold,
		{ ...centralAnswer(), choice: { ...centralAnswer().choice, reasoning: "xhigh" } },
		{ ...centralAnswer(), choice: { ...centralAnswer().choice, billing: "credits" } },
		{ ...centralAnswer(), choice: { ...centralAnswer().choice, provider: "openrouter" } },
		{ ...centralAnswer(), request: { ...centralAnswer().request, eligible_models: ["anthropic/claude-sonnet-5-5"] } },
		{ ...centralAnswer(), request: { ...centralAnswer().request, family_hold: "anthropic" } },
	]) {
		await withCentralRoute(() => Response.json(answer), async reads => {
			const guard = hooks();
			guard.revive("task", GROK);
			guard.state.level = "high";
			const downstream = mock();
			const fallback = mock();
			try {
				await guard.request();
				downstream();
			} catch {
				// OMP isolates hook errors; cancellation must independently prevent recovery.
				if (!guard.state.aborted) fallback();
			}
			expect(guard.state.aborted).toBe(true);
			expect(downstream).not.toHaveBeenCalled();
			expect(fallback).not.toHaveBeenCalled();
			expect(reads).toHaveLength(1);
		});
	}
});

test("missing router environment refuses every Grok provider and Antigravity Gemini without route or auth fallback", async () => {
	const previous = process.env.AI_USAGE_ROUTER_URL;
	delete process.env.AI_USAGE_ROUTER_URL;
	try {
		for (const model of [GROK, { provider: "cursor", id: "grok-4.7" },
			{ provider: "openrouter", id: "x-ai/grok-4" },
			{ provider: "google-antigravity", id: "gemini-3-pro" }]) {
			const auth = mock(async () => "test-key");
			const guard = hooks(auth);
			guard.revive("task", model);
			await expect(guard.request()).rejects.toThrow("AI_USAGE_ROUTER_URL is missing");
			expect(guard.state.aborted).toBe(true);
			expect(auth).not.toHaveBeenCalled();
		}
	} finally {
		if (previous !== undefined) process.env.AI_USAGE_ROUTER_URL = previous;
	}
});

test("failed HTTP and malformed central answers refuse restricted requests", async () => {
	for (const response of [new Response("unavailable", { status: 503 }), new Response("not JSON")]) {
		await withCentralRoute(() => response, async () => {
			const guard = hooks();
			guard.revive("task", GROK);
			await expect(guard.request()).rejects.toThrow("Restricted model refused");
			expect(guard.state.aborted).toBe(true);
		});
	}
});

test("central timeout refuses a restricted request before provider execution", async () => {
	await withCentralRoute(() => new Promise<Response>(() => {}), async () => {
		const guard = hooks();
		guard.revive("task", GROK);
		await expect(guard.request()).rejects.toThrow("Restricted model refused");
		expect(guard.state.aborted).toBe(true);
	});
}, 10_000);

test("explicit native spawn patterns require exact central admission and recheck before the provider", async () => {
	let open = true;
	await withCentralRoute(() => {
		const answer = centralAnswer("research");
		answer.fallback_gate.allowed = open;
		return Response.json(answer);
	}, async reads => {
		const guard = hooks();
		expect(await guard.select("scout", undefined, "high", "eval", "explicit",
			["xai-oauth/grok-4.20:high"])).toBeUndefined();
		open = false;
		guard.revive("scout", GROK);
		guard.state.level = "high";
		await expect(guard.request()).rejects.toThrow("Restricted model refused");
		expect(guard.state.aborted).toBe(true);
		expect(reads).toHaveLength(2);
	});
});

test("denied explicit spawn blocks without specialist auth and cannot escape an incompatible hold", async () => {
	await withCentralRoute(() => Response.json(centralAnswer()), async reads => {
		for (const pattern of ["cursor/grok-4.7:high", "xai-oauth/grok-4.20:xhigh",
			"google-antigravity/gemini-3-pro:high", "xai-oauth/grok-*:high"]) {
			const auth = mock(async () => "test-key");
			const guard = hooks(auth);
			expect(await guard.select("task", undefined, "high", "task", "denied", [pattern]))
				.toMatchObject({ block: true, reason: expect.stringContaining("Restricted model refused") });
			expect(guard.state.aborted).toBe(true);
			expect(auth).not.toHaveBeenCalled();
		}
		expect(reads).toHaveLength(3);
	});
});

test("extension revocation closes a pending restricted route even when the central answer is open", async () => {
	const result = Promise.withResolvers<Response>();
	await withCentralRoute(() => result.promise, async () => {
		const guard = hooks();
		guard.revive("task", GROK);
		guard.state.level = "high";
		const request = guard.request();
		guard.scope.extensionChanges?.extensions?.();
		result.resolve(Response.json(centralAnswer()));
		await expect(request).rejects.toThrow("Restricted model refused");
		expect(guard.state.aborted).toBe(true);
	});
});

test("a closed central gate and missing router block an explicit restricted spawn before dispatch", async () => {
	const answer = centralAnswer();
	answer.fallback_gate.allowed = false;
	await withCentralRoute(() => Response.json(answer), async () => {
		const guard = hooks();
		expect(await guard.select("task", undefined, "high", "task", "closed", ["xai-oauth/grok-4.20:high"]))
			.toMatchObject({ block: true });
		expect(guard.state.aborted).toBe(true);
	});
	const previous = process.env.AI_USAGE_ROUTER_URL;
	delete process.env.AI_USAGE_ROUTER_URL;
	try {
		const guard = hooks();
		expect(await guard.select("scout", undefined, "high", "eval", "missing", ["xai-oauth/grok-4.20:high"]))
			.toMatchObject({ block: true, reason: expect.stringContaining("AI_USAGE_ROUTER_URL is missing") });
		expect(guard.state.aborted).toBe(true);
	} finally {
		if (previous !== undefined) process.env.AI_USAGE_ROUTER_URL = previous;
	}
});

test("a failed central connection aborts a restricted request", async () => {
	const previous = process.env.AI_USAGE_ROUTER_URL;
	const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
	process.env.AI_USAGE_ROUTER_URL = server.url.origin;
	server.stop(true);
	try {
		const guard = hooks();
		guard.revive("task", GROK);
		await expect(guard.request()).rejects.toThrow("Restricted model refused");
		expect(guard.state.aborted).toBe(true);
	} finally {
		if (previous === undefined) delete process.env.AI_USAGE_ROUTER_URL;
		else process.env.AI_USAGE_ROUTER_URL = previous;
	}
});

test("unrestricted Codex Claude and non-Antigravity Gemini requests need no fallback gate", async () => {
	const previous = process.env.AI_USAGE_ROUTER_URL;
	delete process.env.AI_USAGE_ROUTER_URL;
	try {
		for (const model of [
			{ provider: "openai-codex", id: "gpt-6.1-sol" },
			{ provider: "anthropic", id: "claude-sonnet-5-5" },
			{ provider: "google", id: "gemini-3-pro" },
		]) {
			const guard = hooks();
			guard.revive("task", model);
			await expect(guard.request()).resolves.toBeUndefined();
			expect(guard.state.aborted).toBe(false);
		}
	} finally {
		if (previous !== undefined) process.env.AI_USAGE_ROUTER_URL = previous;
	}
});
