import { describe, expect, test } from "bun:test";
import type { Answer, Question, SystemOneProvider } from "./engine";
import { runSemanticQuality } from "./semantic-run";
import type { SemanticGitInput } from "./semantic-git";

const input: SemanticGitInput = {
  snapshot: { kind: "staged_tree", tree: "tree-a", base: "tree-b" },
  changedPaths: ["src/cache.test.ts"],
  abstentions: [],
  candidates: [
    {
      id: "test:tree-a:src/cache.test.ts:1-1",
      kind: "test_evidence",
      snapshot: "tree-a",
      test: { path: "src/cache.test.ts", startLine: 1, endLine: 1, content: "expect(cache()).toBe(1);" },
      target: { path: "src/cache.ts", startLine: 1, endLine: 1, content: "export const cache = () => 1;" },
      dependencyEvidence: [],
    },
  ],
};

class FailingProvider implements SystemOneProvider {
  readonly name = "openrouter" as const;
  async evaluate(_state: string, _questions: Record<string, Question>): Promise<never> {
    throw new Error("quota");
  }
}

class VersionedProvider implements SystemOneProvider {
  readonly name = "openrouter" as const;
  readonly requestedModel = "typesafe/jev-1.13";
  readonly resolvedModels = new Set(["typesafe/jev-1.13-20260917"]);

