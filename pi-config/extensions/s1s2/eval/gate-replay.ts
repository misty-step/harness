#!/usr/bin/env bun
/**
 * Round-2 setup step (US-029): calibrate the advisor gate on recorded runs before any live run.
 *
 * For every turn of every recorded Pi session that ended with tool results, this rebuilds the
 * state the live gate would send (task, recent actions, last executor message, ledger facts) and
 * asks Jev the gate question. It then replays the live policy (a structural consult after the
 * first edit, a minimum gap between gate consults, the last consult kept for the final review)
 * at each candidate threshold and reports gate consults per run. With `--sample N` it also
 * consults the advisor model at N of the points the chosen threshold picks, and at the end of a
 * few runs, to check the reply format, latency, and cost. Replayed edits are approximate: the
 * live battery reads the worktree, the replay reads edit tools and file-writing shell commands.
 *
 * Usage (evidence from misty-step/system1-prototype):
 *   pass-env run -e OPENROUTER_API_KEY=workstation/OPENROUTER_API_KEY_MIRRODIN_PI -- \
 *     bun pi-config/extensions/s1s2/eval/gate-replay.ts --evidence <repo>/evidence --out <dir> \
 *     [--threshold 0.8] [--sample 10]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { OpenRouterJevProvider } from "../../../../agent-config/system-one/engine.ts";
import * as A from "../advisor.ts";
import { CALL_TIMEOUT_MS, STATE_MAX_CHARS } from "../questions.ts";
import { describeAction, monitorFacts, type Action } from "../sensors.ts";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1] ?? "");
const fail = (message: string): never => (console.error(message), process.exit(2));
const evidence = resolve(args.get("evidence") || fail("missing --evidence"));
const out = resolve(args.get("out") || fail("missing --out"));
const threshold = Number(args.get("threshold") ?? A.ADVISOR.gateMin);
const sample = Number(args.get("sample") ?? 0);
const key = process.env.OPENROUTER_API_KEY?.trim() || fail("OPENROUTER_API_KEY is required");
const ADVISOR_MODEL = "xiaomi/mimo-v2.6-pro";
const ADVISOR_UPSTREAM = "xiaomi";
const THRESHOLDS = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9];
/** File-writing shell commands; the live battery detects these edits from the worktree instead. */
const SHELL_EDIT = /\bsed -i|\bcat\s*>|\btee\b|\bapply_patch\b|\bpython3?\s+-\s*<<|writeFileSync|>\s*[\w./-]+\.(ts|md|json|sh|yml|yaml)\b/;

type Point = { turn: number; state: A.GateState; cards: A.Card[]; edited: boolean; p: number | null };
type Run = { id: string; task: string; points: Point[]; cards: A.Card[]; finalDiff: string };

const asObject = (value: unknown): Record<string, unknown> | undefined => (value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined);
const textOf = (content: unknown): string =>
	typeof content === "string" ? content : Array.isArray(content) ? content.map((part) => (asObject(part)?.type === "text" ? String(asObject(part)?.text ?? "") : "")).join("\n") : "";

/** One recorded Pi session, replayed turn by turn the way the extension's handlers see it. */
function replay(id: string, sessionFile: string, finalDiff: string): Run {
	let task = "";
	let turn = 0;
	let lastMessage = "";
	const actions: Action[] = [];
	const cards: A.Card[] = [];
	const points: Point[] = [];
	const calls = new Map<string, { name: string; args: unknown }>();
	let results = 0;
	let edited = false;
	const closeTurn = () => {
		if (turn === 0 || results === 0) return;
		const editsSoFar = actions.filter((action) => action.kind === "edit").length;
		const state = A.gateState(task, turn, actions, monitorFacts(actions, turn), { lastMessage, editsSoFar });
		points.push({ turn, state, cards: [...cards], edited, p: null });
	};
	for (const line of readFileSync(sessionFile, "utf8").split("\n")) {
		if (!line.trim()) continue;
		const entry = asObject(JSON.parse(line));
		if (entry?.type === "custom_message" && (entry.customType === "s1s2/brief" || entry.customType === "s1s2/note")) {
			cards.push(A.noteCard(turn, entry.customType === "s1s2/brief" ? "System 1 brief" : "System 1 note", textOf(entry.content)));
			continue;
		}
		const message = entry?.type === "message" ? asObject(entry.message) : undefined;
		if (!message) continue;
		if (message.role === "user" && !task) task = textOf(message.content);
		if (message.role === "assistant") {
			closeTurn();
			turn++;
			results = 0;
			edited = false;
			const parts = Array.isArray(message.content) ? message.content.map(asObject) : [];
			lastMessage = parts.map((part) => (part?.type === "text" ? String(part.text ?? "") : "")).join("\n").slice(-2000);
			const card = A.assistantCard(turn, lastMessage);
			if (card) cards.push(card);
			for (const part of parts) if (part?.type === "toolCall" && typeof part.id === "string") calls.set(part.id, { name: String(part.name ?? ""), args: part.arguments });
		}
		if (message.role === "toolResult") {
			const call = calls.get(String(message.toolCallId ?? "")) ?? { name: String(message.toolName ?? ""), args: {} };
			const described = describeAction(call.name, call.args, []);
			const command = String(asObject(call.args)?.command ?? "");
			const kind = described.kind === "edit" || (call.name === "bash" && SHELL_EDIT.test(command)) ? "edit" : described.kind;
			const ok = message.isError !== true;
			if (kind === "edit") edited = true;
			actions.push({ ...described, kind, turn, ok });
			cards.push(A.toolCard(turn, `${described.summary}${kind === "edit" && described.kind !== "edit" ? " (edited files)" : ""}`, ok, ok ? "" : textOf(message.content)));
			results++;
		}
	}
	closeTurn();
	return { id, task, points, cards, finalDiff };
}

