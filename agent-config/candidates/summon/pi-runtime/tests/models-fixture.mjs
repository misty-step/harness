import { AssistantMessageEventStream, createModels, createProvider } from "@earendil-works/pi-ai";
import { appendFileSync } from "node:fs";
import { getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";

// Local deterministic provider. No network, credentials, subscription, or model spend.
export function createSummonModels() {
	const models = createModels();
	const model = { id: "fixture", name: "offline fixture", provider: "openai-codex", api: "openai-completions",
		baseUrl: "http://invalid.local", reasoning: false, input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 100 };
	const stream = (selected, transcript) => {
		if (process.env.FIXTURE_CALLS) appendFileSync(process.env.FIXTURE_CALLS, "model\n");
		const hasResult = transcript.messages.some((message) => message.role === "toolResult");
		const tools = getCurrentTools(transcript.messages);
		const content = hasResult || tools.length === 0 ? [{ type: "text", text: "fixture settled" }]
			: [{ type: "toolCall", id: "fixture-call", name: tools[0].name, arguments: tools[0].name === "read" ? { path: "source.txt" } : {} }];
		const message = { role: "assistant", content, api: selected.api, provider: selected.provider, model: selected.id,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: content[0].type === "toolCall" ? "toolUse" : "stop", timestamp: Date.now() };
		const events = new AssistantMessageEventStream();
		events.push({ type: "done", reason: message.stopReason, message }); events.end();
		return events;
	};
	models.setProvider(createProvider({ id: "openai-codex", name: "offline fixture",
		auth: { apiKey: { name: "offline", resolve: async () => ({ auth: {} }) } },
		models: [model], api: { stream, streamSimple: stream } }));
	return models;
}
