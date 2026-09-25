#!/usr/bin/env bun
/**
 * Blind judging and aggregation for a vibe-check run directory (US-030).
 *
 * For each task where every arm finished, three subscription-backed LLM judges
 * (run through OMP with no tools, no extensions, and the advisor off) and one
 * Jev panel see the task statement, the merged pull request as one accepted
 * solution, and the arms' final diffs under shuffled labels. They never see
 * transcripts, harness names, timings, or test results. Scores map back to arms
 * only after parsing, then aggregate with the runner's measurements.
 *
 * Usage (OPENROUTER_API_KEY only for the Jev panel):
 *   pass-env run -f .env.pass -- bun pi-config/extensions/s1s2/eval/judge.ts \
 *     --manifest m.json --out dir --arms omp,s1s2 --price-model deepseek/deepseek-v4.1-flash
 * `--judges opus,jev` limits a pass to those judges, so each judge can run as its own
 * process; verdicts are cached per task and judge, and a final pass without the option
 * aggregates all of them. Each judge's candidate order is drawn from its own seed for
 * each task, so splitting passes across processes never gives every judge the same
 * order.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { OpenRouterJevProvider, type Question } from "../../../../agent-config/system-one/engine.ts";

const CRITERIA = ["task", "correctness", "scope", "quality"] as const;
type Scores = Record<(typeof CRITERIA)[number], number>;
type Task = { id: string; size: string; base: string; merge: string; statement: string };
type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };
type S1Summary = { calls: number; failedCalls: number; latencyMs: number; costUsd: number; actions: Record<string, number> };
type Run = { task: string; arm: string; hiddenPass: boolean; regressPass: boolean; timedOut: boolean; wallMs: number; parentTurns: number; modelCalls: number; usage: Usage; models: string[]; parity: unknown; s1: S1Summary | null };
type LlmVerdict = { task: string; judge: string; labels: Record<string, string>; valid: boolean; scores: Record<string, Scores> | null; ranking: string[] | null; exit: number | null };
type JevVerdict = { task: string; judge: "jev"; labels: Record<string, string>; valid: boolean; success: Record<string, number | null>; best: string | null; costUsd: number | null };
type Verdict = LlmVerdict | JevVerdict;

const JUDGES = [
	{ id: "opus", model: "anthropic/claude-opus-5-5", thinking: "high" },
	{ id: "gemini", model: "google-antigravity/gemini-3.1-pro", thinking: "high" },
	{ id: "grok", model: "xai-oauth/grok-4.7", thinking: "high" },
];

// Runs, verdicts, and model replies are read from disk or a model, so every field is checked before use.
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object";
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
function number(value: unknown, what: string): number {
	if (!finite(value)) throw new Error(`${what} is not a number`);
	return value;
}
function text(value: unknown, what: string): string {
	if (typeof value !== "string") throw new Error(`${what} is not a string`);
	return value;
}
const strings = (value: unknown) => (isObject(value) ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {});
const counts = (value: unknown) => (isObject(value) ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => finite(entry[1]))) : {});

function parseScores(value: unknown): Scores | null {
	if (!isObject(value)) return null;
	const { task, correctness, scope, quality } = value;
	return finite(task) && finite(correctness) && finite(scope) && finite(quality) ? { task, correctness, scope, quality } : null;
}

function parseRun(value: unknown, path: string): Run {
	if (!isObject(value) || !isObject(value.usage)) throw new Error(`${path} is not a run record`);
	const { usage, s1 } = value;
	return {
		task: text(value.task, `${path} task`),
		arm: text(value.arm, `${path} arm`),
		hiddenPass: value.hiddenPass === true,
		regressPass: value.regressPass === true,
		timedOut: value.timedOut === true,
		wallMs: number(value.wallMs, `${path} wallMs`),
		parentTurns: number(value.parentTurns, `${path} parentTurns`),
		modelCalls: number(value.modelCalls, `${path} modelCalls`),
		usage: { input: number(usage.input, "usage.input"), output: number(usage.output, "usage.output"), cacheRead: number(usage.cacheRead, "usage.cacheRead"), cacheWrite: number(usage.cacheWrite, "usage.cacheWrite") },
		models: Array.isArray(value.models) ? value.models.filter((model): model is string => typeof model === "string") : [],
		parity: value.parity,
		s1: isObject(s1)
			? { calls: number(s1.calls, "s1.calls"), failedCalls: number(s1.failedCalls, "s1.failedCalls"), latencyMs: number(s1.latencyMs, "s1.latencyMs"), costUsd: finite(s1.costUsd) ? s1.costUsd : 0, actions: counts(s1.actions) }
			: null,
	};
}

function parseVerdict(value: unknown): Verdict | null {
	if (!isObject(value) || typeof value.task !== "string" || typeof value.judge !== "string") return null;
	const labels = strings(value.labels);
	if (value.judge === "jev") {
		const success = isObject(value.success) ? Object.fromEntries(Object.entries(value.success).map(([arm, score]) => [arm, finite(score) ? score : null])) : {};
		return { task: value.task, judge: "jev", labels, valid: value.valid === true, success, best: typeof value.best === "string" ? value.best : null, costUsd: finite(value.costUsd) ? value.costUsd : null };
	}
	let complete: Record<string, Scores> | null = isObject(value.scores) ? {} : null;
	for (const [arm, score] of isObject(value.scores) ? Object.entries(value.scores) : []) {
		const parsed = parseScores(score);
		if (parsed && complete) complete[arm] = parsed;
		else complete = null;
	}
	const listed = Array.isArray(value.ranking) ? value.ranking.filter((arm): arm is string => typeof arm === "string") : [];
	const ranking = Array.isArray(value.ranking) && listed.length === value.ranking.length ? listed : null;
	return { task: value.task, judge: value.judge, labels, valid: value.valid === true && complete !== null && ranking !== null, scores: complete, ranking, exit: finite(value.exit) ? value.exit : null };
}

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1] ?? "");
const out = resolve(args.get("out") ?? "");
const tasks = (JSON.parse(readFileSync(resolve(args.get("manifest") ?? ""), "utf8")) as { tasks: Task[] }).tasks; // the curated manifest this evaluation ships with
const ARMS = (args.get("arms") ?? "omp,s1s2,pi").split(",");
const selected = args.get("judges")?.split(",").filter(Boolean);
const LABELS = ["A", "B", "C", "D"].slice(0, ARMS.length);
const seed = Number(args.get("seed") ?? 26);

/** Candidate order for one judge on one task, from a seed of its own. */
function shuffle<T>(items: readonly T[], key: string): T[] {
	let state = (seed ^ 0x9e3779b9) >>> 0;
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

/** Current public OpenRouter prices (USD per token) for the model under test. */
async function prices(model: string) {
	const response = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(30_000) });
	const catalog: unknown = await response.json();
	const entry = isObject(catalog) && Array.isArray(catalog.data) ? catalog.data.find((item) => isObject(item) && item.id === model) : undefined;
	if (!isObject(entry) || !isObject(entry.pricing)) throw new Error(`no OpenRouter price for ${model}`);
	const rate = (value: unknown) => Number(value ?? 0) || 0;
	return { input: rate(entry.pricing.prompt), output: rate(entry.pricing.completion), cacheRead: rate(entry.pricing.input_cache_read), cacheWrite: rate(entry.pricing.input_cache_write) };
}
const price = await prices(args.get("price-model") ?? "deepseek/deepseek-v4.1-flash");

