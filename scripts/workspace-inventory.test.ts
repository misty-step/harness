import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "workspace-inventory.ts");
const roots: string[] = [];

function fixture(): { root: string; development: string; repo: string; external: string } {
	const scratch = process.env.TMPDIR ?? join(homedir(), ".cache/tmp");
	mkdirSync(scratch, { recursive: true, mode: 0o700 });
	const root = mkdtempSync(join(scratch, "workspace-inventory-"));
	roots.push(root);
	const development = join(root, "development");
	const repo = join(development, "project");
	const external = join(root, "external-tree");
	mkdirSync(repo, { recursive: true });
	return { root, development, repo, external };
}

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function inventory(development: string) {
	const result = Bun.spawnSync(["bun", script, development], { stdout: "pipe", stderr: "pipe" });
	return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("US-016 includes linked worktrees outside the development directory and distinguishes dirty and prunable states", () => {
	const { development, repo, external } = fixture();
	git(repo, "init", "--quiet", "-b", "master");
	git(repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "--allow-empty", "-m", "baseline");
	git(repo, "worktree", "add", "--quiet", "--detach", external);
	let result = inventory(development);
	expect(result.code).toBe(0);
	expect(result.out).toContain(`clean\tmaster\t${repo}`);
	expect(result.out).toContain(`clean\t(detached)\t${external}`);
	writeFileSync(join(external, "untracked.txt"), "not committed\n");
	result = inventory(development);
	expect(result.out).toContain(`dirty\t(detached)\t${external}`);
	rmSync(external, { recursive: true });
	result = inventory(development);
	expect(result.code).toBe(0);
	expect(result.out).toContain(`prunable (Git registration)\t(detached)\t${external}`);
	expect(result.out).toContain("1 repositories; 1 linked worktrees; 0 dirty; 1 prunable; 0 errors");
});

test("US-016 discovers an independently registered repository inside another checkout", () => {
	const { development, repo } = fixture();
	git(repo, "init", "--quiet", "-b", "master");
	const nested = join(repo, "nested");
	mkdirSync(nested);
	git(nested, "init", "--quiet", "-b", "master");
	const result = inventory(development);
	expect(result.code).toBe(0);
	expect(result.out).toContain(`clean\tmaster\t${nested}`);
	expect(result.out).toContain("2 repositories; 0 linked worktrees;");
});

test("US-016 reports unreadable child directories and continues with accessible repositories", () => {
	const { development, repo } = fixture();
	git(repo, "init", "--quiet", "-b", "master");
	const unreadable = join(development, "unreadable");
	mkdirSync(unreadable);
	chmodSync(unreadable, 0o000);
	try {
		const result = inventory(development);
		expect(result.code).toBe(1);
		expect(result.err).toContain(`inventory failed to read ${unreadable}:`);
		expect(result.out).toContain(`clean\tmaster\t${repo}`);
		expect(result.out).toContain("1 repositories; 0 linked worktrees; 0 dirty; 0 prunable; 1 errors");
	} finally {
		chmodSync(unreadable, 0o700);
	}
});

test("US-016 reports a broken repository without deleting it", () => {
	const { development, repo } = fixture();
	writeFileSync(join(repo, ".git"), "gitdir: /does/not/exist\n");
	const result = inventory(development);
	expect(result.code).toBe(1);
	expect(result.err).toContain("inventory failed:");
	expect(existsSync(join(repo, ".git"))).toBe(true);
	expect(result.out).toContain("0 repositories; 0 linked worktrees; 0 dirty; 0 prunable; 1 errors");
});
