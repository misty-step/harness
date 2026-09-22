import type { SystemOneProvider } from "./engine.ts";
import {
  evaluateSemanticCandidatesCached,
  type CachedEvaluationOptions,
  type SemanticCacheStats,
} from "./semantic-cache.ts";
import type { SemanticGitInput, SemanticSnapshot } from "./semantic-git.ts";
import {
  deriveSemanticFindings,
  SEMANTIC_QUALITY_SCHEMA_VERSION,
  SEMANTIC_QUESTION_PACK_VERSION,
  type CandidateAssessment,
  type SemanticFinding,
} from "./semantic-quality.ts";

export type SemanticRunStatus = "finding" | "assessed" | "abstained" | "unavailable";
export type ModelValidation = "expected_version" | "unexpected" | "unavailable";
export type ProviderValidation = "expected_route" | "unexpected" | "unavailable";

export const DEFAULT_SEMANTIC_MODEL = "typesafe/jev-1.13" as const;
export const DEFAULT_EXPECTED_RESOLVED_MODELS = [
  "typesafe/jev-1.13-20260917",
] as const;

export type MachineFinding = Omit<SemanticFinding, "anchors"> & {
  anchors: Array<{ path: string; startLine: number; endLine: number }>;
};

export type SemanticRunRecord = {
  schemaVersion: typeof SEMANTIC_QUALITY_SCHEMA_VERSION;
  questionPackVersion: typeof SEMANTIC_QUESTION_PACK_VERSION;
  generatedAt: string;
  advisory: true;
  status: SemanticRunStatus;
  provider: SystemOneProvider["name"] | "none";
  expectedProvider: SystemOneProvider["name"];
  providerValidation: ProviderValidation;
  requestedModel: string;
  expectedRequestedModel: string;
  expectedResolvedModels: string[];
  resolvedModels: string[];
  modelReceipts: Array<{ candidateIds: string[]; requestedModel: string; resolvedModel?: string }>;
  modelValidation: ModelValidation;
  snapshots: SemanticSnapshot[];
  changedPaths: string[];
  candidateCount: number;
  assessments: CandidateAssessment[];
  outcomes: MachineFinding[];
  unavailable: Array<{ candidateId: string; reason: string }>;
  abstentions: Array<{ scope: string; reason: string }>;
  cache: SemanticCacheStats;
};

export type SemanticRunOptions = CachedEvaluationOptions & {
  now?: () => Date;
  expectedProvider?: SystemOneProvider["name"];
  expectedResolvedModels?: readonly string[];
};

export type SemanticRunResult = {
  record: SemanticRunRecord;
  humanLines: string[];
};

function machineFinding(finding: SemanticFinding): MachineFinding {
  return {
    ...finding,
    anchors: finding.anchors.map(({ path, startLine, endLine }) => ({
      path,
      startLine,
      endLine,
    })),
  };
}

function humanLines(record: SemanticRunRecord): string[] {
  const lines = record.outcomes
    .filter((outcome) => outcome.status === "finding")
    .map((outcome) => {
      const anchor = outcome.anchors[0];
      const location = anchor ? ` ${anchor.path}:${anchor.startLine}-${anchor.endLine}` : "";
      return `semantic-check: ${outcome.ruleId}${location} — ${outcome.reason}`;
    });
  if (record.unavailable.length > 0) {
    lines.push(`semantic-check: ${record.unavailable.length} candidate(s) not assessed; provider unavailable.`);
  }
  if (record.modelValidation === "unexpected") {
    lines.push("semantic-check: abstained because the provider returned an unexpected resolved model.");
  }
  if (record.modelValidation === "unavailable" && record.assessments.length > 0) {
    lines.push("semantic-check: abstained because the provider omitted the resolved model.");
  }
  if (record.providerValidation === "unexpected") {
    lines.push("semantic-check: abstained because the provider used an unexpected provider route or requested model.");
  }
  if (record.providerValidation === "unavailable" && record.assessments.length > 0) {
    lines.push("semantic-check: abstained because provider route metadata was unavailable.");
  }
  for (const abstention of record.abstentions) {
    lines.push(`semantic-check: abstained for ${abstention.scope}: ${abstention.reason}.`);
  }
  if (lines.length === 0) lines.push("semantic-check: assessed; no findings.");
  lines.push("semantic-check: advisory only; deterministic gates remain authoritative.");
  return lines;
}

