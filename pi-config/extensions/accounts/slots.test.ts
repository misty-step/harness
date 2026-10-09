import { expect, test } from "bun:test";
import type { Provider } from "@earendil-works/pi-ai";
import { cloneProvider, poolMembers } from "./slots.ts";

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

 test("OpenAI pool includes native ChatGPT logins and preserves legacy Codex slots", () => {
 expect(poolMembers("openai-codex")).toEqual(["openai", "openai-2", "openai-3", "openai-4", "openai-codex", "openai-codex-2", "openai-codex-3", "openai-codex-4"]);
 });
