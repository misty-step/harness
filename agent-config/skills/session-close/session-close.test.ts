import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
function run(leaseDir: string, args: string[], owner = "test-owner"): { code: number; out: string; err: string } {
	const result = Bun.spawnSync(["bun", script, "--lease-dir", leaseDir, ...args], {
		env: { ...process.env, SESSION_CLOSE_OWNER: owner }, stdout: "pipe", stderr: "pipe",
	});
	return { code: result.exitCode ?? 1, out: result.stdout.toString(), err: result.stderr.toString() };
}
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("US-004 own leases block, foreign leases do not, and drop reports owner", () => {
	const leases = dir();
	expect(run(leases, ["check"]).out).toContain("no recorded leases");
	expect(run(leases, ["add", "--kind", "worktree", "--target", "/cache/tree"]).code).toBe(0);
	expect(run(leases, ["add", "--kind", "exe.dev", "--target", "qa.exe.xyz"]).code).toBe(0);
	const mine = run(leases, ["--json", "check"]);
	expect(mine.code).toBe(2);
	expect(JSON.parse(mine.out).own).toHaveLength(2);
	const other = run(leases, ["check"], "another-owner");
	expect(other.code).toBe(0);
	expect(other.out).toContain("foreign leases (info)");
	expect(run(leases, ["review"]).code).toBe(0);
	expect(run(leases, ["drop", "--target", "/cache/tree"], "another-owner").out).toContain("owner test-owner");
	expect(run(leases, ["drop", "--target", "qa.exe.xyz"]).code).toBe(0);
	expect(run(leases, ["check"]).code).toBe(0);
});

test("US-004 orphaned and expired leases require review, never block unrelated close", () => {
	const leases = dir();
	const pidStat = readFileSync(`/proc/${process.pid}/stat`, "utf8");
	const start = Number(pidStat.slice(pidStat.lastIndexOf(")") + 2).trim().split(/\s+/)[19]);
	expect(run(leases, ["add", "--kind", "exe.dev-worktree", "--target", "vm.exe.xyz:/ws/task"], `pid:${process.pid}:${start + 999999}`).code).toBe(0);
	expect(run(leases, ["check"]).out).toContain("orphaned");
	const file = join(leases, readdirSync(leases)[0]);
	const lease = JSON.parse(readFileSync(file, "utf8"));
	expect(lease.created).toBeTruthy();
	expect(Date.parse(lease.expires) - Date.parse(lease.created)).toBe(48 * 3600000);
	lease.expires = "2000-01-01T00:00:00.000Z";
	writeFileSync(file, JSON.stringify(lease));
	expect(run(leases, ["review"]).out).toContain("expired");
	expect(run(leases, ["review"]).code).toBe(3);
	expect(run(leases, ["check"]).code).toBe(0);
});

test("US-004 nearest omp argv0 supplies a pid/starttime owner when no override is set", () => {
	const leases = dir();
	const pidFile = join(leases, "outer-pid");
	const command = `printf '%s' "$$" > "$LEASE_PID_FILE"; exec -a omp bun -e 'const result = Bun.spawnSync(["bun", process.env.LEASE_SCRIPT, "--lease-dir", process.env.LEASE_DIR, "add", "--kind", "worktree", "--target", "/task/tree"], {env: process.env, stdout:"pipe",stderr:"pipe"}); process.stderr.write(result.stderr); process.exit(result.exitCode)'`;
	const wrapped = Bun.spawnSync(["bash", "-c", command], {
		env: { ...process.env, SESSION_CLOSE_OWNER: "", LEASE_PID_FILE: pidFile, LEASE_SCRIPT: script, LEASE_DIR: leases },
		stdout: "pipe", stderr: "pipe",
	});
	expect(wrapped.exitCode, wrapped.stderr.toString()).toBe(0);
	const file = readdirSync(leases).find((name) => name.endsWith(".json"))!;
	const saved = JSON.parse(readFileSync(join(leases, file), "utf8"));
	expect(saved.owner).toMatch(new RegExp(`^pid:${readFileSync(pidFile, "utf8")}:\\d+$`));
	expect(run(leases, ["review"]).code).toBe(3);
});

test("US-004 custom expiry is persisted and incomplete owned records fail closed", () => {
	const leases = dir();
	expect(run(leases, ["add", "--kind", "exe.dev", "--target", "vm.exe.xyz", "--expires-hours", "2"]).code).toBe(0);
	const file = join(leases, readdirSync(leases)[0]);
	const saved = JSON.parse(readFileSync(file, "utf8"));
	expect(Date.parse(saved.expires) - Date.parse(saved.created)).toBe(2 * 3600000);
	delete saved.expires;
	writeFileSync(file, JSON.stringify(saved));
	expect(run(leases, ["check"]).code).toBe(1);
});

test("US-004 legacy ownerless files need review while corrupt files fail closed", () => {
	const leases = dir();
	writeFileSync(join(leases, "legacy.json"), JSON.stringify({ kind: "worktree", target: "/old/tree" }));
	expect(run(leases, ["check"]).code).toBe(0);
	expect(run(leases, ["review"]).out).toContain("ownerless");
	expect(run(leases, ["review"]).code).toBe(3);
	writeFileSync(join(leases, "bad.json"), "{not json\n");
	expect(run(leases, ["check"]).code).toBe(1);
	expect(run(leases, ["review"]).code).toBe(1);
	expect(run(leases, ["drop", "--target", "/old/tree"]).code).toBe(1);
});

test("unknown lease kind and unknown drop target are rejected", () => {
	const leases = dir();
	expect(run(leases, ["add", "--kind", "container", "--target", "x"]).err).toContain("worktree, exe.dev or exe.dev-worktree");
	expect(run(leases, ["drop", "--target", "missing"]).code).toBe(2);
});
