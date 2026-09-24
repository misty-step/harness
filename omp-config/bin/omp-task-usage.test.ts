import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
	const dir = mkdtempSync(resolve(tmpdir(), "task-usage-")); dirs.push(dir);
	const sessions = resolve(dir, "sessions"); mkdirSync(sessions);
	return { dir, sessions };
}
const time = (minute: number) => `2026-09-23T18:${String(minute).padStart(2, "0")}:00.000Z`;
function assistant(minute: number, dollars: number, extra = {}) {
	return { type: "message", timestamp: time(minute), message: { role: "assistant", provider: "test", model: "reasoner", stopReason: "stop",
		usage: { input: 100, output: 20, cacheRead: 900, cacheWrite: 0, reasoningTokens: 15,
			cost: { input: dollars * 0.1, output: dollars * 0.6, cacheRead: dollars * 0.3, cacheWrite: 0, total: dollars } }, ...extra } };
}
function transcript(dir: string, name: string, minute: number, events: object[]) {
	const file = resolve(dir, name); mkdirSync(resolve(file, ".."), { recursive: true });
	const records = events.map((entry, i) => "type" in entry && entry.type === "message" && !("id" in entry) ? { ...entry, id: `${name}:${i}` } : entry);
	writeFileSync(file, [{ type: "session", id: name, timestamp: time(minute) }, ...records].map(e => JSON.stringify(e)).join("\n") + "\n");
	return file;
}
function run(f: { dir: string; sessions: string }, tasks: object[]) {
	const manifest = resolve(f.dir, "manifest.json"); writeFileSync(manifest, JSON.stringify({ version: 1, tasks }));
	return Bun.spawnSync(["bun", resolve(import.meta.dir, "omp-task-usage.ts"), "--sessions", f.sessions, "--manifest", manifest]);
}
function task(id: string, file: string, outcome = "unknown", bounds = {}) {
	return { id, outcome, evidence: "independently checked fixture outcome", sessions: [{ file, ...bounds }] };
}

test("US-018 counts the whole tree and failed attempts in cost per completion", () => {
	const f = fixture();
	transcript(f.sessions, "success.jsonl", 0, [assistant(1, 1)]);
	transcript(f.sessions, "success/worker.jsonl", 1, [assistant(2, 2)]);
	transcript(f.sessions, "success/worker/nested.jsonl", 2, [assistant(3, 3)]);
	transcript(f.sessions, "success/__advisor.steward.jsonl", 0, [assistant(1, 4),
		{ type: "model_usage", timestamp: time(2), ...assistant(2, 5).message }]);
	transcript(f.sessions, "failure.jsonl", 0, [assistant(1, 6, { stopReason: "error" })]);
	const result = run(f, [task("a", "success.jsonl", "success"), task("b", "failure.jsonl", "failure")]);
	expect(result.exitCode).toBe(0);
	const report = JSON.parse(result.stdout.toString());
	expect(report.recordedCostPerCompletedTask).toBeCloseTo(21);
	expect(report.total.tokens).toEqual({ input: 600, output: 120, cacheRead: 5400, cacheWrite: 0 });
	expect(report.total.recordedCost.output).toBeCloseTo(12.6);
	expect(report.total.cachedInputTokenFraction).toBe(0.9);
	expect(report.sources.worker.recordedCostTotal).toBeCloseTo(5);
	expect(report.sources["advisor:auxiliary"].recordedCostTotal).toBeCloseTo(5);
	expect(report.total.failedRequests).toBe(1);
});

test("US-018 unknown outcomes and missing usage or prices cannot become cheap successes", () => {
	const f = fixture();
	transcript(f.sessions, "a.jsonl", 0, [assistant(1, 1)]);
	expect(JSON.parse(run(f, [task("a", "a.jsonl")]).stdout.toString()).recordedCostPerCompletedTask).toBeNull();
	transcript(f.sessions, "b.jsonl", 0, [assistant(1, 1, { usage: undefined })]);
	const missing = JSON.parse(run(f, [task("b", "b.jsonl", "success")]).stdout.toString());
	expect(missing.total.missingUsage).toBe(1);
	expect(missing.recordedCostPerCompletedTask).toBeNull();
	transcript(f.sessions, "c.jsonl", 0, [assistant(1, 1, { usage: { input: 10, output: 1, cacheRead: 0, cacheWrite: 0 } })]);
	const unpriced = JSON.parse(run(f, [task("c", "c.jsonl", "success")]).stdout.toString());
	expect(unpriced.total.missingPrices).toBe(1);
	expect(unpriced.recordedCostPerCompletedTask).toBeNull();
	transcript(f.sessions, "zero.jsonl", 0, [assistant(1, 0)]);
	const zero = JSON.parse(run(f, [task("zero", "zero.jsonl", "success")]).stdout.toString());
	expect(zero.total.missingPrices).toBe(1);
	expect(zero.recordedCostPerCompletedTask).toBeNull();
});

test("US-018 split tasks own late workers by launch, not completion time", () => {
	const f = fixture();
	transcript(f.sessions, "a.jsonl", 0, [assistant(1, 1), assistant(10, 2)]);
	transcript(f.sessions, "a/worker.jsonl", 2, [assistant(12, 5)]);
	transcript(f.sessions, "a/__advisor.steward.jsonl", 0, [assistant(3, 3), assistant(11, 4)]);
	const r = run(f, [task("early", "a.jsonl", "success", { until: time(10) }), task("late", "a.jsonl", "success", { from: time(10) })]);
	expect(r.exitCode).toBe(0);
	const report = JSON.parse(r.stdout.toString());
	expect(report.tasks[0].recordedCostTotal).toBeCloseTo(9);
	expect(report.tasks[1].recordedCostTotal).toBeCloseTo(6);
	expect(report.recordedCostPerCompletedTask).toBeCloseTo(7.5);
});

