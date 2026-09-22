import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { SystemOneProvider } from "./engine.ts";
import { SEMANTIC_EXTRACTION_VERSION } from "./semantic-git.ts";
import {
  evaluateSemanticCandidates,
  SEMANTIC_QUALITY_SCHEMA_VERSION,
  SEMANTIC_QUESTION_PACK_VERSION,
  type CandidateAssessment,
  type SemanticCandidate,
  type SemanticEvaluationOptions,
  type SemanticEvaluationResult,
} from "./semantic-quality.ts";

export type SemanticCacheStats = {
  hits: number;
  misses: number;
  writes: number;
  enabled: boolean;
};

export type CachedEvaluationOptions = SemanticEvaluationOptions & {
  cacheDir?: string;
  noCache?: boolean;
  modelVersion?: string;
};

export const DEFAULT_SEMANTIC_MODEL_VERSION = "typesafe/jev-1.13-20260917" as const;
export const MAX_SEMANTIC_CACHE_ENTRIES = 512;
const MAX_SEMANTIC_CACHE_ENTRY_BYTES = 64 * 1024;
const MAX_SEMANTIC_CACHE_BYTES = 8 * 1024 * 1024;

export type CachedSemanticEvaluationResult = SemanticEvaluationResult & {
  cache: SemanticCacheStats;
};

type CacheEntry = {
  schemaVersion: typeof SEMANTIC_QUALITY_SCHEMA_VERSION;
  questionPackVersion: typeof SEMANTIC_QUESTION_PACK_VERSION;
  extractionVersion: typeof SEMANTIC_EXTRACTION_VERSION;
  modelVersion: string;
  key: string;
  candidateId: string;
  assessment: CandidateAssessment;
  resolvedModels: string[];
};

type CacheHit = {
  assessment: CandidateAssessment;
  resolvedModels: string[];
};

const ORACLE_OUTCOMES = ["same_logic", "independent_logic", "literal_or_fixture", "insufficient_evidence"] as const;
const TARGET_OUTCOMES = ["runtime_behavior", "public_contract", "source_structure", "private_mechanism", "insufficient_evidence"] as const;
const PURPOSE_OUTCOMES = ["yes", "no", "insufficient_evidence"] as const;
const SUPPORT_OUTCOMES = ["supported", "narrower_than_claimed", "contradicted", "insufficient_evidence"] as const;

function cachedChoice<T extends string>(
  value: unknown,
  allowed: readonly T[],
): { outcome: T; probability: number; probabilities?: Record<string, number>; confidence?: number } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.outcome !== "string" || !allowed.includes(raw.outcome as T)) return undefined;
  if (typeof raw.probability !== "number" || !Number.isFinite(raw.probability) || raw.probability < 0 || raw.probability > 1) {
    return undefined;
  }
  let probabilities: Record<string, number> | undefined;
  if (raw.probabilities !== undefined) {
    if (!raw.probabilities || typeof raw.probabilities !== "object" || Array.isArray(raw.probabilities)) return undefined;
    probabilities = {};
    for (const outcome of allowed) {
      const probability = (raw.probabilities as Record<string, unknown>)[outcome];
      if (probability === undefined) continue;
      if (typeof probability !== "number" || !Number.isFinite(probability) || probability < 0 || probability > 1) {
        return undefined;
      }
      probabilities[outcome] = probability;
    }
  }
  const confidence = raw.confidence;
  if (confidence !== undefined && (
    typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1
  )) {
    return undefined;
  }
  return {
    outcome: raw.outcome as T,
    probability: raw.probability,
    ...(probabilities === undefined ? {} : { probabilities }),
    ...(confidence === undefined ? {} : { confidence: confidence as number }),
  };
}

