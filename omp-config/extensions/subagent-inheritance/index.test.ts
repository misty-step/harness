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
type SpawnHook = (event: { agent: string; invocationKind: "task" | "eval"; spawnKey?: string }, ctx: {
	agent: Identity;
	model?: ParentModel;
	modelRegistry: { find: (provider: string, id: string) => ParentModel | undefined; getApiKey: () => Promise<string | undefined> };
	models: { resolve: (spec: string) => ParentModel; family: (model: ParentModel) => string };
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
			invocationKind: "task" | "eval" = "task", spawnKey = `${cwd}-spawn-${nextSpawn++}`) {
			state.level = thinking;
			if (!spawn) throw new Error("Subagent spawn hook was not registered");
			return spawn({ agent, invocationKind, spawnKey }, {
				agent: identity,
				model: parent,
				models: {
					resolve: spec => {
						const [provider, id] = spec.split("/");
						return { provider, id };
					},
					family: model => model.id.startsWith("gpt-") ? "gpt" : model.id.startsWith("claude-") ? "claude" : model.id,
				},
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

test("reviewers contrast OpenAI and Anthropic authors on task and eval dispatch", async () => {
	const { select } = hooks();
	for (const agent of ["reviewer", "security-reviewer"]) {
		for (const invocation of ["task", "eval"] as const) {
			expect(await select(agent, { provider: "openai-codex", id: "gpt-6.1-sol" }, "max", invocation))
				.toEqual({ model: "anthropic/claude-sonnet-5-5:high" });
			expect(await select(agent, { provider: "anthropic", id: "claude-opus-5-5" }, "max", invocation))
				.toEqual({ model: "openai-codex/gpt-6.1-sol:medium" });
		}
	}
});

test("reviewers refuse unknown author families and unavailable cross-family models", async () => {
	for (const agent of ["reviewer", "security-reviewer"]) {
		expect(await hooks().select(agent, undefined, "high")).toMatchObject({ block: true });
		expect(await hooks().select(agent, { provider: "custom", id: "unknown" }, "high")).toMatchObject({ block: true });
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

test("security reviewer pins Sol medium even when the task requested maximum thinking", async () => {
	const child = hooks();
	await child.start("security-reviewer", { provider: "openai-codex", id: "gpt-6.1-sol" },
		{ provider: "anthropic", id: "claude-opus-5-5" });
	expect(child.state.level).toBe("medium");
	expect(child.scope.chains).toEqual({ default: [], reviewer: [], "security-reviewer": [] });
});

test("failed or ineffective child recovery pin aborts before a provider request and refuses another specialist spawn", async () => {
	for (const failure of [{ rejectRecoveryPin: true }, { ignoreRecoveryPin: true }]) {
		const child = hooks(undefined, true, {
			chains: { "anthropic/*": ["openai-codex/gpt-6.1-sol:high"] },
			disabled: ["reviewer", "foreign-agent"], ...failure,
		});
		await child.start("reviewer", { provider: "anthropic", id: "claude-sonnet-5-5" });
		expect(() => child.request()).toThrow("review aborted");
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
	expect(() => guard.request()).toThrow("review aborted");
	expect(guard.state.aborted).toBe(true);
});

test("a failed identity lookup blocks dispatch rather than leaking a swallowed spawn-hook error", async () => {
	const parent = { provider: "openai-codex", get id(): string { throw new Error("Model identity unavailable"); } };
	expect(await hooks().select("reviewer", parent, "high")).toMatchObject({ block: true });
});

test("SDK startup substitution and later model changes cannot produce a reviewer request", async () => {
	const substituted = hooks();
	await substituted.start("reviewer", { provider: "openai-codex", id: "gpt-6.1-sol" });
	expect(() => substituted.request()).toThrow("review aborted");
	expect(substituted.state.aborted).toBe(true);
	const child = hooks();
	await child.start("reviewer", { provider: "anthropic", id: "claude-sonnet-5-5" });
	expect(() => child.request({ provider: "openai-codex", id: "gpt-6.1-sol" })).toThrow("review aborted");
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
	expect(() => child.request()).toThrow("review aborted");
	expect(child.state.aborted).toBe(true);
});

test("a reviewer without caller correlation or a persisted pin cannot request a model", () => {
	const child = hooks();
	child.revive("reviewer", { provider: "openai-codex", id: "gpt-6.1-sol" });
	expect(() => child.request()).toThrow("review aborted");
	expect(child.state.aborted).toBe(true);
});

test("a concurrent duplicate spawn identity cannot replace the first caller's review decision", async () => {
	const parent = hooks();
	await parent.select("reviewer", { provider: "openai-codex", id: "gpt-6.1-sol" }, "high", "task", "pending-review");
	expect(await parent.select("reviewer", { provider: "anthropic", id: "claude-opus-5-5" }, "high", "task", "pending-review"))
		.toMatchObject({ block: true });
});