test("US-018 double counting, corrupt records, and escaped files fail without partial output", () => {
	const f = fixture();
	transcript(f.sessions, "a.jsonl", 0, [assistant(1, 1)]);
	const duplicate = run(f, [task("a", "a.jsonl"), task("b", "a.jsonl")]);
	expect(duplicate.exitCode).toBe(1); expect(duplicate.stdout.toString()).toBe("");
	transcript(f.dir, "outside.jsonl", 0, [assistant(1, 999)]);
	symlinkSync(resolve(f.dir, "outside.jsonl"), resolve(f.sessions, "link.jsonl"));
	const escaped = run(f, [task("a", "link.jsonl")]);
	expect(escaped.exitCode).toBe(1); expect(escaped.stdout.toString()).toBe("");
	writeFileSync(resolve(f.sessions, "bad.jsonl"), '{"private":"not printable"');
	const corrupt = run(f, [task("a", "bad.jsonl")]);
	expect(corrupt.exitCode).toBe(1); expect(corrupt.stdout.toString()).toBe("");
	expect(corrupt.stderr.toString()).not.toContain("not printable");
});

test("US-018 malformed native records cannot hide beside a billed successful response", () => {
	const f = fixture();
	const malformed = [
		{ type: "message", timestamp: time(2), message: null, content: "private malformed payload" },
		{ type: "message", timestamp: time(2), message: { role: null } },
		{ ...assistant(2, 2), id: null },
		{ ...assistant(2, 2), timestamp: null },
		{ type: "model_usage", ...assistant(2, 2).message, timestamp: null },
		{ type: "message", timestamp: time(12), message: null },
	];
	for (const record of malformed) {
		transcript(f.sessions, "malformed.jsonl", 0, [assistant(1, 1), record]);
		const result = run(f, [task("a", "malformed.jsonl", "success", { until: time(10) })]);
		expect(result.exitCode).toBe(1);
		expect(result.stdout.toString()).toBe("");
		expect(result.stderr.toString()).not.toContain("private malformed payload");
	}
	for (const header of [{ type: "session", id: null, timestamp: time(0) }, { type: "session", id: "malformed", timestamp: null }]) {
		const file = resolve(f.sessions, "malformed.jsonl");
		writeFileSync(file, [header, { ...assistant(1, 1), id: "billed" }].map(e => JSON.stringify(e)).join("\n") + "\n");
		const result = run(f, [task("a", "malformed.jsonl", "success")]);
		expect(result.exitCode).toBe(1);
		expect(result.stdout.toString()).toBe("");
	}
});

test("US-018 native custom message roles do not invalidate a billed task", () => {
	const f = fixture();
	transcript(f.sessions, "custom.jsonl", 0, [
		assistant(1, 1),
		{ type: "message", timestamp: time(2), message: { role: "notification", content: "local app notice" } },
	]);
	const result = run(f, [task("a", "custom.jsonl", "success")]);
	expect(result.exitCode).toBe(0);
	expect(JSON.parse(result.stdout.toString()).recordedCostPerCompletedTask).toBeCloseTo(1);
});

test("US-018 reports tool incidence and error flags without leaking transcript bodies", () => {
	const f = fixture();
	const result = { type: "message", timestamp: time(2), message: { role: "toolResult", toolName: "read", isError: true, content: "private body", details: { credential: "private credential" } } };
	transcript(f.sessions, "a.jsonl", 0, [assistant(1, 1), result, { ...result, timestamp: time(3) }]);
	transcript(f.sessions, "b.jsonl", 0, [assistant(1, 1)]);
	const r = run(f, [task("a", "a.jsonl"), task("b", "b.jsonl")]);
	expect(r.exitCode).toBe(0);
	const report = JSON.parse(r.stdout.toString());
	expect(report.tools.read).toMatchObject({ results: 2, errors: 2, tasksUsing: 1, taskUseRate: 0.5, flaggedErrorRate: 1, unclassifiedErrors: 2 });
	expect(r.stdout.toString()).not.toContain("private body");
	expect(r.stdout.toString()).not.toContain("private credential");
});

test("US-018 flattened nested sidecars follow their ancestor's task window", () => {
	const f = fixture();
	transcript(f.sessions, "a.jsonl", 0, [assistant(1, 1), assistant(10, 2)]);
	transcript(f.sessions, "a/Worker.jsonl", 2, [assistant(12, 3)]);
	transcript(f.sessions, "a/Worker.Child.jsonl", 11, [assistant(13, 4)]);
	const r = run(f, [task("early", "a.jsonl", "success", { until: time(10) }), task("late", "a.jsonl", "success", { from: time(10) })]);
	expect(r.exitCode).toBe(0);
	const report = JSON.parse(r.stdout.toString());
	expect(report.tasks[0].recordedCostTotal).toBeCloseTo(8);
	expect(report.tasks[1].recordedCostTotal).toBeCloseTo(2);
});

test("US-018 copied fork history cannot be charged as a second provider response", () => {
	const f = fixture();
	const message = assistant(1, 1, { responseId: "recorded-provider-response" });
	transcript(f.sessions, "original.jsonl", 0, [message]);
	transcript(f.sessions, "fork.jsonl", 0, [message, assistant(2, 2)]);
	const result = run(f, [task("one-task", "original.jsonl"), task("another", "fork.jsonl")]);
	expect(result.exitCode).toBe(1);
	expect(result.stdout.toString()).toBe("");
});