function validateResolvedModels(
  expected: readonly string[],
  requestedModel: string,
  receipts: Array<{ candidateIds: string[]; requestedModel: string; resolvedModel?: string }>,
  assessmentIds: string[],
): ModelValidation {
  if (assessmentIds.length === 0 || receipts.length === 0) return "unavailable";
  const allowed = new Set(expected);
  const covered = new Set(receipts.flatMap((receipt) => receipt.candidateIds));
  if (assessmentIds.some((id) => !covered.has(id))) return "unavailable";
  if (receipts.some((receipt) => receipt.requestedModel !== requestedModel)) return "unexpected";
  if (receipts.some((receipt) => !receipt.resolvedModel)) return "unavailable";
  return receipts.every((receipt) => allowed.has(receipt.resolvedModel!)) ? "expected_version" : "unexpected";
}

export async function runSemanticQuality(
  inputs: SemanticGitInput[],
  provider: SystemOneProvider | null,
  options: SemanticRunOptions = {},
): Promise<SemanticRunResult> {
  const candidates = inputs.flatMap((input) => input.candidates);
  const abstentions = inputs.flatMap((input) => input.abstentions);
  if (candidates.length === 0 && abstentions.length === 0) {
    abstentions.push({ scope: "run", reason: "no_candidates" });
  }
  const expectedProvider = options.expectedProvider ?? "openrouter";
  const expectedRequestedModel = options.model ?? DEFAULT_SEMANTIC_MODEL;
  const requestedModel = provider?.requestedModel ?? expectedRequestedModel;
  const providerValidation: ProviderValidation = !provider || !provider.requestedModel
    ? "unavailable"
    : provider.name !== expectedProvider || provider.requestedModel !== expectedRequestedModel
      ? "unexpected"
      : "expected_route";
  const expectedResolvedModels = [...(
    options.expectedResolvedModels ?? DEFAULT_EXPECTED_RESOLVED_MODELS
  )];
  let resolvedModels: string[] = [];
  let modelReceipts: SemanticRunRecord["modelReceipts"] = [];
  const generatedAt = (options.now ?? (() => new Date()))().toISOString();
  let assessments: CandidateAssessment[] = [];
  let unavailable: Array<{ candidateId: string; reason: string }> = [];
  let cache: SemanticCacheStats = {
    hits: 0,
    misses: candidates.length,
    writes: 0,
    enabled: false,
  };

  if (provider) {
    const evaluation = await evaluateSemanticCandidatesCached(candidates, provider, options);
    assessments = evaluation.assessments;
    unavailable = evaluation.unavailable;
    resolvedModels = evaluation.resolvedModels;
    modelReceipts = evaluation.modelReceipts;
    cache = evaluation.cache;
  } else {
    unavailable = candidates.map((candidate) => ({
      candidateId: candidate.id,
      reason: "no_provider",
    }));
  }

  const modelValidation = validateResolvedModels(
    expectedResolvedModels,
    requestedModel,
    modelReceipts,
    assessments.map((assessment) => assessment.candidateId),
  );
  const metadataTrusted = providerValidation === "expected_route" && modelValidation === "expected_version";
  const outcomes = metadataTrusted
    ? deriveSemanticFindings(candidates, assessments).map(machineFinding)
    : [];
  const hasFinding = outcomes.some((outcome) => outcome.status === "finding");
  const status: SemanticRunStatus = unavailable.length > 0
    ? "unavailable"
    : !metadataTrusted
      ? "abstained"
      : hasFinding
        ? "finding"
        : abstentions.length > 0 ||
            outcomes.some((outcome) => outcome.status === "abstained")
          ? "abstained"
          : "assessed";
  const record: SemanticRunRecord = {
    schemaVersion: SEMANTIC_QUALITY_SCHEMA_VERSION,
    questionPackVersion: SEMANTIC_QUESTION_PACK_VERSION,
    generatedAt,
    advisory: true,
    status,
    provider: provider?.name ?? "none",
    expectedProvider,
    providerValidation,
    requestedModel,
    expectedRequestedModel,
    expectedResolvedModels,
    resolvedModels,
    modelReceipts,
    modelValidation,
    snapshots: inputs.map((input) => input.snapshot),
    changedPaths: [...new Set(inputs.flatMap((input) => input.changedPaths))],
    candidateCount: candidates.length,
    assessments,
    outcomes,
    unavailable,
    abstentions,
    cache,
  };
  return { record, humanLines: humanLines(record) };
}