/** Recorded Pi sessions: the pilot's s1s2 arm and both arms of the control run (OMP transcripts use another format). */
function recordedRuns(): Run[] {
	const runs: Run[] = [];
	for (const [phase, arms] of [["pilot", ["s1s2"]], ["control", ["pi", "s1s2"]]] as const) {
		const root = join(evidence, phase, "runs");
		for (const task of readdirSync(root).sort()) {
			for (const arm of arms) {
				const dir = join(root, task, arm);
				const sessions = join(dir, "work", "sessions");
				if (!existsSync(sessions)) continue;
				const file = readdirSync(sessions).find((name) => name.endsWith(".jsonl") && !name.startsWith("__"));
				if (!file) continue;
				const diff = existsSync(join(dir, "final.diff")) ? readFileSync(join(dir, "final.diff"), "utf8") : "";
				runs.push(replay(`${phase}/${task}/${arm}`, join(sessions, file), diff));
			}
		}
	}
	return runs;
}

async function pool<T>(items: readonly T[], width: number, work: (item: T) => Promise<void>): Promise<void> {
	let next = 0;
	await Promise.all(Array.from({ length: width }, async () => {
		while (next < items.length) await work(items[next++]);
	}));
}

/** The live policy's gate consults for one run at threshold `t`. */
function gateTurns(run: Run, t: number): number[] {
	const picked: number[] = [];
	let consults = 0;
	let last = Number.NEGATIVE_INFINITY;
	let firstEdit = false;
	for (const point of run.points) {
		if (consults >= A.ADVISOR.maxConsults - 1) break;
		if (!firstEdit && point.edited) {
			firstEdit = true;
			consults++;
			last = point.turn;
		} else if (point.turn - last >= A.ADVISOR.minGap && point.p !== null && point.p >= t) {
			consults++;
			last = point.turn;
			picked.push(point.turn);
		}
	}
	return picked;
}

type Sample = { run: string; turn: number; trigger: string; latencyMs: number; promptTokens: number | null; cachedTokens: number | null; completionTokens: number | null; costUsd: number | null; severity: string | null; advice: string | null; error: string | null };

async function consultAdvisor(run: Run, cards: A.Card[], diff: string, reason: string, turn: number, trigger: string): Promise<Sample> {
	const [message] = new A.AdvisorConversation().open(run.task, cards, diff, reason);
	const started = performance.now();
	const base = { run: run.id, turn, trigger };
	try {
		const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
			method: "POST",
			headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
			body: JSON.stringify({
				model: ADVISOR_MODEL,
				provider: { order: [ADVISOR_UPSTREAM], allow_fallbacks: false },
				reasoning: { effort: "high" },
				max_tokens: A.ADVISOR.maxTokens,
				usage: { include: true },
				messages: [
					{ role: "system", content: A.ADVISOR_SYSTEM },
					{ role: "user", content: String(message.content) },
				],
			}),
			signal: AbortSignal.timeout(A.ADVISOR.timeoutMs),
		});
		const body = asObject(await response.json());
		const usage = asObject(body?.usage);
		const reply = String(asObject(asObject((body?.choices as unknown[] | undefined)?.[0])?.message)?.content ?? "");
		const advice = A.parseAdvice(reply);
		const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
		return {
			...base,
			latencyMs: Math.round(performance.now() - started),
			promptTokens: number(usage?.prompt_tokens),
			cachedTokens: number(asObject(usage?.prompt_tokens_details)?.cached_tokens),
			completionTokens: number(usage?.completion_tokens),
			costUsd: number(usage?.cost),
			severity: advice?.severity ?? null,
			advice: advice?.advice ?? null,
			error: response.ok ? (advice ? null : `unparsed reply: ${reply.slice(0, 200)}`) : `HTTP ${response.status}`,
		};
	} catch (error) {
		return { ...base, latencyMs: Math.round(performance.now() - started), promptTokens: null, cachedTokens: null, completionTokens: null, costUsd: null, severity: null, advice: null, error: error instanceof Error ? error.message : String(error) };
	}
}

