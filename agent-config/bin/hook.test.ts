import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..", "..");
const preCommit = join(repoRoot, ".githooks", "pre-commit");
const prePush = join(repoRoot, ".githooks", "pre-push");

const gitleaksAvailable = spawnSync("gitleaks", ["version"], { encoding: "utf8" }).status === 0;
if (!gitleaksAvailable) {
	console.log("hook tests skipped: gitleaks is not on PATH (install gitleaks to exercise the blocking scanner)");
}
const hookTest = gitleaksAvailable ? test : test.skip;

const scratchBase =
	process.env.TMPDIR && process.env.TMPDIR.length > 0 ? process.env.TMPDIR : join(homedir(), ".cache", "tmp");
const made: string[] = [];

function scratch(): string {
	mkdirSync(scratchBase, { recursive: true });
	const dir = mkdtempSync(join(scratchBase, "jev-hook-test-"));
	made.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(dir: string, args: string[], env?: NodeJS.ProcessEnv): ReturnType<typeof spawnSync> {
	return spawnSync("git", args, { cwd: dir, encoding: "utf8", env });
}

/** Credential-free, deterministic environment for the hook under test. */
function hookEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env };
	delete env.OPENROUTER_API_KEY;
	delete env.TYPESAFE_API_KEY;
	delete env.MOCK_SYSTEM_ONE;
	delete env.JEV_HOOK_OFF;
	// The hook resolves `bun` through PATH; make the test's own runtime visible.
	env.PATH = `${dirname(process.execPath)}:${env.PATH ?? ""}`;
	return { ...env, ...extra };
}

function makeRepo(): string {
	const dir = scratch();
	git(dir, ["init", "-q", "-b", "main"]);
	git(dir, ["config", "user.email", "hook-test@example.com"]);
	git(dir, ["config", "user.name", "Hook Test"]);
	writeFileSync(join(dir, "README.md"), "# base\n");
	git(dir, ["add", "README.md"]);
	git(dir, ["commit", "-q", "-m", "base"]);

	mkdirSync(join(dir, ".githooks"), { recursive: true });
	cpSync(preCommit, join(dir, ".githooks", "pre-commit"));
	cpSync(prePush, join(dir, ".githooks", "pre-push"));
	chmodSync(join(dir, ".githooks", "pre-commit"), 0o755);
	chmodSync(join(dir, ".githooks", "pre-push"), 0o755);
	git(dir, ["config", "core.hooksPath", ".githooks"]);

	// The pre-commit hook invokes this repo-relative tool; copy it in so the
	// temp repo is self-contained and hermetic. These copies stay untracked.
	mkdirSync(join(dir, "agent-config", "bin"), { recursive: true });
	mkdirSync(join(dir, "agent-config", "system-one"), { recursive: true });
	cpSync(join(repoRoot, "agent-config", "bin", "review-check.ts"), join(dir, "agent-config", "bin", "review-check.ts"));
	cpSync(join(repoRoot, "agent-config", "system-one", "review.ts"), join(dir, "agent-config", "system-one", "review.ts"));
	cpSync(join(repoRoot, "agent-config", "system-one", "engine.ts"), join(dir, "agent-config", "system-one", "engine.ts"));
	return dir;
}

function commit(dir: string, message: string, env: NodeJS.ProcessEnv = hookEnv()): ReturnType<typeof spawnSync> {
	return git(dir, ["commit", "-q", "-m", message], env);
}

function output(result: ReturnType<typeof spawnSync>): string {
	return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

// The AWS-shaped id alone is allowlisted by gitleaks' default config; the
// runtime-assembled Stripe-shaped value guarantees the scanner has a real
// problem to block on without committing a credential-shaped string.
const FAKE_AWS = "AKIAIOSFODNN7EXAMPLE";
const FAKE_STRIPE = ["sk", "live", "51Abcdef1234567890abcdef123456"].join("_");

describe("hook policy matrix", () => {
	hookTest("t1: staged secret material is rejected by the deterministic scanner", () => {
		const repo = makeRepo();
		writeFileSync(join(repo, "secrets.txt"), `AWS_ACCESS_KEY_ID=${FAKE_AWS}\nSTRIPE_KEY=${FAKE_STRIPE}\n`);
		git(repo, ["add", "secrets.txt"]);
		const result = commit(repo, "add synthetic secret");
		expect(result.status).not.toBe(0);
		expect(output(result)).toContain("gitleaks");
	});

	hookTest("t2: a taste-only change commits and prints the advisory unavailable line", () => {
		const repo = makeRepo();
		writeFileSync(join(repo, "app.ts"), "// taste tweak\nexport const app = 1;\n");
		git(repo, ["add", "app.ts"]);
		const result = commit(repo, "taste-only change");
		expect(result.status).toBe(0);
		const text = output(result);
		expect(text).toContain("jev unavailable");
		expect(text).toContain("no_api_key");
		expect(text).toContain("advisory; never a gate");
	});

	hookTest("t3: scanner enforcement is independent of Jev availability", () => {
		const repo = makeRepo();
		writeFileSync(join(repo, "secrets.txt"), `AWS_ACCESS_KEY_ID=${FAKE_AWS}\nSTRIPE_KEY=${FAKE_STRIPE}\n`);
		git(repo, ["add", "secrets.txt"]);
		const result = commit(repo, "add synthetic secret with no provider");
		expect(result.status).not.toBe(0);
		expect(output(result)).toContain("gitleaks");
	});

	hookTest("t4: the commit transaction shows the review line a driving agent consumes", () => {
		const repo = makeRepo();
		writeFileSync(join(repo, "app.ts"), "// driving agent consumption\nexport const app = 1;\n");
		git(repo, ["add", "app.ts"]);
		const result = commit(repo, "driving-agent visibility");
		expect(result.status).toBe(0);
		expect(output(result)).toMatch(/\[jev-review review-1 (?:[0-9a-f]{7}|unresolved)\]/);
	});
});