/**
 * Evidence packets (evidence-1): bounded, deterministic captures of what a task
 * required, what a completion claims, and which evidence references exist.
 *
 * This module extends the shared System One machinery in `engine.ts` with a
 * versioned question pack and deterministic provenance checks. Findings are
 * targeted review leads, never gates: provider failure fails open, and model
 * probabilities stay in machine-readable fields instead of rendered advice.
 *
 * `engine.ts` is imported for types only; this module adds no runtime engine
 * dependency and does not modify the engine.
 *
 * Offline boundary: the shared `HeuristicEngine` has no handling for the
 * evidence question ids (`evidence-questions-1`), so offline evaluation
 * answers every noul at its 0.05 default and returns `insufficient_evidence`
 * for every packet. Heuristic coverage for this pack is owned by `engine.ts`;
 * use the fixture stub or a live System One provider to exercise the semantic
 * layer. The deterministic provenance checks run without any provider.
 */

import { existsSync } from "node:fs";
import type { Answer, Question, SystemOneProvider } from "./engine.ts";

export const PACKET_VERSION = "evidence-1";
export const QUESTION_PACK_VERSION = "evidence-questions-1";

/** Appended to any text clipped by a builder cap. */
export const TRUNCATION_MARKER = "…[truncated]";

/** Noul answers at or above this probability become review leads. */
export const NOUL_ACTIONABLE_THRESHOLD = 0.6;

/** Deterministic builder caps: the packet is a bounded review lead, not a dump. */
export const EVIDENCE_CAPS = {
	requirements: { count: 8, chars: 280 },
	exclusions: { count: 6, chars: 200 },
	claims: { count: 8, chars: 240 },
	refs: 24,
	body: 1200,
} as const;

/** Cap for the state string handed to a System One provider. */
export const MAX_STATE_CHARS = 24_000;

export type EvidenceRef = {
	id: string;
	kind: "tool" | "test" | "merge" | "push" | "deploy" | "artifact" | "revision" | "log" | "other";
	summary: string;
	source: string;
	status?: "ok" | "failed" | "unknown";
};

export type HandoffPacket = {
	packetVersion: typeof PACKET_VERSION;
	kind: "handoff";
	sourceTask: { id: string; requirements: string[]; exclusions: string[] };
	delegation: { assignee: string; title: string; body: string };
	refs: EvidenceRef[];
};

export type CompletionPacket = {
	packetVersion: typeof PACKET_VERSION;
	kind: "completion";
	taskId: string;
	requirements: string[];
	exclusions: string[];
	claimedOutcome: { summary: string; claims: string[] };
	revision: { claimed?: string; actual?: string };
	artifacts: string[];
	refs: EvidenceRef[];
};

export type EvidencePacket = HandoffPacket | CompletionPacket;

export type ProvenanceFinding = {
	id: string;
	severity: "lead" | "warning";
	message: string;
	refs: string[];
	suggestedAction?: string;
};

/** Machine-readable answer values; never rendered into advice text. */
export type RawEvidenceAnswer = {
	probability?: number;
	choice?: string;
	score?: number;
	confidence?: number;
};

export type EvidenceVerdict = {
	packetVersion: string;
	questionPackVersion: string;
	kind: "handoff" | "completion";
	deterministic: ProvenanceFinding[];
	findings: ProvenanceFinding[];
	sufficient: boolean;
	summary: string;
	provider: string | null;
	raw: Record<string, RawEvidenceAnswer>;
};

export type HandoffPacketInput = {
	sourceTask: { id: string; requirements?: string[]; exclusions?: string[] };
	delegation: { assignee: string; title: string; body: string };
	refs?: EvidenceRef[];
};

export type CompletionPacketInput = {
	taskId: string;
	requirements?: string[];
	exclusions?: string[];
	claimedOutcome: { summary: string; claims?: string[] };
	revision?: { claimed?: string; actual?: string };
	artifacts?: string[];
	refs?: EvidenceRef[];
};

export type EvidenceEvaluationOptions = {
	provider?: SystemOneProvider | null;
	timeoutMs?: number;
	/** Injected artifact probe; defaults to a filesystem existence check. */
	artifactExists?: (path: string) => boolean;
};

