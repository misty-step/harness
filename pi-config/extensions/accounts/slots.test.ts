import { expect, test } from "bun:test";
import type { Api, Model, Provider, StreamOptions } from "@earendil-works/pi-ai";
import { cloneProvider, subscriptionTier } from "./slots.ts";

test("a slot's models resolve to the slot's own login while requests are built as the base provider", () => {
	const built: string[] = [];
	const base = {
		id: "openai-codex",
		name: "OpenAI Codex",
		auth: { oauth: {} },
		getModels: () => [{ id: "gpt-a", provider: "openai-codex" }],
		stream: (model: { provider: string }) => built.push(model.provider),
		streamSimple: (model: { provider: string }) => built.push(model.provider),
	} as unknown as Provider;
	const slot = cloneProvider(base, "openai-codex-2");

	expect(slot.id).toBe("openai-codex-2");
	expect(slot.name).toBe("OpenAI Codex (account 2)");
	const [model] = slot.getModels();
	expect(`${model.provider}/${model.id}`).toBe("openai-codex-2/gpt-a");
	expect(base.getModels()[0].provider).toBe("openai-codex");
	slot.stream(model, { messages: [] });
	slot.streamSimple(model, { messages: [] });
	expect(built).toEqual(["openai-codex", "openai-codex"]);
});

test("US-045 an API-key slot (even of a provider that also offers OAuth) resolves only its own stored key, never the base's ambient key", async () => {
	const base = { id: "openrouter", name: "OpenRouter", auth: { oauth: {}, apiKey: { name: "k", resolve: async () => ({ auth: { apiKey: "ambient" } }) } }, getModels: () => [] } as unknown as Provider;
	const slot = cloneProvider(base, "openrouter-2");
	const resolve = slot.auth.apiKey!.resolve;
	expect(await resolve({ credential: undefined } as never)).toBeUndefined();
	expect((await resolve({ credential: { type: "api_key", key: "own" } } as never))?.auth.apiKey).toBe("own");
});


for (const kind of ["stream", "streamSimple"] as const) {
	test(`${kind}: subscription members default to fast without changing caller payloads, overrides or paid routes`, async () => {
		let captured: StreamOptions | undefined;
		const base = {
			id: "openai",
			name: "OpenAI",
			auth: { oauth: {} },
			getModels: () => [],
			[kind]: (_model: Model<Api>, _context: unknown, options?: StreamOptions) => {
				captured = options;
				return undefined as never;
			},
		} as unknown as Provider;
		const model = { provider: "openai-2", api: "openai-responses" } as Model<Api>;
		const slot = subscriptionTier(cloneProvider(base, "openai-2"), (target) => target.provider === "openai-2");
		const payload = { model: "gpt-6.1-sol", reasoning: { effort: "xhigh" } };
		slot[kind](model, { messages: [] });
		expect(await captured!.onPayload!(payload, model)).toEqual({ ...payload, service_tier: "priority" });
		expect(payload).not.toHaveProperty("service_tier");

		const replacement = { model: "gpt-6.1-sol", reasoning: { effort: "low" } };
		slot[kind](model, { messages: [] }, { onPayload: async () => replacement });
		expect(await captured!.onPayload!(payload, model)).toEqual({ ...replacement, service_tier: "priority" });
		expect(replacement).not.toHaveProperty("service_tier");
		for (const tier of ["default", "flex", "fast", "priority", null]) {
			const explicit = { ...replacement, service_tier: tier };
			slot[kind](model, { messages: [] }, { onPayload: async () => explicit });
			expect(await captured!.onPayload!(payload, model)).toBe(explicit);
		}
		slot[kind](model, { messages: [] }, { serviceTier: "default" } as StreamOptions & { serviceTier: string });
		expect(await captured!.onPayload!(payload, model)).toEqual({ ...payload, service_tier: "default" });
		slot[kind](model, { messages: [] }, { onPayload: async () => null });
		expect(await captured!.onPayload!(payload, model)).toBeNull();

		const paid = subscriptionTier(base, () => false);
		const options = { temperature: 0.5 };
		paid[kind]({ ...model, provider: "openai" }, { messages: [] }, options);
		expect(captured).toBe(options);
		const codex = subscriptionTier({ ...base, id: "openai-codex" }, () => false);
		codex[kind]({ ...model, provider: "openai-codex", api: "openai-codex-responses" }, { messages: [] });
		expect(await captured!.onPayload!(payload, model)).toEqual({ ...payload, service_tier: "priority" });
		const xai = { ...base, id: "xai" };
		expect(subscriptionTier(xai, () => true)).toBe(xai);
		const router = { ...base, id: "openrouter" };
		expect(subscriptionTier(router, () => true)).toBe(router);
	});
}
