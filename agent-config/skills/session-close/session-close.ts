#!/usr/bin/env bun
/** Create-time session leases. Check fails while any remain. Does not destroy resources. */

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

type Kind = "worktree" | "exe.dev";
type Lease = { kind: Kind; target: string };

function take(args: string[], flag: string): string | undefined {
	const i = args.indexOf(flag);
	if (i < 0) return undefined;
	const value = args[i + 1];
	if (!value || value.startsWith("-")) {
		console.error(`${flag} requires a value`);
		process.exit(1);
	}
	args.splice(i, 2);
	return value;
}

function leaseDir(override: string | undefined): string {
	return resolve(override ?? join(homedir(), ".cache/tmp/omp-session-leases"));
}

function fileFor(dir: string, kind: Kind, target: string): string {
	const id = createHash("sha256").update(kind).update("\0").update(target).digest("hex").slice(0, 16);
	return join(dir, `${id}.json`);
}

function parseKind(raw: string | undefined): Kind {
	if (raw === "worktree" || raw === "exe.dev") return raw;
	console.error("--kind must be worktree or exe.dev");
	process.exit(1);
}

function parseLease(raw: string, name: string): Lease | string {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return `${name}: not JSON`;
	}
	if (!value || typeof value !== "object") return `${name}: not an object`;
	if (!("kind" in value) || !("target" in value)) return `${name}: missing kind or target`;
	const kind = value.kind;
	const target = value.target;
	if (kind !== "worktree" && kind !== "exe.dev") return `${name}: invalid kind`;
	if (typeof target !== "string" || !target) return `${name}: invalid target`;
	return { kind, target };
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

function add(dir: string, kind: Kind, target: string): void {
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const path = fileFor(dir, kind, target);
	writeFileSync(path, `${JSON.stringify({ kind, target }, null, 2)}\n`, { mode: 0o600 });
	console.log(`leased ${kind} ${target}`);
}

function drop(dir: string, target: string): number {
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const { leases, errors } = listLeases(dir);
	if (errors.length) {
		for (const error of errors) console.error(error);
		return 1;
	}
	const matches = leases.filter((lease) => lease.target === target);
	if (!matches.length) {
		console.error(`no lease for ${target}`);
		return 2;
	}
	for (const lease of matches) rmSync(fileFor(dir, lease.kind, lease.target));
	console.log(`dropped ${target}`);
	return 0;
}

function check(dir: string, json: boolean): number {
	const { leases, errors } = listLeases(dir);
	if (errors.length) {
		if (json) console.log(JSON.stringify({ ok: false, leases, errors }, null, 2));
		else {
			console.log("session-close: corrupt leases");
			for (const error of errors) console.log(`  ${error}`);
		}
		return 1;
	}
	if (json) console.log(JSON.stringify({ ok: leases.length === 0, leases }, null, 2));
	else if (!leases.length) console.log("session-close: no recorded leases (other workspaces not checked)");
	else {
		console.log("session-close: open leases");
		for (const lease of leases) console.log(`  ${lease.kind}: ${lease.target}`);
	}
	return leases.length === 0 ? 0 : 2;
}

const args = process.argv.slice(2);
const json = args.includes("--json");
if (json) args.splice(args.indexOf("--json"), 1);
const dir = leaseDir(take(args, "--lease-dir"));
const command = args[0] ?? "check";
if (command === "check") {
	args.shift();
	if (args.length) {
		console.error(`Unknown argument: ${args[0]}`);
		process.exit(1);
	}
	process.exit(check(dir, json));
}
if (command === "add") {
	args.shift();
	const kind = parseKind(take(args, "--kind"));
	const target = take(args, "--target");
	if (!target) {
		console.error("add requires --target");
		process.exit(1);
	}
	if (args.length) {
		console.error(`Unknown argument: ${args[0]}`);
		process.exit(1);
	}
	add(dir, kind, target);
	process.exit(0);
}
if (command === "drop") {
	args.shift();
	const target = take(args, "--target");
	if (!target) {
		console.error("drop requires --target");
		process.exit(1);
	}
	if (args.length) {
		console.error(`Unknown argument: ${args[0]}`);
		process.exit(1);
	}
	process.exit(drop(dir, target));
}
console.error("Usage: session-close.ts [check] | add --kind worktree|exe.dev --target T | drop --target T");
process.exit(1);
