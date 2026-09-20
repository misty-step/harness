import { describe, expect, test } from "bun:test";
import type { Answer } from "./engine.ts";
import {
	FAIL_OPEN_SEAT,
	mapSeat,
	NAMED_SEATS,
	pickSeat,
	SEAT_PINS,
	type SpawnEvaluator,
	type SpawnQuestion,
} from "./spawn-router.ts";

const choice = (name: string, confidence = 0.9): Answer => ({
	type: "choice",
	choice: name,
	probabilities: { [name]: confidence },
	confidence,
});

const noul = (probability: number): Answer => ({
	type: "noul",
	probability,
	confidence: Math.abs(probability - 0.5) * 2,
});

const score = (value: number, confidence = 0.9): Answer => ({
	type: "score",
	score: value,
	probabilities: { [String(value)]: confidence },
	confidence,
});

/**
 * Choice answer with the confidence field omitted — legal on current main,
 * where engine.ts preserves a provider-omitted confidence as `undefined`
 * ("never fabricate") instead of fabricating a number.
 */
const choiceless = (name: string): Answer => ({
	type: "choice",
	choice: name,
	probabilities: { [name]: 1 },
});

const answers = (overrides: Record<string, Answer> = {}): Record<string, Answer> => ({
	seat: choice("builder_flash", 1.0),
	job_kind: choice("implement", 0.95),
	difficulty: score(1),
	stakes: score(1),
	review_depth: choice("standard", 0.9),
	walk_type: choice("cli_or_api", 0.9),
	needs_vision: noul(0.1),
	needs_human: noul(0.05),
	...overrides,
});

class FakeProvider implements SpawnEvaluator {
	calls = 0;
	lastState: unknown = null;
	constructor(private readonly result: Record<string, Answer> | Error) {}
	async evaluate(
		state: unknown,
		_questions: Record<string, SpawnQuestion>,
		_timeoutMs?: number,
	): Promise<Record<string, Answer>> {
		this.calls += 1;
		this.lastState = state;
		if (this.result instanceof Error) throw this.result;
		return this.result;
	}
}

describe("seat mapping (decision 5)", () => {
	test("trusts a named seat at confidence >= 0.85", () => {
		const decision = mapSeat(answers({ seat: choice("builder_flash", 0.96) }));
		expect(decision.seat).toBe("builder_flash");
		expect(decision.agree).toBe(true);
		expect(decision.jevSeatConfidence).toBeCloseTo(0.96, 3);
	});

	test("a confident verifier stays on a security review (no frontier overspend)", () => {
		const decision = mapSeat(
			answers({
				seat: choice("verifier_gemini", 0.93),
				job_kind: choice("review", 0.95),
				review_depth: choice("security", 0.9),
			}),
		);
		expect(decision.seat).toBe("verifier_gemini");
		expect(decision.agree).toBe(true);
	});

	test("an uncertain security-review seat escalates to frontier", () => {
		const decision = mapSeat(
			answers({
				seat: choice("verifier_gemini", 0.55),
				job_kind: choice("review", 0.95),
				review_depth: choice("security", 0.9),
			}),
		);
		expect(decision.seat).toBe("frontier");
		expect(decision.agree).toBe(false);
		expect(decision.reason).toContain("uncertain");
	});

	test("difficulty and stakes alone never promote to frontier", () => {
		const decision = mapSeat(
			answers({
				seat: choice("builder_flash", 0.9),
				job_kind: choice("implement", 0.95),
				difficulty: score(2),
				stakes: score(2),
			}),
		);
		expect(decision.seat).toBe("builder_flash");
		expect(decision.agree).toBe(true);
	});

	test("fails open to builder_flash on low seat confidence", () => {
		const decision = mapSeat(answers({ seat: choice("frontier", 0.5) }));
		expect(decision.seat).toBe(FAIL_OPEN_SEAT);
		expect(decision.reason).toContain("fail open");
	});

	test("fails open with no answers at all", () => {
		const decision = mapSeat(null);
		expect(decision.seat).toBe(FAIL_OPEN_SEAT);
		expect(decision.reason).toContain("no answers");
		expect(decision.blockForHuman).toBe(false);
	});

	test("never picks fast_cerebras for docs", () => {
		const decision = mapSeat(
			answers({ seat: choice("fast_cerebras", 0.95), job_kind: choice("docs", 0.95) }),
		);
		expect(decision.seat).toBe("builder_flash");
		expect(decision.reason).toContain("never cerebras");
	});

	test("fast_cerebras is still trusted for implementation", () => {
		const decision = mapSeat(
			answers({ seat: choice("fast_cerebras", 0.95), job_kind: choice("implement", 0.95) }),
		);
		expect(decision.seat).toBe("fast_cerebras");
	});

	test("needs_human at 0.75 blocks a live spawn; below it does not", () => {
		expect(mapSeat(answers({ needs_human: noul(0.8) })).blockForHuman).toBe(true);
		expect(mapSeat(answers({ needs_human: noul(0.74) })).blockForHuman).toBe(false);
	});
});

