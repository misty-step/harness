import type { Answer, Question, SystemOneProvider } from "./engine.ts";

export const SEMANTIC_QUALITY_SCHEMA_VERSION = "semantic-quality/v1" as const;

export type EvidenceAnchor = {
  path: string;
  startLine: number;
  endLine: number;
  content: string;
};

export type TestEvidenceCandidate = {
  id: string;
  kind: "test_evidence";
  snapshot: string;
  test: EvidenceAnchor;
  target: EvidenceAnchor;
  contract?: EvidenceAnchor;
  dependencyEvidence: EvidenceAnchor[];
};

export type CompletionCandidate = {
  id: string;
  kind: "completion_claim";
  snapshot: string;
  claim: string;
  evidence: EvidenceAnchor[];
};

export type SemanticCandidate = TestEvidenceCandidate | CompletionCandidate;

export type ChoiceOutcome<T extends string> = {
  outcome: T;
  probability: number;
  probabilities?: Record<string, number>;
  confidence?: number;
};

export type CandidateAssessment = {
  candidateId: string;
  oracleOrigin?: ChoiceOutcome<
    "same_logic" | "independent_logic" | "literal_or_fixture" | "insufficient_evidence"
  >;
  assertionTarget?: ChoiceOutcome<
    "runtime_behavior" | "public_contract" | "source_structure" | "private_mechanism" | "insufficient_evidence"
  >;
  limitedPurpose?: ChoiceOutcome<"yes" | "no" | "insufficient_evidence">;
  completionSupport?: ChoiceOutcome<
    "supported" | "narrower_than_claimed" | "contradicted" | "insufficient_evidence"
  >;
};

export type SemanticRuleId =
  | "circular_oracle"
  | "source_only_behavioral_proof"
  | "unsupported_completion";

export type SemanticFindingStatus = "finding" | "no_finding" | "abstained" | "unavailable";

export type SemanticFinding = {
  ruleId: SemanticRuleId;
  status: SemanticFindingStatus;
  candidateId: string;
  probability: number;
  reason: string;
  anchors: EvidenceAnchor[];
};

function circularOracleFinding(
  candidate: TestEvidenceCandidate,
  assessment: CandidateAssessment,
): SemanticFinding | undefined {
  const oracle = assessment.oracleOrigin;
  if (!oracle) return undefined;
  if (oracle.outcome === "insufficient_evidence") {
    return {
      ruleId: "circular_oracle",
      status: "abstained",
      candidateId: candidate.id,
      probability: oracle.probability,
      reason: "The available evidence does not establish the oracle's origin.",
      anchors: [candidate.test, candidate.target],
    };
  }
  if (oracle.outcome !== "same_logic") return undefined;
  return {
    ruleId: "circular_oracle",
    status: "finding",
    candidateId: candidate.id,
    probability: oracle.probability,
    reason: "The expected result derives from the same logic under test.",
    anchors: [candidate.test, candidate.target],
  };
}

function sourceOnlyFinding(
  candidate: TestEvidenceCandidate,
  assessment: CandidateAssessment,
): SemanticFinding | undefined {
  const target = assessment.assertionTarget;
  const purpose = assessment.limitedPurpose;
  if (!target || !purpose) return undefined;
  if (target.outcome === "insufficient_evidence" || purpose.outcome === "insufficient_evidence") {
    return {
      ruleId: "source_only_behavioral_proof",
      status: "abstained",
      candidateId: candidate.id,
      probability: Math.max(target.probability, purpose.probability),
      reason: "The evidence does not establish what contract this assertion proves.",
      anchors: [candidate.test, candidate.target],
    };
  }
  if (
    (target.outcome === "source_structure" || target.outcome === "private_mechanism") &&
    purpose.outcome === "no"
  ) {
    return {
      ruleId: "source_only_behavioral_proof",
      status: "finding",
      candidateId: candidate.id,
      probability: target.probability,
      reason: "A source-structure assertion is presented as behavioral proof without a declared structural contract.",
      anchors: [candidate.test, candidate.target],
    };
  }
  return {
    ruleId: "source_only_behavioral_proof",
    status: "no_finding",
    candidateId: candidate.id,
    probability: target.probability,
    reason: "The assertion checks runtime behavior or a declared structural contract.",
    anchors: [candidate.test, candidate.target],
  };
}