  async evaluate(_state: string, questions: Record<string, Question>): Promise<Record<string, Answer>> {
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

class CircularAliasProvider extends VersionedProvider {
  readonly resolvedModels = new Set(["typesafe/jev-1.13"]);

  override async evaluate(
    _state: string,
    questions: Record<string, Question>,
  ): Promise<Record<string, Answer>> {
    return Object.fromEntries(
      Object.keys(questions).map((key) => [
        key,
        key.endsWith("oracle")
          ? { type: "choice", choice: "same_logic", probabilities: { same_logic: 1 }, confidence: 1 }
          : key.endsWith("target")
            ? { type: "choice", choice: "runtime_behavior", probabilities: { runtime_behavior: 1 }, confidence: 1 }
            : { type: "choice", choice: "no", probabilities: { no: 1 }, confidence: 1 },
      ]),
    ) as unknown as Record<string, Answer>;
  }
}

class UnversionedProvider extends VersionedProvider {
  readonly resolvedModels = new Set<string>();
}

class WrongRouteProvider implements SystemOneProvider {
  readonly name = "fixture" as const;
  readonly requestedModel = "typesafe/jev-1.13";
  readonly resolvedModels = new Set(["typesafe/jev-1.13-20260917"]);

  async evaluate(_state: string, questions: Record<string, Question>): Promise<Record<string, Answer>> {
    return Object.fromEntries(
      Object.keys(questions).map((key) => [
        key,
        key.endsWith("oracle")
          ? { type: "choice", choice: "same_logic", probabilities: { same_logic: 1 }, confidence: 1 }
          : key.endsWith("target")
            ? { type: "choice", choice: "runtime_behavior", probabilities: { runtime_behavior: 1 }, confidence: 1 }
            : { type: "choice", choice: "no", probabilities: { no: 1 }, confidence: 1 },
      ]),
    ) as unknown as Record<string, Answer>;
  }
}

class MixedRevisionProvider extends VersionedProvider {
  private call = 0;

  async evaluateWithMetadata(state: string, questions: Record<string, Question>) {
    const answers = await this.evaluate(state, questions);
    const resolvedModel = this.call++ === 0
      ? "typesafe/jev-1.13-20260917"
      : "typesafe/jev-1.13-20991231";
    this.resolvedModels.add(resolvedModel);
    return { answers, requestedModel: this.requestedModel, resolvedModel };
  }
}

describe("runSemanticQuality", () => {
  test("reports provider failure as unavailable rather than false-clean", async () => {
    const result = await runSemanticQuality([input], new FailingProvider(), {
      noCache: true,
      now: () => new Date("2026-09-22T17:00:00.000Z"),
    });

    expect(result.record.advisory).toBe(true);
    expect(result.record.status).toBe("unavailable");
    expect(result.record.unavailable).toEqual([
      { candidateId: input.candidates[0]!.id, reason: "provider_unavailable" },
    ]);
    expect(result.humanLines.join("\n")).toContain("not assessed");
    expect(result.humanLines.join("\n").toLowerCase()).not.toContain("clean");
  });

  test("records requested and expected version-resolved model identities separately", async () => {
    const result = await runSemanticQuality([input], new VersionedProvider(), { noCache: true });

    expect(result.record.requestedModel).toBe("typesafe/jev-1.13");
    expect(result.record.expectedResolvedModels).toEqual(["typesafe/jev-1.13-20260917"]);
    expect(result.record.resolvedModels).toEqual(["typesafe/jev-1.13-20260917"]);
    expect(result.record.modelValidation).toBe("expected_version");
  });

  test("does not accept the requested alias as resolved-version evidence", async () => {
    const provider = new VersionedProvider();
    provider.resolvedModels.clear();
    provider.resolvedModels.add("typesafe/jev-1.13");

    const result = await runSemanticQuality([input], provider, { noCache: true });

    expect(result.record.requestedModel).toBe("typesafe/jev-1.13");
    expect(result.record.resolvedModels).toEqual(["typesafe/jev-1.13"]);
    expect(result.record.modelValidation).toBe("unexpected");
    expect(result.record.status).toBe("abstained");
  });

  test("abstains overall when an unapproved model returns a finding", async () => {
    const result = await runSemanticQuality([input], new CircularAliasProvider(), { noCache: true });

    expect(result.record.outcomes).toEqual([]);
    expect(result.record.modelValidation).toBe("unexpected");
    expect(result.record.status).toBe("abstained");
    expect(result.humanLines.join("\n")).not.toContain("circular_oracle");
  });

  test("suppresses findings from an unexpected provider route", async () => {
    const result = await runSemanticQuality([input], new WrongRouteProvider(), { noCache: true });

    expect(result.record.expectedProvider).toBe("openrouter");
    expect(result.record.providerValidation).toBe("unexpected");
    expect(result.record.outcomes).toEqual([]);
    expect(result.record.status).toBe("abstained");
    expect(result.humanLines.join("\n")).toContain("unexpected provider route");
  });

  test("abstains when typed answers omit resolved-model evidence", async () => {
    const result = await runSemanticQuality([input], new UnversionedProvider(), { noCache: true });

    expect(result.record.assessments).toHaveLength(1);
    expect(result.record.modelValidation).toBe("unavailable");
    expect(result.record.status).toBe("abstained");
    expect(result.humanLines.join("\n")).toContain("resolved model");
    expect(result.humanLines.join("\n")).not.toContain("assessed; no findings");
  });

  test("rejects an unapproved dated revision instead of accepting any alias suffix", async () => {
    const provider = new VersionedProvider();
    provider.resolvedModels.clear();
    provider.resolvedModels.add("typesafe/jev-1.13-20991231");

    const result = await runSemanticQuality([input], provider, { noCache: true });

    expect(result.record.resolvedModels).toEqual(["typesafe/jev-1.13-20991231"]);
    expect(result.record.modelValidation).toBe("unexpected");
    expect(result.record.status).toBe("abstained");
    expect(result.humanLines.join("\n")).toContain("unexpected resolved model");
  });

  test("binds resolved-model evidence to every batch", async () => {
    const second = { ...input.candidates[0]!, id: `${input.candidates[0]!.id}-second` };
    const result = await runSemanticQuality(
      [{ ...input, candidates: [input.candidates[0]!, second] }],
      new MixedRevisionProvider(),
      { noCache: true, maxBatchCandidates: 1, maxConcurrency: 1 },
    );

    expect(result.record.modelReceipts.map((receipt) => receipt.resolvedModel)).toEqual([
      "typesafe/jev-1.13-20260917",
      "typesafe/jev-1.13-20991231",
    ]);
    expect(result.record.modelValidation).toBe("unexpected");
    expect(result.record.status).toBe("abstained");
  });
});
