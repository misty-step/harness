#!/usr/bin/env bun
/**
 * Paired comparison of evaluation arms (US-030). For each pair `arm:reference`, over the tasks where
 * both ran: geometric-mean ratios of billed cost, System 2 turns, token categories, and wall-clock,
 * the mean difference in judged quality, and hidden-test passes, each with a two-sided t interval
 * (95%) and p-value across tasks. Token totals add the advisor's tokens to System 1's arms, since
 * OMP's session files already carry its Steward's. Cost is the evaluation boundary's settled charge
 * for every call a run made (System 2, Jev, advisor).
 *
 * Usage:
 *   bun pi-config/extensions/s1s2/eval/compare.ts --out <run dir> --report <run dir>/report-<tag>.json \
 *     --pairs s1s2-gated:pi,s1s2-gated:s1s2 [--tasks h37,h57]
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1] ?? "");
const fail = (message: string): never => (console.error(message), process.exit(2));
const out = resolve(args.get("out") || fail("missing --out"));
const report = JSON.parse(readFileSync(resolve(args.get("report") || fail("missing --report")), "utf8")) as { perTask?: Record<string, Record<string, { judgeOverall?: number | null } | null>> };
const pairs = (args.get("pairs") || fail("missing --pairs")).split(",").map((pair) => {
	const [arm, ref] = pair.split(":");
	return arm && ref ? { arm, ref } : fail(`bad pair ${pair}`);
});
const only = args.get("tasks")?.split(",").filter(Boolean);

type Metrics = { cost: number; turns: number; input: number; cacheRead: number; output: number; wall: number; hidden: boolean; quality: number | null };

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

function metrics(task: string, arm: string): Metrics | null {
	const path = join(out, "runs", task, arm, "run.json");
	if (!existsSync(path)) return null;
	const run: unknown = JSON.parse(readFileSync(path, "utf8"));
	if (!isObject(run) || !isObject(run.usage) || !isObject(run.boundary)) fail(`${path} is not a run record`);
	const record = run as Record<string, unknown> & { usage: Record<string, unknown>; boundary: Record<string, unknown> };
	const advisor = isObject(record.s1) && isObject(record.s1.advisor) ? record.s1.advisor : {};
	return {
		cost: num(record.boundary.settledUsd),
		turns: num(record.parentTurns),
		input: num(record.usage.input) + num(advisor.inputTokens),
		cacheRead: num(record.usage.cacheRead) + num(advisor.cacheReadTokens),
		output: num(record.usage.output) + num(advisor.outputTokens),
		wall: num(record.wallMs) / 1000,
		hidden: record.hiddenPass === true,
		quality: report.perTask?.[task]?.[arm]?.judgeOverall ?? null,
	};
}

/** Regularized incomplete beta I_x(a, b) by Lentz's continued fraction. */
function betaInc(x: number, a: number, b: number): number {
	if (x <= 0) return 0;
	if (x >= 1) return 1;
	const lnBeta = lgamma(a + b) - lgamma(a) - lgamma(b);
	const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b + lnBeta);
	if (x > (a + 1) / (a + b + 2)) return 1 - betaInc(1 - x, b, a);
	let f = 1;
	let c = 1;
	let d = 1 - ((a + b) * x) / (a + 1);
	d = Math.abs(d) < 1e-30 ? 1e-30 : d;
	d = 1 / d;
	f = d;
	for (let m = 1; m <= 200; m++) {
		for (const numerator of [(m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m)), -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1))]) {
			d = 1 + numerator * d;
			d = Math.abs(d) < 1e-30 ? 1e-30 : d;
			c = 1 + numerator / c;
			c = Math.abs(c) < 1e-30 ? 1e-30 : c;
			d = 1 / d;
			f *= c * d;
		}
		if (Math.abs(c * d - 1) < 1e-12) break;
	}
	return (front * f) / a;
}