function unsupportedCompletionFinding(
  candidate: CompletionCandidate,
  assessment: CandidateAssessment,
): SemanticFinding | undefined {
  const support = assessment.completionSupport;
  if (!support) return undefined;
  if (support.outcome === "insufficient_evidence") {
    return {
      ruleId: "unsupported_completion",
      status: "abstained",
      candidateId: candidate.id,
      probability: support.probability,
      reason: "The supplied receipts are insufficient to assess the completion claim.",
      anchors: candidate.evidence,
    };
  }
  if (support.outcome !== "supported") {
    return {
      ruleId: "unsupported_completion",
      status: "finding",
      candidateId: candidate.id,
      probability: support.probability,
      reason:
        support.outcome === "contradicted"
          ? "The supplied receipts contradict the completion claim."
          : "The supplied receipts prove a narrower result than the completion claim.",
      anchors: candidate.evidence,
    };
  }
  return undefined;
}

export function deriveSemanticFindings(
  candidates: SemanticCandidate[],
  assessments: CandidateAssessment[],
): SemanticFinding[] {
  const byCandidate = new Map(assessments.map((assessment) => [assessment.candidateId, assessment]));
  const findings: SemanticFinding[] = [];
  for (const candidate of candidates) {
    const assessment = byCandidate.get(candidate.id);
    if (!assessment) continue;
    if (candidate.kind === "test_evidence") {
      const circular = circularOracleFinding(candidate, assessment);
      if (circular) findings.push(circular);
      const sourceOnly = sourceOnlyFinding(candidate, assessment);
      if (sourceOnly) findings.push(sourceOnly);
    } else {
      const unsupported = unsupportedCompletionFinding(candidate, assessment);
      if (unsupported) findings.push(unsupported);
    }
  }
  return findings;
}

const ORACLE_CRITERIA = {
  same_logic: "Expected results derive from the production logic or an equivalent reimplementation.",
  independent_logic: "Expected results come from an independent reference, invariant, or external authority.",
  literal_or_fixture: "Expected results are fixed literals or fixtures not computed by the tested logic.",
  insufficient_evidence: "The supplied anchors do not reveal where expected results originate.",
} as const;

const TARGET_CRITERIA = {
  runtime_behavior: "The assertion executes the product and checks observable runtime behavior.",
  public_contract: "The assertion checks a documented public artifact or source-shape contract.",
  source_structure: "The assertion only scans or compares implementation source structure.",
  private_mechanism: "The assertion checks a private implementation detail rather than the promised behavior.",
  insufficient_evidence: "The supplied anchors do not establish what the assertion proves.",
} as const;

const PURPOSE_CRITERIA = {
  yes: "A narrow structural purpose is explicit, valid, and not presented as behavioral proof.",
  no: "No valid narrow structural purpose is declared for this assertion.",
  insufficient_evidence: "The supplied contract evidence cannot establish the assertion's intended purpose.",
} as const;

const SUPPORT_CRITERIA = {
  supported: "The receipts directly prove every material part of the completion claim.",
  narrower_than_claimed: "The receipts prove a real result, but not the full claimed scope or environment.",
  contradicted: "At least one receipt conflicts with a material part of the completion claim.",
  insufficient_evidence: "The receipts are missing, stale, ambiguous, or otherwise inadequate for assessment.",
} as const;

export type SemanticEvaluationResult = {
  schemaVersion: typeof SEMANTIC_QUALITY_SCHEMA_VERSION;
  provider: SystemOneProvider["name"];
  model: string;
  assessments: CandidateAssessment[];
  unavailable: Array<{ candidateId: string; reason: string }>;
};

export type SemanticEvaluationOptions = {
  maxBatchCandidates?: number;
  maxConcurrency?: number;
  timeoutMs?: number;
  model?: string;
};

type EvaluationBatch = {
  candidates: SemanticCandidate[];
  state: string;
  questions: Record<string, Question>;
};

function buildBatch(candidates: SemanticCandidate[]): EvaluationBatch {
  const questions: Record<string, Question> = {};
  candidates.forEach((candidate, index) => {
    const prefix = `c${index}`;
    if (candidate.kind === "test_evidence") {
      questions[`${prefix}_oracle`] = {
        type: "choice",
        instructions: `For \`candidates[${index}]\`, where do the asserted expected results originate?`,
        criteria: ORACLE_CRITERIA,
      };
      questions[`${prefix}_target`] = {
        type: "choice",
        instructions: `For \`candidates[${index}]\`, what does the test assertion directly establish?`,
        criteria: TARGET_CRITERIA,
      };
      questions[`${prefix}_purpose`] = {
        type: "choice",
        instructions: `For \`candidates[${index}]\`, is a valid narrow source-shape purpose explicit?`,
        criteria: PURPOSE_CRITERIA,
      };
    } else {
      questions[`${prefix}_support`] = {
        type: "choice",
        instructions: `For \`candidates[${index}]\`, how fully do the anchored receipts support the completion claim?`,
        criteria: SUPPORT_CRITERIA,
      };
    }
  });
  return {
    candidates,
    state: JSON.stringify({ candidates }),
    questions,
  };
}

