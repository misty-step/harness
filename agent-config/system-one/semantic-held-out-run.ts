import type { SystemOneProvider } from "./engine.ts";
import type { SemanticGitInput } from "./semantic-git.ts";
import {
  type SemanticCandidate,
  type SemanticFindingStatus,
  type SemanticRuleId,
} from "./semantic-quality.ts";
import {
  runSemanticQuality,
  type ModelValidation,
  type ProviderValidation,
} from "./semantic-run.ts";

export const HELD_OUT_FIXTURE_SCHEMA_VERSION = "semantic-quality-held-out/v1" as const;
export const HELD_OUT_REPORT_SCHEMA_VERSION = "semantic-quality-held-out-report/v1" as const;
export const MAX_HELD_OUT_CASES = 64;

export type HeldOutCase = {
  id: string;
  candidate: SemanticCandidate;
  expected: Partial<Record<SemanticRuleId, SemanticFindingStatus>>;
};

export type HeldOutFixture = {
  schemaVersion: string;
  description?: string;
  cases: HeldOutCase[];
};

export type HeldOutMetrics = {
  labels: number;
  exactMatches: number;
  expectedFindings: number;
  correctFindings: number;
  falsePositives: number;
  misses: number;
  abstentions: number;
  missingOutcomes: number;
};

export type HeldOutCaseResult = {
  id: string;
  candidateId: string;
  expected: Partial<Record<SemanticRuleId, SemanticFindingStatus>>;
  actual: Partial<Record<SemanticRuleId, SemanticFindingStatus>>;
};

export type HeldOutReport = {
  schemaVersion: typeof HELD_OUT_REPORT_SCHEMA_VERSION;
  fixtureSchemaVersion: string;
  generatedAt: string;
  result: "pass" | "fail" | "unavailable";
  caseCount: number;
  evaluatedCaseCount: number;
  provider: SystemOneProvider["name"] | "none";
  providerValidation: ProviderValidation;
  requestedModel: string;
  resolvedModels: string[];
  modelValidation: ModelValidation;
  metrics: HeldOutMetrics | null;
  unavailable: Array<{ candidateId: string; reason: string }>;
  extractionAbstentions: Array<{ scope: string; reason: string }>;
  cases: HeldOutCaseResult[];
};

export type HeldOutOptions = {
  maxCases?: number;
  timeoutMs?: number;
  maxBatchCandidates?: number;
  maxConcurrency?: number;
  now?: () => Date;
};

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function validateFixture(fixture: HeldOutFixture): void {
  if (fixture.schemaVersion !== HELD_OUT_FIXTURE_SCHEMA_VERSION || !Array.isArray(fixture.cases)) {
    throw new Error("invalid semantic-quality held-out fixture");
  }
  const caseIds = new Set<string>();
  const candidateIds = new Set<string>();
  for (const item of fixture.cases) {
    if (!item || typeof item.id !== "string" || !item.candidate || !item.expected) {
      throw new Error("invalid semantic-quality held-out case");
    }
    if (caseIds.has(item.id) || candidateIds.has(item.candidate.id)) {
      throw new Error("held-out case and candidate ids must be unique");
    }
    caseIds.add(item.id);
    candidateIds.add(item.candidate.id);
  }
}

function inputForCases(cases: HeldOutCase[]): SemanticGitInput {
  return {
    snapshot: { kind: "staged_tree", tree: "held-out-public-fixture" },
    candidates: cases.map((item) => item.candidate),
    changedPaths: [],
    abstentions: [],
  };
}

