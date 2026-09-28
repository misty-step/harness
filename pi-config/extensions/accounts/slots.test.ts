import { expect, test } from "bun:test";
import type { Provider } from "@earendil-works/pi-ai";
import { cloneProvider } from "./slots.ts";

test("a slot's models resolve to the slot's own login while requests are built as the base provider", () => {
	const built: string[] = [];
	const base = {
		id: "openai-codex",
		name: "OpenAI Codex",
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