function choiceOutcome<T extends string>(
  answer: Answer | undefined,
  allowed: readonly T[],
): ChoiceOutcome<T> | undefined {
  if (!answer || answer.type !== "choice" || !allowed.includes(answer.choice as T)) return undefined;
  const selectedProbability = answer.probabilities[answer.choice];
  if (typeof selectedProbability !== "number" || !Number.isFinite(selectedProbability)) return undefined;
  return {
    outcome: answer.choice as T,
    probability: selectedProbability,
    probabilities: answer.probabilities,
    confidence: answer.confidence,
  };
}

function mapBatchAnswers(
  candidates: SemanticCandidate[],
  answers: Record<string, Answer>,
): { assessments: CandidateAssessment[]; unavailable: Array<{ candidateId: string; reason: string }> } {
  const assessments: CandidateAssessment[] = [];
  const unavailable: Array<{ candidateId: string; reason: string }> = [];
  candidates.forEach((candidate, index) => {
    const prefix = `c${index}`;
    if (candidate.kind === "test_evidence") {
      const oracleOrigin = choiceOutcome(
        answers[`${prefix}_oracle`],
        Object.keys(ORACLE_CRITERIA) as Array<keyof typeof ORACLE_CRITERIA>,
      );
      const assertionTarget = choiceOutcome(
        answers[`${prefix}_target`],
        Object.keys(TARGET_CRITERIA) as Array<keyof typeof TARGET_CRITERIA>,
      );
      const limitedPurpose = choiceOutcome(
        answers[`${prefix}_purpose`],
        Object.keys(PURPOSE_CRITERIA) as Array<keyof typeof PURPOSE_CRITERIA>,
      );
      if (!oracleOrigin || !assertionTarget || !limitedPurpose) {
        unavailable.push({ candidateId: candidate.id, reason: "malformed_or_missing_answer" });
        return;
      }
      assessments.push({ candidateId: candidate.id, oracleOrigin, assertionTarget, limitedPurpose });
      return;
    }
    const completionSupport = choiceOutcome(
      answers[`${prefix}_support`],
      Object.keys(SUPPORT_CRITERIA) as Array<keyof typeof SUPPORT_CRITERIA>,
    );
    if (!completionSupport) {
      unavailable.push({ candidateId: candidate.id, reason: "malformed_or_missing_answer" });
      return;
    }
    assessments.push({ candidateId: candidate.id, completionSupport });
  });
  return { assessments, unavailable };
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

export async function evaluateSemanticCandidates(
  candidates: SemanticCandidate[],
  provider: SystemOneProvider,
  options: SemanticEvaluationOptions = {},
): Promise<SemanticEvaluationResult> {
  const batchSize = positiveInteger(options.maxBatchCandidates, 4);
  const concurrency = positiveInteger(options.maxConcurrency, 2);
  const batches = chunks(candidates, batchSize).map(buildBatch);
  const results: Array<ReturnType<typeof mapBatchAnswers> | undefined> = new Array(batches.length);
  let nextBatch = 0;

  const workers = Array.from({ length: Math.min(concurrency, batches.length) }, async () => {
    while (nextBatch < batches.length) {
      const batchIndex = nextBatch++;
      const batch = batches[batchIndex]!;
      try {
        const answers = await provider.evaluate(batch.state, batch.questions, options.timeoutMs ?? 15_000);
        results[batchIndex] = mapBatchAnswers(batch.candidates, answers);
      } catch {
        results[batchIndex] = {
          assessments: [],
          unavailable: batch.candidates.map((candidate) => ({
            candidateId: candidate.id,
            reason: "provider_unavailable",
          })),
        };
      }
    }
  });
  await Promise.all(workers);

  return {
    schemaVersion: SEMANTIC_QUALITY_SCHEMA_VERSION,
    provider: provider.name,
    model: options.model ?? "typesafe/jev-1.13",
    assessments: results.flatMap((result) => result?.assessments ?? []),
    unavailable: results.flatMap((result) => result?.unavailable ?? []),
  };
}
