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
 * aggregates all of them.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { OpenRouterJevProvider, type Question } from "../../../../agent-config/system-one/engine.ts";

type Task = { id: string; size: string; base: string; merge: string; statement: string };
type Run = Record<string, any>;
const CRITERIA = ["task", "correctness", "scope", "quality"] as const;
const JUDGES = [
	{ id: "opus", model: "anthropic/claude-opus-5-5", thinking: "high" },
	{ id: "gemini", model: "google-antigravity/gemini-3.1-pro", thinking: "high" },
	{ id: "grok", model: "xai-oauth/grok-4.7", thinking: "high" },
];

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1] ?? "");
const out = resolve(args.get("out") ?? "");
const tasks = (JSON.parse(readFileSync(resolve(args.get("manifest") ?? ""), "utf8")) as { tasks: Task[] }).tasks;
const ARMS = (args.get("arms") ?? "omp,s1s2,pi").split(",");
const selected = args.get("judges")?.split(",").filter(Boolean);
const LABELS = ["A", "B", "C", "D"].slice(0, ARMS.length);
let state = (Number(args.get("seed") ?? 26) ^ 0x9e3779b9) >>> 0;
const random = () => {
	state = (state + 0x6d2b79f5) >>> 0;
	let t = state;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const shuffle = <T,>(items: readonly T[]) => {
	const copy = [...items];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
};

/** Current public OpenRouter prices (USD per token) for the model under test. */
async function prices(model: string) {
	const response = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(30_000) });
	const entry = ((await response.json()) as { data: { id: string; pricing: Record<string, string | null> }[] }).data.find((item) => item.id === model);
	if (!entry) throw new Error(`no OpenRouter price for ${model}`);
	const number = (value: string | null | undefined) => Number(value ?? 0) || 0;
	return { input: number(entry.pricing.prompt), output: number(entry.pricing.completion), cacheRead: number(entry.pricing.input_cache_read), cacheWrite: number(entry.pricing.input_cache_write) };
}
const price = await prices(args.get("price-model") ?? "deepseek/deepseek-v4.1-flash");

