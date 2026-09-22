import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  gatherOutgoingSemanticInputs,
  gatherStagedSemanticInput,
  gatherWorktreeSemanticInput,
  parsePrePushUpdates,
  withCompletionClaim,
} from "./semantic-git";

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
  test("uses the empty tree as the immutable base before the initial commit", () => {
    const repo = mkdtempSync(join(process.env.TMPDIR!, "semantic-git-initial-"));
    roots.push(repo);
    git(repo, "init", "-q");
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src/first.ts"), "export const first = () => 'value';\n");
    writeFileSync(join(repo, "src/first.test.ts"), "expect(first()).toBe('value');\n");
    git(repo, "add", ".");

    const input = gatherStagedSemanticInput(repo);

    expect(input.snapshot.base).toBe(git(repo, "hash-object", "-t", "tree", "/dev/null"));
    expect(input.candidates).toHaveLength(1);
  });

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

  test("anchors a local window around changed test lines instead of sending the whole file", () => {
    const repo = repository();
    const baseLines = Array.from({ length: 100 }, (_, index) =>
      index === 59 ? "expect(cacheKey('base')).toBe('base');" : `// unchanged ${index + 1}`,
    );
    writeFileSync(join(repo, "src/cache.test.ts"), `${baseLines.join("\n")}\n`);
    git(repo, "add", "src/cache.test.ts");
    git(repo, "commit", "-qm", "long test fixture");
    const changedLines = [...baseLines];
    changedLines[59] = "expect(cacheKey('changed')).toBe('changed');";
    writeFileSync(join(repo, "src/cache.test.ts"), `${changedLines.join("\n")}\n`);
    git(repo, "add", "src/cache.test.ts");

    const input = gatherStagedSemanticInput(repo);

    if (input.candidates[0]!.kind !== "test_evidence") throw new Error("expected test candidate");
    expect(input.candidates[0]!.test.startLine).toBeGreaterThan(1);
    expect(input.candidates[0]!.test.endLine).toBeLessThan(100);
    expect(input.candidates[0]!.test.content).toContain("cacheKey('changed')");
    expect(input.candidates[0]!.test.content).not.toContain("unchanged 1\n");
  });

  test("anchors local dependency content selected from the same tree", () => {
    const repo = repository();
    writeFileSync(join(repo, "src/oracle.ts"), "export const expected = 'INDEPENDENT';\n");
    writeFileSync(
      join(repo, "src/cache.test.ts"),
      "import { expected } from './oracle';\nexpect(cacheKey('x')).toBe(expected);\n",
    );
    git(repo, "add", "src/cache.test.ts", "src/oracle.ts");

    const input = gatherStagedSemanticInput(repo);

    if (input.candidates[0]!.kind !== "test_evidence") throw new Error("expected test candidate");
    expect(input.candidates[0]!.dependencyEvidence).toEqual([
      expect.objectContaining({ path: "src/oracle.ts", content: expect.stringContaining("INDEPENDENT") }),
    ]);
  });

  test("anchors target evidence around the referenced symbol", () => {
    const repo = repository();
    const targetLines = Array.from({ length: 100 }, (_, index) =>
      index === 69
        ? "export const cacheKey = (value: string) => value.trim();"
        : `export const unrelated${index + 1} = ${index + 1};`,
    );
    writeFileSync(join(repo, "src/cache.ts"), `${targetLines.join("\n")}\n`);
    writeFileSync(join(repo, "src/cache.test.ts"), "expect(cacheKey(' x ')).toBe('x');\n");
    git(repo, "add", "src/cache.ts", "src/cache.test.ts");

    const input = gatherStagedSemanticInput(repo);

    if (input.candidates[0]!.kind !== "test_evidence") throw new Error("expected test candidate");
    expect(input.candidates[0]!.target.startLine).toBeGreaterThan(1);
    expect(input.candidates[0]!.target.endLine).toBeLessThan(100);
    expect(input.candidates[0]!.target.content).toContain("cacheKey");
    expect(input.candidates[0]!.target.content).not.toContain("unrelated1 =");
  });

  test("excludes credential paths before dependency evidence is assembled", () => {
    const repo = repository();
    writeFileSync(join(repo, "src/credentials.ts"), "export const token = 'DO_NOT_SEND';\n");
    writeFileSync(
      join(repo, "src/cache.test.ts"),
      "import { token } from './credentials';\nexpect(cacheKey('x')).not.toBe(token);\n",
    );
    git(repo, "add", "src/cache.test.ts", "src/credentials.ts");

    const input = gatherStagedSemanticInput(repo);

    expect(input.candidates).toEqual([]);
    expect(input.abstentions).toContainEqual({
      scope: "src/cache.test.ts",
      reason: "dependency_context_excluded",
    });
    expect(JSON.stringify(input)).not.toContain("DO_NOT_SEND");
  });

  test("excludes dependencies nested below credential directories", () => {
    const repo = repository();
    mkdirSync(join(repo, "src/secrets"), { recursive: true });
    writeFileSync(join(repo, "src/secrets/oracle.ts"), "export const expected = 'NESTED_SECRET';\n");
    writeFileSync(
      join(repo, "src/cache.test.ts"),
      "import { expected } from './secrets/oracle';\nexpect(cacheKey('x')).toBe(expected);\n",
    );
    git(repo, "add", "src/cache.test.ts", "src/secrets/oracle.ts");

    const input = gatherStagedSemanticInput(repo);

    expect(input.candidates).toEqual([]);
    expect(input.abstentions).toContainEqual({
      scope: "src/cache.test.ts",
      reason: "dependency_context_excluded",
    });
    expect(JSON.stringify(input)).not.toContain("NESTED_SECRET");
  });

  test("excludes a renamed dependency when either rename path is credential-classified", () => {
    const repo = repository();
    writeFileSync(join(repo, "src/credentials.ts"), "export const expected = 'RENAMED_SECRET';\n");
    git(repo, "add", "src/credentials.ts");
    git(repo, "commit", "-qm", "add credential fixture");
    git(repo, "mv", "src/credentials.ts", "src/oracle.ts");
    writeFileSync(
      join(repo, "src/cache.test.ts"),
      "import { expected } from './oracle';\nexpect(cacheKey('x')).toBe(expected);\n",
    );
    git(repo, "add", "src/cache.test.ts");

    const input = gatherStagedSemanticInput(repo);

    expect(input.candidates).toEqual([]);
    expect(input.abstentions).toContainEqual({
      scope: "src/cache.test.ts",
      reason: "dependency_context_excluded",
    });
    expect(JSON.stringify(input)).not.toContain("RENAMED_SECRET");
  });

  test("excludes a low-similarity credential rename reported as delete plus add", () => {
    const repo = repository();
    writeFileSync(
      join(repo, "src/credentials.ts"),
      `${Array.from({ length: 40 }, (_, index) => `export const old${index} = ${index};`).join("\n")}\n`,
    );
    git(repo, "add", "src/credentials.ts");
    git(repo, "commit", "-qm", "add credential source");
    git(repo, "mv", "src/credentials.ts", "src/oracle.ts");
    writeFileSync(join(repo, "src/oracle.ts"), "export const expected = 'LOW_SIMILARITY_SECRET';\n");
    writeFileSync(
      join(repo, "src/cache.test.ts"),
      "import { expected } from './oracle';\nexpect(cacheKey('x')).toBe(expected);\n",
    );
    git(repo, "add", "src/cache.test.ts", "src/oracle.ts");

    const input = gatherStagedSemanticInput(repo);

    expect(input.candidates).toEqual([]);
    expect(input.abstentions).toContainEqual({
      scope: "src/cache.test.ts",
      reason: "dependency_context_excluded",
    });
    expect(input.excludedPaths).toContain("src/oracle.ts");
    expect(JSON.stringify(input)).not.toContain("LOW_SIMILARITY_SECRET");
  });

  test("resolves directory-based tests to an imported production target", () => {
    const repo = repository();
    mkdirSync(join(repo, "test"), { recursive: true });
    writeFileSync(
      join(repo, "test/cache.ts"),
      "import { cacheKey } from '../src/cache';\nexpect(cacheKey('x')).toBe('x');\n",
    );
    git(repo, "add", "test/cache.ts");

    const input = gatherStagedSemanticInput(repo);

    const candidate = input.candidates.find(
      (item) => item.kind === "test_evidence" && item.test.path === "test/cache.ts",
    );
    expect(candidate?.kind).toBe("test_evidence");
    if (candidate?.kind !== "test_evidence") throw new Error("expected directory test candidate");
    expect(candidate.target.path).toBe("src/cache.ts");
    expect(candidate.target.path).not.toBe(candidate.test.path);
  });

  test("abstains explicitly when changed test context exceeds the egress bound", () => {
    const repo = repository();
    writeFileSync(join(repo, "src/cache.test.ts"), `// ${"x".repeat(40_000)}\n`);
    git(repo, "add", "src/cache.test.ts");

    const input = gatherStagedSemanticInput(repo);

    expect(input.candidates).toEqual([]);
    expect(input.abstentions).toEqual([
      { scope: "src/cache.test.ts", reason: "test_context_too_large" },
    ]);
  });

  test("abstains explicitly when a changed test has no target context", () => {
    const repo = repository();
    writeFileSync(join(repo, "src/missing.test.ts"), "expect(missing()).toBe('value');\n");
    git(repo, "add", "src/missing.test.ts");

    const input = gatherStagedSemanticInput(repo);

    expect(input.abstentions).toContainEqual({
      scope: "src/missing.test.ts",
      reason: "missing_target_context",
    });
  });
});

