/**
 * Pure unit tests for extensions/openrouter-live/live.ts. Run with
 * `bun test extensions/` — same contract as extensions/failover/decide.test.ts:
 * brain-only, no harness import, no network, no filesystem.
 */
import { expect, test } from "bun:test";
import {
	type LiveModelEntry,
	type OpenRouterModel,
	MIN_LIVE_MODELS,
	isToolCapable,
	mapModel,
	mergeEntries,
	newModelIds,
	sanityOk,
} from "./live.ts";

function model(partial: Partial<OpenRouterModel>): OpenRouterModel {
	return {
		id: "example/model",
		name: "Example Model",
		context_length: 128000,
		supported_parameters: ["tools"],
		...partial,
	};
}

test("isToolCapable requires tools in supported_parameters", () => {
	expect(isToolCapable(model({}))).toBe(true);
	expect(isToolCapable(model({ supported_parameters: ["tools", "reasoning"] }))).toBe(
		true,
	);
	expect(isToolCapable(model({ supported_parameters: ["reasoning"] }))).toBe(false);
	expect(isToolCapable(model({ supported_parameters: null }))).toBe(false);
	expect(isToolCapable({})).toBe(false);
});

test("sanityOk refuses implausibly small catalogs", () => {
	const list = Array.from({ length: MIN_LIVE_MODELS }, (_, i) => ({ id: `m/${i}` }));
	expect(sanityOk(list)).toBe(true);
	expect(sanityOk(list.slice(1))).toBe(false);
	expect(sanityOk([])).toBe(false);
});

test("mapModel mirrors the pi.dev field mapping (union-alpha shape)", () => {
	const entry = mapModel(
		model({
			id: "stealth/union-alpha",
			name: "Union Alpha",
			context_length: 262144,
			top_provider: { context_length: 262144, max_completion_tokens: 131072 },
			architecture: { input_modalities: ["text", "image"] },
			supported_parameters: ["tools"],
			pricing: { prompt: "0", completion: "0" },
		}),
	) as LiveModelEntry;
	expect(entry).toEqual({
		id: "stealth/union-alpha",
		name: "Union Alpha",
		contextWindow: 262144,
		maxTokens: 131072,
		input: ["text", "image"],
		reasoning: false,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	});
});

test("mapModel prefers top_provider.context_length over the model level", () => {
	const entry = mapModel(
		model({
			context_length: 1000000,
			top_provider: { context_length: 200000, max_completion_tokens: 8192 },
		}),
	)!;
	expect(entry.contextWindow).toBe(200000);
	expect(entry.maxTokens).toBe(8192);
});

test("mapModel falls back to context_length and the conservative cap", () => {
	const entry = mapModel(model({ context_length: 99000 }))!;
	expect(entry.contextWindow).toBe(99000);
	expect(entry.maxTokens).toBe(32768);
});

test("mapModel scales per-token prices to per-1M and accepts strings", () => {
	const entry = mapModel(
		model({
			pricing: {
				prompt: "0.000003",
				completion: "0.000015",
				input_cache_read: "0.0000003",
				input_cache_write: "0.00000375",
			},
		}),
	)!;
	expect(entry.cost).toEqual({
		input: 3,
		output: 15,
		cacheRead: 0.3,
		cacheWrite: 3.75,
	});
});

test("mapModel maps missing or bad prices to zero, never NaN", () => {
	const entry = mapModel(
		model({ pricing: { prompt: "oops", completion: null, input_cache_read: undefined } }),
	)!;
	expect(entry.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
});

test("mapModel restricts input to text and image, text first", () => {
	const entry = mapModel(
		model({
			architecture: { input_modalities: ["image", "file", "text"] },
		}),
	)!;
	expect(entry.input).toEqual(["text", "image"]);
	expect(mapModel(model({ architecture: null }))!.input).toEqual(["text"]);
	expect(mapModel(model({}))!.input).toEqual(["text"]);
});

test("mapModel derives reasoning from supported_parameters", () => {
	expect(mapModel(model({ supported_parameters: ["tools", "reasoning"] }))!.reasoning).toBe(
		true,
	);
	expect(mapModel(model({ supported_parameters: ["tools"] }))!.reasoning).toBe(false);
});

test("mapModel rejects identity-less and non-tool-capable models", () => {
	expect(mapModel(model({ supported_parameters: [] }))).toBeNull();
	expect(mapModel(model({ supported_parameters: null }))).toBeNull();
	expect(mapModel({ name: "No id" })).toBeNull();
});

test("newModelIds filters known ids and sorts the rest", () => {
	const live = [
		model({ id: "stealth/union-alpha" }),
		model({ id: "acme/brand-new" }),
		model({ id: "anthropic/claude-sonnet-4.5" }),
		model({ id: "acme/brand-new" }),
		model({ id: "acme/no-tools", supported_parameters: [] }),
	];
	const known = new Set([
		"openrouter/anthropic/claude-sonnet-4.5",
		"openrouter/stealth/union-alpha",
		"qwen/qwen3-coder",
	]);
	expect(newModelIds(live, known)).toEqual(["acme/brand-new"]);
});

test("mergeEntries appends only missing ids, preserving everything else", () => {
	const doc = {
		providers: {
			openrouter: {
				models: [{ id: "stealth/union-alpha", name: "Union Alpha" }],
			},
			other: { models: [{ id: "keep/me" }] },
		},
		foreignKey: 1,
	};
	const fresh: LiveModelEntry[] = [
		{
			id: "acme/brand-new",
			name: "Brand New",
			contextWindow: 1,
			maxTokens: 1,
			input: ["text"],
			reasoning: false,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		},
		{
			id: "stealth/union-alpha",
			name: "Union Alpha rewritten",
			contextWindow: 9,
			maxTokens: 9,
			input: ["text"],
			reasoning: false,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		},
	];
	const { doc: out, addedIds } = mergeEntries(doc, fresh);
	expect(addedIds).toEqual(["acme/brand-new"]);
	expect(out.foreignKey).toBe(1);
	expect((out.providers as Record<string, any>).other).toEqual({
		models: [{ id: "keep/me" }],
	});
	const models = (out.providers as any).openrouter.models;
	expect(models).toHaveLength(2);
	expect(models[0]).toEqual({ id: "stealth/union-alpha", name: "Union Alpha" });
	expect(models[1].id).toBe("acme/brand-new");
});

test("mergeEntries rebuilds the skeleton for an empty or absent doc", () => {
	const fresh: LiveModelEntry[] = [
		{
			id: "acme/brand-new",
			name: "Brand New",
			contextWindow: 1,
			maxTokens: 1,
			input: ["text"],
			reasoning: false,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		},
	];
	for (const doc of [undefined, null, {}, { providers: {} }]) {
		const { doc: out, addedIds } = mergeEntries(doc, fresh);
		expect(addedIds).toEqual(["acme/brand-new"]);
		expect((out.providers as any).openrouter.models.map((m: any) => m.id)).toEqual([
			"acme/brand-new",
		]);
	}
});