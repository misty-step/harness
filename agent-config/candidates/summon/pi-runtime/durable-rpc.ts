// Narrow JSONL bridge consumed by the existing Rust process owner.
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { Models } from "@earendil-works/pi-ai";
import { Parse } from "typebox/value";
import { Type } from "typebox";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openRuntime } from "./durable.ts";
import { pilotTools } from "./pilot-tools.ts";

const { values } = parseArgs({ options: {
	mode: { type: "string" }, offline: { type: "boolean" }, provider: { type: "string" }, model: { type: "string" },
	thinking: { type: "string" }, "no-extensions": { type: "boolean" }, "no-prompt-templates": { type: "boolean" },
	extension: { type: "string" }, "session-dir": { type: "string" }, tools: { type: "string" },
	session: { type: "string" }, "session-id": { type: "string" }, "run-id": { type: "string" },
	"no-context-files": { type: "boolean" }, "no-skills": { type: "boolean" },
	"append-system-prompt": { type: "string", multiple: true },
} });
const StartSchema = Type.Object({ runId: Type.String({ minLength: 1 }), sessionId: Type.String({ pattern: "^summon-[a-f0-9]{64}$" }),
	sessionFile: Type.String(), provider: Type.Literal("openai-codex"), model: Type.String({ minLength: 1 }),
	effort: Type.Union(["off", "minimal", "low", "medium", "high", "xhigh", "max"].map((level) => Type.Literal(level))),
});
const start = Parse(StartSchema, { runId: values["run-id"], sessionId: values["session-id"],
	sessionFile: values.session ?? join(values["session-dir"] ?? "", `${values["session-id"]}.sqlite`),
	provider: values.provider, model: values.model, effort: values.thinking });
if (values.mode !== "rpc" || values.tools !== "read,grep,find,ls" || !isAbsolute(start.sessionFile)
	|| resolve(values.extension ?? "") !== fileURLToPath(import.meta.url)) throw new Error("explicit durable bridge and pilot loadout required");
// The factory host supplies its native pi-ai Models instance and credential
// store. The bridge never logs in, copies credentials, or selects a fallback.
const modulePath = process.env.SUMMON_PI_MODELS_MODULE;
if (!modulePath || !isAbsolute(modulePath)) throw new Error("SUMMON_PI_MODELS_MODULE must name an absolute host Models module");
const host = await import(pathToFileURL(modulePath).href);
const models: Models = await host.createSummonModels();
process.umask(0o077);
mkdirSync(dirname(start.sessionFile), { recursive: true, mode: 0o700 });
const runtime = await openRuntime({ ...start, resume: Boolean(values.session), cwd: process.cwd(),
	instructions: values["append-system-prompt"] ?? [], models, tools: pilotTools(process.cwd()) });

const CommandSchema = Type.Object({ id: Type.String(), type: Type.String(), message: Type.Optional(Type.String()), enabled: Type.Optional(Type.Boolean()) }, { additionalProperties: false });
const emit = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
try {
	// Reopen is inert until the owner explicitly requests recovery below.
	for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
		if (Buffer.byteLength(line) > 1024 * 1024) throw new Error("durable RPC record exceeds 1MiB bound");
		const command = Parse(CommandSchema, JSON.parse(line));
		try {
			let data: unknown;
			switch (command.type) {
				case "get_state": data = await runtime.state(); break;
				case "get_commands": data = { commands: ["summon-native-input", "summon-native-receipt"].map((name) => ({ name, source: "extension", sourceInfo: { path: values.extension } })) }; break;
				case "set_auto_retry": case "set_auto_compaction":
					if (command.enabled !== false) throw new Error("automatic retry/compaction disabled in pilot");
					break;
				case "get_entries": data = await runtime.entries(); break;
				case "clear_queue": case "abort": await runtime.conversation.abort(context); break;
				case "prompt": {
					const match = /^\/(summon-native-input|summon-native-receipt) (.*)$/.exec(command.message ?? "");
					if (!match) throw new Error("only exact Summon native commands accepted");
					const input: unknown = JSON.parse(match[2]);
					if (match[1] === "summon-native-receipt") {
						const receipt = await runtime.receipt(input);
						data = receipt;
						// Existing admitted work resumes; absent/ambiguous input is never resent.
						if (receipt.submissionId) runtime.harness.resume();
					} else {
						const submission = await runtime.deliver(input);
						void submission.wait(context).then((settled) => emit({ type: "agent_settled", status: settled.status }),
							(error: unknown) => emit({ type: "runtime_error", error: String(error) }));
					}
					break;
				}
				default: throw new Error(`unsupported durable RPC command: ${command.type}`);
			}
			emit({ type: "response", id: command.id, success: true, data });
		} catch (error) { emit({ type: "response", id: command.id, success: false, error: String(error) }); }
	}
} finally { await runtime.close(); }
