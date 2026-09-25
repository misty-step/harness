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

describe("US-029 provider usage preservation", () => {
	async function usageFrom(usage: unknown) {
		const original = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					model: "typesafe/jev-1.13-20260917",
					answers: { continuation: { type: "noul", noul: 0.9 } },
					usage,
				}),
				{ status: 200 },
			)) as unknown as typeof fetch;
		try {
			const evaluation = await new OpenRouterJevProvider("test-key").evaluateWithMetadata("state", {
				continuation: { type: "noul", instructions: "test" },
			});
			return evaluation.usage;
		} finally {
			globalThis.fetch = original;
		}
	}

	test("reports provider-billed tokens and cost exactly", async () => {
		expect(await usageFrom({ input_tokens: 365, output_tokens: 58, cost: 0.00001533 })).toEqual({
			inputTokens: 365,
			outputTokens: 58,
			costUsd: 0.00001533,
		});
	});

	test("omits malformed or missing usage instead of reporting zero cost", async () => {
		expect(await usageFrom(undefined)).toBeUndefined();
		expect(await usageFrom({ input_tokens: "365", output_tokens: 58, cost: 0.1 })).toBeUndefined();
		expect(await usageFrom({ input_tokens: 365, output_tokens: 58, cost: "free" })).toEqual({
			inputTokens: 365,
			outputTokens: 58,
		});
	});
});

describe("provider failure classification", () => {
	test("OpenRouter reports a JSON null body as a typed malformed response", async () => {
		const original = globalThis.fetch;
		globalThis.fetch = (async () => new Response("null", { status: 200 })) as unknown as typeof fetch;
		try {
			await expect(
				new OpenRouterJevProvider("test-key").evaluate("state", { continuation: CHOICE_QUESTION }),
			).rejects.toMatchObject({ name: "SystemOneProviderError", kind: "malformed_response" });
		} finally {
			globalThis.fetch = original;
		}
	});

	test("OpenRouter reports a null answer entry as a typed malformed response", async () => {
		const original = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					model: "typesafe/jev-1.13-20260917",
					answers: { continuation: null },
				}),
				{ status: 200 },
			)) as unknown as typeof fetch;
		try {
			await expect(
				new OpenRouterJevProvider("test-key").evaluate("state", { continuation: CHOICE_QUESTION }),
			).rejects.toMatchObject({ name: "SystemOneProviderError", kind: "malformed_response" });
		} finally {
			globalThis.fetch = original;
		}
	});

	test("OpenRouter reports an HTTP quota response as typed quota unavailability", async () => {
		const original = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ error: { message: "daily key limit reached" } }), {
				status: 429,
			})) as unknown as typeof fetch;
		try {
			await expect(
				new OpenRouterJevProvider("test-key").evaluate("state", { continuation: CHOICE_QUESTION }),
			).rejects.toMatchObject({ name: "SystemOneProviderError", kind: "quota", status: 429 });
		} finally {
			globalThis.fetch = original;
		}
	});

	test("OpenRouter reports an aborted request as typed timeout unavailability", async () => {
		const original = globalThis.fetch;
		globalThis.fetch = (async () => {
			const error = new Error("aborted");
			error.name = "AbortError";
			throw error;
		}) as unknown as typeof fetch;
		try {
			await expect(
				new OpenRouterJevProvider("test-key").evaluate("state", { continuation: CHOICE_QUESTION }),
			).rejects.toMatchObject({ name: "SystemOneProviderError", kind: "timeout" });
		} finally {
			globalThis.fetch = original;
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

	test("keeps all eight unvalidated non-security findings advisory at high confidence", () => {
		const answers: Record<string, Answer> = {
			needless_abstraction: { type: "noul", probability: 0.9, confidence: 0.8 },
			incomplete_cutover: { type: "noul", probability: 0.86, confidence: 0.72 },
			preserves_root_cause: { type: "noul", probability: 0.9, confidence: 0.8 },
			fails_open: { type: "noul", probability: 0.9, confidence: 0.8 },
			test_asserts_implementation: { type: "noul", probability: 0.9, confidence: 0.8 },
			pokayoke_mechanism: {
				type: "choice",
				choice: "suppressed_symptom",
				probabilities: { suppressed_symptom: 0.9 },
				confidence: 0.9,
			},
			ousterhout_complexity: {
				type: "choice",
				choice: "complexity_spreading",
				probabilities: { complexity_spreading: 0.9 },
				confidence: 0.9,
			},
			torvalds_taste: { type: "score", score: 0.2, probabilities: { "0": 0.9 }, confidence: 0.9 },
		};
		const expected = new Map([
			["needless_abstraction", { category: "taste", probability: 0.9, confidence: 0.8 }],
			["incomplete_cutover", { category: "taste", probability: 0.86, confidence: 0.72 }],
			["preserves_root_cause", { category: "pokayoke", probability: 0.9, confidence: 0.8 }],
			["fails_open", { category: "pokayoke", probability: 0.9, confidence: 0.8 }],
			["test_asserts_implementation", { category: "verification", probability: 0.9, confidence: 0.8 }],
			["pokayoke_mechanism", { category: "pokayoke", probability: 1, confidence: 0.9 }],
			["ousterhout_complexity", { category: "taste", probability: 0.9, confidence: 0.9 }],
			["torvalds_taste", { category: "taste", probability: 0.9, confidence: 0.9 }],
		]);

		const findings = parseRuleFindings(answers);

		expect(expected.size).toBe(8);
		expect(findings.blocks).toHaveLength(0);
		expect(findings.warnings.map((finding) => finding.rule)).toEqual([...expected.keys()]);
		for (const finding of findings.warnings) {
			expect(finding).toMatchObject({ rule: finding.rule, severity: "warning", ...expected.get(finding.rule) });
			expect(finding.evidence.length).toBeGreaterThan(0);
		}
	});

	test("keeps high-confidence test padding visible without blocking", () => {
		const findings = parseRuleFindings({
			is_test_padding: { type: "noul", probability: 0.9, confidence: 0.8 },
		});
		expect(findings.blocks).toHaveLength(0);
		expect(findings.warnings).toEqual([{
			rule: "is_test_padding",
			category: "verification",
			severity: "warning",
			message: "Test padding detected (tautology or bare not-throw). Delete padding.",
			evidence: "Probability: 0.90, Confidence: 0.80",
			probability: 0.9,
			confidence: 0.8,
		}]);
	});

	test("keeps all four legacy security findings blocking", () => {
		const findings = parseRuleFindings({
			credential_leak: { type: "noul", probability: 0.76, confidence: 0.52 },
			disk_secret_persistence: { type: "noul", probability: 0.81, confidence: 0.62 },
			authority_escalation: { type: "noul", probability: 0.81, confidence: 0.62 },
			prompt_injection_risk: { type: "noul", probability: 0.81, confidence: 0.62 },
		});

		expect(findings.blocks.map((finding) => finding.rule)).toEqual([
			"credential_leak",
			"disk_secret_persistence",
			"authority_escalation",
			"prompt_injection_risk",
		]);
		expect(findings.blocks.every((finding) => finding.severity === "block")).toBe(true);
		expect(findings.warnings).toHaveLength(0);
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