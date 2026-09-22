import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Answer, Question, SystemOneProvider } from "./engine";
import { evaluateHeldOutFixture } from "./semantic-held-out-run";
import type { SemanticCandidate, SemanticRuleId, SemanticFindingStatus } from "./semantic-quality";

type HeldOutCase = {
  id: string;
  candidate: SemanticCandidate;
  expected: Partial<Record<SemanticRuleId, SemanticFindingStatus>>;
};

type HeldOutFixture = {
  schemaVersion: string;
  cases: HeldOutCase[];
};

const fixturePath = join(import.meta.dir, "fixtures", "semantic-quality", "held-out-public.json");

class AdjudicatedProvider implements SystemOneProvider {
  readonly name = "openrouter" as const;
  readonly requestedModel = "typesafe/jev-1.13";
  readonly resolvedModels = new Set(["typesafe/jev-1.13-20260917"]);
  readonly states: string[] = [];

  async evaluate(): Promise<Record<string, Answer>> {
    throw new Error("evaluateWithMetadata should be used");
  }

  async evaluateWithMetadata(
    state: string,
    questions: Record<string, Question>,
  ): Promise<{ answers: Record<string, Answer>; requestedModel: string; resolvedModel: string }> {
    this.states.push(state);
    const candidates = (JSON.parse(state) as { candidates: SemanticCandidate[] }).candidates;
    const answers: Record<string, Answer> = {};
    for (const [key, question] of Object.entries(questions)) {
      if (question.type !== "choice") throw new Error("expected Choice question");
      const index = Number(/^c(\d+)_/.exec(key)?.[1]);
      const id = candidates[index]!.id;
      const suffix = key.split("_").at(-1)!;
      let choice: string;
      if (suffix === "oracle") {
        choice = id.includes("circular-normalizer") ? "same_logic" : "literal_or_fixture";
      } else if (suffix === "target") {
        choice = id.includes("source-assertion")
          ? "source_structure"
          : id.includes("declared-structural")
            ? "public_contract"
            : "runtime_behavior";
      } else if (suffix === "purpose") {
        choice = id.includes("declared-structural") ? "yes" : "no";
      } else {
        choice = id.includes("production-claim") ? "narrower_than_claimed" : "supported";
      }
      answers[key] = {
        type: "choice",
        choice,
        probabilities: Object.fromEntries(
          Object.keys(question.criteria).map((option) => [option, option === choice ? 1 : 0]),
        ),
        confidence: 1,
      };
    }
    return {
      answers,
      requestedModel: this.requestedModel,
      resolvedModel: "typesafe/jev-1.13-20260917",
    };
  }
}

describe("semantic quality held-out fixture", () => {
  test("covers a finding and closest valid counterexample for every initial rule", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as HeldOutFixture;
    const labels = new Map<SemanticRuleId, Set<string>>();
    for (const item of fixture.cases) {
      for (const [rule, status] of Object.entries(item.expected)) {
        const values = labels.get(rule as SemanticRuleId) ?? new Set<string>();
        values.add(status);
        labels.set(rule as SemanticRuleId, values);
      }
    }

    expect(fixture.schemaVersion).toBe("semantic-quality-held-out/v1");
    expect(new Set(fixture.cases.map((item) => item.id)).size).toBe(fixture.cases.length);
    expect([...labels.entries()].sort()).toEqual([
      ["circular_oracle", new Set(["finding", "no_finding"])],
      ["source_only_behavioral_proof", new Set(["finding", "no_finding"])],
      ["unsupported_completion", new Set(["finding", "no_finding"])],
    ]);
  });

  test("keeps expected labels outside provider candidate state", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as HeldOutFixture;
    const providerState = JSON.stringify({ candidates: fixture.cases.map((item) => item.candidate) });

    expect(providerState).not.toContain('"expected"');
    expect(fixture.cases.map((item) => item.candidate.id)).toHaveLength(6);
  });

  test("runs source-only held-out cases and compares labels after inference", async () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as HeldOutFixture;
    const provider = new AdjudicatedProvider();

    const report = await evaluateHeldOutFixture(fixture, provider, {
      now: () => new Date("2026-09-22T00:00:00.000Z"),
      maxCases: 24,
    });

    expect(provider.states.join("\n")).not.toContain('"expected"');
    expect(report.result).toBe("pass");
    expect(report.providerValidation).toBe("expected_route");
    expect(report.caseCount).toBe(6);
    expect(report.metrics).toEqual({
      labels: 10,
      exactMatches: 10,
      expectedFindings: 3,
      correctFindings: 3,
      falsePositives: 0,
      misses: 0,
      abstentions: 0,
      missingOutcomes: 0,
    });
    expect(report.unavailable).toEqual([]);
  });

  test("CLI reports unavailable without inventing metrics when provider credentials are absent", () => {
    const { OPENROUTER_API_KEY: _discarded, ...environment } = process.env;
    const cli = join(import.meta.dir, "..", "bin", "semantic-held-out.ts");
    const result = spawnSync(
      "bun",
      [cli, "--fixture", fixturePath, "--json"],
      { encoding: "utf8", env: environment },
    );

    expect(result.status).toBe(3);
    expect(result.stderr).toBe("");
    const report = JSON.parse(result.stdout);
    expect(report.result).toBe("unavailable");
    expect(report.metrics).toBeNull();
    expect(report.unavailable).toHaveLength(6);
    expect(new Set(report.unavailable.map((item: { reason: string }) => item.reason))).toEqual(
      new Set(["no_provider"]),
    );
  });
});