describe("confidence-less answers (current-main Answer.confidence is optional)", () => {
	test("mapSeat fails open on a confidence-less seat answer instead of throwing", () => {
		const decision = mapSeat(answers({ seat: choiceless("builder_flash") }));
		expect(decision.seat).toBe(FAIL_OPEN_SEAT);
		expect(decision.jevSeatConfidence).toBe(0);
		expect(decision.reason).toContain("fail open");
		expect(decision.reason).toContain("builder_flash");
		expect(decision.reason).toContain("0.00");
	});

	test("a non-finite seat confidence is untrusted, not an exception", () => {
		const decision = mapSeat(
			answers({
				seat: { type: "choice", choice: "planner_glm", probabilities: {}, confidence: Number.NaN },
			}),
		);
		expect(decision.seat).toBe(FAIL_OPEN_SEAT);
		expect(decision.jevSeatConfidence).toBe(0);
		expect(decision.reason).toContain("fail open");
	});

	test("a confidence-less security-review seat stays policy-consistent (frontier)", () => {
		const decision = mapSeat(
			answers({
				seat: choiceless("verifier_gemini"),
				job_kind: choice("review", 0.95),
				review_depth: choice("security", 0.9),
			}),
		);
		expect(decision.seat).toBe("frontier");
		expect(decision.jevSeatConfidence).toBe(0);
		expect(decision.reason).toContain("uncertain");
	});

	test("pickSeat keeps its never-throws contract on confidence-less answers", async () => {
		const provider = new FakeProvider(answers({ seat: choiceless("verifier_gemini") }));
		const pick = await pickSeat({ id: "confidenceless", state: {} }, { provider });
		expect(pick.code_seat).toBe(FAIL_OPEN_SEAT);
		expect(pick.error).toBeNull();
		expect(pick.jev_seat_confidence).toBe(0);
		expect(pick.answers).not.toBeNull();
	});
});

describe("seat pins", () => {
	test("every named seat has a complete pin and frontier is Grok 4.6 xhigh", () => {
		for (const seat of NAMED_SEATS) {
			const pin = SEAT_PINS[seat];
			expect(pin.model.length).toBeGreaterThan(0);
			expect(pin.provider.length).toBeGreaterThan(0);
			expect(pin.reasoning.length).toBeGreaterThan(0);
		}
		expect(SEAT_PINS.frontier.model).toBe("grok-4.6");
		expect(SEAT_PINS.frontier.reasoning).toBe("xhigh");
	});
});

describe("pickSeat", () => {
	test("passes the structured state through and returns the pinned seat", async () => {
		const provider = new FakeProvider(
			answers({ seat: choice("verifier_gemini", 0.9), job_kind: choice("review", 0.95) }),
		);
		const state = { dispatch: { slot: "review" }, work: { repo: "misty-step/linejam" } };
		const pick = await pickSeat({ id: "pr-review:misty-step/linejam:465", state }, { provider });
		expect(provider.calls).toBe(1);
		expect(provider.lastState).toEqual(state);
		expect(pick.code_seat).toBe("verifier_gemini");
		expect(pick.code_model).toBe("google/gemini-3.8-flash");
		expect(pick.error).toBeNull();
		expect(pick.elapsed_ms).toBeGreaterThanOrEqual(0);
	});

	test("a provider error fails open and records the error, never throws", async () => {
		const provider = new FakeProvider(new Error("boom"));
		const pick = await pickSeat({ id: "x", state: {} }, { provider });
		expect(pick.code_seat).toBe(FAIL_OPEN_SEAT);
		expect(pick.error).toContain("boom");
	});

	test("a missing provider (no key) fails open without calling out", async () => {
		const pick = await pickSeat({ id: "x", state: {} }, { provider: null });
		expect(pick.code_seat).toBe(FAIL_OPEN_SEAT);
		expect(pick.error).toContain("OPENROUTER_API_KEY");
		expect(pick.answers).toBeNull();
	});
});