function compareCases(
  cases: HeldOutCase[],
  outcomes: Array<{ candidateId: string; ruleId: SemanticRuleId; status: SemanticFindingStatus }>,
): { cases: HeldOutCaseResult[]; metrics: HeldOutMetrics } {
  const actualByCandidate = new Map<string, Partial<Record<SemanticRuleId, SemanticFindingStatus>>>();
  for (const outcome of outcomes) {
    const actual = actualByCandidate.get(outcome.candidateId) ?? {};
    actual[outcome.ruleId] = outcome.status;
    actualByCandidate.set(outcome.candidateId, actual);
  }

  const metrics: HeldOutMetrics = {
    labels: 0,
    exactMatches: 0,
    expectedFindings: 0,
    correctFindings: 0,
    falsePositives: 0,
    misses: 0,
    abstentions: 0,
    missingOutcomes: 0,
  };
  const results = cases.map((item) => {
    const actual = actualByCandidate.get(item.candidate.id) ?? {};
    for (const [ruleId, expected] of Object.entries(item.expected) as Array<[
      SemanticRuleId,
      SemanticFindingStatus,
    ]>) {
      const observed = actual[ruleId];
      metrics.labels += 1;
      if (expected === "finding") metrics.expectedFindings += 1;
      if (observed === expected) metrics.exactMatches += 1;
      if (expected === "finding" && observed === "finding") metrics.correctFindings += 1;
      if (expected === "no_finding" && observed === "finding") metrics.falsePositives += 1;
      if (expected === "finding" && observed === "no_finding") metrics.misses += 1;
      if (observed === "abstained") metrics.abstentions += 1;
      if (observed === undefined) metrics.missingOutcomes += 1;
    }
    return {
      id: item.id,
      candidateId: item.candidate.id,
      expected: item.expected,
      actual,
    };
  });
  return { cases: results, metrics };
}

export async function evaluateHeldOutFixture(
  fixture: HeldOutFixture,
  provider: SystemOneProvider | null,
  options: HeldOutOptions = {},
): Promise<HeldOutReport> {
  validateFixture(fixture);
  const requestedLimit = positiveInteger(options.maxCases, 24);
  const caseLimit = Math.min(requestedLimit, MAX_HELD_OUT_CASES);
  const selected = fixture.cases.slice(0, caseLimit);
  const skipped = fixture.cases.slice(caseLimit).map((item) => ({
    candidateId: item.candidate.id,
    reason: "held_out_case_limit_exceeded",
  }));
  const run = await runSemanticQuality([inputForCases(selected)], provider, {
    noCache: true,
    maxCandidates: caseLimit,
    maxBatchCandidates: Math.min(positiveInteger(options.maxBatchCandidates, 4), 16),
    maxConcurrency: Math.min(positiveInteger(options.maxConcurrency, 2), 8),
    timeoutMs: Math.min(positiveInteger(options.timeoutMs, 15_000), 60_000),
    now: options.now,
  });
  const unavailable = [...run.record.unavailable, ...skipped];
  const compared = compareCases(selected, run.record.outcomes);
  const inferenceAvailable =
    run.record.providerValidation === "expected_route" &&
    run.record.modelValidation === "expected_version" &&
    unavailable.length === 0;
  const metrics = inferenceAvailable ? compared.metrics : null;
  const result = !inferenceAvailable
    ? "unavailable"
    : compared.metrics.exactMatches === compared.metrics.labels &&
        compared.metrics.abstentions === 0 &&
        compared.metrics.missingOutcomes === 0 &&
        run.record.abstentions.length === 0
      ? "pass"
      : "fail";

  return {
    schemaVersion: HELD_OUT_REPORT_SCHEMA_VERSION,
    fixtureSchemaVersion: fixture.schemaVersion,
    generatedAt: run.record.generatedAt,
    result,
    caseCount: fixture.cases.length,
    evaluatedCaseCount: selected.length,
    provider: run.record.provider,
    providerValidation: run.record.providerValidation,
    requestedModel: run.record.requestedModel,
    resolvedModels: run.record.resolvedModels,
    modelValidation: run.record.modelValidation,
    metrics,
    unavailable,
    extractionAbstentions: run.record.abstentions,
    cases: compared.cases,
  };
}