describe("gatherOutgoingSemanticInputs", () => {
  test("parses multiple refs and preserves malformed lines as explicit abstentions", () => {
    const zero = "0".repeat(40);
    const one = "1".repeat(40);
    const two = "2".repeat(40);
    const parsed = parsePrePushUpdates(
      `refs/heads/main ${one} refs/heads/main ${two}\nrefs/heads/new ${two} refs/heads/new ${zero}\nmalformed\n`,
    );

    expect(parsed.updates).toHaveLength(2);
    expect(parsed.updates[1]).toEqual({
      localRef: "refs/heads/new",
      localOid: two,
      remoteRef: "refs/heads/new",
      remoteOid: zero,
    });
    expect(parsed.abstentions).toEqual([{ scope: "pre_push_line_3", reason: "malformed_pre_push_line" }]);
  });

  test("binds an updated ref to the pushed commit trees", () => {
    const repo = repository();
    const base = git(repo, "rev-parse", "HEAD");
    writeFileSync(join(repo, "src/cache.test.ts"), "expect('PUSHED_ASSERT').toBe('PUSHED_ASSERT');\n");
    git(repo, "add", "src/cache.test.ts");
    git(repo, "commit", "-qm", "change test");
    const head = git(repo, "rev-parse", "HEAD");

    const [input] = gatherOutgoingSemanticInputs(repo, [
      { localRef: "refs/heads/main", localOid: head, remoteRef: "refs/heads/main", remoteOid: base },
    ]);

    expect(input!.snapshot).toEqual(
      expect.objectContaining({ kind: "outgoing_ref", ref: "refs/heads/main", base, tree: head }),
    );
    expect(input!.candidates).toHaveLength(1);
    if (input!.candidates[0]!.kind !== "test_evidence") throw new Error("expected test candidate");
    expect(input!.candidates[0]!.test.content).toContain("PUSHED_ASSERT");
  });

  test("handles new refs, deletions, and missing bases as explicit abstentions", () => {
    const repo = repository();
    const head = git(repo, "rev-parse", "HEAD");
    const zero = "0".repeat(40);
    const missing = "f".repeat(40);

    const inputs = gatherOutgoingSemanticInputs(repo, [
      { localRef: "refs/heads/new", localOid: head, remoteRef: "refs/heads/new", remoteOid: zero },
      { localRef: "(delete)", localOid: zero, remoteRef: "refs/heads/old", remoteOid: head },
      { localRef: "refs/heads/main", localOid: head, remoteRef: "refs/heads/main", remoteOid: missing },
    ]);

    expect(inputs.map((input) => input.abstentions[0]?.reason)).toEqual([
      "new_ref_missing_base",
      "deleted_ref",
      "missing_base_object",
    ]);
    expect(inputs.map((input) => input.snapshot.ref)).toEqual([
      "refs/heads/new",
      "refs/heads/old",
      "refs/heads/main",
    ]);
  });
});

