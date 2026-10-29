import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const check = join(root, "scripts/check");
const roots: string[] = [];

afterEach(() => {
	for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

function run(args: string[], code = 0) {
	const scratch = join(homedir(), ".cache/tmp");
	mkdirSync(scratch, { recursive: true });
	const home = mkdtempSync(join(scratch, "mistystack-gate-test-"));
	roots.push(home);
	const bin = join(home, "bin");
	const trace = join(home, "arguments");
	mkdirSync(bin);
	for (const [name, body] of [
		["git", 'case "$1" in rev-parse) printf "fixture-source\\n" ;; esac'],
		["bun", 'printf "%s\\n" "$@" > "$VERIFY_TRACE"\nexit "$VERIFY_EXIT"'],
	]) {
		const path = join(bin, name);
		writeFileSync(path, `#!/bin/sh\n${body}\n`);
		chmodSync(path, 0o700);
	}
	const result = Bun.spawnSync([check, ...args], {
		cwd: root,
		env: {
			...process.env,
			HOME: home,
			PATH: `${bin}:${process.env.PATH}`,
			VERIFY_TRACE: trace,
			VERIFY_EXIT: String(code),
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		code: result.exitCode,
		out: result.stdout.toString(),
		err: result.stderr.toString(),
		args: existsSync(trace) ? readFileSync(trace, "utf8").trim().split("\n") : undefined,
	};
}

test("the default and all gates skip native installs while selecting maintained tests and lint", () => {
	for (const selection of [[], ["all"]]) {
		const result = run(selection);
		expect(result.code).toBe(0);
		expect(result.args).toEqual(["scripts/verify-plugin.ts", "--lint-only"]);
		expect(result.out).toContain("Verification complete: all");
	}
});

test("native install checks remain explicit and forward the no-inference OMP model override", () => {
	for (const flags of [[], ["--strict"], ["--strict", "--lint-only"], ["--model", "fixture/model"]]) {
		const result = run(["plugin", ...flags]);
		expect(result.code).toBe(0);
		expect(result.args).toEqual(["scripts/verify-plugin.ts", ...flags]);
	}
});

test("retired selections and unsupported all arguments fail before invoking proof", () => {
	for (const args of [["shared"], ["pi"], ["omp"], ["workspace"], ["unknown"], ["all", "--strict"], ["all", "--lint-only"], ["all", "--model", "fixture/model"]]) {
		const result = run(args);
		expect(result.code).not.toBe(0);
		expect(result.args).toBeUndefined();
		expect(result.err).toContain("Usage:");
	}
});

test("help succeeds without proof and identifies plugin-only options", () => {
	const result = run(["--help"]);
	expect(result.code).toBe(0);
	expect(result.args).toBeUndefined();
	expect(result.out).toContain("scripts/verify [all]\n");
	expect(result.out).toContain("scripts/verify plugin [--strict] [--lint-only] [--model SELECTOR]");
	expect(result.out).toContain("Plugin-only options:");
	expect(result.out).toContain("--strict       Fail on broken relative Markdown links, unknown skill names and harness-specific URIs.");
	expect(result.out).toContain("allowed only in skills/misty/harnesses/");
	expect(result.out).toContain("CI structural proof only");
	expect(result.out).toContain("no model inference request");
	expect(result.out).toContain("isolated Claude, Codex, OMP and pi install checks");
	expect(result.out).toContain("Missing harness CLIs report SKIP, never PASS");
});

test("a failed maintained suite is the canonical gate's failure", () => {
	const result = run([], 17);
	expect(result.code).toBe(17);
	expect(result.out).not.toContain("Verification complete: all");
});
