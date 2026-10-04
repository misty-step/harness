import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { AssistantMessage, Models, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { createRegistry, defineEntry, defineExtension, Harness, type ToolRegistration } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { Type, type Static } from "typebox";
import { Parse } from "typebox/value";

export const InputSchema = Type.Object({
	runId: Type.String({ minLength: 1 }), attemptId: Type.String({ minLength: 1 }), inputId: Type.String({ minLength: 1 }),
	textSha256: Type.String({ pattern: "^[a-f0-9]{64}$" }), sessionId: Type.String({ minLength: 1 }),
	sessionFile: Type.String({ minLength: 1 }), text: Type.String(),
}, { additionalProperties: false });
const Binding = defineEntry<Static<typeof InputSchema>>("summon.pi.input.v1");
const Receipt = defineEntry<{ attemptId: string; inputId: string; textSha256: string; messageEntryId: string; submissionId: string }>("summon.pi.receipt.v1");
const Identity = defineEntry<{ fingerprint: string }>("summon.pi.engine.v1");
type ProjectedEntry = { id: string } & (
	{ type: "custom_message"; customType: string; details: Static<typeof InputSchema>; content: string }
	| { type: "custom"; customType: string; data: { attemptId: string; inputId: string; textSha256: string; messageEntryId: string; submissionId: string } }
	| { type: "message"; message: AssistantMessage }
);

export type RuntimeOptions = {
	runId: string; sessionId: string; sessionFile: string; resume: boolean;
	provider: string; model: string; effort: ModelThinkingLevel; cwd: string; instructions: string[];
	models: Models; tools: readonly ToolRegistration[];
};

export async function openRuntime(options: RuntimeOptions) {
	if (options.resume && !existsSync(options.sessionFile)) throw new Error("exact durable resume file unavailable");
	if (!options.models.getModel(options.provider, options.model)) throw new Error("exact selected model unavailable; no fallback");
	const registry = createRegistry();
	const extension = defineExtension({ name: "summon-pilot", tools: options.tools });
	registry.install(extension);
	const fingerprint = JSON.stringify({ engine: "pi-durable@1.0.2", runId: options.runId, sessionId: options.sessionId,
		provider: options.provider, model: options.model, effort: options.effort, cwd: options.cwd,
		instructions: options.instructions, tools: options.tools.map((tool) => ({ name: tool.name, replay: tool.replay ?? null, parameters: tool.parameters })) });
	const harness = await Harness.open(await openNodeSqliteStorage(options.sessionFile), {
		models: options.models, registry, env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? options.cwd }),
		settings: { retry: { enabled: false, maxRetries: 0 }, compaction: { enabled: false }, toolExecution: "sequential" },
	}, context);
	try {
		const conversation = await harness.root(context, {
			agent: { model: { provider: options.provider, modelId: options.model }, thinkingLevel: options.effort,
				cwd: options.cwd, instructions: options.instructions.join("\n\n"), tools: options.tools, extensions: [extension] },
			init: async (tx, id) => { await tx.appendEntry(Identity, id, { data: { fingerprint } }); },
		});
		const identity = await conversation.entries({}, 10000, undefined, context);
		if (identity.next || !identity.items.some((entry) => Identity.is(entry) && entry.data?.fingerprint === fingerprint)) {
			throw new Error("durable runtime/route/loadout conflict; explicit handoff required");
		}

		async function parseInput(value: unknown) {
			const input = Parse(InputSchema, value);
			if (input.runId !== options.runId || input.sessionId !== options.sessionId || input.sessionFile !== options.sessionFile
				|| createHash("sha256").update(input.text).digest("hex") !== input.textSha256) throw new Error("exact durable input/session/hash required");
			const entries = await conversation.entries({}, 10000, undefined, context);
			if (entries.next) throw new Error("durable input inspection exceeds bound");
			const prior = entries.items.find((entry) => Binding.is(entry)
				&& (entry.data?.inputId === input.inputId || entry.data?.attemptId === input.attemptId));
			if (prior && (!Binding.is(prior) || JSON.stringify(prior.data) !== JSON.stringify(input))) throw new Error("durable input ID conflict");
			return { input, prior };
		}
		async function receipt(value: unknown) {
			const { input, prior } = await parseInput(value);
			if (!prior) return { state: "absent" };
			const admitted = await conversation.commit((tx) => tx.submissionByRequest(conversation.id, input.inputId), context);
			if (!admitted || admitted.type !== "input" || !admitted.entry) return { state: "uncertain" };
			await conversation.commit(async (tx) => {
				const receipts = await tx.scanEntries({ conversationId: conversation.id }, 10000);
				if (receipts.next) throw new Error("durable receipt inspection exceeds bound");
				if (!receipts.items.some((entry) => Receipt.is(entry) && entry.data?.attemptId === input.attemptId)) {
					await tx.appendEntry(Receipt, conversation.id, { data: { attemptId: input.attemptId, inputId: input.inputId,
						textSha256: input.textSha256, messageEntryId: String(prior.id), submissionId: String(admitted.id) } });
				}
			}, context);
			return { state: "acknowledged", submissionId: String(admitted.id) };
		}
		return {
			harness, conversation,
			async deliver(value: unknown) {
				const { input, prior } = await parseInput(value);
				if (!prior) await conversation.commit((tx) => tx.appendEntry(Binding, conversation.id, { data: input }), context);
				// requestId is Summon's immutable input identity, never a new retry UUID.
				const submission = await conversation.submit({ type: "input", requestId: input.inputId, content: input.text, whenBusy: "reject" }, context);
				await receipt(input);
				return submission;
			},
			receipt,
			async entries() {
				const page = await conversation.entries({}, 10000, undefined, context);
				if (page.next) throw new Error("durable transcript inspection exceeds bound");
				// Read-only projection for the existing Rust observation parser. These
				// references name committed durable entries, not another transcript store.
				const entries = page.items.slice().reverse().flatMap<ProjectedEntry>((entry) => {
					if (Binding.is(entry)) return [{ id: String(entry.id), type: "custom_message", customType: Binding.kind, details: entry.data, content: entry.data?.text }];
					if (Receipt.is(entry)) return [{ id: String(entry.id), type: "custom", customType: Receipt.kind, data: entry.data }];
					return (entry.model ?? []).filter((message) => message.role === "assistant")
						.map((message) => ({ id: String(entry.id), type: "message", message }));
				});
				return { leafId: entries.at(-1)?.id ?? null, entries: entries.map((entry, i) => ({ ...entry, parentId: entries[i - 1]?.id ?? null })) };
			},
			async state() {
				const live = await harness.inspect(context);
				return { sessionId: options.sessionId, sessionFile: options.sessionFile, engine: "pi-durable", conversationId: conversation.id,
					model: { provider: options.provider, id: options.model }, thinkingLevel: options.effort,
					isStreaming: live.tasks.length > 0, pendingMessageCount: live.submissions.length };
			},
			close: () => harness.close(context),
		};
	} catch (error) {
		await harness.close(context);
		throw error;
	}
}
