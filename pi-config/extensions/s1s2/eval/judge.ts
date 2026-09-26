#!/usr/bin/env bun
/**
 * Blind judging and aggregation for an s1s2 evaluation run directory (US-030).
 * Two OpenRouter LLM judges and a Jev panel see the task, accepted reference
 * change, and shuffled, anonymous candidate diffs. They do not see run metrics.
 * Verdicts are cached per task, judge, and candidate set; invalid replies are
 * retained but never counted as votes.
 *
 * Usage:
 *   pass-env run -e OPENROUTER_API_KEY=workstation/OPENROUTER_API_KEY_MIRRODIN_PI -- bun pi-config/extensions/s1s2/eval/judge.ts \
 *     --manifest m.json --out dir --arms pi,omp,s1s2 --tag exp1
 * `--judges glm,minimax,jev` selects a panel (all by default).
 * `--exclude-judges glm` omits a model family for that pass. Separate passes
 * share verdicts only when their sorted candidate sets match.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { OpenRouterJevProvider, type Question } from "../../../../agent-config/system-one/engine.ts";

const CRITERIA = ["task", "correctness", "scope", "quality"] as const;
type Scores = Record<(typeof CRITERIA)[number], number>;
type Task = { id: string; size: string; base: string; merge: string; statement: string };
type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };
type ModelSpend = { calls: number; settledUsd: number };
type Boundary = { calls: number; settledUsd: number; unsettled: number; byModel: Record<string, ModelSpend> };
type Advisor = { consults: number; costUsd: number };
type S1Summary = { calls: number; failedCalls: number; latencyMs: number; inputTokens: number; outputTokens: number; costUsd: number; callsWithoutCost: number; actions: Record<string, number>; advisor: Advisor | null };
type Run = { task: string; arm: string; hiddenPass: boolean; regressPass: boolean; timedOut: boolean; wallMs: number; parentTurns: number; modelCalls: number; usage: Usage; models: string[]; parity: unknown; boundary: Boundary; s1: S1Summary | null };
type LlmJudge = "glm" | "minimax";
type Judge = LlmJudge | "jev";
type Attempt = { valid: boolean; costUsd: number | null; promptTokens: number | null; completionTokens: number | null; reply: string | null; error: string | null };
type LlmVerdict = { task: string; judge: LlmJudge; labels: Record<string, string>; valid: boolean; scores: Record<string, Scores> | null; ranking: string[] | null; costUsd: number | null; promptTokens: number | null; completionTokens: number | null; attempts: Attempt[] };
type JevVerdict = { task: string; judge: "jev"; labels: Record<string, string>; valid: boolean; success: Record<string, number | null>; best: string | null; costUsd: number | null };
type Verdict = LlmVerdict | JevVerdict;

const JUDGES = [
	{ id: "glm", model: "z-ai/glm-5.3", order: ["morph", "baidu", "deepinfra"] },
	{ id: "minimax", model: "minimax/minimax-m3", order: ["minimax"] },
] as const;
const ALL_JUDGES: Judge[] = ["glm", "minimax", "jev"];
const LABELS = ["A", "B", "C", "D", "E", "F", "G", "H"];

// Manifest, runs, caches, and provider replies cross trust boundaries.
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
function number(value: unknown, what: string): number {
	if (!finite(value) || value < 0) throw new Error(`${what} is not a nonnegative finite number`);
	return value;
}
function text(value: unknown, what: string): string {
	if (typeof value !== "string") throw new Error(`${what} is not a string`);
	return value;
}
function flag(value: unknown, what: string): boolean {
	if (typeof value !== "boolean") throw new Error(`${what} is not a boolean`);
	return value;
}
function optionalNumber(value: unknown, what: string): number | null {
	return value === undefined || value === null ? null : number(value, what);
}
function counts(value: unknown, what: string): Record<string, number> {
	if (value === undefined || value === null) return {};
	if (!isObject(value)) throw new Error(`${what} is not an object`);
	return Object.fromEntries(Object.entries(value).map(([key, count]) => [key, number(count, `${what}.${key}`)]));
}
function parseScores(value: unknown): Scores | null {
	if (!isObject(value)) return null;
	const values = CRITERIA.map((criterion) => value[criterion]);
	if (!values.every((score) => finite(score) && Number.isInteger(score) && score >= 1 && score <= 5)) return null;
	return { task: values[0] as number, correctness: values[1] as number, scope: values[2] as number, quality: values[3] as number };
}
function parseTask(value: unknown): Task {
	if (!isObject(value)) throw new Error("manifest contains an invalid task");
	const id = text(value.id, "task.id");
	if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(`unsafe task id ${id}`);
	return { id, size: text(value.size, `${id}.size`), base: text(value.base, `${id}.base`), merge: text(value.merge, `${id}.merge`), statement: text(value.statement, `${id}.statement`) };
}
function parseRun(value: unknown, path: string, task: string, arm: string): Run {
	if (!isObject(value) || !isObject(value.usage) || !isObject(value.boundary)) throw new Error(`${path} is not a run record`);
	if (value.task !== task || value.arm !== arm) throw new Error(`${path} has the wrong task or arm`);
	const { usage, boundary, s1 } = value;
	const byModel: Record<string, ModelSpend> = Object.create(null);
	if (boundary.byModel !== undefined) {
		if (!isObject(boundary.byModel)) throw new Error(`${path} boundary.byModel is not an object`);
		for (const [model, spend] of Object.entries(boundary.byModel)) {
			if (!isObject(spend)) throw new Error(`${path} boundary.byModel.${model} is not an object`);
			byModel[model] = { calls: number(spend.calls, `boundary.byModel.${model}.calls`), settledUsd: number(spend.settledUsd, `boundary.byModel.${model}.settledUsd`) };
		}
	}
	if (s1 !== null && s1 !== undefined && !isObject(s1)) throw new Error(`${path} s1 is not an object`);
	const advisor = isObject(s1) && s1.advisor !== undefined && s1.advisor !== null ? s1.advisor : null;
	if (advisor !== null && !isObject(advisor)) throw new Error(`${path} s1.advisor is not an object`);
	if (!Array.isArray(value.models) || !value.models.every((model) => typeof model === "string")) throw new Error(`${path} models is not a list of strings`);
	return {
		task,
		arm,
		hiddenPass: flag(value.hiddenPass, `${path} hiddenPass`),
		regressPass: flag(value.regressPass, `${path} regressPass`),
		timedOut: flag(value.timedOut, `${path} timedOut`),
		wallMs: number(value.wallMs, `${path} wallMs`),
		parentTurns: number(value.parentTurns, `${path} parentTurns`),
		modelCalls: number(value.modelCalls, `${path} modelCalls`),
		usage: { input: number(usage.input, "usage.input"), output: number(usage.output, "usage.output"), cacheRead: number(usage.cacheRead, "usage.cacheRead"), cacheWrite: number(usage.cacheWrite, "usage.cacheWrite") },
		models: value.models,
		parity: value.parity ?? null,
		boundary: { calls: number(boundary.calls, "boundary.calls"), settledUsd: number(boundary.settledUsd, "boundary.settledUsd"), unsettled: number(boundary.unsettled, "boundary.unsettled"), byModel },
		s1: isObject(s1) ? {
			calls: number(s1.calls, "s1.calls"), failedCalls: number(s1.failedCalls, "s1.failedCalls"), latencyMs: number(s1.latencyMs, "s1.latencyMs"),
			inputTokens: number(s1.inputTokens ?? 0, "s1.inputTokens"), outputTokens: number(s1.outputTokens ?? 0, "s1.outputTokens"),
			costUsd: number(s1.costUsd ?? 0, "s1.costUsd"), callsWithoutCost: number(s1.callsWithoutCost ?? 0, "s1.callsWithoutCost"), actions: counts(s1.actions, "s1.actions"),
			advisor: isObject(advisor) ? { consults: number(advisor.consults, "s1.advisor.consults"), costUsd: number(advisor.costUsd, "s1.advisor.costUsd") } : null,
		} : null,
	};
}
function parseAttempt(value: unknown): Attempt | null {
	if (!isObject(value) || typeof value.valid !== "boolean") return null;
	try {
		return {
			valid: value.valid, costUsd: optionalNumber(value.costUsd, "attempt.costUsd"),
			promptTokens: optionalNumber(value.promptTokens, "attempt.promptTokens"), completionTokens: optionalNumber(value.completionTokens, "attempt.completionTokens"),
			reply: value.reply === null || value.reply === undefined ? null : text(value.reply, "attempt.reply"),
			error: value.error === null || value.error === undefined ? null : text(value.error, "attempt.error"),
		};
	} catch { return null; }
}
function totalKnown(values: (number | null)[]): number | null {
	return values.some((value) => value !== null) ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null;
}
function parseVerdict(value: unknown, task: string, judge: Judge, arms: string[], labels: string[]): Verdict | null {
	if (!isObject(value) || value.task !== task || value.judge !== judge) return null;
	const given = value.labels;
	if (!isObject(given)) return null;
	if (Object.keys(given).length !== arms.length || !arms.every((arm) => {
		const label = given[arm];
		return typeof label === "string" && labels.includes(label);
	}) || new Set(Object.values(given)).size !== arms.length) return null;
	const mapping = Object.fromEntries(arms.map((arm) => [arm, text(given[arm], `labels.${arm}`)]));
	if (judge === "jev") {
		if (!isObject(value.success)) return null;
		const success: Record<string, number | null> = {};
		for (const arm of arms) {
			const score = value.success[arm];
			if (score !== null && score !== undefined && !(finite(score) && score >= 1 && score <= 5)) return null;
			success[arm] = finite(score) ? score : null;
		}
		const best = typeof value.best === "string" && arms.includes(value.best) ? value.best : null;
		return { task, judge, labels: mapping, valid: value.valid === true && arms.every((arm) => success[arm] !== null) && (value.best === null || best !== null), success, best, costUsd: optionalNumber(value.costUsd, "jev.costUsd") };
	}
	if (!Array.isArray(value.attempts)) return null;
	const attempts = value.attempts.map(parseAttempt);
	if (attempts.some((attempt) => attempt === null)) return null;
	const parsedAttempts = attempts.filter((attempt): attempt is Attempt => attempt !== null);
	const scores: Record<string, Scores> = {};
	for (const arm of arms) {
		const score = parseScores(isObject(value.scores) ? value.scores[arm] : undefined);
		if (score) scores[arm] = score;
	}
	const ranking = Array.isArray(value.ranking) && value.ranking.every((arm) => typeof arm === "string") ? value.ranking as string[] : null;
	const valid = value.valid === true && arms.every((arm) => scores[arm]) && isPermutation(ranking, arms);
	return {
		task, judge, labels: mapping, valid, scores: valid ? scores : null, ranking: valid ? ranking : null,
		costUsd: totalKnown(parsedAttempts.map((attempt) => attempt.costUsd)),
		promptTokens: totalKnown(parsedAttempts.map((attempt) => attempt.promptTokens)),
		completionTokens: totalKnown(parsedAttempts.map((attempt) => attempt.completionTokens)), attempts: parsedAttempts,
	};
}
function isPermutation(items: string[] | null, members: string[]): items is string[] {
	return items !== null && items.length === members.length && new Set(items).size === members.length && items.every((item) => members.includes(item));
}

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
	const option = process.argv[i];
	if (!option.startsWith("--") || i + 1 >= process.argv.length || process.argv[i + 1].startsWith("--") || args.has(option.slice(2))) throw new Error(`invalid option ${option}`);
	args.set(option.slice(2), process.argv[i + 1]);
}
for (const option of args.keys()) if (!["manifest", "out", "arms", "tag", "judges", "exclude-judges", "seed"].includes(option)) throw new Error(`unknown option --${option}`);
for (const option of ["manifest", "out", "arms"]) if (!args.get(option)) throw new Error(`--${option} is required`);
const out = resolve(args.get("out") ?? "");
const manifest: unknown = JSON.parse(readFileSync(resolve(args.get("manifest") ?? ""), "utf8"));
if (!isObject(manifest) || !Array.isArray(manifest.tasks)) throw new Error("manifest has no tasks array");
const tasks = manifest.tasks.map(parseTask);
if (new Set(tasks.map((task) => task.id)).size !== tasks.length) throw new Error("duplicate task IDs");
function parseCommaList(value: string): string[] { return value.split(",").map((item) => item.trim()); }
const ARMS = parseCommaList(args.get("arms") ?? "").sort();
if (ARMS.length < 1 || ARMS.length > LABELS.length || ARMS.some((arm) => !/^[a-zA-Z0-9_-]+$/.test(arm)) || new Set(ARMS).size !== ARMS.length) throw new Error("--arms requires 1-8 distinct arm names");
function judgeList(option: string): Judge[] {
	const selected = parseCommaList(args.get(option) ?? "");
	if (selected.some((judge) => !ALL_JUDGES.includes(judge as Judge)) || new Set(selected).size !== selected.length) throw new Error(`invalid --${option}`);
	return selected as Judge[];
}
const selected = args.has("judges") ? judgeList("judges") : ALL_JUDGES;
const excluded = args.has("exclude-judges") ? judgeList("exclude-judges") : [];
const activeJudges = selected.filter((judge) => !excluded.includes(judge));
const tag = args.get("tag") ?? "";
if (tag && !/^[a-zA-Z0-9_-]+$/.test(tag)) throw new Error("unsafe --tag");
const parsedSeed = Number(args.get("seed") ?? 26);
if (!Number.isSafeInteger(parsedSeed)) throw new Error("--seed must be an integer");
const armsKey = createHash("sha256").update(JSON.stringify(ARMS)).digest("hex").slice(0, 8);
const labels = LABELS.slice(0, ARMS.length);

/** Candidate order for one judge on one task, from a seed of its own. */
function shuffle<T>(items: readonly T[], key: string): T[] {
	let state = (parsedSeed ^ 0x9e3779b9) >>> 0;
	for (let i = 0; i < key.length; i++) state = Math.imul(state ^ key.charCodeAt(i), 16777619) >>> 0;
	const random = () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const copy = [...items];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
}
/** Drop harness bookkeeping so no candidate is identifiable by its artifacts. */
function normalize(diff: string): string {
	const blocks = diff.split(/(?=^diff --git )/m);
	return blocks.filter((block) => !/^diff --git a\/(\.omp|\.pi|\.s1s2)\//.test(block)).join("") || "(no changes)";
}
function clip(content: string, limit: number): string {
	if (content.length <= limit) return content;
	if (limit === 0) return "";
	const suffix = `\n[… ${content.length - limit} more characters omitted]`;
	return suffix.length < limit ? `${content.slice(0, limit - suffix.length)}${suffix}` : content.slice(0, limit);
}
function promptFor(task: Task, reference: string, diffs: Record<string, string>, order: string[]): string {
	// Round-1 final diffs ran to 30,348 characters (median 12,672), so no candidate is clipped below 32,000.
	const candidateLimit = Math.max(32_000, Math.floor(60_000 / Math.max(1, order.length - 2)));
	const example = `{${labels.map((label) => `"${label}":{"task":3,"correctness":3,"scope":3,"quality":3}`).join(",")},"ranking":[${labels.map((label) => `"${label}"`).join(",")}]}`;
	return [
		`You are reviewing ${labels.length} candidate changes (${labels.join(", ")}) to the same Git repository for the same task. Judge each on its own merits against the task statement.`,
		"You have no tools and cannot open files or run commands: judge only from the text below, and answer in one reply.",
		"A reference change that the project actually accepted is included for context; other correct solutions may differ from it.",
		`\nTask statement:\n<<<\n${task.statement}\n>>>`,
		`\nReference change (accepted; not the only correct solution):\n<<<\n${clip(reference, 60_000)}\n>>>`,
		...order.map((arm, i) => `\nCandidate ${labels[i]}:\n<<<\n${clip(diffs[arm], candidateLimit)}\n>>>`),
		"\nScore each candidate from 1 (worst) to 5 (best) on: task (does it accomplish what the task asks), correctness (likely free of bugs and regressions),",
		"scope (no unrelated or unrequested changes), quality (clear, fits the codebase, maintainable). Then rank the candidates from best to worst.",
		`Reply with only this JSON and nothing else: ${example}`,
	].join("\n");
}
function parseReply(reply: unknown, order: string[]): { scores: Record<string, Scores>; ranking: string[] } | null {
	if (!isObject(reply)) return null;
	const ranked = reply.ranking;
	if (!Array.isArray(ranked) || !ranked.every((label) => typeof label === "string") || !isPermutation(ranked, labels)) return null;
	const scores: Record<string, Scores> = {};
	for (const [i, arm] of order.entries()) {
		const score = parseScores(reply[labels[i]]);
		if (!score) return null;
		scores[arm] = score;
	}
	return { scores, ranking: ranked.map((label) => order[labels.indexOf(label)]) };
}
async function callLlm(judge: (typeof JUDGES)[number], prompt: string, order: string[], key: string): Promise<{ attempt: Attempt; result: { scores: Record<string, Scores>; ranking: string[] } | null; retry: boolean }> {
	let reply: string | null = null;
	let costUsd: number | null = null;
	let promptTokens: number | null = null;
	let completionTokens: number | null = null;
	try {
		const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "HTTP-Referer": "https://github.com/misty-step/harness", "X-Title": "Harness Blind Evaluation" },
			body: JSON.stringify({ model: judge.model, provider: { order: judge.order, allow_fallbacks: true }, reasoning: { effort: "high" }, max_tokens: 16000, usage: { include: true }, messages: [{ role: "user", content: prompt }] }),
			signal: AbortSignal.timeout(600_000),
		});
		const raw = await response.text();
		let data: unknown;
		try { data = JSON.parse(raw); } catch {
			return { attempt: { valid: false, costUsd, promptTokens, completionTokens, reply: raw, error: "unparseable response JSON" }, result: null, retry: response.ok };
		}
		if (isObject(data) && isObject(data.usage)) {
			costUsd = optionalNumber(data.usage.cost, "usage.cost");
			promptTokens = optionalNumber(data.usage.prompt_tokens, "usage.prompt_tokens");
			completionTokens = optionalNumber(data.usage.completion_tokens, "usage.completion_tokens");
		}
		if (!response.ok) return { attempt: { valid: false, costUsd, promptTokens, completionTokens, reply: raw, error: `HTTP ${response.status}` }, result: null, retry: false };
		const choices = isObject(data) && Array.isArray(data.choices) ? data.choices : [];
		const message = isObject(choices[0]) ? choices[0].message : null;
		reply = isObject(message) && typeof message.content === "string" ? message.content : null;
		let parsed: unknown = null;
		try { parsed = reply === null ? null : JSON.parse(reply); } catch { /* invalid model reply, retry once */ }
		const result = parseReply(parsed, order);
		return { attempt: { valid: result !== null, costUsd, promptTokens, completionTokens, reply, error: result ? null : "invalid JSON verdict" }, result, retry: result === null };
	} catch (error) {
		return { attempt: { valid: false, costUsd, promptTokens, completionTokens, reply, error: error instanceof Error ? error.message : String(error) }, result: null, retry: false };
	}
}
function jevState(task: Task, reference: string, diffs: Record<string, string>, order: string[]): string {
	const serialize = (taskLimit: number, referenceLimit: number, candidateLimit: number) => JSON.stringify({
		task: clip(task.statement, taskLimit), reference: clip(reference, referenceLimit),
		candidates: Object.fromEntries(order.map((arm, i) => [labels[i], clip(diffs[arm], candidateLimit)])),
	});
	const fits = (text: string) => text.length < 55_000;
	const largestFitting = (max: number, make: (limit: number) => string): number => {
		let low = 0;
		let high = max;
		while (low < high) {
			const middle = Math.ceil((low + high) / 2);
			if (fits(make(middle))) low = middle;
			else high = middle - 1;
		}
		return low;
	};
	let taskLimit = task.statement.length;
	let referenceLimit = Math.min(reference.length, 10_000);
	if (!fits(serialize(taskLimit, referenceLimit, 0))) taskLimit = largestFitting(taskLimit, (limit) => serialize(limit, referenceLimit, 0));
	if (!fits(serialize(taskLimit, referenceLimit, 0))) referenceLimit = largestFitting(referenceLimit, (limit) => serialize(taskLimit, limit, 0));
	if (!fits(serialize(taskLimit, referenceLimit, 0))) throw new Error(`task ${task.id} exceeds Jev's state budget`);
	const candidateLimit = largestFitting(Math.max(0, ...order.map((arm) => diffs[arm].length)), (limit) => serialize(taskLimit, referenceLimit, limit));
	const state = serialize(taskLimit, referenceLimit, candidateLimit);
	if (!fits(state)) throw new Error(`task ${task.id} exceeds Jev's state budget`);
	return state;
}

