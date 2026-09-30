#!/usr/bin/env bun
/** Create-time owner-scoped leases. Never destroys a resource. */

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

type Kind = "worktree" | "exe.dev" | "exe.dev-worktree";
type Lease = { kind: Kind; target: string; owner?: string; created?: string; expires?: string };

function take(args: string[], flag: string): string | undefined {
	const i = args.indexOf(flag);
	if (i < 0) return undefined;
	const value = args[i + 1];
	if (!value || value.startsWith("-")) throw new Error(`${flag} requires a value`);
	args.splice(i, 2);
	return value;
}

function stat(pid: number): { parent: number; session: number; start: string; comm: string } | undefined {
	try {
		const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
		const end = raw.lastIndexOf(")");
		const fields = raw.slice(end + 2).trim().split(/\s+/);
		return { comm: raw.slice(raw.indexOf("(") + 1, end), parent: Number(fields[1]), session: Number(fields[3]), start: fields[19] };
	} catch { return undefined; }
}

function owner(): string {
	if (process.env.SESSION_CLOSE_OWNER) return process.env.SESSION_CLOSE_OWNER;
	let pid = process.ppid;
	const seen = new Set<number>();
	const session = stat(pid)?.session ?? pid;
	while (pid > 1 && !seen.has(pid)) {
		seen.add(pid);
		const info = stat(pid);
		if (!info) break;
		let argv0 = "";
		try { argv0 = basename(readFileSync(`/proc/${pid}/cmdline`).toString().split("\0")[0] ?? ""); } catch { /* comm remains authoritative */ }
		if (["omp", "pi"].includes(info.comm) || ["omp", "pi"].includes(argv0)) return `pid:${pid}:${info.start}`;
		pid = info.parent;
	}
	const leader = stat(session);
	if (!leader) throw new Error(`session leader ${session} is unavailable; set SESSION_CLOSE_OWNER for non-agent use`);
	return `pid:${session}:${leader.start}`;
}

function fileFor(dir: string, kind: Kind, target: string): string {
	const id = createHash("sha256").update(kind).update("\0").update(target).digest("hex").slice(0, 16);
	return join(dir, `${id}.json`);
}

function parseLease(raw: string, name: string): Lease | string {
	let value: unknown;
	try { value = JSON.parse(raw); } catch { return `${name}: not JSON`; }
	if (!value || typeof value !== "object") return `${name}: not an object`;
	const v = value as Record<string, unknown>;
	if (v.kind !== "worktree" && v.kind !== "exe.dev" && v.kind !== "exe.dev-worktree") return `${name}: invalid kind`;
	if (typeof v.target !== "string" || !v.target) return `${name}: invalid target`;
	if (v.owner !== undefined && (typeof v.owner !== "string" || !v.owner)) return `${name}: invalid owner`;
	for (const field of ["created", "expires"]) {
		if (v[field] !== undefined && (typeof v[field] !== "string" || !Number.isFinite(Date.parse(v[field])))) return `${name}: invalid ${field}`;
	}
	if (v.owner && (!v.created || !v.expires)) return `${name}: owned lease missing created or expires`;
	return { kind: v.kind, target: v.target, ...(v.owner ? { owner: v.owner as string } : {}), ...(v.created ? { created: v.created as string } : {}), ...(v.expires ? { expires: v.expires as string } : {}) };
}

function listLeases(dir: string): { leases: Lease[]; errors: string[] } {
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const leases: Lease[] = [];
	const errors: string[] = [];
	for (const name of readdirSync(dir).sort()) {
		if (!name.endsWith(".json")) continue;
		const parsed = parseLease(readFileSync(join(dir, name), "utf8"), name);
		if (typeof parsed === "string") errors.push(parsed);
		else leases.push(parsed);
	}
	return { leases, errors };
}

function reviewReason(lease: Lease): string | undefined {
	if (!lease.owner) return "ownerless";
	if (lease.expires && Date.parse(lease.expires) <= Date.now()) return "expired";
	const match = /^pid:(\d+):(\d+)$/.exec(lease.owner);
	if (match && stat(Number(match[1]))?.start !== match[2]) return "orphaned";
	return undefined;
}

