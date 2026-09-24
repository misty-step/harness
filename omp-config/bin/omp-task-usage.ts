#!/usr/bin/env bun
/** US-018: offline accounting over explicitly selected OMP task trees. No provider calls. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

const BILLING = ["input", "output", "cacheRead", "cacheWrite"] as const;
type Billing = Record<(typeof BILLING)[number], number>;
type Span = { file: string; from?: string; until?: string };
type Task = { id: string; outcome: "success" | "failure" | "unknown"; evidence?: string; sessions: Span[] };
type Usage = Partial<Billing> & { cost?: Partial<Billing> & { total?: number } };
type Message = { role?: string; attribution?: string; provider?: string; model?: string; responseId?: string; usage?: Usage; stopReason?: string; toolName?: string; toolCallId?: string; isError?: boolean; timestamp?: number };
type Event = Omit<Message, "timestamp"> & { type: string; id?: string; timestamp?: string; message?: Message };
type Window = { from: number; until: number };
type ToolCounts = { results: number; errors: number; unclassifiedErrors: number; tasks: Set<string> };

type Meter = {
	requests: number;
	missingUsage: number;
	missingPrices: number;
	failedRequests: number;
	cacheHitRequests: number;
	tokens: Billing;
	recordedCost: Billing;
};

function billing(): Billing { return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }; }
function meter(): Meter {
	return { requests: 0, missingUsage: 0, missingPrices: 0, failedRequests: 0, cacheHitRequests: 0, tokens: billing(), recordedCost: billing() };
}
function numeric(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function instant(value: unknown): number {
	if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("expected an ISO timestamp with timezone");
	return Date.parse(value);
}
function event(value: unknown, index: number): Event {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid transcript record ${index}`);
	const record = value as Record<string, unknown>;
	if (typeof record.type !== "string" || !record.type) throw new Error(`invalid transcript record ${index}: missing type`);
	if (record.type === "session" || record.type === "message") {
		if (typeof record.id !== "string" || !record.id.trim()) throw new Error(`invalid ${record.type} record ${index}: missing id`);
	}
	if (record.type === "session" || record.type === "message" || record.type === "model_usage") {
		try { instant(record.timestamp); } catch { throw new Error(`invalid ${record.type} record ${index}: timestamp`); }
	}
	if (record.type === "message") {
		// Native AgentMessage is extensible; custom app roles are not billing events.
		const message = record.message;
		if (message === null || typeof message !== "object" || Array.isArray(message) ||
			typeof (message as Record<string, unknown>).role !== "string" || !(message as Message).role!.trim())
			throw new Error(`invalid message record ${index}: message role`);
	}
	return record as Event;
}
function window(span: Span): Window {
	const from = span.from === undefined ? -Infinity : instant(span.from);
	const until = span.until === undefined ? Infinity : instant(span.until);
	if (from >= until) throw new Error("task span must have from < until");
	return { from, until };
}
function within(time: number, w: Window) { return time >= w.from && time < w.until; }
function cost(m: Meter) { return BILLING.reduce((sum, field) => sum + m.recordedCost[field], 0); }
function view(m: Meter) {
	const input = m.tokens.input + m.tokens.cacheRead + m.tokens.cacheWrite;
	return { ...m, recordedCostTotal: cost(m), cacheHitRequestRate: m.requests ? m.cacheHitRequests / m.requests : null,
		cachedInputTokenFraction: input ? m.tokens.cacheRead / input : null };
}
function add(m: Meter, message: Omit<Message, "timestamp">) {
	m.requests++;
	if (message.stopReason === "error" || message.stopReason === "aborted") m.failedRequests++;
	const u = message.usage;
	if (!u) { m.missingUsage++; return; }
	for (const field of BILLING) {
		if (!numeric(u[field])) throw new Error(`invalid or missing usage.${field}`);
		m.tokens[field] += u[field];
	}
	if (u.cacheRead! > 0) m.cacheHitRequests++;
	let complete = true;
	for (const field of BILLING) {
		const value = u.cost?.[field];
		if (value === undefined) { complete = false; continue; }
		if (!numeric(value)) throw new Error(`invalid usage.cost.${field}`);
		m.recordedCost[field] += value;
	}
	// OMP can emit zero cost for an unpriced model. Do not mistake that for a free task.
	if (!complete || (BILLING.every(f => u.cost![f] === 0) && BILLING.some(f => u[f]! > 0))) m.missingPrices++;
	if (complete && u.cost?.total !== undefined) {
		const sum = BILLING.reduce((n, f) => n + u.cost![f]!, 0);
		if (!numeric(u.cost.total) || Math.abs(sum - u.cost.total) > Math.max(1e-9, sum * 1e-6)) throw new Error("usage cost components do not reconcile with total");
	}
}
function main() {
	const { values } = parseArgs({ options: { sessions: { type: "string" }, manifest: { type: "string" }, help: { type: "boolean" } }, strict: true });
	if (values.help) {
		console.log("Usage: bun omp-task-usage.ts --sessions DIR --manifest FILE\nManifest: {version:1,tasks:[{id,outcome:success|failure|unknown,evidence?,sessions:[{file,from?,until?}]}]}\nPaths are relative to DIR; timestamps are ISO [from,until). Worker trees belong to their launch span. Advisor requests use their event time. See docs/token-efficiency.md.");
		return;
	}
	if (!values.sessions || !values.manifest) throw new Error("--sessions and --manifest are required; no implicit archive scan");
	const boundary = realpathSync(values.sessions);
	const manifest = JSON.parse(readFileSync(values.manifest, "utf8"));
	if (manifest.version !== 1 || !Array.isArray(manifest.tasks) || !manifest.tasks.length) throw new Error("expected nonempty version 1 task manifest");
	const tasks: Task[] = manifest.tasks;
	const taskIds = new Set<string>();
	for (const task of tasks) {
		if (typeof task.id !== "string" || !task.id.trim() || taskIds.has(task.id)) throw new Error("task ids must be nonempty and unique");
		taskIds.add(task.id);
		if (!["success", "failure", "unknown"].includes(task.outcome)) throw new Error("explicit task outcome required");
		if (task.outcome !== "unknown" && (typeof task.evidence !== "string" || !task.evidence.trim())) throw new Error("known outcomes require evidence");
		if (!Array.isArray(task.sessions) || !task.sessions.length) throw new Error("task sessions required");
	}
	function scoped(path: string) {
		const canonical = realpathSync(path);
		const rel = relative(boundary, canonical);
		if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) throw new Error("session path escapes selected directory");
		return canonical;
	}
	// OMP adopts the parent's artifact directory for dotted Parent.Child sidecars.
	// Walk only immediate children so every descendant inherits its ancestor's task.
	function directChildren(dir: string, prefix = "") {
		const names = readdirSync(dir).filter(name => name.endsWith(".jsonl")).sort();
		const stems = new Set(names.map(name => name.slice(0, -6)));
		return names.filter(name => {
			const stem = name.slice(0, -6);
			if (!stem.startsWith(prefix)) return false;
			for (let dot = stem.indexOf(".", prefix.length); dot >= 0; dot = stem.indexOf(".", dot + 1)) {
				if (stems.has(stem.slice(0, dot))) return false;
			}
			return true;
		});
	}
	const total = meter(), sources = new Map<string, Meter>(), models = new Map<string, Meter>();
	const tools = new Map<string, ToolCounts>(), modelTools = new Map<string, ToolCounts>();
	const seen = new Set<string>(), receipts = new Map<string, { file: string; sha256: string; bytes: number }>();
	const spans = new Map<string, Window[]>();
	const billedIdentities = new Set<string>();
	const results: object[] = [];
	for (const task of tasks) {
		const taskMeter = meter();
		let parentTurns = 0, userMessages = 0, files = 0;
		function tool(map: Map<string, ToolCounts>, name: string, result: Message) {
			const count = map.get(name) ?? { results: 0, errors: 0, unclassifiedErrors: 0, tasks: new Set<string>() };
			// toolResult is the stable event in parent, worker, and advisor archives.
			// Execution-start events duplicate results and are absent in advisor files.
			count.results++; count.tasks.add(task.id);
			if (result.isError === true) { count.errors++; count.unclassifiedErrors++; }
			map.set(name, count);
		}
		function consume(path: string, source: string, w: Window) {
			const file = scoped(path), bytes = readFileSync(file);
			const entries: Event[] = bytes.toString("utf8").split("\n").filter(line => line.trim()).map((line, i) => {
				let value: unknown;
				try { value = JSON.parse(line); } catch { throw new Error(`malformed session JSON at record ${i + 1}`); }
				return event(value, i + 1);
			});
			const header = entries.find(e => e.type === "session");
			if (!header) throw new Error("transcript has no session header");
			if (source === "worker" && !within(instant(header.timestamp), w)) return;
			const ownedWindow = source === "worker" ? { from: -Infinity, until: Infinity } : w;
			files++;
			receipts.set(file, { file: relative(boundary, file), sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length });
			let model = "unknown";
			for (const [index, e] of entries.entries()) {
				const message = e.message;
				if (message?.role === "assistant") model = `${message.provider ?? "unknown"}/${message.model ?? "unknown"}`;
				if (e.type !== "model_usage" && e.type !== "message") continue;
				const time = instant(e.timestamp);
				if (!within(time, ownedWindow)) continue;
				const key = `${file}:${index}`;
				if (seen.has(key)) throw new Error("task spans double-count transcript events");
				seen.add(key);
				if (source === "parent" && message?.role === "user" && message.attribution === "user") userMessages++;
				if (message?.role === "toolResult") {
					const name = message.toolName ?? "unknown";
					tool(tools, name, message); tool(modelTools, `${model}:${name}`, message);
				}
				if (e.type !== "model_usage" && message?.role !== "assistant") continue;
				const usageMessage = e.type === "model_usage" ? e : message!;
				const identity = usageMessage.responseId ?? (e.id ? `${e.id}:${e.timestamp}` : undefined);
				if (identity) {
					const billedKey = JSON.stringify([usageMessage.provider, usageMessage.model, identity]);
					if (billedIdentities.has(billedKey)) throw new Error("copied provider response would be double-counted; exclude inherited fork history");
					billedIdentities.add(billedKey);
				}
				const label = source + (e.type === "model_usage" ? ":auxiliary" : "");
				const sourceMeter = sources.get(label) ?? meter(); sources.set(label, sourceMeter);
				const modelLabel = `${usageMessage.provider ?? "unknown"}/${usageMessage.model ?? "unknown"}`;
				const modelMeter = models.get(modelLabel) ?? meter(); models.set(modelLabel, modelMeter);
				for (const m of [total, taskMeter, sourceMeter, modelMeter]) add(m, usageMessage);
				if (source === "parent" && e.type === "message") parentTurns++;
			}
			const children = file.slice(0, -".jsonl".length);
			if (existsSync(children)) {
				for (const entry of directChildren(scoped(children))) {
					consume(resolve(children, entry), entry.startsWith("__advisor.") ? "advisor" : "worker", ownedWindow);
				}
			}
			for (const entry of directChildren(dirname(file), `${basename(children)}.`)) {
				consume(resolve(dirname(file), entry), "worker", ownedWindow);
			}
		}
		for (const span of task.sessions) {
			if (typeof span.file !== "string" || !span.file.endsWith(".jsonl")) throw new Error("session file must name a JSONL transcript");
			const file = scoped(resolve(boundary, span.file)), w = window(span);
			const previous = spans.get(file) ?? [];
			if (previous.some(p => p.from < w.until && w.from < p.until)) throw new Error("overlapping task spans");
			previous.push(w); spans.set(file, previous);
			consume(file, "parent", w);
		}
		if (!taskMeter.requests) throw new Error("task span has no recorded model requests");
		results.push({ id: task.id, outcome: task.outcome, parentTurns, userMessages, files, ...view(taskMeter) });
	}
	const success = tasks.filter(t => t.outcome === "success").length;
	const unknown = tasks.filter(t => t.outcome === "unknown").length;
	const complete = total.missingUsage === 0 && total.missingPrices === 0;
	const toolView = (map: Map<string, ToolCounts>) => Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b)).map(([name, c]) => [name,
		{ results: c.results, errors: c.errors, unclassifiedErrors: c.unclassifiedErrors, tasksUsing: c.tasks.size, taskUseRate: c.tasks.size / tasks.length, flaggedErrorRate: c.results ? c.errors / c.results : null }]));
	console.log(JSON.stringify({ version: 1, costBasis: "recorded runtime catalog USD, not an invoice", cohort: { tasks: tasks.length, success, failure: tasks.length - success - unknown, unknown },
		recordedCostPerCompletedTask: complete && unknown === 0 && success > 0 ? cost(total) / success : null,
		total: view(total), tasks: results, sources: Object.fromEntries([...sources].sort().map(([k, v]) => [k, view(v)])),
		models: Object.fromEntries([...models].sort().map(([k, v]) => [k, view(v)])), tools: toolView(tools), toolsByModel: toolView(modelTools), files: [...receipts.values()].sort((a, b) => a.file.localeCompare(b.file)),
		limitations: ["Task boundaries and outcome evidence are supplied by the manifest, not inferred from stopReason.", "Only recorded calls are measurable; transport retries or missing child logs may be absent.", "Tool rates use completed toolResult events; isError=false can still contain provider failures or command failures.", "Prompt/source billing attribution, invoices, task quality, and cache TTL misses are not present in these archives."] }, null, 2));
}

try { main(); } catch (error) {
	console.error(`omp-task-usage: ${error instanceof Error ? error.message : "invalid input"}`);
	process.exitCode = 1;
}
