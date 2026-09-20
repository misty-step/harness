/**
 * engine.test.ts — provider answer-shape contracts for the shared System One
 * engine (the US-010.4 boundary).
 *
 * Locks the confidence-preservation rule: a Decisions API answer that omits
 * `confidence` (or carries a non-finite value) must stay missing, never
 * become a fabricated default. `decideNudge` rejects missing confidence, and
 * `parseRuleFindings` demotes it to a warning so a malformed answer can never
 * gate the diff-review consumer.
 */
import { describe, expect, test } from "bun:test";
import {
	OpenRouterJevProvider,
	TypeSafeJevProvider,
	parseRuleFindings,
	type Answer,
	type Question,
	type SystemOneProvider,
} from "./engine.ts";

const CHOICE_QUESTION: Question = {
	type: "choice",
	instructions: "test",
	criteria: { nudge: null, no_nudge: null },
};

const SCORE_QUESTION: Question = {
	type: "score",
	instructions: "test",
	criteria: ["surgical", "sprawl"],
};

function payload(answers: Record<string, unknown>): unknown {
	return { model: "typesafe/jev-1.13", answers };
}

async function evaluateWithStubbedFetch(
	provider: SystemOneProvider,
	answers: Record<string, unknown>,
	questions: Record<string, Question> = { continuation: CHOICE_QUESTION },
): Promise<Record<string, Answer>> {
	const original = globalThis.fetch;
	globalThis.fetch = (async () =>
		new Response(JSON.stringify(payload(answers)), {
			status: 200,
			headers: { "content-type": "application/json" },
		})) as unknown as typeof fetch;
	try {
		return await provider.evaluate("state", questions);
	} finally {
		globalThis.fetch = original;
	}
}

describe("provider confidence preservation", () => {
	test("OpenRouter provider keeps a missing confidence missing", async () => {
		const answers = await evaluateWithStubbedFetch(new OpenRouterJevProvider("test-key"), {
			continuation: { type: "choice", choice: "nudge", probabilities: { nudge: 0.9 } },
		});
		expect(answers.continuation.type).toBe("choice");
		if (answers.continuation.type === "choice") {
			expect(answers.continuation.confidence).toBeUndefined();
		}
	});

	test("OpenRouter provider preserves a valid confidence exactly", async () => {
		const answers = await evaluateWithStubbedFetch(new OpenRouterJevProvider("test-key"), {
			continuation: { type: "choice", choice: "nudge", probabilities: { nudge: 0.9 }, confidence: 0.7 },
		});
		if (answers.continuation.type === "choice") {
			expect(answers.continuation.confidence).toBe(0.7);
		}
	});

	test("OpenRouter provider drops a non-numeric confidence instead of coercing it", async () => {
		const answers = await evaluateWithStubbedFetch(new OpenRouterJevProvider("test-key"), {
			continuation: { type: "choice", choice: "nudge", probabilities: { nudge: 0.9 }, confidence: "high" },
		});
		if (answers.continuation.type === "choice") {
			expect(answers.continuation.confidence).toBeUndefined();
		}
	});

	test("TypeSafe provider keeps a missing confidence missing", async () => {
		const answers = await evaluateWithStubbedFetch(
			new TypeSafeJevProvider("test-key"),
			{ continuation: { type: "score", score: 2, probabilities: { "2": 0.8 } } },
			{ continuation: SCORE_QUESTION },
		);
		expect(answers.continuation.type).toBe("score");
		if (answers.continuation.type === "score") {
			expect(answers.continuation.confidence).toBeUndefined();
		}
	});
});

describe("parseRuleFindings confidence policy", () => {
	test("a choice answer with missing confidence demotes to a warning, never a block", () => {
		const findings = parseRuleFindings({
			pokayoke_mechanism: { type: "choice", choice: "suppressed_symptom", probabilities: { suppressed_symptom: 1 } },
		});
		expect(findings.blocks).toHaveLength(0);
		expect(findings.warnings).toHaveLength(1);
		expect(findings.warnings[0].confidence).toBe(0);
	});

	test("a choice answer with high confidence still blocks", () => {
		const findings = parseRuleFindings({
			pokayoke_mechanism: {
				type: "choice",
				choice: "suppressed_symptom",
				probabilities: { suppressed_symptom: 1 },
				confidence: 0.9,
			},
		});
		expect(findings.blocks).toHaveLength(1);
	});

	test("a score answer with missing confidence demotes to a warning", () => {
		const findings = parseRuleFindings({
			torvalds_taste: { type: "score", score: 0.2, probabilities: {} },
		});
		expect(findings.blocks).toHaveLength(0);
		expect(findings.warnings).toHaveLength(1);
		expect(findings.warnings[0].confidence).toBe(0);
	});
});