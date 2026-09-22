import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const roots: string[] = [];
const cli = resolve(import.meta.dir, "semantic-check.ts");

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

function repository(): string {
  const root = mkdtempSync(join(process.env.TMPDIR!, "semantic-cli-"));
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
  writeFileSync(join(root, "src/cache.test.ts"), "expect(cacheKey('x')).toBe(cacheKey('x'));\n");
  git(root, "add", "src/cache.test.ts");
  return root;
}

function fixture(root: string): string {
  const path = join(root, "fixture.json");
  writeFileSync(
    path,
    JSON.stringify({
      requestedModel: "typesafe/jev-1.13",
      resolvedModel: "typesafe/jev-1.13-20260917",
      outcomes: {
        oracle: "same_logic",
        target: "source_structure",
        purpose: "no",
        support: "narrower_than_claimed",
      },
    }),
  );
  return path;
}

describe("semantic-check CLI", () => {
  test("emits a machine-readable advisory finding from the staged tree", () => {
    const repo = repository();
    const result = spawnSync(
      "bun",
      [cli, "--repo", repo, "--staged", "--fixture", fixture(repo), "--json", "--no-cache"],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    const record = JSON.parse(result.stdout);
    expect(record.status).toBe("finding");
    expect(record.provider).toBe("fixture");
    expect(record.requestedModel).toBe("typesafe/jev-1.13");
    expect(record.resolvedModels).toEqual(["typesafe/jev-1.13-20260917"]);
    expect(record.modelValidation).toBe("expected_version");
    expect(record.outcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: "circular_oracle", status: "finding" }),
        expect.objectContaining({ ruleId: "source_only_behavioral_proof", status: "finding" }),
      ]),
    );
  });

  test("assesses a completion claim only against an immutable staged receipt", () => {
    const repo = repository();
    mkdirSync(join(repo, "reports"), { recursive: true });
    writeFileSync(join(repo, "reports/local.txt"), "Focused local fixture test passed.\n");
    git(repo, "add", "reports/local.txt");
    const result = spawnSync(
      "bun",
      [
        cli,
        "--repo",
        repo,
        "--staged",
        "--fixture",
        fixture(repo),
        "--claim",
        "The change is deployed and healthy in production.",
        "--receipt",
        "reports/local.txt",
        "--json",
        "--no-cache",
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    const record = JSON.parse(result.stdout);
    expect(record.outcomes).toContainEqual(
      expect.objectContaining({ ruleId: "unsupported_completion", status: "finding" }),
    );
    expect(record.snapshots[0].tree).toMatch(/^[0-9a-f]{40,64}$/);
  });

  test("returns unavailable advisory outcomes when the provider credential is absent", () => {
    const repo = repository();
    writeFileSync(
      join(repo, "src/example.test.ts"),
      'test("example", () => {\n  expect(example("x")).toBe("y");\n});\n',
    );
    writeFileSync(
      join(repo, "src/example.ts"),
      'export function example(value: string) {\n  return value;\n}\n',
    );
    git(repo, "add", ".");
    const result = spawnSync(
      "bun",
      [cli, "--repo", repo, "--staged", "--json", "--no-cache"],
      {
        encoding: "utf8",
        env: {
          ...(globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env,
          OPENROUTER_API_KEY: "",
        },
      },
    );

    expect(result.status).toBe(0);
    const record = JSON.parse(result.stdout);
    expect(record.status).toBe("unavailable");
    expect(record.outcomes).toEqual([]);
    expect(record.unavailable[0].reason).toBe("no_provider");
  });

  test("writes advisory output without replacing a deterministic failure exit", () => {
    const repo = repository();
    const shell = join(repo, "gate.sh");
    writeFileSync(
      shell,
      `#!/usr/bin/env bash\nset +e\n(exit 23)\ngate_status=$?\nbun ${JSON.stringify(cli)} --repo ${JSON.stringify(repo)} --staged --fixture ${JSON.stringify(fixture(repo))}\nexit "$gate_status"\n`,
      { mode: 0o755 },
    );

    const result = spawnSync(shell, [], { encoding: "utf8" });

    expect(result.status).toBe(23);
    expect(result.stdout).toContain("semantic-check: circular_oracle");
    expect(result.stdout).toContain("advisory only");
  });

  test("reads every pre-push ref update and emits their immutable snapshots", () => {
    const repo = repository();
    const base = git(repo, "rev-parse", "HEAD");
    writeFileSync(join(repo, "src/cache.test.ts"), "expect(cacheKey('push')).toBe('push');\n");
    git(repo, "add", "src/cache.test.ts");
    git(repo, "commit", "-qm", "push change");
    const head = git(repo, "rev-parse", "HEAD");
    const stdin = [
      `refs/heads/main ${head} refs/heads/main ${base}`,
      `refs/heads/topic ${head} refs/heads/topic ${base}`,
    ].join("\n");

    const result = spawnSync(
      "bun",
      [cli, "--repo", repo, "--outgoing", "--fixture", fixture(repo), "--json", "--no-cache"],
      { encoding: "utf8", input: `${stdin}\n` },
    );

    expect(result.status).toBe(0);
    const record = JSON.parse(result.stdout);
    expect(record.snapshots).toHaveLength(2);
    expect(record.snapshots.map((snapshot: { ref: string }) => snapshot.ref)).toEqual([
      "refs/heads/main",
      "refs/heads/topic",
    ]);
  });

  test("disables the cache in CI even when a cache directory is provided", () => {
    const repo = repository();
    const cacheDir = join(repo, "cache");
    const result = spawnSync(
      "bun",
      [cli, "--repo", repo, "--staged", "--fixture", fixture(repo), "--json", "--cache-dir", cacheDir],
      { encoding: "utf8", env: { ...process.env, CI: "true" } },
    );

    expect(result.status).toBe(0);
    const record = JSON.parse(result.stdout);
    expect(record.cache.enabled).toBe(false);
    expect(() => readFileSync(join(cacheDir, "missing"))).toThrow();
  });
});
