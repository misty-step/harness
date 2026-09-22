import { describe, expect, test } from "bun:test";
import {
  deriveSemanticFindings,
  evaluateSemanticCandidates,
  type CandidateAssessment,
  type SemanticCandidate,
} from "./semantic-quality";
import type { Answer, Question, SystemOneProvider } from "./engine";

const circularCandidate: SemanticCandidate = {
  id: "test:src/cache.test.ts:10-16",
  kind: "test_evidence",
  snapshot: "tree-a",
  test: {
    path: "src/cache.test.ts",
    startLine: 10,
    endLine: 16,
    content: "expect(cacheKey(source)).toBe(cacheKey(source));",
  },
  target: {
    path: "src/cache.ts",
    startLine: 1,
    endLine: 30,
    content: "export function cacheKey(source: string) { return source; }",
  },
  contract: {
    path: "docs/cache.md",
    startLine: 3,
    endLine: 5,
    content: "Cache invalidation must observe dependency content changes.",
  },
  dependencyEvidence: [],
};

describe("deriveSemanticFindings", () => {
  test("reports a circular oracle from a model-selected same-logic assessment", () => {
    const assessment: CandidateAssessment = {
      candidateId: circularCandidate.id,
      oracleOrigin: { outcome: "same_logic", probability: 0.97 },
      assertionTarget: { outcome: "runtime_behavior", probability: 0.95 },
      limitedPurpose: { outcome: "no", probability: 0.99 },
    };

    expect(deriveSemanticFindings([circularCandidate], [assessment])).toContainEqual(
      expect.objectContaining({
        ruleId: "circular_oracle",
        status: "finding",
        candidateId: circularCandidate.id,
        probability: 0.97,
      }),
    );
  });

  test("reports source-only proof when a behavioral claim asserts source structure", () => {
    const assessment: CandidateAssessment = {
      candidateId: circularCandidate.id,
      oracleOrigin: { outcome: "independent_logic", probability: 0.91 },
      assertionTarget: { outcome: "source_structure", probability: 0.94 },
      limitedPurpose: { outcome: "no", probability: 0.96 },
    };

    expect(deriveSemanticFindings([circularCandidate], [assessment])).toContainEqual(
      expect.objectContaining({
        ruleId: "source_only_behavioral_proof",
        status: "finding",
        candidateId: circularCandidate.id,
        probability: 0.94,
      }),
    );
  });

  test("records a valid structural-contract counterexample as no finding", () => {
    const assessment: CandidateAssessment = {
      candidateId: circularCandidate.id,
      oracleOrigin: { outcome: "literal_or_fixture", probability: 0.93 },
      assertionTarget: { outcome: "public_contract", probability: 0.96 },
      limitedPurpose: { outcome: "yes", probability: 0.98 },
    };

    expect(deriveSemanticFindings([circularCandidate], [assessment])).toContainEqual(
      expect.objectContaining({
        ruleId: "source_only_behavioral_proof",
        status: "no_finding",
        candidateId: circularCandidate.id,
      }),
    );
  });

  test("reports a completion claim that outruns its receipts", () => {
    const candidate: SemanticCandidate = {
      id: "completion:ship",
      kind: "completion_claim",
      snapshot: "tree-b",
      claim: "The integration is working in production.",
      evidence: [
        {
          path: "reports/check.txt",
          startLine: 1,
          endLine: 1,
          content: "Unit tests passed with a fixture provider.",
        },
      ],
    };
    const assessment: CandidateAssessment = {
      candidateId: candidate.id,
      completionSupport: { outcome: "narrower_than_claimed", probability: 0.98 },
    };

    expect(deriveSemanticFindings([candidate], [assessment])).toEqual([
      expect.objectContaining({
        ruleId: "unsupported_completion",
        status: "finding",
        candidateId: candidate.id,
        probability: 0.98,
      }),
    ]);
  });
});

class RecordingProvider implements SystemOneProvider {
  readonly name = "openrouter" as const;
  active = 0;
  maxActive = 0;
  calls: Array<{ state: string; questions: Record<string, Question> }> = [];

  async evaluate(state: string, questions: Record<string, Question>): Promise<Record<string, Answer>> {
    this.calls.push({ state, questions });
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    this.active -= 1;
    return Object.fromEntries(
      Object.keys(questions).map((key) => [
        key,
        key.endsWith("oracle")
          ? { type: "choice", choice: "same_logic", probabilities: { same_logic: 0.97 }, confidence: 0.96 }
          : key.endsWith("target")
            ? { type: "choice", choice: "runtime_behavior", probabilities: { runtime_behavior: 0.95 }, confidence: 0.94 }
            : { type: "choice", choice: "no", probabilities: { no: 0.99 }, confidence: 0.98 },
      ]),
    ) as unknown as Record<string, Answer>;
  }
}

describe("evaluateSemanticCandidates", () => {
  test("batches fixed Choice questions with bounded concurrency", async () => {
    const provider = new RecordingProvider();
    const candidates = [0, 1, 2].map((index) => ({
      ...circularCandidate,
      id: `${circularCandidate.id}:${index}`,
    }));

    const result = await evaluateSemanticCandidates(candidates, provider, {
      maxBatchCandidates: 1,
      maxConcurrency: 2,
    });

    expect(provider.calls).toHaveLength(3);
    expect(provider.maxActive).toBe(2);
    expect(Object.keys(provider.calls[0]!.questions)).toEqual([
      "c0_oracle",
      "c0_target",
      "c0_purpose",
    ]);
    expect(result.assessments).toHaveLength(3);
    expect(result.unavailable).toEqual([]);
  });
});