describe("gatherWorktreeSemanticInput", () => {
  test("freezes staged, unstaged, and untracked edits without changing the real index", () => {
    const repo = repository();
    writeFileSync(join(repo, "src/cache.test.ts"), "expect('STAGED').toBe('STAGED');\n");
    git(repo, "add", "src/cache.test.ts");
    const indexBefore = git(repo, "write-tree");
    writeFileSync(join(repo, "src/cache.test.ts"), "expect('WORKTREE').toBe('WORKTREE');\n");
    writeFileSync(join(repo, "src/new.test.ts"), "expect('UNTRACKED').toBe('UNTRACKED');\n");
    writeFileSync(join(repo, "src/new.ts"), "export const value = 'UNTRACKED';\n");

    const input = gatherWorktreeSemanticInput(repo);

    expect(input.snapshot.kind).toBe("worktree_tree");
    expect(git(repo, "write-tree")).toBe(indexBefore);
    expect(input.candidates).toHaveLength(2);
    const content = input.candidates
      .filter((candidate) => candidate.kind === "test_evidence")
      .map((candidate) => candidate.test.content)
      .join("\n");
    expect(content).toContain("WORKTREE");
    expect(content).toContain("UNTRACKED");
    expect(content).not.toContain("STAGED");
  });

  test("does not persist excluded untracked credential content as a Git object", () => {
    const repo = repository();
    const secretContent = "WORKTREE_SECRET_SHOULD_NOT_BECOME_A_BLOB\n";
    writeFileSync(join(repo, ".env"), secretContent);
    const blob = execFileSync("git", ["hash-object", "--stdin"], {
      cwd: repo,
      encoding: "utf8",
      input: secretContent,
    }).trim();

    const input = gatherWorktreeSemanticInput(repo);

    expect(JSON.stringify(input.candidates)).not.toContain("WORKTREE_SECRET_SHOULD_NOT_BECOME_A_BLOB");
    expect(() => git(repo, "cat-file", "-e", blob)).toThrow();
  });
});

