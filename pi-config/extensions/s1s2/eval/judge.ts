#!/usr/bin/env bun
/**
 * Blind judging and aggregation for a vibe-check run directory (US-029).
 *
 * For each task with all arms complete, three subscription-backed LLM judges
 * (run through OMP with no tools, no extensions, and the advisor off) and one
 * Jev panel see the task statement, the merged pull request as one accepted
 * solution, and the arms' final diffs under shuffled labels. They never see
 * transcripts, harness names, timings, or test results. Scores are mapped back
 * to arms only after parsing, then aggregated with the runner's measurements.
 *
 * Usage (OPENROUTER_API_KEY only for the Jev panel):
 *   pass-env run -f .env.pass -- bun pi-config/extensions/s1s2/eval/judge.ts --manifest m.json --out dir [--seed 26]
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { OpenRouterJevProvider, type Question } from "../../../../agent-config/system-one/engine.ts";

type Task = { id: string; size: string; base: string; merge: string; statement: string };
type Run = Record<string, any>;
const ARMS = ["omp", "s1s2", "pi"] as const;
const LABELS = ["A", "B", "C"] as const;
const CRITERIA = ["task", "correctness", "scope", "quality"] as const;
const JUDGES = [
	{ id: "opus", model: "anthropic/claude-opus-5-5", thinking: "high" },
	{ id: "gemini", model: "google-antigravity/gemini-3.1-pro", thinking: "high" },
	{ id: "grok", model: "xai-oauth/grok-4.7", thinking: "high" },
];
// Catalog prices (USD per million tokens) for the model under test, to compare arms on one scale.
const PRICE = { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 };

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1] ?? "");
const out = resolve(args.get("out") ?? "");
const tasks = (JSON.parse(readFileSync(resolve(args.get("manifest") ?? ""), "utf8")) as { tasks: Task[] }).tasks;
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
let jevCost = 0;

const judgements: Record<string, any>[] = [];
const runs: Run[] = [];
for (const task of tasks) {
	const taskRuns = ARMS.map((arm) => join(out, "runs", task.id, arm, "run.json")).filter(existsSync).map((path) => JSON.parse(readFileSync(path, "utf8")) as Run);
	runs.push(...taskRuns);
	if (taskRuns.length !== ARMS.length) continue;
	const reference = spawnSync("git", ["diff", task.base, task.merge], { cwd: join(out, "src"), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout;
	const diffs = Object.fromEntries(ARMS.map((arm) => [arm, normalize(readFileSync(join(out, "runs", task.id, arm, "final.diff"), "utf8"))]));

	for (const judge of JUDGES) {
		const cache = join(judgeDir, `${task.id}.${judge.id}.json`);
		if (existsSync(cache)) {
			judgements.push(JSON.parse(readFileSync(cache, "utf8")));
			continue;
		}
		const order = shuffle(ARMS);
		const labelOf = Object.fromEntries(order.map((arm, i) => [arm, LABELS[i]]));
		const prompt = [
			"You are reviewing three candidate changes (A, B, C) to the same Git repository for the same task. Judge each on its own merits against the task statement.",
			"A reference change that the project actually accepted is included for context; other correct solutions may differ from it.",
			`\nTask statement:\n<<<\n${task.statement}\n>>>`,
			`\nReference change (accepted; not the only correct solution):\n<<<\n${clip(reference, 60_000)}\n>>>`,
			...order.map((arm, i) => `\nCandidate ${LABELS[i]}:\n<<<\n${clip(diffs[arm], 60_000)}\n>>>`),
			"\nScore each candidate from 1 (worst) to 5 (best) on: task (does it accomplish what the task asks), correctness (likely free of bugs and regressions),",
			"scope (no unrelated or unrequested changes), quality (clear, fits the codebase, maintainable). Then rank the candidates from best to worst.",
			'Reply with only this JSON and nothing else: {"A":{"task":n,"correctness":n,"scope":n,"quality":n},"B":{...},"C":{...},"ranking":["X","Y","Z"]}',
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
		const valid = parsed && LABELS.every((label) => CRITERIA.every((key) => Number.isFinite(parsed?.[label]?.[key]))) && Array.isArray(parsed.ranking);
		const record = {
			task: task.id,
			judge: judge.id,
			labels: labelOf,
			valid: Boolean(valid),
			scores: valid ? Object.fromEntries(ARMS.map((arm) => [arm, parsed?.[labelOf[arm]]])) : null,
			ranking: valid ? (parsed?.ranking as string[]).map((label) => order[LABELS.indexOf(label as (typeof LABELS)[number])]) : null,
			exit: result.status,
		};
		writeFileSync(cache, `${JSON.stringify(record, null, 2)}\n`);
		judgements.push(record);
		console.log(`${task.id} ${judge.id} valid=${record.valid}`);
	}

	const jevCache = join(judgeDir, `${task.id}.jev.json`);
	if (existsSync(jevCache)) judgements.push(JSON.parse(readFileSync(jevCache, "utf8")));
	else if (jev) {
		const order = shuffle(ARMS);
		const questions: Record<string, Question> = {
			best: {
				type: "choice",
				instructions: "Which candidate change in `candidates` best accomplishes the task in `task`, judged against the accepted `reference` change?",
				criteria: { A: "Candidate A", B: "Candidate B", C: "Candidate C", none_acceptable: "None of the candidates accomplishes the task" },
			},
		};
		for (const label of LABELS) {
			questions[`success_${label}`] = {
				type: "score",
				instructions: `How completely does candidate ${label} in \`candidates\` accomplish the task in \`task\`?`,
				criteria: ["It does not address the task", "It addresses part of the task with clear gaps or errors", "It addresses most of the task with minor gaps", "It fully accomplishes the task", "It fully accomplishes the task cleanly, with appropriate tests"],
			};
		}
		const jevState = JSON.stringify({
			task: task.statement,
			reference: clip(reference, 12_000),
			candidates: Object.fromEntries(order.map((arm, i) => [LABELS[i], clip(diffs[arm], 12_000)])),
		});
		try {
			const evaluation = await jev.evaluateWithMetadata(jevState, questions, 30_000);
			jevCost += evaluation.usage?.costUsd ?? 0;
			const best = evaluation.answers.best;
			const record = {
				task: task.id,
				judge: "jev",
				labels: Object.fromEntries(order.map((arm, i) => [arm, LABELS[i]])),
				valid: true,
				success: Object.fromEntries(order.map((arm, i) => {
					const answer = evaluation.answers[`success_${LABELS[i]}`];
					return [arm, answer?.type === "score" ? answer.score + 1 : null];
				})),
				best: best?.type === "choice" && best.choice !== "none_acceptable" ? order[LABELS.indexOf(best.choice as (typeof LABELS)[number])] : null,
				costUsd: evaluation.usage?.costUsd ?? null,
			};
			writeFileSync(jevCache, `${JSON.stringify(record, null, 2)}\n`);
			judgements.push(record);
		} catch (error) {
			console.log(`${task.id} jev unavailable: ${error instanceof Error ? error.message.slice(0, 120) : error}`);
		}
	}
}

// Aggregate per arm.
const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
const median = (values: number[]) => {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
};
const summary = Object.fromEntries(
	ARMS.map((arm) => {
		const armRuns = runs.filter((run) => run.arm === arm);
		const llm = judgements.filter((entry) => entry.judge !== "jev" && entry.valid);
		const scores = llm.map((entry) => entry.scores[arm]);
		const tokens = armRuns.map((run) => run.usage);
		const cost = tokens.map((usage) => (usage.input * PRICE.input + usage.output * PRICE.output + usage.cacheRead * PRICE.cacheRead + usage.cacheWrite * PRICE.cacheWrite) / 1e6);
		const s1 = armRuns.map((run) => run.s1).filter(Boolean);
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
				jevSuccess: mean(judgements.filter((entry) => entry.judge === "jev").map((entry) => entry.success[arm]).filter((value) => value !== null)),
				jevBest: judgements.filter((entry) => entry.judge === "jev" && entry.best === arm).length,
				medianWallSec: median(armRuns.map((run) => run.wallMs / 1000)),
				totalWallSec: armRuns.reduce((sum, run) => sum + run.wallMs / 1000, 0),
				meanParentTurns: mean(armRuns.map((run) => run.parentTurns)),
				meanModelCalls: mean(armRuns.map((run) => run.modelCalls)),
				tokens: ["input", "output", "cacheRead", "cacheWrite"].reduce((acc, key) => ({ ...acc, [key]: tokens.reduce((sum, usage) => sum + usage[key], 0) }), {} as Record<string, number>),
				catalogCostUsd: cost.reduce((sum, value) => sum + value, 0),
				models: [...new Set(armRuns.flatMap((run) => run.models))],
				parity: [...new Set(armRuns.map((run) => JSON.stringify(run.parity)))],
				s1: s1.length ? { calls: s1.reduce((sum, value) => sum + value.calls, 0), failedCalls: s1.reduce((sum, value) => sum + value.failedCalls, 0), latencyMs: s1.reduce((sum, value) => sum + value.latencyMs, 0), costUsd: s1.reduce((sum, value) => sum + value.costUsd, 0), actions: s1.reduce((acc, value) => { for (const [key, count] of Object.entries(value.actions as Record<string, number>)) acc[key] = (acc[key] ?? 0) + count; return acc; }, {} as Record<string, number>) } : null,
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
			const llm = judgements.filter((entry) => entry.task === task.id && entry.judge !== "jev" && entry.valid);
			return [arm, run ? { hidden: run.hiddenPass, wallSec: Math.round(run.wallMs / 1000), turns: run.parentTurns, judgeTask: mean(llm.map((entry) => entry.scores[arm].task)), firsts: llm.filter((entry) => entry.ranking[0] === arm).length } : null];
		}),
	),
}));
writeFileSync(join(out, "report.json"), `${JSON.stringify({ version: 1, summary, perTask, judgeJevCostUsd: jevCost, judgements }, null, 2)}\n`);
console.log(JSON.stringify({ summary, perTask }, null, 2));
