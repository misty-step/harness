import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Regression tests for the four confirmed review findings on imagine.py:
//  1. the default budget cap must always apply (fail closed without price evidence)
//  2. unsafe job ids must be refused before any network call or write
//  3. (covered by --self-test) URL downloads are status/payload validated
//  4. (covered by --self-test) artifact paths cannot escape the output directory
// Everything here is credential-free and network-free: refusals happen before
// the credential resolver is reached, and --dry-run returns before it too.

const script = join(import.meta.dir, "imagine.py");
const roots: string[] = [];

function dir(): string {
	const scratch = process.env.TMPDIR ?? join(homedir(), ".cache/tmp");
	mkdirSync(scratch, { recursive: true, mode: 0o700 });
	const root = mkdtempSync(join(scratch, "imagine-"));
	roots.push(root);
	return root;
}

function run(args: string[], env: Record<string, string> = {}) {
	const result = Bun.spawnSync(["python3", script, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, ...env },
	});
	return { code: result.exitCode ?? 1, out: result.stdout.toString(), err: result.stderr.toString() };
}

function jobsFile(root: string, jobs: unknown[]): string {
	const path = join(root, "jobs.json");
	writeFileSync(path, JSON.stringify(jobs));
	return path;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("self-test passes without credentials or network", () => {
	const result = run(["--self-test"]);
	expect(result.err).toBe("");
	expect(result.code).toBe(0);
	expect(result.out).toContain("imagine self-test OK");
});

test("unsafe job ids are refused before any network call or write", () => {
	const root = dir();
	for (const id of ["../escape", "/abs/evil", "a/b", "", ".hidden", "a..b"]) {
		const out = join(root, "out");
		const result = run(["--jobs", jobsFile(root, [{ id, prompt: "x", price_usd: 0.05 }]),
			"--out", out, "--dry-run"]);
		expect(result.code).toBe(2);
		expect(result.out).toContain("invalid_job_id");
		expect(existsSync(out)).toBe(false);
	}
});

test("the default budget cap applies without any pricing flags", () => {
	const root = dir();
	const result = run(["--jobs", jobsFile(root, [
		{ id: "a", prompt: "x", price_usd: 2.0 },
		{ id: "b", prompt: "x", price_usd: 2.0 },
	]), "--out", join(root, "out"), "--dry-run"]);
	expect(result.code).toBe(3);
	expect(result.out).toContain("budget_exceeded");
});

test("unknown price evidence fails closed", () => {
	const root = dir();
	const result = run(["--jobs", jobsFile(root, [{ id: "a", prompt: "x" }]),
		"--out", join(root, "out"), "--dry-run"]);
	expect(result.code).toBe(3);
	expect(result.out).toContain("price_unknown");
});

test("--budget-usd 0 refuses every non-zero estimate", () => {
	const root = dir();
	const result = run(["--jobs", jobsFile(root, [{ id: "a", prompt: "x" }]),
		"--out", join(root, "out"), "--budget-usd", "0", "--price-per-image", "0.05", "--dry-run"]);
	expect(result.code).toBe(3);
	expect(result.out).toContain("budget_exceeded");
});

test("budget 0 with explicitly zero-priced jobs is honored literally", () => {
	const root = dir();
	const result = run(["--jobs", jobsFile(root, [{ id: "a", prompt: "x", price_usd: 0 }]),
		"--out", join(root, "out"), "--budget-usd", "0", "--dry-run"]);
	expect(result.code).toBe(0);
	expect(result.out).toContain("dry_run");
});

test("a raised cap proceeds and the dry run reports the estimate", () => {
	const root = dir();
	const result = run(["--jobs", jobsFile(root, [
		{ id: "a", prompt: "x" },
		{ id: "b", prompt: "x" },
	]), "--out", join(root, "out"), "--budget-usd", "1", "--price-per-image", "0.25", "--dry-run"]);
	expect(result.code).toBe(0);
	expect(result.out).toContain("\"estimate_usd\": 0.5");
});

test("the environment override caps the batch", () => {
	const root = dir();
	const result = run(["--jobs", jobsFile(root, [{ id: "a", prompt: "x" }]),
		"--out", join(root, "out"), "--price-per-image", "0.05", "--dry-run"],
		{ DESIGN_STUDIO_BUDGET_USD: "0.01" });
	expect(result.code).toBe(3);
	expect(result.out).toContain("budget_exceeded");
});

test("a global price still has to satisfy the cap", () => {
	const root = dir();
	const result = run(["--jobs", jobsFile(root, [{ id: "a", prompt: "x" }]),
		"--out", join(root, "out"), "--budget-usd", "0.01", "--price-per-image", "0.02", "--dry-run"]);
	expect(result.code).toBe(3);
	expect(result.out).toContain("budget_exceeded");
});

test("max-images remains a hard bound", () => {
	const root = dir();
	const jobs = Array.from({ length: 13 }, (_, i) => ({ id: `j${i}`, prompt: "x", price_usd: 0.01 }));
	const result = run(["--jobs", jobsFile(root, jobs), "--out", join(root, "out"), "--dry-run"]);
	expect(result.code).toBe(3);
	expect(result.out).toContain("max_images_exceeded");
});