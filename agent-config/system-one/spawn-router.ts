/**
 * spawn-router — System One spawn-time seat picker (shadow).
 *
 * One Jev call per factory spawn packet; code maps the seat to a pinned
 * model. Seats are named fleet roles — Jev never emits a model id, and this
 * picker never merges, never gates a spawn, and never swaps a seat
 * mid-thread. Pick once at spawn; escalate by spawning a child; failover
 * stays failure-only.
 *
 * Locked policy (operator 2026-09-18, decision 5):
 *  - Trust Jev's `seat` when confidence >= 0.85.
 *  - Never promote to frontier from stakes/difficulty alone. Frontier only
 *    when Jev picks it at >= 0.85, or when a security review's seat is
 *    uncertain (< 0.70).
 *  - Fail open to builder_flash on timeout, error, or low confidence.
 *  - Never fast_cerebras for docs/intake/roam.
 *  - needs_human >= 0.75: a live path would block the card needs_input and
 *    not spawn; this shadow module only records `block_for_human`.
 *
 * Shadow phase: callers log picks; they do not set kanban model overrides
 * from them until a week of logs has been reviewed.
 *
 * The question battery lives in `spawn-router-questions.json` (copied from
 * the live eval runner); thresholds live here beside the mapper. The
 * OpenRouter client is the one in `engine.ts` — this module imports it and
 * does not modify it (sibling cards own that file).
 */

import { resolveProvider, type Answer } from "./engine.ts";
import questions from "./spawn-router-questions.json";

/**
 * Question shape used by the Decisions API for the spawn router. The live
 * eval sends `instructions` as an object (`question`/`inspect`/`focus`) and
 * rich criteria; engine.ts's `Question` type describes the diff-review
 * batteries, so this module keeps its own structural type and hands it to
 * the provider through the evaluator view below.
 */
export type SpawnQuestion = {
	type: "noul" | "choice" | "score";
	instructions: Record<string, unknown>;
	criteria: unknown;
};

/** The nine spawn-router questions, copied byte-for-byte from the eval runner. */
export const SPAWN_QUESTIONS = questions as Record<string, SpawnQuestion>;

/** OpenRouter Decisions endpoint + model the live eval pinned. */
export const JEV_ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
export const JEV_MODEL = "typesafe/jev-1.13";

/**
 * Structural view of the OpenRouter Jev provider for a structured (object)
 * state. The live eval sends `{dispatch, work, fleet, ask}` as `state` and
 * the Decisions API accepts it; engine.ts types `state` as a string for the
 * diff-review path. The single widening cast in `defaultEvaluator` is
 * deliberate: engine.ts stays untouched.
 */
export interface SpawnEvaluator {
	evaluate(
		state: unknown,
		questions: Record<string, SpawnQuestion>,
		timeoutMs?: number,
	): Promise<Record<string, Answer>>;
}

function defaultEvaluator(): SpawnEvaluator | null {
	return resolveProvider() as unknown as SpawnEvaluator | null;
}

export type SpawnSeat =
	| "builder_flash"
	| "planner_glm"
	| "verifier_gemini"
	| "frontier"
	| "fast_cerebras";

export const NAMED_SEATS: readonly SpawnSeat[] = [
	"builder_flash",
	"planner_glm",
	"verifier_gemini",
	"frontier",
	"fast_cerebras",
];

export interface SeatPin {
	model: string;
	provider: string;
	reasoning: string;
}

/**
 * Pinned seat → model + reasoning. The weekly model-fitness review and each
 * profile's config.yaml own the live pins; this table mirrors them and never
 * bumps model ids.
 */
export const SEAT_PINS: Record<SpawnSeat, SeatPin> = {
	builder_flash: {
		model: "deepseek/deepseek-v4.1-flash",
		provider: "openrouter",
		reasoning: "max",
	},
	planner_glm: { model: "z-ai/glm-5.3", provider: "openrouter", reasoning: "high" },
	verifier_gemini: {
		model: "google/gemini-3.8-flash",
		provider: "openrouter",
		reasoning: "high",
	},
	frontier: { model: "grok-4.6", provider: "xai-oauth", reasoning: "xhigh" },
	fast_cerebras: { model: "qwen-3.8-27b", provider: "cerebras", reasoning: "high" },
};

