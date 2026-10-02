import { readFileSync } from "node:fs";
import type { TaskSpec } from "./contract.ts";

export type GlassIntake = Omit<TaskSpec, "id" | "brief" | "source"> & { taskId: string };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Optional, inert intake: converts a frozen read result, never contacts or changes Glass. */
export function taskFromGlass(snapshot: unknown, intake: GlassIntake): TaskSpec {
	if (!record(snapshot) || !record(snapshot.data) || snapshot.data.state !== "ok" || !record(snapshot.data.value)) {
		throw new Error("Glass snapshot must be a successful data.value item; no task created");
	}
	const item = snapshot.data.value;
	if (typeof item.id !== "string" || !item.id.trim() || typeof item.title !== "string" || !item.title.trim()) {
		throw new Error("Glass item needs its source ID and title; no task created");
	}
	if (typeof intake.taskId !== "string" || !intake.taskId.trim()) throw new Error("Supply a summon taskId independent of the Glass ID");
	const description = record(item.description) && typeof item.description.text === "string" ? item.description.text : "";
	const why = record(item.why) && typeof item.why.text === "string" ? item.why.text : "";
	const victory = typeof item.victory === "string" ? item.victory : "";
	const done = Array.isArray(item.done) ? JSON.stringify(item.done) : "";
	const { taskId, ...task } = intake;
	return {
		...task,
		id: taskId,
		brief: [item.title, description, why && `Why: ${why}`, victory && `Victory: ${victory}`, done && `Ticket done criteria: ${done}`].filter(Boolean).join("\n\n"),
		source: { adapter: "glass", id: item.id },
	};
}

if (import.meta.main) {
	try {
		if (process.argv.length !== 4) throw new Error("Usage: bun glass.ts SNAPSHOT.json INTAKE.json (prints a task; no Glass operation)");
		const snapshot: unknown = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
		const intake = JSON.parse(readFileSync(process.argv[3]!, "utf8")) as GlassIntake;
		process.stdout.write(`${JSON.stringify(taskFromGlass(snapshot, intake), null, 2)}\n`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
