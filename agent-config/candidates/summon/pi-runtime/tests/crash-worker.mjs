import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { defineTool } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openRuntime } from "../durable.ts";
import { createSummonModels } from "./models-fixture.mjs";

const [root, policy, mode] = process.argv.slice(2);
const input = JSON.parse(readFileSync(join(root, "input.json"), "utf8"));
const tool = defineTool({ name: "probe", description: "Crash-window fixture", parameters: Type.Object({}),
	...(policy === "safe" ? { replay: "safe" } : {}),
	async execute() {
		// 'effect' counts invocations for the unsafe case. Safe replay reads a
		// stable file and has no product effect; the append is test instrumentation.
		appendFileSync(join(root, "invocations"), "execute\n");
		const text = readFileSync(join(root, "source.txt"), "utf8");
		if (!existsSync(join(root, "release"))) {
			writeFileSync(join(root, "mid-tool"), "intent committed; execute running\n");
			await new Promise((resolve) => setTimeout(resolve, 30000));
		}
		return { content: [{ type: "text", text }] };
	},
});
const runtime = await openRuntime({ runId: input.runId, sessionId: input.sessionId, sessionFile: input.sessionFile,
	resume: mode === "resume", provider: "openai-codex", model: "fixture", effort: "off", cwd: root,
	instructions: [], models: createSummonModels(), tools: [tool] });
try {
	let submission;
	if (mode === "resume") {
		if ((await runtime.receipt(input)).state !== "acknowledged") throw new Error("missing persisted admission");
		const admitted = await runtime.conversation.commit((tx) => tx.submissionByRequest(runtime.conversation.id, input.inputId), context);
		submission = await runtime.harness.submission(admitted.id, context);
		runtime.harness.resume();
	} else {
		const [first, concurrent] = await Promise.all([runtime.deliver(input), runtime.deliver(input)]);
		if (first.id !== concurrent.id) throw new Error("concurrent duplicate created another submission");
		submission = first;
	}
	const duplicate = await runtime.deliver(input);
	if (duplicate.id !== submission.id) throw new Error("duplicate request created another submission");
	if (mode === "start") writeFileSync(join(root, "admission.json"), JSON.stringify({ submissionId: submission.id, conversationId: runtime.conversation.id }));
	const settled = await submission.wait(context);
	const entries = await runtime.conversation.entries({}, 100, undefined, context);
	writeFileSync(join(root, "result.json"), JSON.stringify({ submissionId: submission.id, settled,
		conversationId: runtime.conversation.id, entries: entries.items }));
} finally { await runtime.close(); }
