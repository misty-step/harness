import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gatherStagedSemanticInput } from "./semantic-git";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

function repository(): string {
  const root = mkdtempSync(join(process.env.TMPDIR!, "semantic-git-"));
  roots.push(root);
  git(root, "init", "-q");
  git(root, "config", "user.email", "semantic@example.invalid");
  git(root, "config", "user.name", "Semantic Test");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src/cache.ts"), "export const cacheKey = (value: string) => value;\n");
  writeFileSync(join(root, "src/cache.test.ts"), "expect(cacheKey('base')).toBe('base');\n");
  writeFileSync(join(root, "README.md"), "Cache tests prove runtime behavior.\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "base");
  return root;
}

describe("gatherStagedSemanticInput", () => {
  test("binds candidate content to the immutable index tree", () => {
    const repo = repository();
    writeFileSync(join(repo, "src/cache.test.ts"), "expect('STAGED_ASSERT').toBe('STAGED_ASSERT');\n");
    git(repo, "add", "src/cache.test.ts");
    writeFileSync(join(repo, "src/cache.test.ts"), "expect('UNSTAGED_ASSERT').toBe('UNSTAGED_ASSERT');\n");

    const input = gatherStagedSemanticInput(repo);

    expect(input.snapshot.kind).toBe("staged_tree");
    expect(input.snapshot.tree).toMatch(/^[0-9a-f]{40,64}$/);
    expect(input.candidates).toHaveLength(1);
    expect(input.candidates[0]!.kind).toBe("test_evidence");
    if (input.candidates[0]!.kind !== "test_evidence") throw new Error("expected test candidate");
    expect(input.candidates[0]!.test.content).toContain("STAGED_ASSERT");
    expect(input.candidates[0]!.test.content).not.toContain("UNSTAGED_ASSERT");
  });
});
