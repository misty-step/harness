import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Answer, Question, SystemOneProvider } from "./engine";
import {
  evaluateSemanticCandidatesCached,
  MAX_SEMANTIC_CACHE_ENTRIES,
} from "./semantic-cache";
import type { SemanticCandidate } from "./semantic-quality";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

class CountingProvider implements SystemOneProvider {
  readonly name = "openrouter" as const;
  readonly requestedModel = "typesafe/jev-1.13";
  readonly resolvedModels = new Set<string>();
  calls = 0;

  async evaluate(_state: string, questions: Record<string, Question>): Promise<Record<string, Answer>> {
    this.calls += 1;
    this.resolvedModels.add("typesafe/jev-1.13-20260917");
    return Object.fromEntries(
      Object.keys(questions).map((key) => [
        key,
        key.endsWith("oracle")
          ? { type: "choice", choice: "independent_logic", probabilities: { independent_logic: 1 }, confidence: 1 }
          : key.endsWith("target")
            ? { type: "choice", choice: "runtime_behavior", probabilities: { runtime_behavior: 1 }, confidence: 1 }
            : { type: "choice", choice: "no", probabilities: { no: 1 }, confidence: 1 },
      ]),
    ) as unknown as Record<string, Answer>;
  }
}

function candidate(dependencyContent: string, contractContent?: string): SemanticCandidate {
  return {
    id: "test:src/cache.test.ts:1-2",
    kind: "test_evidence",
    snapshot: "tree-a",
    test: { path: "src/cache.test.ts", startLine: 1, endLine: 2, content: "expect(cache()).toBe(expected);" },
    target: { path: "src/cache.ts", startLine: 1, endLine: 2, content: "export const cache = () => 1;" },
    ...(contractContent === undefined
      ? {}
      : {
          contract: {
            path: "README.md",
            startLine: 1,
            endLine: 1,
            content: contractContent,
          },
        }),
    dependencyEvidence: [
      { path: "src/oracle.ts", startLine: 1, endLine: 1, content: dependencyContent },
    ],
  };
}