/** Seat used whenever the call fails or no seat is trusted. */
export const FAIL_OPEN_SEAT: SpawnSeat = "builder_flash";
/** Jev's seat is trusted at or above this confidence. */
export const TRUST_CONFIDENCE = 0.85;
/** Below this seat confidence a security review escalates to frontier. */
export const UNCERTAIN_CONFIDENCE = 0.7;
/** needs_human at or above this blocks the card in a live path. */
export const HUMAN_BLOCK_THRESHOLD = 0.75;
/** Default call timeout; decision 4 fails open on timeout. */
export const SPAWN_TIMEOUT_MS = 8000;

type Choice = { choice: string; confidence: number };

function choiceOf(answers: Record<string, Answer> | null | undefined, name: string): Choice {
	const raw = answers?.[name];
	if (!raw || raw.type !== "choice") return { choice: "none_of_these", confidence: 0 };
	return { choice: raw.choice, confidence: raw.confidence };
}

function noulOf(answers: Record<string, Answer> | null | undefined, name: string): number {
	const raw = answers?.[name];
	if (!raw || raw.type !== "noul") return 0;
	return raw.probability;
}

function scoreOf(answers: Record<string, Answer> | null | undefined, name: string): number {
	const raw = answers?.[name];
	if (!raw || raw.type !== "score") return 0;
	return raw.score;
}

function isNamedSeat(name: string): name is SpawnSeat {
	return (NAMED_SEATS as readonly string[]).includes(name);
}

export interface SeatDecision {
	/** Seat the code selects (always a named seat; never none_of_these). */
	seat: SpawnSeat;
	/** Why the code chose that seat, in one line. */
	reason: string;
	/** Live paths would block the card needs_input and not spawn. */
	blockForHuman: boolean;
	needsHuman: number;
	jevSeat: string;
	jevSeatConfidence: number;
	jobKind: string;
	jobConfidence: number;
	reviewDepth: string;
	walkType: string;
	needsVision: number;
	difficulty: number;
	stakes: number;
	/** Jev's seat equals the code seat (false when the code overrode). */
	agree: boolean;
}

/**
 * Code owns arithmetic and policy; Jev answers are inputs. Implements
 * decision 5 exactly: trust the seat at >= 0.85, allow frontier only for a
 * trusted pick or an uncertain security review, and fail open otherwise.
 */
export function mapSeat(answers: Record<string, Answer> | null | undefined): SeatDecision {
	const jevSeat = choiceOf(answers, "seat");
	const job = choiceOf(answers, "job_kind");
	const depth = choiceOf(answers, "review_depth");
	const walk = choiceOf(answers, "walk_type");
	const human = noulOf(answers, "needs_human");
	const vision = noulOf(answers, "needs_vision");
	const difficulty = scoreOf(answers, "difficulty");
	const stakes = scoreOf(answers, "stakes");

	let seat: SpawnSeat;
	let reason: string;

	if (answers && isNamedSeat(jevSeat.choice) && jevSeat.confidence >= TRUST_CONFIDENCE) {
		seat = jevSeat.choice;
		reason = `jev seat ${seat} at confidence ${jevSeat.confidence.toFixed(2)} (>= ${TRUST_CONFIDENCE})`;
	} else if (
		job.choice === "review" &&
		depth.choice === "security" &&
		jevSeat.confidence < UNCERTAIN_CONFIDENCE
	) {
		seat = "frontier";
		reason = `security review with uncertain seat (${jevSeat.confidence.toFixed(2)} < ${UNCERTAIN_CONFIDENCE})`;
	} else {
		seat = FAIL_OPEN_SEAT;
		reason = answers
			? `fail open: no trusted seat (${jevSeat.choice} at ${jevSeat.confidence.toFixed(2)})`
			: "fail open: no answers";
	}

	// Decision 4: never Cerebras for docs/intake/roam. Factory job kinds only
	// name docs; intake and roam are not factory slots.
	if (seat === "fast_cerebras" && job.choice === "docs") {
		seat = FAIL_OPEN_SEAT;
		reason += "; policy: never cerebras for docs";
	}

	return {
		seat,
		reason,
		blockForHuman: human >= HUMAN_BLOCK_THRESHOLD,
		needsHuman: human,
		jevSeat: jevSeat.choice,
		jevSeatConfidence: jevSeat.confidence,
		jobKind: job.choice,
		jobConfidence: job.confidence,
		reviewDepth: depth.choice,
		walkType: walk.choice,
		needsVision: vision,
		difficulty,
		stakes,
		agree: jevSeat.choice === seat,
	};
}

export interface SpawnPickInput {
	/** Stable spawn id (the factory idempotency key when one exists). */
	id: string;
	/** Structured Decisions state: dispatch, work, fleet, ask. */
	state: unknown;
	/** What the card would have used anyway (lane pin), for the log. */
	wouldHaveUsed?: string | null;
	timeoutMs?: number;
}