describe("withCompletionClaim", () => {
  test("anchors receipts to the same immutable snapshot as the claim", () => {
    const repo = repository();
    mkdirSync(join(repo, "reports"), { recursive: true });
    writeFileSync(join(repo, "reports/check.txt"), "STAGED RECEIPT\n");
    git(repo, "add", "reports/check.txt");
    const input = gatherStagedSemanticInput(repo);
    writeFileSync(join(repo, "reports/check.txt"), "UNSTAGED RECEIPT\n");

    const completed = withCompletionClaim(
      repo,
      input,
      "The focused check passed.",
      ["reports/check.txt"],
    );

    const claim = completed.candidates.find((candidate) => candidate.kind === "completion_claim");
    expect(claim?.evidence[0]).toEqual(
      expect.objectContaining({ path: "reports/check.txt", content: expect.stringContaining("STAGED RECEIPT") }),
    );
    expect(claim?.evidence[0]!.content).not.toContain("UNSTAGED RECEIPT");
  });

  test("abstains when a receipt is not changed in the candidate snapshot", () => {
    const repo = repository();
    mkdirSync(join(repo, "reports"), { recursive: true });
    writeFileSync(join(repo, "reports/old.txt"), "OLDER RECEIPT\n");
    git(repo, "add", "reports/old.txt");
    git(repo, "commit", "-qm", "old receipt");
    writeFileSync(join(repo, "src/cache.test.ts"), "expect(cacheKey('new')).toBe('new');\n");
    git(repo, "add", "src/cache.test.ts");
    const input = gatherStagedSemanticInput(repo);

    const completed = withCompletionClaim(repo, input, "The new check passed.", ["reports/old.txt"]);

    expect(completed.candidates.some((candidate) => candidate.kind === "completion_claim")).toBe(false);
    expect(completed.abstentions).toContainEqual({
      scope: "reports/old.txt",
      reason: "receipt_not_changed_in_candidate",
    });
  });

  test("abstains instead of silently ignoring one missing requested receipt", () => {
    const repo = repository();
    mkdirSync(join(repo, "reports"), { recursive: true });
    writeFileSync(join(repo, "reports/check.txt"), "CURRENT RECEIPT\n");
    git(repo, "add", "reports/check.txt");
    const input = gatherStagedSemanticInput(repo);

    const completed = withCompletionClaim(
      repo,
      input,
      "Both checks passed.",
      ["reports/check.txt", "reports/missing.txt"],
    );

    expect(completed.candidates.some((candidate) => candidate.kind === "completion_claim")).toBe(false);
    expect(completed.abstentions).toContainEqual({
      scope: "reports/missing.txt",
      reason: "receipt_missing",
    });
  });
});