const judgeDir = join(out, "judging");
mkdirSync(judgeDir, { recursive: true });
const apiKey = process.env.OPENROUTER_API_KEY ?? "";
const jev = apiKey ? new OpenRouterJevProvider(apiKey, "typesafe/jev-1.13") : null;
const readCache = (path: string, task: string, judge: Judge) => existsSync(path) ? parseVerdict(JSON.parse(readFileSync(path, "utf8")), task, judge, ARMS, labels) : null;
const cachePath = (task: Task, judge: Judge) => join(judgeDir, `${task.id}.${judge}.${armsKey}.json`);
const judgements: Verdict[] = [];
const runs: Run[] = [];
for (const task of tasks) {
	const taskRuns = ARMS.flatMap((arm) => {
		const path = join(out, "runs", task.id, arm, "run.json");
		return existsSync(path) ? [parseRun(JSON.parse(readFileSync(path, "utf8")), path, task.id, arm)] : [];
	});
	runs.push(...taskRuns);
	if (taskRuns.length !== ARMS.length) continue;
	const cached = new Map(activeJudges.map((judge) => [judge, readCache(cachePath(task, judge), task.id, judge)]));
	const pending = activeJudges.filter((judge) => !cached.get(judge)?.valid);
	for (const judge of activeJudges) {
		const verdict = cached.get(judge);
		if (verdict?.valid) judgements.push(verdict);
	}
	if (!pending.length) continue;
	if (!apiKey) throw new Error(`OPENROUTER_API_KEY is required for ${task.id}: ${pending.join(", ")}`);
	const git = spawnSync("git", ["diff", task.base, task.merge], { cwd: join(out, "src"), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
	if (git.status !== 0) throw new Error(`cannot load reference for ${task.id}: ${git.stderr}`);
	const reference = git.stdout;
	const diffs = Object.fromEntries(ARMS.map((arm) => [arm, normalize(readFileSync(join(out, "runs", task.id, arm, "final.diff"), "utf8"))]));
	for (const judge of JUDGES.filter((entry) => pending.includes(entry.id))) {
		const order = shuffle(ARMS, `${task.id}:${judge.id}:${armsKey}`);
		const mapping = Object.fromEntries(order.map((arm, i) => [arm, labels[i]]));
		const prompt = promptFor(task, reference, diffs, order);
		writeFileSync(join(judgeDir, `${task.id}.${judge.id}.${armsKey}.prompt.md`), prompt);
		const previous = cached.get(judge.id);
		const attempts = previous && previous.judge !== "jev" ? previous.attempts : [];
		let record: LlmVerdict = { task: task.id, judge: judge.id, labels: mapping, valid: false, scores: null, ranking: null, costUsd: null, promptTokens: null, completionTokens: null, attempts: [...attempts] };
		for (let retry = 0; retry < 2; retry++) {
			const result = await callLlm(judge, prompt, order, apiKey);
			const nextAttempts = [...record.attempts, result.attempt];
			record = {
				...record, attempts: nextAttempts, valid: result.result !== null,
				scores: result.result?.scores ?? null, ranking: result.result?.ranking ?? null,
				costUsd: totalKnown(nextAttempts.map((attempt) => attempt.costUsd)),
				promptTokens: totalKnown(nextAttempts.map((attempt) => attempt.promptTokens)),
				completionTokens: totalKnown(nextAttempts.map((attempt) => attempt.completionTokens)),
			};
			writeFileSync(cachePath(task, judge.id), `${JSON.stringify(record, null, 2)}\n`);
			if (!result.retry || result.result) break;
		}
		judgements.push(record);
		console.log(`${task.id} ${judge.id} valid=${record.valid}`);
	}
	if (pending.includes("jev") && jev) {
		const order = shuffle(ARMS, `${task.id}:jev:${armsKey}`);
		const bestCriteria: Record<string, string> = Object.fromEntries(labels.map((label) => [label, `Candidate ${label}`]));
		bestCriteria.none_acceptable = "None of the candidates accomplishes the task";
		const questions: Record<string, Question> = {
			best: { type: "choice", instructions: "Which candidate change in `candidates` best accomplishes the task in `task`, judged against the accepted `reference` change?", criteria: bestCriteria },
		};
		for (const label of labels) {
			questions[`success_${label}`] = {
				type: "score", instructions: `How completely does candidate ${label} in \`candidates\` accomplish the task in \`task\`?`,
				criteria: ["It does not address the task", "It addresses part of the task with clear gaps or errors", "It addresses most of the task with minor gaps", "It fully accomplishes the task", "It fully accomplishes the task cleanly, with appropriate tests"],
			};
		}
		try {
			const evaluation = await jev.evaluateWithMetadata(jevState(task, reference, diffs, order), questions, 30_000);
			const best = evaluation.answers.best;
			const bestChoice = best?.type === "choice" ? best.choice : null;
			const bestArm = bestChoice === "none_acceptable" ? null : bestChoice && labels.includes(bestChoice) ? order[labels.indexOf(bestChoice)] : null;
			const success = Object.fromEntries(order.map((arm, i) => {
				const answer = evaluation.answers[`success_${labels[i]}`];
				return [arm, answer?.type === "score" && Number.isInteger(answer.score) && answer.score >= 0 && answer.score <= 4 ? answer.score + 1 : null];
			}));
			const record: JevVerdict = {
				task: task.id, judge: "jev", labels: Object.fromEntries(order.map((arm, i) => [arm, labels[i]])),
				valid: bestChoice !== null && (bestChoice === "none_acceptable" || bestArm !== null) && Object.values(success).every((score) => score !== null),
				success, best: bestArm, costUsd: evaluation.usage?.costUsd ?? null,
			};
			writeFileSync(cachePath(task, "jev"), `${JSON.stringify(record, null, 2)}\n`);
			judgements.push(record);
		} catch (error) {
			console.log(`${task.id} jev unavailable: ${error instanceof Error ? error.message.slice(0, 120) : error}`);
		}
	}
}

const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const median = (values: number[]) => {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
};
const llm = judgements.filter((entry): entry is LlmVerdict & { scores: Record<string, Scores>; ranking: string[] } => entry.judge !== "jev" && entry.valid && entry.scores !== null && entry.ranking !== null);
const jevVerdicts = judgements.filter((entry): entry is JevVerdict => entry.judge === "jev" && entry.valid);
const summary = Object.fromEntries(ARMS.map((arm) => {
	const armRuns = runs.filter((run) => run.arm === arm);
	const scores = llm.flatMap((entry) => entry.scores[arm] ? [entry.scores[arm]] : []);
	const s1 = armRuns.flatMap((run) => run.s1 ? [run.s1] : []);
	const actions: Record<string, number> = Object.create(null);
	for (const value of s1) for (const [key, count] of Object.entries(value.actions)) actions[key] = (actions[key] ?? 0) + count;
	const tokens: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	for (const run of armRuns) for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) tokens[key] += run.usage[key];
	const byModel: Record<string, ModelSpend> = Object.create(null);
	for (const run of armRuns) for (const [model, spend] of Object.entries(run.boundary.byModel)) {
		const total = byModel[model] ?? { calls: 0, settledUsd: 0 };
		total.calls += spend.calls;
		total.settledUsd += spend.settledUsd;
		byModel[model] = total;
	}
	const costUsd = armRuns.reduce((sum, run) => sum + run.boundary.settledUsd, 0);
	const advisors = s1.flatMap((value) => value.advisor ? [value.advisor] : []);
	return [arm, {
		runs: armRuns.length, hiddenPass: armRuns.filter((run) => run.hiddenPass).length, regressPass: armRuns.filter((run) => run.regressPass).length, timedOut: armRuns.filter((run) => run.timedOut).length,
		judgeTask: mean(scores.map((score) => score.task)), judgeCorrectness: mean(scores.map((score) => score.correctness)),
		judgeScope: mean(scores.map((score) => score.scope)), judgeQuality: mean(scores.map((score) => score.quality)),
		judgeOverall: mean(scores.map((score) => CRITERIA.reduce((sum, key) => sum + score[key], 0) / CRITERIA.length)),
		judgeFirstPlaces: llm.filter((entry) => entry.ranking[0] === arm).length, judgeVotes: llm.filter((entry) => entry.scores[arm]).length,
		jevSuccess: mean(jevVerdicts.map((entry) => entry.success[arm]).filter((value): value is number => value !== null && value !== undefined)),
		jevBest: jevVerdicts.filter((entry) => entry.best === arm).length,
		medianWallMs: median(armRuns.map((run) => run.wallMs)), totalWallMs: armRuns.reduce((sum, run) => sum + run.wallMs, 0),
		totalParentTurns: armRuns.reduce((sum, run) => sum + run.parentTurns, 0), totalModelCalls: armRuns.reduce((sum, run) => sum + run.modelCalls, 0),
		tokens, costUsd, costByModel: byModel,
		boundaryCalls: armRuns.reduce((sum, run) => sum + run.boundary.calls, 0), boundaryUnsettled: armRuns.reduce((sum, run) => sum + run.boundary.unsettled, 0),
		models: [...new Set(armRuns.flatMap((run) => run.models))], parity: [...new Set(armRuns.map((run) => JSON.stringify(run.parity)))],
		s1: s1.length ? {
			calls: s1.reduce((sum, value) => sum + value.calls, 0), failedCalls: s1.reduce((sum, value) => sum + value.failedCalls, 0),
			latencyMs: s1.reduce((sum, value) => sum + value.latencyMs, 0), inputTokens: s1.reduce((sum, value) => sum + value.inputTokens, 0),
			outputTokens: s1.reduce((sum, value) => sum + value.outputTokens, 0), costUsd: s1.reduce((sum, value) => sum + value.costUsd, 0),
			callsWithoutCost: s1.reduce((sum, value) => sum + value.callsWithoutCost, 0), actions,
			advisor: advisors.length ? { consults: advisors.reduce((sum, value) => sum + value.consults, 0), costUsd: advisors.reduce((sum, value) => sum + value.costUsd, 0) } : null,
		} : null,
	}];
}));
const perTask = tasks.map((task) => ({
	task: task.id, size: task.size,
	arms: Object.fromEntries(ARMS.map((arm) => {
		const run = runs.find((entry) => entry.task === task.id && entry.arm === arm);
		const taskScores = llm.flatMap((entry) => entry.task === task.id && entry.scores[arm] ? [entry.scores[arm]] : []);
		return [arm, run ? {
			hiddenPass: run.hiddenPass, regressPass: run.regressPass, costUsd: run.boundary.settledUsd,
			turns: run.parentTurns, wallMs: run.wallMs,
			judgeOverall: mean(taskScores.map((score) => CRITERIA.reduce((sum, key) => sum + score[key], 0) / CRITERIA.length)),
		} : null];
	})),
}));
const judgeLlmCostUsd = judgements.reduce((sum, entry) => sum + (entry.judge === "jev" ? 0 : entry.costUsd ?? 0), 0);
const judgeJevCostUsd = judgements.reduce((sum, entry) => sum + (entry.judge === "jev" ? entry.costUsd ?? 0 : 0), 0);
const report = { version: 2, arms: ARMS, armsKey, judges: activeJudges, summary, perTask, judgeLlmCostUsd, judgeJevCostUsd, judgements };
writeFileSync(join(out, tag ? `report-${tag}.json` : "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ summary, perTask, judgeLlmCostUsd, judgeJevCostUsd }, null, 2));