/**
 * One pick record, field names matching the factory JSONL log (snake_case).
 */
export interface SpawnPick {
	id: string;
	when: string;
	elapsed_ms: number;
	error: string | null;
	jev_model: string;
	jev_endpoint: string;
	jev_seat: string;
	jev_seat_confidence: number;
	code_seat: SpawnSeat;
	code_model: string;
	code_provider: string;
	code_reasoning: string;
	code_reason: string;
	agree: boolean;
	block_for_human: boolean;
	needs_human: number;
	needs_vision: number;
	job_kind: string;
	job_confidence: number;
	review_depth: string;
	walk_type: string;
	difficulty: number;
	stakes: number;
	would_have_used: string | null;
	answers: Record<string, Answer> | null;
}

export interface PickOptions {
	provider?: SpawnEvaluator | null;
	now?: () => number;
}

/**
 * Call Jev once and map the answer to a seat. Never throws: a missing key,
 * provider error, or timeout records `error` and fails open to
 * builder_flash.
 */
export async function pickSeat(
	input: SpawnPickInput,
	options: PickOptions = {},
): Promise<SpawnPick> {
	const now = options.now ?? Date.now;
	const started = now();
	let answers: Record<string, Answer> | null = null;
	let error: string | null = null;

	const provider = options.provider !== undefined ? options.provider : defaultEvaluator();
	if (!provider) {
		error = "no provider: OPENROUTER_API_KEY missing";
	} else {
		try {
			answers = await provider.evaluate(
				input.state,
				SPAWN_QUESTIONS,
				input.timeoutMs ?? SPAWN_TIMEOUT_MS,
			);
		} catch (err) {
			error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
		}
	}

	const decision = mapSeat(answers);
	const pin = SEAT_PINS[decision.seat];
	return {
		id: input.id,
		when: new Date().toISOString(),
		elapsed_ms: Math.max(0, Math.round(now() - started)),
		error,
		jev_model: JEV_MODEL,
		jev_endpoint: JEV_ENDPOINT,
		jev_seat: decision.jevSeat,
		jev_seat_confidence: decision.jevSeatConfidence,
		code_seat: decision.seat,
		code_model: pin.model,
		code_provider: pin.provider,
		code_reasoning: pin.reasoning,
		code_reason: decision.reason,
		agree: decision.agree,
		block_for_human: decision.blockForHuman,
		needs_human: decision.needsHuman,
		needs_vision: decision.needsVision,
		job_kind: decision.jobKind,
		job_confidence: decision.jobConfidence,
		review_depth: decision.reviewDepth,
		walk_type: decision.walkType,
		difficulty: decision.difficulty,
		stakes: decision.stakes,
		would_have_used: input.wouldHaveUsed ?? null,
		answers,
	};
}

const USAGE = `usage: bun spawn-router.ts --packet <path|->

Reads one spawn packet JSON ({id, dispatch, work, fleet?, ask?,
would_have_used?, timeout_ms?}) and prints one pick record as JSON. Exits 0
even when the Jev call fails: the picker fails open to builder_flash.`;

async function main(): Promise<number> {
	const args = process.argv.slice(2);
	let packetPath: string | undefined;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--packet") packetPath = args[++i];
		else if (args[i] === "--help" || args[i] === "-h") {
			console.log(USAGE);
			return 0;
		}
	}
	if (!packetPath) {
		console.error(USAGE);
		return 2;
	}
	let raw: string;
	try {
		raw = packetPath === "-" ? await Bun.stdin.text() : await Bun.file(packetPath).text();
	} catch (err) {
		console.error(`spawn-router: cannot read packet: ${err}`);
		return 2;
	}
	let packet: Record<string, unknown>;
	try {
		packet = JSON.parse(raw) as Record<string, unknown>;
	} catch (err) {
		console.error(`spawn-router: packet is not JSON: ${err}`);
		return 2;
	}
	const state = {
		dispatch: packet.dispatch ?? {},
		work: packet.work ?? {},
		fleet: packet.fleet ?? null,
		ask: packet.ask ?? packet.plain ?? "",
	};
	const pick = await pickSeat({
		id: String(packet.id ?? "packet"),
		state,
		wouldHaveUsed: typeof packet.would_have_used === "string" ? packet.would_have_used : null,
		timeoutMs: typeof packet.timeout_ms === "number" ? packet.timeout_ms : undefined,
	});
	console.log(JSON.stringify(pick, null, 2));
	return 0;
}

if (import.meta.main) {
	process.exit(await main());
}
