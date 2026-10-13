import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";


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

test("an unpriced batch above the former image ceiling can run without admission", () => {
	const root = dir();
	const ids = Array.from({ length: 13 }, (_, i) => `image-${i}`);
	const result = run(["--jobs", jobsFile(root, ids.map(id => ({ id, prompt: "x" }))),
		"--out", join(root, "out"), "--dry-run"]);
	expect(result.code).toBe(0);
	expect(JSON.parse(result.out)).toEqual({ dry_run: true, jobs: ids, estimate_usd: null });
});
