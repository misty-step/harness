import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "session-close.ts");
const roots: string[] = [];

function dir(): string {
	const scratch = process.env.TMPDIR ?? join(homedir(), ".cache/tmp");
	mkdirSync(scratch, { recursive: true, mode: 0o700 });
	const root = mkdtempSync(join(scratch, "session-close-"));
	roots.push(root);
	return root;
}

function run(leaseDir: string, args: string[]): { code: number; out: string; err: string } {
	const result = Bun.spawnSync(["bun", script, "--lease-dir", leaseDir, ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	return { code: result.exitCode ?? 1, out: result.stdout.toString(), err: result.stderr.toString() };
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("US-004 empty lease store exits zero", () => {
	const result = run(dir(), ["check"]);
	expect(result.code).toBe(0);
	expect(result.out).toContain("no recorded leases (other workspaces not checked)");
});

test("US-004 add then check fails until drop", () => {
	const leases = dir();
	expect(run(leases, ["add", "--kind", "worktree", "--target", "/cache/tree"]).code).toBe(0);
	expect(run(leases, ["add", "--kind", "exe.dev", "--target", "qa.exe.xyz"]).code).toBe(0);
	const open = run(leases, ["--json"]);
	expect(open.code).toBe(2);
	expect(open.out).toContain("\"ok\": false");
	expect(open.out).toContain("/cache/tree");
	expect(open.out).toContain("qa.exe.xyz");
	expect(run(leases, ["drop", "--target", "/cache/tree"]).code).toBe(0);
	expect(run(leases, ["drop", "--target", "qa.exe.xyz"]).code).toBe(0);
	expect(run(leases, ["check"]).code).toBe(0);
});

test("drop of unknown target fails", () => {
	expect(run(dir(), ["drop", "--target", "missing"]).code).toBe(2);
});

test("US-004 corrupt lease fails closed", () => {
	const leases = dir();
	mkdirSync(leases, { recursive: true });
	writeFileSync(join(leases, "bad.json"), "{not json\n");
	expect(run(leases, ["check"]).code).toBe(1);
});

test("unknown kind is rejected", () => {
	const result = run(dir(), ["add", "--kind", "container", "--target", "x"]);
	expect(result.code).toBe(1);
	expect(result.err).toContain("worktree or exe.dev");
});
