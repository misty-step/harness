import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const gate = resolve(import.meta.dir, "../.githooks/trufflehog-gate.py");
const roots: string[] = [];
const sha = "789ae58ddd" + "0aecad3406" + "3f53304665" + "f215a9418a";
const raw = sha.slice(0, 20);
const commitLink = `https://github.com/misty-step/harness/commit/${sha}`;

function finding(changes: Record<string, unknown> = {}) {
	return {
		DetectorName: "GitHubOauth2",
		Verified: false,
		Raw: raw,
		SourceMetadata: { Data: { Filesystem: { file: "CHANGELOG.md", line: 1 } } },
		...changes,
	};
}

function run(rows: unknown[], exit = rows.length ? 183 : 0, changelog = `* release (${commitLink})\n`) {
	const root = mkdtempSync(join(tmpdir(), "harness-trufflehog-gate-"));
	roots.push(root);
	const bin = join(root, "bin");
	mkdirSync(bin);
	writeFileSync(join(root, "CHANGELOG.md"), changelog);
	const reports = join(root, "reports.jsonl");
	writeFileSync(reports, rows.map(row => typeof row === "string" ? row : JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
	const scanner = join(bin, "trufflehog");
	writeFileSync(scanner, '#!/bin/sh\ncat "$TRUFFLEHOG_FIXTURE"\nexit "$TRUFFLEHOG_EXIT"\n');
	chmodSync(scanner, 0o700);
	const result = Bun.spawnSync(["python3", gate], {
		cwd: root,
		env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TRUFFLEHOG_FIXTURE: reports, TRUFFLEHOG_EXIT: String(exit) },
		stdout: "pipe", stderr: "pipe",
	});
	return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("the pinned public commit SHA false positive does not block the scan", () => {
	const result = run([finding(), finding()]);
	expect(result.code).toBe(0);
	expect(result.out).toBe("");
	expect(result.err).toContain("ignored 2 unverified public commit-SHA finding(s)");
	expect(result.err).not.toContain(raw);
});

test("other findings still block, even beside an allowed public SHA", () => {
	for (const [name, other] of [
		["other detector", finding({ DetectorName: "Generic" })],
		["verified result", finding({ Verified: true })],
		["other file", finding({ SourceMetadata: { Data: { Filesystem: { file: "source.ts", line: 1 } } } })],
		["other value", finding({ Raw: "f".repeat(20) })],
		["wrong line", finding({ SourceMetadata: { Data: { Filesystem: { file: "CHANGELOG.md", line: 2 } } } })],
	]) {
		const result = run([finding(), other], 183, `* release (${commitLink})\nUnrelated text\n`);
		expect(result.code, name).toBe(1);
		expect(result.err, name).toContain("finding outside public commit links");
		expect(result.err, name).not.toContain(raw);
	}
});

test("a different public commit link is not an exception", () => {
	const otherSha = "abcdef0123".repeat(4);
	const result = run([finding({ Raw: otherSha.slice(0, 20) })], 183,
		`* release (https://github.com/misty-step/harness/commit/${otherSha})\n`);
	expect(result.code).toBe(1);
	expect(result.err).toContain("finding outside public commit links");
});

test("a URL extending the pinned SHA is not the exact changelog link", () => {
	for (const suffix of ["A", "?x=1", "/next", "#fragment"]) {
		const result = run([finding()], 183, `* release (${commitLink}${suffix})\n`);
		expect(result.code, suffix).toBe(1);
		expect(result.err, suffix).toContain("finding outside public commit links");
	}
});

test("scanner errors and malformed results fail closed", () => {
	for (const [name, rows, code] of [
		["scanner error", [finding()], 1],
		["malformed JSON", ["not JSON"], 183],
		["empty result with finding exit", [], 183],
	] as const) {
		const result = run(rows, code);
		expect(result.code, name).toBe(1);
		expect(result.err, name).not.toContain(raw);
	}
	expect(run([]).code).toBe(0);
});