function lgamma(z: number): number {
	const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
	if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
	let x = 0.9999999999998099;
	for (let i = 0; i < g.length; i++) x += g[i] / (z + i);
	const t = z + g.length - 1.5;
	return 0.5 * Math.log(2 * Math.PI) + (z - 0.5) * Math.log(t) - t + Math.log(x);
}

/** Two-sided p-value of Student's t with `df` degrees of freedom. */
const pValue = (t: number, df: number) => betaInc(df / (df + t * t), df / 2, 0.5);

/** The 97.5th percentile of Student's t, by bisection on the p-value. */
function tCritical(df: number): number {
	let lo = 0;
	let hi = 50;
	for (let i = 0; i < 100; i++) {
		const mid = (lo + hi) / 2;
		if (pValue(mid, df) > 0.05) lo = mid;
		else hi = mid;
	}
	return (lo + hi) / 2;
}

type Interval = { estimate: number; lo: number; hi: number; p: number | null; n: number };

function meanInterval(values: readonly number[]): Interval {
	const n = values.length;
	const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, n);
	if (n < 2) return { estimate: mean, lo: Number.NaN, hi: Number.NaN, p: null, n };
	const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1));
	const se = sd / Math.sqrt(n);
	const half = tCritical(n - 1) * se;
	return { estimate: mean, lo: mean - half, hi: mean + half, p: se > 0 ? pValue(mean / se, n - 1) : null, n };
}

/** Geometric-mean ratio with its interval, from the mean of per-task log ratios. */
function ratioInterval(pairs: readonly [number, number][]): Interval {
	const logs = pairs.filter(([a, b]) => a > 0 && b > 0).map(([a, b]) => Math.log(a / b));
	const interval = meanInterval(logs);
	return { ...interval, estimate: Math.exp(interval.estimate), lo: Math.exp(interval.lo), hi: Math.exp(interval.hi) };
}

const tasks = [...new Set(Object.keys(report.perTask ?? {}))].filter((task) => !only || only.includes(task)).sort();
const round = (value: number, digits = 3) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : null);
const shape = (interval: Interval, digits = 3) => ({ estimate: round(interval.estimate, digits), lo: round(interval.lo, digits), hi: round(interval.hi, digits), p: interval.p === null ? null : round(interval.p, 4), n: interval.n });

const results = pairs.map(({ arm, ref }) => {
	const rows = tasks.flatMap((task) => {
		const a = metrics(task, arm);
		const b = metrics(task, ref);
		return a && b ? [{ task, a, b }] : [];
	});
	const ratio = (key: "cost" | "turns" | "input" | "cacheRead" | "output" | "wall") => shape(ratioInterval(rows.map(({ a, b }) => [a[key], b[key]])));
	const judged = rows.filter(({ a, b }) => a.quality !== null && b.quality !== null);
	return {
		arm,
		ref,
		tasks: rows.map((row) => row.task),
		totals: {
			[arm]: { cost: round(rows.reduce((sum, row) => sum + row.a.cost, 0), 4), turns: rows.reduce((sum, row) => sum + row.a.turns, 0), hidden: rows.filter((row) => row.a.hidden).length },
			[ref]: { cost: round(rows.reduce((sum, row) => sum + row.b.cost, 0), 4), turns: rows.reduce((sum, row) => sum + row.b.turns, 0), hidden: rows.filter((row) => row.b.hidden).length },
		},
		cost: ratio("cost"),
		turns: ratio("turns"),
		uncachedInput: ratio("input"),
		cacheRead: ratio("cacheRead"),
		output: ratio("output"),
		wall: ratio("wall"),
		quality: shape(meanInterval(judged.map(({ a, b }) => (a.quality as number) - (b.quality as number)))),
		perTask: rows.map(({ task, a, b }) => ({ task, cost: [round(a.cost, 4), round(b.cost, 4)], turns: [a.turns, b.turns], hidden: [a.hidden, b.hidden], quality: [a.quality === null ? null : round(a.quality, 2), b.quality === null ? null : round(b.quality, 2)] })),
	};
});
console.log(JSON.stringify({ version: 1, out, tasks: tasks.length, pairs: results }, null, 2));