describe("evaluateSemanticCandidatesCached", () => {
  test("applies the candidate limit before cache lookup", async () => {
    const cacheDir = mkdtempSync(join(process.env.TMPDIR!, "semantic-cache-limit-"));
    roots.push(cacheDir);
    const provider = new CountingProvider();
    const candidates = [0, 1, 2, 3].map((index) => ({
      ...candidate(`dependency-${index}`),
      id: `candidate-${index}`,
    }));
    await evaluateSemanticCandidatesCached(candidates, provider, { cacheDir, maxCandidates: 4 });
    provider.calls = 0;

    const bounded = await evaluateSemanticCandidatesCached(candidates, provider, {
      cacheDir,
      maxCandidates: 2,
    });

    expect(provider.calls).toBe(0);
    expect(bounded.assessments.map((item) => item.candidateId)).toEqual(["candidate-0", "candidate-1"]);
    expect(bounded.unavailable).toEqual([
      { candidateId: "candidate-2", reason: "candidate_limit_exceeded" },
      { candidateId: "candidate-3", reason: "candidate_limit_exceeded" },
    ]);
  });

  test("reuses exact evidence but invalidates when dependency content changes", async () => {
    const cacheDir = mkdtempSync(join(process.env.TMPDIR!, "semantic-cache-"));
    roots.push(cacheDir);
    const provider = new CountingProvider();

    const first = await evaluateSemanticCandidatesCached([candidate("one")], provider, { cacheDir });
    const second = await evaluateSemanticCandidatesCached([candidate("one")], provider, { cacheDir });
    const changed = await evaluateSemanticCandidatesCached([candidate("two")], provider, { cacheDir });
    const bypassed = await evaluateSemanticCandidatesCached([candidate("two")], provider, {
      cacheDir,
      noCache: true,
    });

    expect(provider.calls).toBe(3);
    expect(first.cache).toEqual({ hits: 0, misses: 1, writes: 1, enabled: true });
    expect(second.cache).toEqual({ hits: 1, misses: 0, writes: 0, enabled: true });
    expect(changed.cache).toEqual({ hits: 0, misses: 1, writes: 1, enabled: true });
    expect(bypassed.cache.enabled).toBe(false);
  });

  test("retains the exact resolved model on a cache hit in a fresh process", async () => {
    const cacheDir = mkdtempSync(join(process.env.TMPDIR!, "semantic-cache-model-"));
    roots.push(cacheDir);
    const writer = new CountingProvider();
    await evaluateSemanticCandidatesCached([candidate("one")], writer, { cacheDir });
    const reader = new CountingProvider();

    const cached = await evaluateSemanticCandidatesCached([candidate("one")], reader, { cacheDir });

    expect(reader.calls).toBe(0);
    expect(cached.resolvedModels).toEqual(["typesafe/jev-1.13-20260917"]);
  });

  test("treats a malformed cached assessment as a miss", async () => {
    const cacheDir = mkdtempSync(join(process.env.TMPDIR!, "semantic-cache-malformed-"));
    roots.push(cacheDir);
    const writer = new CountingProvider();
    const input = candidate("one");
    await evaluateSemanticCandidatesCached([input], writer, { cacheDir });
    const entryPath = join(cacheDir, readdirSync(cacheDir)[0]!);
    const entry = JSON.parse(readFileSync(entryPath, "utf8"));
    entry.assessment = { candidateId: input.id };
    writeFileSync(entryPath, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    const reader = new CountingProvider();

    const result = await evaluateSemanticCandidatesCached([input], reader, { cacheDir });

    expect(reader.calls).toBe(1);
    expect(result.cache).toEqual({ hits: 0, misses: 1, writes: 1, enabled: true });
    expect(result.assessments[0]!.oracleOrigin?.outcome).toBe("independent_logic");
  });

  test("evicts old files to keep the persistent cache within its hard entry bound", async () => {
    const cacheDir = mkdtempSync(join(process.env.TMPDIR!, "semantic-cache-bound-"));
    roots.push(cacheDir);
    for (let index = 0; index < MAX_SEMANTIC_CACHE_ENTRIES + 8; index += 1) {
      const name = `${index.toString(16).padStart(64, "0")}.json`;
      writeFileSync(join(cacheDir, name), "{}\n", { mode: 0o600 });
    }
    const provider = new CountingProvider();

    await evaluateSemanticCandidatesCached([candidate("bounded")], provider, { cacheDir });

    expect(readdirSync(cacheDir).filter((name) => name.endsWith(".json"))).toHaveLength(
      MAX_SEMANTIC_CACHE_ENTRIES,
    );
  });

  test("versions extraction configuration and invalidates changed contract evidence", async () => {
    const cacheDir = mkdtempSync(join(process.env.TMPDIR!, "semantic-cache-contract-"));
    roots.push(cacheDir);
    const provider = new CountingProvider();

    await evaluateSemanticCandidatesCached([candidate("same", "Structural contract v1")], provider, {
      cacheDir,
    });
    await evaluateSemanticCandidatesCached([candidate("same", "Structural contract v2")], provider, {
      cacheDir,
    });
    await evaluateSemanticCandidatesCached([candidate("same", "Structural contract v2")], provider, {
      cacheDir,
      modelVersion: "typesafe/jev-1.13-20260918",
    });

    expect(provider.calls).toBe(3);
    const serializedEntries = readdirSync(cacheDir).map((name: string) =>
      readFileSync(join(cacheDir, name), "utf8"),
    );
    const entries = serializedEntries.map((entry: string) => JSON.parse(entry));
    expect(entries.every((entry) => entry.extractionVersion === "semantic-quality-extraction/v1")).toBe(true);
    expect([...new Set(entries.map((entry) => entry.modelVersion))].sort()).toEqual([
      "typesafe/jev-1.13-20260917",
      "typesafe/jev-1.13-20260918",
    ]);
    expect(serializedEntries.join("\n")).not.toContain("Structural contract v2");
    expect(serializedEntries.join("\n")).not.toContain("dependency-v1");
  });
});
