import { expect, test } from "bun:test";
import type { Provider } from "@earendil-works/pi-ai";
import { cloneProvider } from "./slots.ts";

test("a slot's models resolve to the slot's own login and follow the base catalog", () => {
	let catalog = [{ id: "gpt-a", provider: "openai-codex" }];
	const base = { id: "openai-codex", name: "OpenAI Codex", getModels: () => catalog } as unknown as Provider;
	const slot = cloneProvider(base, "openai-codex-2");

	expect(slot.id).toBe("openai-codex-2");
	expect(slot.name).toBe("OpenAI Codex (account 2)");
	expect(slot.getModels().map((model) => model.provider)).toEqual(["openai-codex-2"]);
	catalog = [...catalog, { id: "gpt-b", provider: "openai-codex" }];
	expect(slot.getModels().map((model) => `${model.provider}/${model.id}`)).toEqual([
		"openai-codex-2/gpt-a",
		"openai-codex-2/gpt-b",
	]);
	expect(base.getModels().every((model) => model.provider === "openai-codex")).toBe(true);
});