mkdirSync(out, { recursive: true });
const runs = recordedRuns();
const cachePath = join(out, "gate-answers.json");
const cached: Record<string, number | null> = existsSync(cachePath) ? (JSON.parse(readFileSync(cachePath, "utf8")) as Record<string, number | null>) : {};
const jev = new OpenRouterJevProvider(key);
let jevCostUsd = 0;
let jevCalls = 0;
let jevFailed = 0;
const pending = runs.flatMap((run) => run.points.map((point) => ({ run, point })));
await pool(pending, 6, async ({ run, point }) => {
	const id = `${run.id}#${point.turn}`;
	if (id in cached) {
		point.p = cached[id];
		return;
	}
	const serialized = JSON.stringify(point.state);
	if (serialized.length > STATE_MAX_CHARS) {
		point.p = cached[id] = null;
		return;
	}
	try {
		const evaluation = await jev.evaluateWithMetadata(serialized, A.GATE_QUESTIONS, CALL_TIMEOUT_MS);
		point.p = cached[id] = A.gateProbability(evaluation.answers) ?? null;
		jevCalls++;
		jevCostUsd += evaluation.usage?.costUsd ?? 0;
	} catch {
		jevFailed++;
		point.p = null; // not cached: a rerun retries it
	}
});
writeFileSync(cachePath, `${JSON.stringify(cached, null, 2)}\n`);

const perThreshold = THRESHOLDS.map((t) => {
	const counts = runs.map((run) => gateTurns(run, t).length);
	return { threshold: t, meanGateConsults: counts.reduce((sum, n) => sum + n, 0) / runs.length, runsWithGateConsult: counts.filter((n) => n > 0).length, maxGateConsults: Math.max(...counts) };
});
const probabilities = runs.flatMap((run) => run.points.flatMap((point) => (point.p === null ? [] : [point.p])));

const samples: Sample[] = [];
if (sample > 0) {
	const gatePoints = runs.flatMap((run) => gateTurns(run, threshold).slice(0, 1).map((turn) => ({ run, turn })));
	const chosen = gatePoints.filter((_, i) => i % Math.max(1, Math.floor(gatePoints.length / Math.ceil(sample / 2))) === 0).slice(0, Math.ceil(sample / 2));
	const settles = runs.filter((run) => run.finalDiff.trim()).filter((_, i, all) => i % Math.max(1, Math.floor(all.length / Math.floor(sample / 2))) === 0).slice(0, Math.floor(sample / 2));
	const jobs = [
		...chosen.map(({ run, turn }) => () => {
			const point = run.points.find((entry) => entry.turn === turn);
			return consultAdvisor(run, point?.cards ?? [], "", "System 1 judged that a review now could change what the executor does next.", turn, "gate");
		}),
		...settles.map((run) => () => consultAdvisor(run, run.cards, run.finalDiff, "The executor says it is done. Review the final change against the task before it finishes.", run.points.at(-1)?.turn ?? 0, "settle")),
	];
	await pool(jobs, 3, async (job) => {
		samples.push(await job());
	});
}

const report = {
	version: 1,
	runs: runs.length,
	points: probabilities.length,
	jev: { calls: jevCalls, failed: jevFailed, costUsd: jevCostUsd, cachedAnswers: pending.length - jevCalls - jevFailed },
	probability: {
		mean: probabilities.reduce((sum, p) => sum + p, 0) / Math.max(1, probabilities.length),
		atLeast: Object.fromEntries(THRESHOLDS.map((t) => [t, probabilities.filter((p) => p >= t).length])),
	},
	policy: { minGap: A.ADVISOR.minGap, maxConsults: A.ADVISOR.maxConsults, perThreshold },
	sampleThreshold: sample > 0 ? threshold : null,
	samples,
	advisorCostUsd: samples.reduce((sum, entry) => sum + (entry.costUsd ?? 0), 0),
	perRun: runs.map((run) => ({ run: run.id, turns: run.points.length, gateTurns: gateTurns(run, threshold), p: run.points.map((point) => point.p) })),
};
writeFileSync(join(out, "gate-replay.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ runs: report.runs, points: report.points, jev: report.jev, perThreshold, samples: samples.map(({ run, trigger, latencyMs, promptTokens, completionTokens, costUsd, severity, error }) => ({ run, trigger, latencyMs, promptTokens, completionTokens, costUsd, severity, error })) }, null, 2));