function cachedAssessment(candidate: SemanticCandidate, value: unknown): CandidateAssessment | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.candidateId !== candidate.id) return undefined;
  if (candidate.kind === "completion_claim") {
    const completionSupport = cachedChoice(raw.completionSupport, SUPPORT_OUTCOMES);
    return completionSupport ? { candidateId: candidate.id, completionSupport } : undefined;
  }
  const oracleOrigin = cachedChoice(raw.oracleOrigin, ORACLE_OUTCOMES);
  const assertionTarget = cachedChoice(raw.assertionTarget, TARGET_OUTCOMES);
  const limitedPurpose = cachedChoice(raw.limitedPurpose, PURPOSE_OUTCOMES);
  return oracleOrigin && assertionTarget && limitedPurpose
    ? { candidateId: candidate.id, oracleOrigin, assertionTarget, limitedPurpose }
    : undefined;
}

function cacheKey(
  candidate: SemanticCandidate,
  provider: SystemOneProvider,
  model: string,
  modelVersion: string,
): string {
  return createHash("sha256")
    .update(SEMANTIC_QUALITY_SCHEMA_VERSION)
    .update("\0")
    .update(SEMANTIC_QUESTION_PACK_VERSION)
    .update("\0")
    .update(SEMANTIC_EXTRACTION_VERSION)
    .update("\0")
    .update(provider.name)
    .update("\0")
    .update(model)
    .update("\0")
    .update(modelVersion)
    .update("\0")
    .update(JSON.stringify(candidate))
    .digest("hex");
}

function cachePath(cacheDir: string, key: string): string {
  return join(cacheDir, `${key}.json`);
}

function pruneCache(cacheDir: string, preserve: string): void {
  try {
    const files = readdirSync(cacheDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^[0-9a-f]{64}\.json$/.test(entry.name))
      .flatMap((entry) => {
        const path = join(cacheDir, entry.name);
        try {
          const stat = statSync(path);
          return [{ path, size: stat.size, modified: stat.mtimeMs }];
        } catch {
          return [];
        }
      })
      .sort((left, right) =>
        left.path === preserve ? 1 : right.path === preserve ? -1 : left.modified - right.modified,
      );
    let totalBytes = files.reduce((total, item) => total + item.size, 0);
    while (files.length > MAX_SEMANTIC_CACHE_ENTRIES || totalBytes > MAX_SEMANTIC_CACHE_BYTES) {
      const oldest = files.shift();
      if (!oldest || oldest.path === preserve) break;
      try {
        unlinkSync(oldest.path);
        totalBytes -= oldest.size;
      } catch {
        // Concurrent readers or writers may already have replaced this entry.
      }
    }
  } catch {
    // Cache maintenance never changes the advisory evaluation result.
  }
}

function readEntry(
  cacheDir: string,
  key: string,
  candidate: SemanticCandidate,
  modelVersion: string,
): CacheHit | undefined {
  try {
    const path = cachePath(cacheDir, key);
    if (statSync(path).size > MAX_SEMANTIC_CACHE_ENTRY_BYTES) return undefined;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<CacheEntry>;
    const assessment = cachedAssessment(candidate, parsed.assessment);
    if (
      parsed.schemaVersion !== SEMANTIC_QUALITY_SCHEMA_VERSION ||
      parsed.questionPackVersion !== SEMANTIC_QUESTION_PACK_VERSION ||
      parsed.extractionVersion !== SEMANTIC_EXTRACTION_VERSION ||
      parsed.modelVersion !== modelVersion ||
      parsed.key !== key ||
      parsed.candidateId !== candidate.id ||
      !assessment ||
      !Array.isArray(parsed.resolvedModels) ||
      !parsed.resolvedModels.every((model) => typeof model === "string")
    ) {
      return undefined;
    }
    return { assessment, resolvedModels: parsed.resolvedModels };
  } catch {
    return undefined;
  }
}

function writeEntry(
  cacheDir: string,
  key: string,
  candidateId: string,
  modelVersion: string,
  assessment: CandidateAssessment,
  resolvedModels: string[],
): boolean {
  mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  chmodSync(cacheDir, 0o700);
  const target = cachePath(cacheDir, key);
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const entry: CacheEntry = {
    schemaVersion: SEMANTIC_QUALITY_SCHEMA_VERSION,
    questionPackVersion: SEMANTIC_QUESTION_PACK_VERSION,
    extractionVersion: SEMANTIC_EXTRACTION_VERSION,
    modelVersion,
    key,
    candidateId,
    assessment,
    resolvedModels,
  };
  const serialized = `${JSON.stringify(entry)}\n`;
  if (new TextEncoder().encode(serialized).byteLength > MAX_SEMANTIC_CACHE_ENTRY_BYTES) return false;
  writeFileSync(temporary, serialized, { mode: 0o600 });
  renameSync(temporary, target);
  chmodSync(target, 0o600);
  pruneCache(cacheDir, target);
  return true;
}

