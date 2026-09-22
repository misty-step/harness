import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "gallery.py");
const roots: string[] = [];

function dir(): string {
	const scratch = process.env.TMPDIR ?? join(homedir(), ".cache/tmp");
	mkdirSync(scratch, { recursive: true, mode: 0o700 });
	const root = mkdtempSync(join(scratch, "visual-state-review-"));
	roots.push(root);
	return root;
}

function run(args: string[]): { code: number; out: string; err: string } {
	const result = Bun.spawnSync(["python3", script, ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		code: result.exitCode ?? 1,
		out: result.stdout.toString(),
		err: result.stderr.toString(),
	};
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("US-006 self-test passes", () => {
	const result = run(["--self-test"]);
	expect(result.err).toBe("");
	expect(result.code).toBe(0);
	expect(result.out).toContain("gallery self-test OK");
});

test("US-006 --check fails when a captured file is missing", () => {
	const root = dir();
	const manifest = join(root, "manifest.json");
	writeFileSync(
		manifest,
		JSON.stringify({
			title: "Gap",
			states: [{ id: "01-home", file: "missing.png", status: "captured" }],
		}),
	);
	const result = run([manifest, "--check"]);
	expect(result.code).toBe(1);
	expect(result.err).toContain("01-home");
	expect(result.err).toContain("unverified");
});

test("US-006 duplicate state ids fail closed", () => {
	const root = dir();
	const manifest = join(root, "manifest.json");
	writeFileSync(
		manifest,
		JSON.stringify({
			title: "Dup",
			states: [
				{ id: "01-home", file: "a.png", status: "skipped", reason: "x" },
				{ id: "01-home", file: "b.png", status: "skipped", reason: "y" },
			],
		}),
	);
	const result = run([manifest, "--check"]);
	expect(result.code).toBe(1);
	expect(result.err).toContain("duplicate state id");
});

test("US-006 skipped state requires a reason", () => {
	const root = dir();
	const manifest = join(root, "manifest.json");
	writeFileSync(
		manifest,
		JSON.stringify({
			title: "Skip",
			states: [{ id: "02-empty", file: "02-empty.png", status: "skipped" }],
		}),
	);
	const result = run([manifest, "--check"]);
	expect(result.code).toBe(1);
	expect(result.err).toContain("no reason");
});