function add(dir: string, kind: Kind, target: string, hours: number): number {
	const { leases, errors } = listLeases(dir);
	if (errors.length) throw new Error(`corrupt leases: ${errors.join(", ")}`);
	const who = owner();
	const existing = leases.find((lease) => lease.kind === kind && lease.target === target);
	if (existing) {
		if (existing.owner !== who) throw new Error(`${target} already leased by ${existing.owner ?? "ownerless"}; review before reuse`);
		console.log(`already leased ${kind} ${target} owner ${who}`);
		return 0;
	}
	const created = new Date();
	const lease: Lease = { kind, target, owner: who, created: created.toISOString(), expires: new Date(created.getTime() + hours * 3600000).toISOString() };
	writeFileSync(fileFor(dir, kind, target), `${JSON.stringify(lease, null, 2)}\n`, { mode: 0o600, flag: "wx" });
	console.log(`leased ${kind} ${target} owner ${who}`);
	return 0;
}

function drop(dir: string, target: string): number {
	const { leases, errors } = listLeases(dir);
	if (errors.length) throw new Error(`corrupt leases: ${errors.join(", ")}`);
	const matches = leases.filter((lease) => lease.target === target);
	if (!matches.length) { console.error(`no lease for ${target}`); return 2; }
	for (const lease of matches) {
		rmSync(fileFor(dir, lease.kind, lease.target));
		console.log(`dropped ${lease.kind} ${target} owner ${lease.owner ?? "ownerless"}`);
	}
	return 0;
}

function check(dir: string, json: boolean, review: boolean): number {
	const { leases, errors } = listLeases(dir);
	if (errors.length) {
		if (json) console.log(JSON.stringify({ ok: false, leases, errors }, null, 2));
		else console.log(`session-close: corrupt leases: ${errors.join(", ")}`);
		return 1;
	}
	const needsReview: Lease[] = [];
	const own: Lease[] = [];
	const foreign: Lease[] = [];
	let who: string | undefined;
	for (const lease of leases) {
		if (reviewReason(lease)) needsReview.push(lease);
		else if (!review) {
			who ??= owner();
			(lease.owner === who ? own : foreign).push(lease);
		}
	}
	const code = review ? (needsReview.length ? 3 : 0) : (own.length ? 2 : 0);
	if (json) console.log(JSON.stringify({ ok: code === 0, leases, own, foreign, needsReview }, null, 2));
	else {
		if (!leases.length) console.log("session-close: no recorded leases (other workspaces not checked)");
		if (!review && own.length) {
			console.log("session-close: own open leases");
			for (const lease of own) console.log(`  ${lease.kind}: ${lease.target} owner ${lease.owner}`);
		}
		if (!review && foreign.length) {
			console.log("session-close: foreign leases (info)");
			for (const lease of foreign) console.log(`  ${lease.kind}: ${lease.target} owner ${lease.owner}`);
		}
		if (needsReview.length) {
			console.log("session-close: needs review (never auto-delete)");
			for (const lease of needsReview) console.log(`  ${lease.kind}: ${lease.target} owner ${lease.owner ?? "ownerless"} (${reviewReason(lease)})`);
		}
	}
	return code;
}

try {
	const args = process.argv.slice(2);
	const json = args.includes("--json");
	if (json) args.splice(args.indexOf("--json"), 1);
	const dir = resolve(take(args, "--lease-dir") ?? join(homedir(), ".cache/tmp/omp-session-leases"));
	const command = args.shift() ?? "check";
	let code: number;
	if (command === "check" || command === "review") code = check(dir, json, command === "review");
	else if (command === "add") {
		const kind = take(args, "--kind");
		if (kind !== "worktree" && kind !== "exe.dev" && kind !== "exe.dev-worktree") throw new Error("--kind must be worktree, exe.dev or exe.dev-worktree");
		const target = take(args, "--target");
		if (!target) throw new Error("add requires --target");
		const raw = take(args, "--expires-hours") ?? "48";
		const hours = Number(raw);
		if (!Number.isFinite(hours) || hours <= 0 || hours > 1e6) throw new Error("--expires-hours requires a positive finite number");
		code = add(dir, kind, target, hours);
	} else if (command === "drop") {
		const target = take(args, "--target");
		if (!target) throw new Error("drop requires --target");
		code = drop(dir, target);
	} else throw new Error("Usage: session-close.ts [check|review] | add --kind worktree|exe.dev|exe.dev-worktree --target T [--expires-hours N] | drop --target T");
	if (args.length) throw new Error(`Unknown argument: ${args[0]}`);
	process.exit(code);
} catch (error) {
	console.error(`session-close: ${error instanceof Error ? error.message : error}`);
	process.exit(1);
}