export async function evaluateSemanticCandidatesCached(
  candidates: SemanticCandidate[],
  provider: SystemOneProvider,
  options: CachedEvaluationOptions = {},
): Promise<CachedSemanticEvaluationResult> {
  const requestedLimit = Number.isInteger(options.maxCandidates) && options.maxCandidates! > 0
    ? options.maxCandidates!
    : 32;
  const candidateLimit = Math.min(requestedLimit, 256);
  const boundedCandidates = candidates.slice(0, candidateLimit);
  const skippedCandidates = candidates.slice(candidateLimit);
  const model = provider.requestedModel ?? options.model ?? "typesafe/jev-1.13";
  const modelVersion = options.modelVersion ?? (
    model === "typesafe/jev-1.13" ? DEFAULT_SEMANTIC_MODEL_VERSION : model
  );
  const enabled = Boolean(options.cacheDir) && !options.noCache;
  if (!enabled) {
    const result = await evaluateSemanticCandidates(candidates, provider, options);
    return {
      ...result,
      cache: { hits: 0, misses: candidates.length, writes: 0, enabled: false },
    };
  }

  const cacheDir = options.cacheDir!;
  const cached = new Map<string, CandidateAssessment>();
  const cachedResolvedModels = new Set<string>();
  const cachedModelReceipts: SemanticEvaluationResult["modelReceipts"] = [];
  const missing: SemanticCandidate[] = [];
  const keys = new Map<string, string>();
  for (const candidate of boundedCandidates) {
    const key = cacheKey(candidate, provider, model, modelVersion);
    keys.set(candidate.id, key);
    const hit = readEntry(cacheDir, key, candidate, modelVersion);
    if (hit) {
      cached.set(candidate.id, hit.assessment);
      for (const resolvedModel of hit.resolvedModels) cachedResolvedModels.add(resolvedModel);
      cachedModelReceipts.push({
        candidateIds: [candidate.id],
        requestedModel: model,
        ...(hit.resolvedModels.length === 1 ? { resolvedModel: hit.resolvedModels[0] } : {}),
      });
    } else missing.push(candidate);
  }

  const fresh = await evaluateSemanticCandidates(missing, provider, {
    ...options,
    maxCandidates: candidateLimit,
  });
  for (const resolvedModel of fresh.resolvedModels) cachedResolvedModels.add(resolvedModel);
  let writes = 0;
  for (const assessment of fresh.assessments) {
    const key = keys.get(assessment.candidateId);
    if (!key) continue;
    const receipt = fresh.modelReceipts.find((item) => item.candidateIds.includes(assessment.candidateId));
    const wrote = writeEntry(
      cacheDir,
      key,
      assessment.candidateId,
      modelVersion,
      assessment,
      receipt?.resolvedModel ? [receipt.resolvedModel] : [],
    );
    cached.set(assessment.candidateId, assessment);
    if (wrote) writes += 1;
  }

  return {
    schemaVersion: SEMANTIC_QUALITY_SCHEMA_VERSION,
    provider: provider.name,
    requestedModel: provider.requestedModel ?? model,
    resolvedModels: [...cachedResolvedModels].sort(),
    modelReceipts: [...cachedModelReceipts, ...fresh.modelReceipts],
    assessments: boundedCandidates.flatMap((candidate) => {
      const assessment = cached.get(candidate.id);
      return assessment ? [assessment] : [];
    }),
    unavailable: [
      ...fresh.unavailable,
      ...skippedCandidates.map((candidate) => ({
        candidateId: candidate.id,
        reason: "candidate_limit_exceeded",
      })),
    ],
    cache: {
      hits: boundedCandidates.length - missing.length,
      misses: missing.length,
      writes,
      enabled: true,
    },
  };
}
