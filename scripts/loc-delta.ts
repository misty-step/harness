#!/usr/bin/env bun
/** Project and module code-line change between two dated receipts of Glass's complexity ledger. Read only. */
import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
	options: { repo: { type: "string", default: "misty-step/harness" }, from: { type: "string" }, to: { type: "string" }, ledger: { type: "string" } },
	strict: true,
});
const repo = values.repo as string;
const ledger = values.ledger ?? join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local/state"), "complexity");
const shift = (day: string, days: number) => new Date(Date.parse(day) + days * 864e5).toISOString().slice(0, 10);
const to = values.to ?? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
const from = values.from ?? shift(to, -7);
if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || repo.split("/").includes("..") || ![from, to].every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) || from >= to) {
	console.error("Usage: bun scripts/loc-delta.ts [--repo owner/name] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--ledger DIR]");
	process.exit(2);
}

type Part = { name: string; code_lines: number };
type Receipt = { commit: string; cutoff: string; measured_at: string; tools: Record<string, string>; metrics: { code_lines: number; modules: Part[] } };
const count = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0;

/** One day's receipt, or why there is none. A missing or failed day is unknown, never zero or a neighbour. */
function read(date: string): Receipt | string {
	const path = join(ledger, ...repo.split("/"), `${date}.json`);
	let stat;
	try {
		stat = lstatSync(path);
	} catch {
		return "no receipt collected";
	}
	if (!stat.isFile() || stat.size > 1 << 20) return "receipt is not a regular file under 1 MiB";
	try {
		const r = JSON.parse(readFileSync(path, "utf8"));
		if (r.schema !== "complexity/1" || r.repo !== repo || r.date !== date) return "receipt does not describe this repository and day";
		if (r.status !== "ok") return `measurement failed: ${r.reason || r.status}`;
		const m = r.metrics;
		if (!count(m?.code_lines) || !Array.isArray(m.modules) || !m.modules.every((p: Part) => typeof p.name === "string" && count(p.code_lines))) return "receipt figures are invalid";
		return r;
	} catch {
		return "receipt cannot be read";
	}
}

const n = (v: number) => v.toLocaleString("en-US");
const net = (v: number) => `${v > 0 ? "+" : ""}${n(v)}`;
const before = read(from);
const after = read(to);
console.log(`Code lines, ${repo}, ${from} to ${to} (Central midnight receipts)`);
for (const [label, date, r] of [["before", from, before], ["after", to, after]] as const) {
	console.log(typeof r === "string" ? `  ${label} ${date}: unknown, ${r}` : `  ${label} ${date}: commit ${r.commit.slice(0, 10)}, measured ${r.measured_at}, scc ${r.tools.scc ?? "unrecorded"}`);
}
if (typeof before === "string" || typeof after === "string") process.exit(1);
if (before.tools.scc !== after.tools.scc) {
	console.log(`  change unknown: scc ${before.tools.scc ?? "none"} then ${after.tools.scc ?? "none"}`);
	process.exit(1);
}

const pct = (was: number, change: number) => (was === 0 ? "" : ` (${change > 0 ? "+" : ""}${((100 * change) / was).toFixed(1)}%)`);
const total = after.metrics.code_lines - before.metrics.code_lines;
console.log(`Project: ${n(before.metrics.code_lines)} to ${n(after.metrics.code_lines)}, net ${net(total)}${pct(before.metrics.code_lines, total)}`);
const was = new Map(before.metrics.modules.map((p) => [p.name, p.code_lines]));
const now = new Map(after.metrics.modules.map((p) => [p.name, p.code_lines]));
const modules = [...new Set([...was.keys(), ...now.keys()])]
	.map((name) => ({ name, was: was.get(name), now: now.get(name) }))
	.sort((a, b) => Math.abs((b.now ?? 0) - (b.was ?? 0)) - Math.abs((a.now ?? 0) - (a.was ?? 0)) || a.name.localeCompare(b.name));
console.log("Modules, largest change first:");
for (const m of modules) {
	const change = (m.now ?? 0) - (m.was ?? 0);
	const note = m.was === undefined ? " new" : m.now === undefined ? " removed" : pct(m.was, change);
	console.log(`  ${m.name}: ${n(m.was ?? 0)} to ${n(m.now ?? 0)}, net ${net(change)}${note}`);
}
const days: string[] = [];
for (let d = from; d <= to; d = shift(d, 1)) {
	const r = read(d);
	days.push(`${d.slice(5)} ${typeof r === "string" ? "unknown" : n(r.metrics.code_lines)}`);
}
console.log(`Project by day: ${days.join(" | ")}`);