/** Drop harness bookkeeping so no candidate is identifiable by its artifacts. */
function normalize(diff: string): string {
	const blocks = diff.split(/(?=^diff --git )/m);
	return blocks.filter((block) => !/^diff --git a\/(\.omp|\.pi|\.s1s2)\//.test(block)).join("") || "(no changes)";
}

function clip(content: string, limit: number): string {
	return content.length <= limit ? content : `${content.slice(0, limit)}\n[… ${content.length - limit} more characters omitted]`;
}

const judgeDir = join(out, "judging");
mkdirSync(judgeDir, { recursive: true });
const overlay = join(judgeDir, "judge.yml");
writeFileSync(overlay, "advisor:\n  enabled: false\n");
const jevKey = process.env.OPENROUTER_API_KEY ?? "";
const jev = jevKey ? new OpenRouterJevProvider(jevKey, "typesafe/jev-1.13") : null;
const readCache = (path: string) => (existsSync(path) ? parseVerdict(JSON.parse(readFileSync(path, "utf8"))) : null);

const judgements: Verdict[] = [];
const runs: Run[] = [];
for (const task of tasks) {
	const taskRuns = ARMS.map((arm) => join(out, "runs", task.id, arm, "run.json"))
		.filter(existsSync)
		.map((path) => parseRun(JSON.parse(readFileSync(path, "utf8")), path));
	runs.push(...taskRuns);
	if (taskRuns.length !== ARMS.length) continue;
	const reference = spawnSync("git", ["diff", task.base, task.merge], { cwd: join(out, "src"), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout ?? "";
	const diffs = Object.fromEntries(ARMS.map((arm) => [arm, normalize(readFileSync(join(out, "runs", task.id, arm, "final.diff"), "utf8"))]));

	for (const judge of JUDGES.filter((entry) => !selected || selected.includes(entry.id))) {
		const cache = join(judgeDir, `${task.id}.${judge.id}.json`);
		const cached = readCache(cache);
		if (cached?.valid) {
			judgements.push(cached);
			continue;
		}
		const order = shuffle(ARMS, `${task.id}:${judge.id}`);
		const labelOf = Object.fromEntries(order.map((arm, i) => [arm, LABELS[i]]));
		const example = `{${LABELS.map((label) => `"${label}":{"task":n,"correctness":n,"scope":n,"quality":n}`).join(",")},"ranking":[${LABELS.map(() => '"X"').join(",")}]}`;
		const prompt = [
			`You are reviewing ${LABELS.length} candidate changes (${LABELS.join(", ")}) to the same Git repository for the same task. Judge each on its own merits against the task statement.`,
			"You have no tools and cannot open files or run commands: judge only from the text below, and answer in one reply.",
			"A reference change that the project actually accepted is included for context; other correct solutions may differ from it.",
			`\nTask statement:\n<<<\n${task.statement}\n>>>`,
			`\nReference change (accepted; not the only correct solution):\n<<<\n${clip(reference, 60_000)}\n>>>`,
			...order.map((arm, i) => `\nCandidate ${LABELS[i]}:\n<<<\n${clip(diffs[arm], 60_000)}\n>>>`),
			"\nScore each candidate from 1 (worst) to 5 (best) on: task (does it accomplish what the task asks), correctness (likely free of bugs and regressions),",
			"scope (no unrelated or unrequested changes), quality (clear, fits the codebase, maintainable). Then rank the candidates from best to worst.",
			`Reply with only this JSON and nothing else: ${example}`,
		].join("\n");
		const promptFile = join(judgeDir, `${task.id}.${judge.id}.prompt.md`);
		writeFileSync(promptFile, prompt);
		const result = spawnSync(
			"omp",
			["-p", "--mode", "text", "--no-tools", "--no-extensions", "--no-skills", "--no-rules", "--no-title", "--no-session", "--config", overlay, "--model", judge.model, "--thinking", judge.thinking, `@${promptFile}`, "Follow the instructions in the attached file."],
			{ cwd: judgeDir, encoding: "utf8", timeout: 900_000, maxBuffer: 16 * 1024 * 1024 },
		);
		const match = [...(result.stdout ?? "").matchAll(/\{[\s\S]*\}/g)].at(-1)?.[0];
		let reply: unknown = null;
		try {
			reply = match ? JSON.parse(match) : null;
		} catch {
			reply = null;
		}
		const byLabel = Object.fromEntries(LABELS.map((label) => [label, parseScores(isObject(reply) ? reply[label] : undefined)]));
		const rankedLabels = isObject(reply) && Array.isArray(reply.ranking) ? reply.ranking.filter((label): label is string => typeof label === "string") : [];
		const valid = LABELS.every((label) => byLabel[label] !== null && rankedLabels.includes(label));
		const scores: Record<string, Scores> = {};
		for (const arm of ARMS) {
			const score = byLabel[labelOf[arm]];
			if (score) scores[arm] = score;
		}
		const record: LlmVerdict = {
			task: task.id,
			judge: judge.id,
			labels: labelOf,
			valid,
			scores: valid ? scores : null,
			ranking: valid ? rankedLabels.filter((label) => LABELS.includes(label)).map((label) => order[LABELS.indexOf(label)]) : null,
			exit: result.status,
		};
		writeFileSync(cache, `${JSON.stringify(record, null, 2)}\n`);
		judgements.push(record);
		console.log(`${task.id} ${judge.id} valid=${record.valid}`);
	}

	const jevCache = join(judgeDir, `${task.id}.jev.json`);
	const cachedJev = readCache(jevCache);
	if (cachedJev) judgements.push(cachedJev);
	else if (jev && (!selected || selected.includes("jev"))) {
		const order = shuffle(ARMS, `${task.id}:jev`);
		const bestCriteria: Record<string, string> = Object.fromEntries(LABELS.map((label) => [label, `Candidate ${label}`]));
		bestCriteria.none_acceptable = "None of the candidates accomplishes the task";
		const questions: Record<string, Question> = {
			best: { type: "choice", instructions: "Which candidate change in `candidates` best accomplishes the task in `task`, judged against the accepted `reference` change?", criteria: bestCriteria },
		};
		for (const label of LABELS) {
			questions[`success_${label}`] = {
				type: "score",
				instructions: `How completely does candidate ${label} in \`candidates\` accomplish the task in \`task\`?`,
				criteria: ["It does not address the task", "It addresses part of the task with clear gaps or errors", "It addresses most of the task with minor gaps", "It fully accomplishes the task", "It fully accomplishes the task cleanly, with appropriate tests"],
			};
		}
		const jevState = JSON.stringify({ task: task.statement, reference: clip(reference, 12_000), candidates: Object.fromEntries(order.map((arm, i) => [LABELS[i], clip(diffs[arm], 12_000)])) });
		try {
			const evaluation = await jev.evaluateWithMetadata(jevState, questions, 30_000);
			const best = evaluation.answers.best;
			const record: JevVerdict = {
				task: task.id,
				judge: "jev",
				labels: Object.fromEntries(order.map((arm, i) => [arm, LABELS[i]])),
				valid: true,
				success: Object.fromEntries(
					order.map((arm, i) => {
						const answer = evaluation.answers[`success_${LABELS[i]}`];
						return [arm, answer?.type === "score" ? answer.score + 1 : null];
					}),
				),
				best: best?.type === "choice" && best.choice !== "none_acceptable" ? order[LABELS.indexOf(best.choice)] : null,
				costUsd: evaluation.usage?.costUsd ?? null,
			};
			writeFileSync(jevCache, `${JSON.stringify(record, null, 2)}\n`);
			judgements.push(record);
		} catch (error) {
			console.log(`${task.id} jev unavailable: ${error instanceof Error ? error.message.slice(0, 120) : error}`);
		}
	}
}

const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
const median = (values: number[]) => {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
};
const costOf = (usage: Usage) => usage.input * price.input + usage.output * price.output + usage.cacheRead * price.cacheRead + usage.cacheWrite * price.cacheWrite;
const llm = judgements.filter((entry): entry is LlmVerdict & { scores: Record<string, Scores>; ranking: string[] } => entry.judge !== "jev" && entry.valid && "scores" in entry && entry.scores !== null && entry.ranking !== null);
const jevVerdicts = judgements.filter((entry): entry is JevVerdict => entry.judge === "jev");
const summary = Object.fromEntries(
	ARMS.map((arm) => {
		const armRuns = runs.filter((run) => run.arm === arm);
		const scores = llm.map((entry) => entry.scores[arm]);
		const s1 = armRuns.flatMap((run) => (run.s1 ? [run.s1] : []));
		const modelCost = armRuns.reduce((sum, run) => sum + costOf(run.usage), 0);
		const jevCost = s1.reduce((sum, value) => sum + value.costUsd, 0);
		const actions: Record<string, number> = {};
		for (const value of s1) for (const [key, count] of Object.entries(value.actions)) actions[key] = (actions[key] ?? 0) + count;
		const tokens: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
		for (const run of armRuns) for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) tokens[key] += run.usage[key];
		return [
			arm,
			{
				runs: armRuns.length,
				hiddenPass: armRuns.filter((run) => run.hiddenPass).length,
				regressPass: armRuns.filter((run) => run.regressPass).length,
				timedOut: armRuns.filter((run) => run.timedOut).length,
				judgeTask: mean(scores.map((score) => score.task)),
				judgeOverall: mean(scores.map((score) => CRITERIA.reduce((sum, key) => sum + score[key], 0) / CRITERIA.length)),
				judgeFirstPlaces: llm.filter((entry) => entry.ranking[0] === arm).length,
				judgeVotes: llm.length,
				jevSuccess: mean(jevVerdicts.map((entry) => entry.success[arm]).filter((value): value is number => value !== null && value !== undefined)),
				jevBest: jevVerdicts.filter((entry) => entry.best === arm).length,
				medianWallSec: median(armRuns.map((run) => run.wallMs / 1000)),
				totalWallSec: armRuns.reduce((sum, run) => sum + run.wallMs / 1000, 0),
				meanParentTurns: mean(armRuns.map((run) => run.parentTurns)),
				meanModelCalls: mean(armRuns.map((run) => run.modelCalls)),
				tokens,
				modelCostUsd: modelCost,
				jevCostUsd: jevCost,
				totalCostUsd: modelCost + jevCost,
				models: [...new Set(armRuns.flatMap((run) => run.models))],
				parity: [...new Set(armRuns.map((run) => JSON.stringify(run.parity)))],
				s1: s1.length ? { calls: s1.reduce((sum, value) => sum + value.calls, 0), failedCalls: s1.reduce((sum, value) => sum + value.failedCalls, 0), latencyMs: s1.reduce((sum, value) => sum + value.latencyMs, 0), actions } : null,
			},
		];
	}),
);
const perTask = tasks.map((task) => ({
	task: task.id,
	size: task.size,
	arms: Object.fromEntries(
		ARMS.map((arm) => {
			const run = runs.find((entry) => entry.task === task.id && entry.arm === arm);
			const taskJudges = llm.filter((entry) => entry.task === task.id);
			return [
				arm,
				run
					? { hidden: run.hiddenPass, regress: run.regressPass, wallSec: Math.round(run.wallMs / 1000), turns: run.parentTurns, calls: run.modelCalls, costUsd: costOf(run.usage) + (run.s1?.costUsd ?? 0), judgeTask: mean(taskJudges.map((entry) => entry.scores[arm].task)), firsts: taskJudges.filter((entry) => entry.ranking[0] === arm).length }
					: null,
			];
		}),
	),
}));
const judgeJevCostUsd = jevVerdicts.reduce((sum, entry) => sum + (entry.costUsd ?? 0), 0);
writeFileSync(join(out, "report.json"), `${JSON.stringify({ version: 1, price, summary, perTask, judgeJevCostUsd, judgements }, null, 2)}\n`);
console.log(JSON.stringify({ summary, perTask, judgeJevCostUsd }, null, 2));
