import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..", "..");
const preCommit = join(repoRoot, ".githooks", "pre-commit");
const prePush = join(repoRoot, ".githooks", "pre-push");
const outcomeHelpers = join(repoRoot, ".githooks", "outcome.sh");

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
	cpSync(outcomeHelpers, join(dir, ".githooks", "outcome.sh"));
	git(dir, ["config", "core.hooksPath", ".githooks"]);

	// Exercise the remaining advisory CLI on the real commit path. Its sources
	// stay untracked so scanners see only the fixture's staged content.
	mkdirSync(join(dir, "agent-config", "bin"), { recursive: true });
	mkdirSync(join(dir, "agent-config", "system-one"), { recursive: true });
	cpSync(join(repoRoot, "agent-config", "bin", "semantic-check.ts"), join(dir, "agent-config", "bin", "semantic-check.ts"));
	for (const file of ["engine.ts", "redaction.ts", "semantic-cache.ts", "semantic-git.ts", "semantic-quality.ts", "semantic-run.ts"]) {
		cpSync(join(repoRoot, "agent-config", "system-one", file), join(dir, "agent-config", "system-one", file));
	}
	return dir;
}

function commit(dir: string, message: string, env: NodeJS.ProcessEnv = hookEnv()): ReturnType<typeof spawnSync> {
	return git(dir, ["commit", "-q", "-m", message], env);
}

function output(result: ReturnType<typeof spawnSync>): string {
	return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

/** A PATH directory holding a recording `outcome` and, optionally, a key-injecting `pass-env` stand-in. */
function fakeTools(passEnv: boolean): { env: NodeJS.ProcessEnv; outcomes: () => string[] } {
	const bin = scratch();
	const log = join(bin, "outcomes.log");
	writeFileSync(join(bin, "outcome"), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\n`);
	chmodSync(join(bin, "outcome"), 0o755);
	if (passEnv) {
		// Resolves every entry, injects no key: the check itself then finds its provider unavailable.
		writeFileSync(join(bin, "pass-env"), '#!/bin/sh\nwhile [ "$1" != "--" ]; do shift; done\nshift\nexec "$@"\n');
		chmodSync(join(bin, "pass-env"), 0o755);
	}
	const env = hookEnv();
	env.PATH = `${bin}:${env.PATH}`;
	return { env, outcomes: () => readFileSync(log, "utf8").trim().split("\n") };
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

	hookTest("a semantic check whose key cannot be read commits and records a failed run", () => {
		const repo = makeRepo();
		writeFileSync(join(repo, "cache.ts"), "export const cacheKey = (value: string) => value;\n");
		git(repo, ["add", "cache.ts"]);
		// The fixture has no .env.pass, so key resolution fails whichever pass-env is installed.
		const tools = fakeTools(false);
		const result = commit(repo, "add code without a readable key", tools.env);
		expect(result.status).toBe(0);
		expect(tools.outcomes()).toHaveLength(1);
		expect(tools.outcomes()[0]).toStartWith("record harness-pre-commit-semantic-check --fail key-unreadable --detail ");
	});

	hookTest("staged test changes commit when the provider is unavailable, recording a failed run rather than a clean verdict", () => {
		const repo = makeRepo();
		writeFileSync(join(repo, "cache.ts"), "export const cacheKey = (value: string) => value;\n");
		writeFileSync(join(repo, "cache.test.ts"), "import { cacheKey } from './cache';\nexpect(cacheKey('base')).toBe('base');\n");
		git(repo, ["add", "cache.ts", "cache.test.ts"]);
		const stagedTree = git(repo, ["write-tree"]).stdout?.toString().trim();
		const tools = fakeTools(true);
		const result = commit(repo, "add staged test evidence", tools.env);
		expect(result.status).toBe(0);
		expect(git(repo, ["rev-parse", "HEAD^{tree}"]).stdout?.toString().trim()).toBe(stagedTree);
		expect(output(result)).toContain("provider unavailable");
		expect(output(result)).not.toContain("assessed; no findings");
		expect(tools.outcomes()).toEqual([
			"record harness-pre-commit-semantic-check --fail exit-3 --detail harness-pre-commit-semantic-check exited 3; no advice was produced",
		]);
	});

	hookTest("disabling advisory checks cannot bypass the staged secret scanner", () => {
		const repo = makeRepo();
		writeFileSync(join(repo, "secrets.txt"), `AWS_ACCESS_KEY_ID=${FAKE_AWS}\nSTRIPE_KEY=${FAKE_STRIPE}\n`);
		git(repo, ["add", "secrets.txt"]);
		const result = commit(repo, "add synthetic secret with advisory checks disabled", hookEnv({ JEV_HOOK_OFF: "1" }));
		expect(result.status).not.toBe(0);
		expect(output(result)).toContain("gitleaks");
	});
});