/** Drop harness bookkeeping so no candidate is identifiable by its artifacts. */
function normalize(diff: string): string {
	const blocks = diff.split(/(?=^diff --git )/m);
	return blocks.filter((block) => !/^diff --git a\/(\.omp|\.pi|\.s1s2)\//.test(block)).join("") || "(no changes)";
}

function clip(text: string, limit: number): string {
	return text.length <= limit ? text : `${text.slice(0, limit)}\n[… ${text.length - limit} more characters omitted]`;
}

const judgeDir = join(out, "judging");
mkdirSync(judgeDir, { recursive: true });
const overlay = join(judgeDir, "judge.yml");
writeFileSync(overlay, "advisor:\n  enabled: false\n");
const jevKey = process.env.OPENROUTER_API_KEY ?? "";
const jev = jevKey ? new OpenRouterJevProvider(jevKey, "typesafe/jev-1.13") : null;

const judgements: Record<string, any>[] = [];
const runs: Run[] = [];
for (const task of tasks) {
	const taskRuns = ARMS.map((arm) => join(out, "runs", task.id, arm, "run.json")).filter(existsSync).map((path) => JSON.parse(readFileSync(path, "utf8")) as Run);
	runs.push(...taskRuns);
	if (taskRuns.length !== ARMS.length) continue;
	const reference = spawnSync("git", ["diff", task.base, task.merge], { cwd: join(out, "src"), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout;
	const diffs = Object.fromEntries(ARMS.map((arm) => [arm, normalize(readFileSync(join(out, "runs", task.id, arm, "final.diff"), "utf8"))]));

	for (const judge of JUDGES.filter((entry) => !selected || selected.includes(entry.id))) {
		const cache = join(judgeDir, `${task.id}.${judge.id}.json`);
		const cached = existsSync(cache) ? JSON.parse(readFileSync(cache, "utf8")) : null;
		if (cached?.valid) {
			judgements.push(cached);
			continue;
		}
		const order = shuffle(ARMS);
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
		let parsed: Record<string, any> | null = null;
		try {
			parsed = match ? JSON.parse(match) : null;
		} catch {
			parsed = null;
		}
		const valid =
			parsed && LABELS.every((label) => CRITERIA.every((key) => Number.isFinite(parsed?.[label]?.[key]))) && Array.isArray(parsed.ranking) && LABELS.every((label) => parsed?.ranking.includes(label));
		const record = {
			task: task.id,
			judge: judge.id,
			labels: labelOf,
			valid: Boolean(valid),
			scores: valid ? Object.fromEntries(ARMS.map((arm) => [arm, parsed?.[labelOf[arm]]])) : null,
			ranking: valid ? (parsed?.ranking as string[]).map((label) => order[LABELS.indexOf(label)]) : null,
			exit: result.status,
		};
		writeFileSync(cache, `${JSON.stringify(record, null, 2)}\n`);
		judgements.push(record);
		console.log(`${task.id} ${judge.id} valid=${record.valid}`);
	}

	const jevCache = join(judgeDir, `${task.id}.jev.json`);
	if (existsSync(jevCache)) judgements.push(JSON.parse(readFileSync(jevCache, "utf8")));
	else if (jev && (!selected || selected.includes("jev"))) {
		const order = shuffle(ARMS);
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
			const record = {
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
const costOf = (usage: Record<string, number>) => usage.input * price.input + usage.output * price.output + usage.cacheRead * price.cacheRead + usage.cacheWrite * price.cacheWrite;
const llm = judgements.filter((entry) => entry.judge !== "jev" && entry.valid);
const summary = Object.fromEntries(
	ARMS.map((arm) => {
		const armRuns = runs.filter((run) => run.arm === arm);
		const scores = llm.map((entry) => entry.scores[arm]);
		const s1 = armRuns.map((run) => run.s1).filter(Boolean);
		const modelCost = armRuns.reduce((sum, run) => sum + costOf(run.usage), 0);
		const jevCost = s1.reduce((sum, value) => sum + value.costUsd, 0);
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
				jevSuccess: mean(judgements.filter((entry) => entry.judge === "jev").map((entry) => entry.success[arm]).filter((value) => value !== null)),
				jevBest: judgements.filter((entry) => entry.judge === "jev" && entry.best === arm).length,
				medianWallSec: median(armRuns.map((run) => run.wallMs / 1000)),
				totalWallSec: armRuns.reduce((sum, run) => sum + run.wallMs / 1000, 0),
				meanParentTurns: mean(armRuns.map((run) => run.parentTurns)),
				meanModelCalls: mean(armRuns.map((run) => run.modelCalls)),
				tokens: ["input", "output", "cacheRead", "cacheWrite"].reduce((acc, key) => ({ ...acc, [key]: armRuns.reduce((sum, run) => sum + run.usage[key], 0) }), {} as Record<string, number>),
				modelCostUsd: modelCost,
				jevCostUsd: jevCost,
				totalCostUsd: modelCost + jevCost,
				models: [...new Set(armRuns.flatMap((run) => run.models))],
				parity: [...new Set(armRuns.map((run) => JSON.stringify(run.parity)))],
				s1: s1.length ? { calls: s1.reduce((sum, value) => sum + value.calls, 0), failedCalls: s1.reduce((sum, value) => sum + value.failedCalls, 0), latencyMs: s1.reduce((sum, value) => sum + value.latencyMs, 0), actions: s1.reduce((acc, value) => { for (const [key, count] of Object.entries(value.actions as Record<string, number>)) acc[key] = (acc[key] ?? 0) + count; return acc; }, {} as Record<string, number>) } : null,
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
const judgeJevCostUsd = judgements.filter((entry) => entry.judge === "jev").reduce((sum, entry) => sum + (entry.costUsd ?? 0), 0);
writeFileSync(join(out, "report.json"), `${JSON.stringify({ version: 1, price, summary, perTask, judgeJevCostUsd, judgements }, null, 2)}\n`);
console.log(JSON.stringify({ summary, perTask, judgeJevCostUsd }, null, 2));
