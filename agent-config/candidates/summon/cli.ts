#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { SummonError, SummonStore } from "./core";
import { createNativeAdapter } from "./native";

const USAGE = `summon (source-only; JSON output)
  bun agent-config/candidates/summon/cli.ts start --state-dir DIR --task FILE|-
  ... say TASK --state-dir DIR --request-id ID (--text TEXT | --text-file FILE|-)
  ... run TASK --state-dir DIR [--claude-binary FILE] [--antigravity-binary FILE]
              [--display-script FILE] [--timeout-ms N]
  ... status|inspect|stop|check TASK --state-dir DIR
  ... review|reconcile --state-dir DIR --receipt FILE|-
Queued is not native ACK. run processes one safe queued turn; uncertain turns are never resent.
Review/reconciliation imports are commissioner assertions, not OS-authenticated signatures.`;

async function jsonFile(path: string): Promise<unknown> {
	try { return JSON.parse(path === "-" ? await Bun.stdin.text() : await readFile(path, "utf8")); }
	catch { throw new SummonError("INPUT_JSON", `cannot read valid JSON from ${path}`); }
}

export async function main(args = process.argv.slice(2)): Promise<number> {
	const { values, positionals } = parseArgs({
		args, allowPositionals: true, strict: true,
		options: {
			help: { type: "boolean", short: "h" },
			"state-dir": { type: "string" }, task: { type: "string" }, receipt: { type: "string" },
			"request-id": { type: "string" }, text: { type: "string" }, "text-file": { type: "string" },
			"claude-binary": { type: "string" }, "antigravity-binary": { type: "string" },
			"display-script": { type: "string" }, "timeout-ms": { type: "string" },
		},
	});
	if (values.help || positionals[0] === "help") { console.log(USAGE); return 0; }
	const command = positionals[0];
	if (!command || !["start", "say", "run", "status", "inspect", "stop", "check", "review", "reconcile"].includes(command)) throw new SummonError("USAGE", "expected start, say, run, status, inspect, stop, check, review or reconcile; use --help");
	if (!values["state-dir"]) throw new SummonError("USAGE", "--state-dir is required; no default/live dispatch store exists");
	const allowed: Record<string, string[]> = {
		start: ["state-dir", "task"], say: ["state-dir", "request-id", "text", "text-file"],
		run: ["state-dir", "claude-binary", "antigravity-binary", "display-script", "timeout-ms"],
		status: ["state-dir"], inspect: ["state-dir"], stop: ["state-dir"], check: ["state-dir"],
		review: ["state-dir", "receipt"], reconcile: ["state-dir", "receipt"],
	};
	if (Object.keys(values).some((flag) => !allowed[command]!.includes(flag))) throw new SummonError("USAGE", `unsupported option for ${command}`);
	const needsTask = ["say", "run", "status", "inspect", "stop", "check"].includes(command);
	if (positionals.length !== (needsTask ? 2 : 1)) throw new SummonError("USAGE", needsTask ? `${command} requires exactly one task id` : `${command} accepts no positional task id`);
	const runId = positionals[1]!;
	const store = new SummonStore(values["state-dir"]);
	const controller = new AbortController();
	const cancel = () => controller.abort(new SummonError("CANCELED", "operation canceled; awaiting owned process cleanup"));
	const signals = ["SIGINT", "SIGTERM"] as const;
	if (command === "run" || command === "check") for (const signal of signals) process.on(signal, cancel);
	let result: unknown;
	let exitCode = 0;
	try {
		switch (command) {
			case "start":
				if (!values.task) throw new SummonError("USAGE", "start requires --task FILE|-");
				result = store.start(await jsonFile(values.task)); break;
			case "say": {
				if (!values["request-id"] || (values.text === undefined) === (values["text-file"] === undefined)) throw new SummonError("USAGE", "say requires --request-id and exactly one of --text or --text-file");
				const message = values.text ?? (values["text-file"] === "-" ? await Bun.stdin.text() : await readFile(values["text-file"]!, "utf8"));
				result = store.say(runId, values["request-id"], message); break;
			}
			case "run": {
				const timeoutMs = values["timeout-ms"] === undefined ? undefined : Number(values["timeout-ms"]);
				if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)) throw new SummonError("USAGE", "--timeout-ms must be a positive integer");
				const task = store.status(runId).task;
				const adapter = createNativeAdapter(task.route.harness, {
					claudeBinary: values["claude-binary"], antigravityBinary: values["antigravity-binary"],
					displayScript: values["display-script"], timeoutMs,
				});
				result = await store.run(runId, adapter, { signal: controller.signal }); break;
			}
			case "status": result = store.status(runId); break;
			case "inspect": result = store.inspect(runId); break;
			case "stop": result = await store.stop(runId); break;
			case "check": {
				const checked = await store.check(runId, { signal: controller.signal });
				result = checked;
				exitCode = checked.checks.some((check) => check.status === "block") ? 1 : 0;
				break;
			}
			case "review":
			case "reconcile":
				if (!values.receipt) throw new SummonError("USAGE", `${command} requires --receipt FILE|-`);
				result = command === "review" ? store.review(await jsonFile(values.receipt)) : store.reconcile(await jsonFile(values.receipt)); break;
		}
		console.log(JSON.stringify(result, null, 2));
		return controller.signal.aborted ? 130 : exitCode;
	} finally {
		if (command === "run" || command === "check") for (const signal of signals) process.removeListener(signal, cancel);
	}
}

if (import.meta.main) {
	try { process.exitCode = await main(); }
	catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const code = error instanceof SummonError ? error.code : error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "COMMAND_FAILED";
		console.error(JSON.stringify({ error: { code, message } }));
		process.exitCode = code === "CANCELED" ? 130 : code === "USAGE" || code.startsWith("ERR_PARSE_ARGS") ? 2 : 1;
	}
}