export type EvidenceFixtureAnswer = { noul?: number; choice?: string; confidence?: number };

export type EvidenceFixture = {
	name: string;
	packet: EvidencePacket;
	stubAnswers?: Record<string, EvidenceFixtureAnswer>;
	stubThrow?: boolean;
	_note?: string;
};

/** Clip text to a deterministic cap, marking the cut. */
export function capText(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, Math.max(0, max - TRUNCATION_MARKER.length))}${TRUNCATION_MARKER}`;
}

/**
 * Bound a string list by item count and item length. When items are dropped,
 * the cap is spent on an explicit marker so truncation is never silent.
 */
function boundedList(items: string[] | undefined, cap: { count: number; chars: number }): string[] {
	const list = items ?? [];
	if (list.length === 0) return [];
	if (list.length <= cap.count) return list.map((item) => capText(item, cap.chars));
	const kept = list.slice(0, cap.count - 1).map((item) => capText(item, cap.chars));
	kept.push(`${TRUNCATION_MARKER}: ${list.length - kept.length} more`);
	return kept;
}

/**
 * Dedupe refs by id (first wins) and bound the list. `source` strings are
 * copied untouched so the original pointer stays recoverable.
 */
function boundedRefs(refs: EvidenceRef[] | undefined): EvidenceRef[] {
	const seen = new Set<string>();
	const deduped: EvidenceRef[] = [];
	for (const ref of refs ?? []) {
		if (seen.has(ref.id)) continue;
		seen.add(ref.id);
		deduped.push({ ...ref });
	}
	if (deduped.length <= EVIDENCE_CAPS.refs) return deduped;
	const kept = deduped.slice(0, EVIDENCE_CAPS.refs - 1);
	const dropped = deduped.length - kept.length;
	kept.push({
		id: "refs-truncated",
		kind: "other",
		summary: `...(${dropped} more)`,
		source: `refs cap ${EVIDENCE_CAPS.refs}`,
		status: "unknown",
	});
	return kept;
}

/** Build a bounded handoff packet from a source task and a delegated brief. */
export function buildHandoffPacket(input: HandoffPacketInput): HandoffPacket {
	return {
		packetVersion: PACKET_VERSION,
		kind: "handoff",
		sourceTask: {
			id: input.sourceTask.id,
			requirements: boundedList(input.sourceTask.requirements, EVIDENCE_CAPS.requirements),
			exclusions: boundedList(input.sourceTask.exclusions, EVIDENCE_CAPS.exclusions),
		},
		delegation: {
			assignee: input.delegation.assignee,
			title: input.delegation.title,
			body: capText(input.delegation.body, EVIDENCE_CAPS.body),
		},
		refs: boundedRefs(input.refs),
	};
}

/** Build a bounded completion packet from requirements, claims, and refs. */
export function buildCompletionPacket(input: CompletionPacketInput): CompletionPacket {
	return {
		packetVersion: PACKET_VERSION,
		kind: "completion",
		taskId: input.taskId,
		requirements: boundedList(input.requirements, EVIDENCE_CAPS.requirements),
		exclusions: boundedList(input.exclusions, EVIDENCE_CAPS.exclusions),
		claimedOutcome: {
			summary: capText(input.claimedOutcome.summary, EVIDENCE_CAPS.body),
			claims: boundedList(input.claimedOutcome.claims, EVIDENCE_CAPS.claims),
		},
		revision: { claimed: input.revision?.claimed, actual: input.revision?.actual },
		artifacts: input.artifacts ?? [],
		refs: boundedRefs(input.refs),
	};
}

/**
 * The bounded evidence question pack. Ids are for code only; the instructions
 * carry the full meaning, and criteria are the code-owned decision thresholds.
 */
export const EVIDENCE_QUESTIONS: Record<string, Question> = {
	"handoff::requirement_dropped": {
		type: "noul",
		instructions:
			"Does the delegated brief omit, weaken, or contradict a requirement or exclusion that the source task states?",
		criteria: {
			true: "A stated requirement, exclusion, or acceptance condition is missing, weakened, or contradicted in the brief",
			false: "Every stated requirement and exclusion is preserved or explicitly deferred",
		},
	},
	"handoff::evidence_sufficient": {
		type: "noul",
		instructions:
			"Is enough context supplied to judge whether the brief preserves the source task's requirements?",
		criteria: {
			true: "Source requirements and the delegated brief are both present",
			false: "Either the source requirements or the brief are missing, empty, or truncated",
		},
	},
	"handoff::dropped_kind": {
		type: "choice",
		instructions: "If coverage is incomplete, which gap is it?",
		criteria: {
			none_of_these: "No gap found",
			requirement: "An explicit requirement is absent",
			exclusion: "An explicit exclusion or non-goal is absent",
			constraint: "A stated constraint or boundary is absent",
			acceptance: "The success condition or acceptance check is absent",
		},
	},
	"completion::claim_unsupported": {
		type: "noul",
		instructions:
			"Does the claimed outcome assert a result or side effect — merge, push, deploy, test pass, verification — that the supplied evidence does not support?",
		criteria: {
			true: "A claim outruns the evidence",
			false: "Claims are within the evidence",
		},
	},
	"completion::evidence_sufficient": {
		type: "noul",
		instructions: "Is enough evidence supplied to judge the claims at all?",
		criteria: {
			true: "Claims and usable evidence references are present",
			false: "No usable evidence is supplied",
		},
	},
	"completion::missing_evidence": {
		type: "choice",
		instructions: "If support is missing, which evidence is missing or contradicting?",
		criteria: {
			none_of_these: "Nothing missing",
			test_run: "No test or check run at the claimed revision",
			merge_record: "No merge record",
			deploy_record: "No deploy record",
			artifact: "No artifact for a claimed artifact",
			revision: "No revision identifier",
			other: "Something else",
		},
	},
	"completion::acceptance_weakened": {
		type: "noul",
		instructions:
			"Does the supplied evidence suggest an acceptance check was weakened — deleted assertion, narrowed fixture, swallowed error — relative to the original requirements?",
		criteria: {
			true: "An acceptance check looks weakened",
			false: "No sign of weakened acceptance",
		},
	},
};

/** The question subset for one packet kind, ready for `provider.evaluate`. */
export function questionsForKind(kind: "handoff" | "completion"): Record<string, Question> {
	return Object.fromEntries(
		Object.entries(EVIDENCE_QUESTIONS).filter(([id]) => id.startsWith(`${kind}::`)),
	);
}

// Word boundaries keep the patterns from matching substrings such as "latest"
// ("test"), "decision" ("CI"), "bypass" ("pass"), or "greenfield" ("green").
const TEST_CLAIM_PATTERN = /\btest(?:s|ed|ing)?\b|\bverified\b|\bCI\b|\bgreen\b/i;
const SIDE_EFFECT_PATTERNS: Array<{ kind: EvidenceRef["kind"]; pattern: RegExp }> = [
	{ kind: "merge", pattern: /\bmerge(?:s|d|ing)?\b/i },
	{ kind: "push", pattern: /\bpush(?:es|ed|ing)?\b/i },
	{ kind: "deploy", pattern: /\bdeploy(?:s|ed|ing)?\b/i },
];
const SIDE_EFFECT_SUGGESTIONS: Record<string, string> = {
	merge: "gh pr view <n> --json state",
	push: "git ls-remote origin <branch>",
	deploy: "verify the deploy record in the target environment",
};
const SUCCESS_CLAIM_PATTERN =
	/\bpass(?:es|ed|ing)?\b|\bverif(?:y|ied)\b|\bmerge(?:s|d|ing)?\b|\bpush(?:es|ed|ing)?\b|\bdeploy(?:s|ed|ing)?\b|\bgreen\b|\bsuccess(?:ful(?:ly)?)?\b/i;
const INSTRUCTION_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
	{ label: "ignore previous", pattern: /ignore (all )?previous/i },
	{ label: "disregard", pattern: /disregard/i },
	{ label: "you must", pattern: /you must/i },
	{ label: "system:", pattern: /system:/i },
	{ label: "do not tell", pattern: /do not tell/i },
	{ label: "approve this", pattern: /approve this/i },
	{ label: "override", pattern: /override/i },
];

type TextField = { path: string; value: string; refId?: string };

function packetTextFields(packet: EvidencePacket): TextField[] {
	const fields: TextField[] = [];
	const push = (path: string, value: string | undefined, refId?: string) => {
		if (typeof value === "string" && value.length > 0) fields.push({ path, value, refId });
	};
	if (packet.kind === "handoff") {
		push("sourceTask.id", packet.sourceTask.id);
		packet.sourceTask.requirements.forEach((value, index) =>
			push(`sourceTask.requirements[${index}]`, value),
		);
		packet.sourceTask.exclusions.forEach((value, index) =>
			push(`sourceTask.exclusions[${index}]`, value),
		);
		push("delegation.assignee", packet.delegation.assignee);
		push("delegation.title", packet.delegation.title);
		push("delegation.body", packet.delegation.body);
	} else {
		push("taskId", packet.taskId);
		packet.requirements.forEach((value, index) => push(`requirements[${index}]`, value));
		packet.exclusions.forEach((value, index) => push(`exclusions[${index}]`, value));
		push("claimedOutcome.summary", packet.claimedOutcome.summary);
		packet.claimedOutcome.claims.forEach((value, index) =>
			push(`claimedOutcome.claims[${index}]`, value),
		);
		push("revision.claimed", packet.revision?.claimed);
		push("revision.actual", packet.revision?.actual);
		packet.artifacts.forEach((value, index) => push(`artifacts[${index}]`, value));
	}
	packet.refs.forEach((ref, index) => {
		push(`refs[${index}].id`, ref.id, ref.id);
		push(`refs[${index}].summary`, ref.summary, ref.id);
		push(`refs[${index}].source`, ref.source, ref.id);
	});
	return fields;
}

function defaultArtifactExists(path: string): boolean {
	try {
		return existsSync(path);
	} catch {
		return false;
	}
}

/**
 * Claim sources for the deterministic checks: the explicit claims first, then
 * the claimed-outcome summary. The summary is part of the claimed outcome, so
 * a summary-only packet (`claims` omitted) must not skip the checks. Explicit
 * claims stay first so messages keep quoting the structured claim when both
 * match.
 */
function claimSources(packet: CompletionPacket): string[] {
	const candidates = [...(packet.claimedOutcome.claims ?? []), packet.claimedOutcome.summary];
	return candidates.filter((text) => typeof text === "string" && text.trim().length > 0);
}

/**
 * Deterministic provenance checks. No model is consulted; the filesystem is
 * only touched for declared artifacts when `artifactExists` is not injected.
 * Every finding is a review lead or warning — never a gate.
 */
export function checkProvenance(
	packet: EvidencePacket,
	opts: { artifactExists?: (path: string) => boolean } = {},
): ProvenanceFinding[] {
	const findings: ProvenanceFinding[] = [];
	const refs = packet.refs ?? [];
	const idsOfKind = (...kinds: EvidenceRef["kind"][]): string[] =>
		refs.filter((ref) => kinds.includes(ref.kind)).map((ref) => ref.id);

	if (packet.kind === "completion") {
		const claimed = packet.revision?.claimed?.trim();
		const actual = packet.revision?.actual?.trim();
		if (claimed && actual && claimed !== actual) {
			findings.push({
				id: "stale_revision",
				severity: "warning",
				message: `Claimed revision ${claimed} does not match actual revision ${actual}.`,
				refs: idsOfKind("revision"),
				suggestedAction: "re-run the suite at the claimed revision and record the actual revision",
			});
		}

		const artifactExists = opts.artifactExists ?? defaultArtifactExists;
		const seenArtifacts = new Set<string>();
		for (const artifact of packet.artifacts ?? []) {
			if (seenArtifacts.has(artifact)) continue;
			seenArtifacts.add(artifact);
			if (!artifactExists(artifact)) {
				findings.push({
					id: "missing_artifact",
					severity: "lead",
					message: `Claimed artifact is not present at ${artifact}.`,
					refs: [],
					suggestedAction: "re-read the artifact path or attach the artifact to the packet",
				});
			}
		}

		// The claimed-outcome summary is part of the claimed outcome: a
		// summary-only packet (claims omitted) must not skip these checks.
		const claims = claimSources(packet);
		const testClaim = claims.find((claim) => TEST_CLAIM_PATTERN.test(claim));
		if (testClaim && idsOfKind("test").length === 0) {
			findings.push({
				id: "missing_test_evidence",
				severity: "lead",
				message: `Claim asserts a test or verification result with no test evidence: "${testClaim}".`,
				refs: [],
				suggestedAction: "re-run the suite at the claimed revision",
			});
		}

		for (const claim of claims) {
			for (const sideEffect of SIDE_EFFECT_PATTERNS) {
				if (!sideEffect.pattern.test(claim)) continue;
				if (idsOfKind(sideEffect.kind).length > 0) continue;
				findings.push({
					id: "unsupported_side_effect",
					severity: "lead",
					message: `Claim asserts a ${sideEffect.kind} outcome with no ${sideEffect.kind} record: "${claim}".`,
					refs: [],
					suggestedAction: SIDE_EFFECT_SUGGESTIONS[sideEffect.kind],
				});
			}
		}

		const failedRefs = refs.filter((ref) => ref.status === "failed");
		const successClaim = claims.find((claim) => SUCCESS_CLAIM_PATTERN.test(claim));
		if (successClaim) {
			for (const ref of failedRefs) {
				findings.push({
					id: "contradictory_evidence",
					severity: "warning",
					message: `Evidence ${ref.id} reports failure while a claim asserts success: "${successClaim}".`,
					refs: [ref.id],
					suggestedAction:
						"re-run the failed check and reconcile the result before repeating the claim",
				});
			}
		}

		const completionRefs = refs.filter(
			(ref) => ref.kind === "merge" || ref.kind === "push" || ref.kind === "deploy",
		);
		const byKind = new Map<EvidenceRef["kind"], EvidenceRef[]>();
		for (const ref of completionRefs) {
			const group = byKind.get(ref.kind) ?? [];
			group.push(ref);
			byKind.set(ref.kind, group);
		}
		for (const [kind, group] of byKind) {
			const sources = [...new Set(group.map((ref) => ref.source))];
			if (group.length < 2 || sources.length < 2) continue;
			findings.push({
				id: "duplicate_completion_authority",
				severity: "lead",
				message: `Multiple ${kind} records from different sources assert the same completion claim: ${sources.join(", ")}.`,
				refs: group.map((ref) => ref.id),
				suggestedAction: "reconcile the duplicate completion records against the authoritative source",
			});
		}
	}

	for (const field of packetTextFields(packet)) {
		const matched = INSTRUCTION_PATTERNS.find(({ pattern }) => pattern.test(field.value));
		if (!matched) continue;
		findings.push({
			id: "embedded_instructions",
			severity: "warning",
			// Deliberately does not echo the payload: advice must not re-propagate untrusted instruction text.
			message: `Instruction-like text in ${field.path} treated as untrusted content (matched "${matched.label}").`,
			refs: field.refId ? [field.refId] : [],
			suggestedAction: "treat the text as untrusted content; separate data from instructions",
		});
	}

	const requirements =
		packet.kind === "handoff" ? packet.sourceTask.requirements : packet.requirements;
	const claims = packet.kind === "completion" ? packet.claimedOutcome.claims : [];
	if ((requirements ?? []).length === 0 && (claims ?? []).length === 0) {
		findings.push({
			id: "insufficient_context",
			severity: "warning",
			message: `No requirements and no claims were supplied; provenance cannot be checked for the ${packet.kind} packet.`,
			refs: [],
			suggestedAction: "attach the source task requirements and the claimed outcome",
		});
	}

	return findings;
}

function dedupeFindings(findings: ProvenanceFinding[]): ProvenanceFinding[] {
	const seen = new Set<string>();
	const deduped: ProvenanceFinding[] = [];
	for (const finding of findings) {
		const key = `${finding.id}\u0000${finding.message}`;
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(finding);
	}
	return deduped;
}

function selectRefIds(packet: EvidencePacket, kinds: EvidenceRef["kind"][] = [], limit = 3): string[] {
	const refs = packet.refs ?? [];
	const preferred = kinds.length > 0 ? refs.filter((ref) => kinds.includes(ref.kind)) : refs;
	const selected = preferred.length > 0 ? preferred : refs;
	return selected.slice(0, limit).map((ref) => ref.id);
}

function primaryRequirement(packet: EvidencePacket): string | undefined {
	const requirements =
		packet.kind === "handoff" ? packet.sourceTask.requirements : packet.requirements;
	return (requirements ?? []).find((requirement) => requirement.trim().length > 0);
}

function primaryClaim(packet: CompletionPacket): string | undefined {
	const claims = packet.claimedOutcome.claims ?? [];
	const matched = claims.find(
		(claim) =>
			TEST_CLAIM_PATTERN.test(claim) || SIDE_EFFECT_PATTERNS.some(({ pattern }) => pattern.test(claim)),
	);
	if (matched !== undefined) return matched;
	if (claims.length > 0) return claims[0];
	// Summary-only packets have no explicit claims; quote the summary instead
	// of rendering "(no claims supplied)" for an outcome that was supplied.
	const summary = packet.claimedOutcome.summary;
	return typeof summary === "string" && summary.trim().length > 0 ? summary : undefined;
}

function choiceCriteriaText(questionId: string, choice: string): string {
	const question = EVIDENCE_QUESTIONS[questionId];
	if (question?.type !== "choice") return choice;
	return question.criteria[choice] ?? choice;
}

function requirementDroppedFinding(packet: EvidencePacket): ProvenanceFinding {
	const requirement = primaryRequirement(packet) ?? "(no requirements supplied)";
	return {
		id: "handoff::requirement_dropped",
		severity: "lead",
		message: `Delegated brief may omit, weaken, or contradict requirement: "${capText(requirement, 200)}".`,
		refs: selectRefIds(packet),
		suggestedAction: "re-read the source task requirements against the delegated brief",
	};
}

function droppedKindFinding(packet: EvidencePacket, choice: string): ProvenanceFinding {
	const requirement = primaryRequirement(packet) ?? "(no requirements supplied)";
	return {
		id: "handoff::dropped_kind",
		severity: "lead",
		message: `Coverage gap for requirement "${capText(requirement, 160)}": ${choiceCriteriaText("handoff::dropped_kind", choice)}.`,
		refs: selectRefIds(packet),
		suggestedAction: "restore the omitted item in the delegated brief or record the explicit deferral",
	};
}

function claimUnsupportedFinding(packet: EvidencePacket): ProvenanceFinding {
	const claim = packet.kind === "completion" ? primaryClaim(packet) : undefined;
	return {
		id: "completion::claim_unsupported",
		severity: "lead",
		message: `Claim may outrun evidence: "${capText(claim ?? "(no claims supplied)", 200)}".`,
		refs: selectRefIds(packet, ["merge", "push", "deploy", "test"]),
		suggestedAction: "attach the missing evidence or narrow the claim to what the evidence shows",
	};
}

function missingEvidenceFinding(packet: EvidencePacket, choice: string): ProvenanceFinding {
	const claim = packet.kind === "completion" ? primaryClaim(packet) : undefined;
	return {
		id: "completion::missing_evidence",
		severity: "lead",
		message: `Missing evidence for claim "${capText(claim ?? "(no claims supplied)", 160)}": ${choiceCriteriaText("completion::missing_evidence", choice)}.`,
		refs: selectRefIds(packet, ["merge", "push", "deploy", "test", "artifact", "revision"]),
		suggestedAction: "attach the missing evidence reference to the completion packet",
	};
}

function acceptanceWeakenedFinding(packet: EvidencePacket): ProvenanceFinding {
	const requirement = primaryRequirement(packet) ?? "(no requirements supplied)";
	return {
		id: "completion::acceptance_weakened",
		severity: "lead",
		message: `Acceptance check may be weakened for requirement "${capText(requirement, 200)}".`,
		refs: selectRefIds(packet, ["test"]),
		suggestedAction: "re-read the acceptance check and restore the original assertion or fixture",
	};
}

function semanticEvaluation(
	packet: EvidencePacket,
	answers: Record<string, Answer>,
): { findings: ProvenanceFinding[]; sufficient: boolean; raw: Record<string, RawEvidenceAnswer> } {
	const kind = packet.kind;
	const sufficiencyId = `${kind}::evidence_sufficient`;
	const findings: ProvenanceFinding[] = [];
	const raw: Record<string, RawEvidenceAnswer> = {};

	for (const [id, answer] of Object.entries(answers)) {
		raw[id] =
			answer.type === "noul"
				? { probability: answer.probability, confidence: answer.confidence }
				: answer.type === "choice"
					? { choice: answer.choice, confidence: answer.confidence }
					: { score: answer.score, confidence: answer.confidence };
	}

	const sufficiency = answers[sufficiencyId];
	const sufficient =
		sufficiency?.type === "noul" && sufficiency.probability >= NOUL_ACTIONABLE_THRESHOLD;
	if (!sufficient) {
		const reason = sufficiency
			? "provider judged the evidence insufficient"
			: "provider returned no sufficiency answer";
		findings.push({
			id: "insufficient_evidence",
			severity: "warning",
			message: `Not enough evidence to judge the ${kind} packet (${reason}).`,
			refs: selectRefIds(packet),
			suggestedAction: "attach requirements, claims, and evidence references before reviewing",
		});
	}

	for (const [id, answer] of Object.entries(answers)) {
		if (!id.startsWith(`${kind}::`) || id === sufficiencyId) continue;
		if (answer.type === "noul") {
			if (answer.probability < NOUL_ACTIONABLE_THRESHOLD) continue;
			if (id === "handoff::requirement_dropped") findings.push(requirementDroppedFinding(packet));
			else if (id === "completion::claim_unsupported") findings.push(claimUnsupportedFinding(packet));
			else if (id === "completion::acceptance_weakened") findings.push(acceptanceWeakenedFinding(packet));
		} else if (answer.type === "choice") {
			if (answer.choice === "none_of_these") continue;
			if (id === "handoff::dropped_kind") findings.push(droppedKindFinding(packet, answer.choice));
			else if (id === "completion::missing_evidence")
				findings.push(missingEvidenceFinding(packet, answer.choice));
		}
	}

	return { findings, sufficient, raw };
}

function stateForPacket(packet: EvidencePacket): string {
	const json = JSON.stringify(packet);
	if (json.length <= MAX_STATE_CHARS) return json;
	return `${json.slice(0, MAX_STATE_CHARS)}\n${TRUNCATION_MARKER}`;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

/**
 * Evaluate one evidence packet.
 *
 * Deterministic provenance checks always run. Without a usable provider the
 * verdict is deterministic-only with `sufficient: false`; provider errors and
 * timeouts never throw. Evidence judged insufficient never becomes a
 * reassuring pass: a deterministic `insufficient_context` finding forces
 * `sufficient: false` even when a lenient provider answers sufficiency.
 */
export async function evaluateEvidencePacket(
	packet: EvidencePacket,
	opts: EvidenceEvaluationOptions = {},
): Promise<EvidenceVerdict> {
	const kind = packet.kind;
	const deterministic = checkProvenance(packet, { artifactExists: opts.artifactExists });
	const provider = opts.provider ?? null;
	const base = {
		packetVersion: String(packet.packetVersion ?? PACKET_VERSION),
		questionPackVersion: QUESTION_PACK_VERSION,
		kind,
		deterministic,
		provider: provider ? provider.name : null,
	};

	if (!provider) {
		return {
			...base,
			findings: dedupeFindings(deterministic),
			sufficient: false,
			summary: `No System One provider configured; deterministic provenance only (${deterministic.length} finding(s)); evidence judged insufficient.`,
			raw: {},
		};
	}

	const timeoutMs = opts.timeoutMs ?? 15_000;
	let answers: Record<string, Answer> | null = null;
	let failure: string | null = null;
	try {
		answers = await withTimeout(
			provider.evaluate(stateForPacket(packet), questionsForKind(kind), timeoutMs),
			timeoutMs,
			`provider ${provider.name}`,
		);
	} catch (error) {
		failure = error instanceof Error ? error.message : String(error);
	}

	if (!answers) {
		return {
			...base,
			findings: dedupeFindings(deterministic),
			sufficient: false,
			summary: `System One provider ${provider.name} unavailable (${capText(failure ?? "no answers returned", 160)}); deterministic provenance only; evidence judged insufficient.`,
			raw: {},
		};
	}

	const semantic = semanticEvaluation(packet, answers);
	const findings = dedupeFindings([...deterministic, ...semantic.findings]);
	// Deterministic absence of context outranks any provider answer: a lenient
	// provider must not turn an empty packet into a reassuring sufficiency.
	const sufficient =
		semantic.sufficient && !deterministic.some((finding) => finding.id === "insufficient_context");
	return {
		...base,
		findings,
		sufficient,
		summary: `System One provider ${provider.name} evaluated the ${kind} packet: evidence ${sufficient ? "sufficient" : "insufficient"}, ${findings.length} finding(s).`,
		raw: semantic.raw,
	};
}

/**
 * Render terse advice lines for the verdict's findings. No probabilities or
 * scores appear here; raw values stay on `verdict.raw`.
 */
export function renderEvidenceAdvice(verdict: EvidenceVerdict): string[] {
	return verdict.findings.map((finding) => {
		const refs = finding.refs.length > 0 ? finding.refs.join(", ") : "none";
		const verify = finding.suggestedAction ? ` (verify: ${finding.suggestedAction})` : "";
		return `evidence: ${finding.id} — ${finding.message} [refs: ${refs}]${verify}`;
	});
}

/**
 * Replay helper for synthetic regression fixtures: builds a stub provider from
 * the fixture answers (or throws when `stubThrow`), evaluates, and returns the
 * verdict. No network, no credentials, no live Jev call.
 */
export async function evaluateEvidenceFixture(
	fixture: EvidenceFixture,
	opts: { timeoutMs?: number; artifactExists?: (path: string) => boolean } = {},
): Promise<EvidenceVerdict> {
	const provider: SystemOneProvider = {
		name: "heuristic",
		async evaluate(_state, questions) {
			if (fixture.stubThrow) throw new Error(`stub provider outage for fixture ${fixture.name}`);
			const answers: Record<string, Answer> = {};
			for (const [questionId, stub] of Object.entries(fixture.stubAnswers ?? {})) {
				const question = questions[questionId] ?? EVIDENCE_QUESTIONS[questionId];
				if (!question) continue;
				if (question.type === "noul") {
					answers[questionId] = {
						type: "noul",
						probability: stub.noul ?? 0.05,
						confidence: stub.confidence ?? 0.9,
					};
				} else if (question.type === "choice") {
					const choice = stub.choice ?? "none_of_these";
					answers[questionId] = {
						type: "choice",
						choice,
						probabilities: { [choice]: 0.9 },
						confidence: stub.confidence ?? 0.9,
					};
				}
			}
			return answers;
		},
	};
	return evaluateEvidencePacket(fixture.packet, {
		provider,
		timeoutMs: opts.timeoutMs,
		artifactExists: opts.artifactExists,
	});
}

// Advisory CLI: deterministic provenance only, never a gate.
if (import.meta.main) {
	const [, , command, packetPath] = process.argv;
	if (command !== "check" || !packetPath) {
		console.error("usage: bun agent-config/system-one/evidence.ts check <packet.json>");
		process.exit(2);
	}
	let findings: ProvenanceFinding[];
	try {
		const packet = (await Bun.file(packetPath).json()) as EvidencePacket;
		findings = checkProvenance(packet);
	} catch (error) {
		console.error(
			`evidence: cannot read packet: ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exit(2);
	}
	console.log(JSON.stringify(findings, null, 2));
	process.exit(0);
}