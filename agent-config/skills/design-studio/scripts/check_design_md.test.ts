import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Regression tests for the fresh-install fallback resolution (review finding 2):
// Pi/OMP consumer installs carry only agent-config/skills/*, so design-studio
// must not depend on the design-md CLI being present. It ships a minimal
// structural fallback validator; this suite pins its behavior.

const script = join(import.meta.dir, "check_design_md.py");
const roots: string[] = [];

function dir(): string {
	const scratch = process.env.TMPDIR ?? join(homedir(), ".cache/tmp");
	mkdirSync(scratch, { recursive: true, mode: 0o700 });
	const root = mkdtempSync(join(scratch, "check-design-md-"));
	roots.push(root);
	return root;
}

function run(args: string[]) {
	const result = Bun.spawnSync(["python3", script, ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	return { code: result.exitCode ?? 1, out: result.stdout.toString(), err: result.stderr.toString() };
}

function spec(overrides: { frontmatter?: string; body?: string } = {}): string {
	const frontmatter = overrides.frontmatter ?? `---
version: alpha
name: Fixture
colors:
  primary: "#111111"
typography:
  body:
    fontFamily: system-ui
    fontSize: 14px
components:
  button:
    backgroundColor: "{colors.primary}"
---`;
	const body = overrides.body ?? `
## Overview

X

## Colors

X

## Typography

X

## Components

X
`;
	return `${frontmatter}\n${body}`;
}

function write(root: string, text: string): string {
	const path = join(root, "DESIGN.md");
	writeFileSync(path, text);
	return path;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("self-test passes", () => {
	const result = run(["--self-test"]);
	expect(result.err).toBe("");
	expect(result.code).toBe(0);
	expect(result.out).toContain("check_design_md self-test OK");
});

test("a well-formed spec passes", () => {
	const result = run([write(dir(), spec())]);
	expect(result.code).toBe(0);
	expect(result.out).toContain("check_design_md OK");
});

test("missing frontmatter fails closed", () => {
	const result = run([write(dir(), "# no frontmatter\n")]);
	expect(result.code).toBe(1);
	expect(result.err).toContain("frontmatter");
});

test("a missing canonical section fails", () => {
	const result = run([write(dir(), spec({ body: "\n## Overview\n\nX\n" }))]);
	expect(result.code).toBe(1);
	expect(result.err).toContain("## Components");
});

test("an unresolved token reference fails", () => {
	const result = run([write(dir(), spec({
		frontmatter: `---
version: alpha
name: Fixture
colors:
  primary: "#111111"
typography:
  body:
    fontFamily: system-ui
components:
  button:
    backgroundColor: "{colors.ghost}"
---`,
	}))]);
	expect(result.code).toBe(1);
	expect(result.err).toContain("{colors.ghost}");
});