import { describe, expect, test } from "bun:test";
import {
	evaluateDiff,
	HeuristicEngine,
	parseDiffStats,
	resolveProvider,
	TypeSafeJevProvider,
} from "./omp-diff-review.ts";

describe("Diff Review - Line Statistics Parser", () => {
	test("correctly tallies additions, deletions, and file counts", () => {
		const sampleDiff = `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
-const old = 1;
+const next = 2;
+const extra = 3;
diff --git a/src/utils.ts b/src/utils.ts
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -10,2 +10,1 @@
-console.log("drop");
`;
		const stats = parseDiffStats(sampleDiff);
		expect(stats.filesChanged).toBe(2);
		expect(stats.linesAdded).toBe(2);
		expect(stats.linesRemoved).toBe(2);
	});
});

describe("Diff Review - Rule Battery Violations", () => {
	const engine = new HeuristicEngine();

	test("passes clean, minimal diff with zero blocks", async () => {
		const cleanDiff = `diff --git a/src/math.ts b/src/math.ts
--- a/src/math.ts
+++ b/src/math.ts
@@ -5,2 +5,3 @@
 export function add(a: number, b: number): number {
+	// Core addition implementation
 	return a + b;
`;
		const verdict = await evaluateDiff(cleanDiff, { provider: engine });
		expect(verdict.passed).toBe(true);
		expect(verdict.clean).toBe(true);
		expect(verdict.blocks.length).toBe(0);
	});

	test("blocks diff with plaintext credential leak (assembled at runtime)", async () => {
		// Assembled at runtime to avoid scanner masking
		const fakeSecret = ["sk", "live", "51Abcdef1234567890abcdef123456"].join("_");
		const leakDiff = `diff --git a/src/client.ts b/src/client.ts
--- a/src/client.ts
+++ b/src/client.ts
@@ -1,2 +1,3 @@
+const STRIPE_SECRET = "${fakeSecret}";
`;
		const verdict = await evaluateDiff(leakDiff, { provider: engine });
		expect(verdict.passed).toBe(false);
		const leakBlock = verdict.blocks.find((b) => b.rule === "credential_leak");
		expect(leakBlock).toBeDefined();
		expect(leakBlock?.category).toBe("security");
	});

	test("blocks diff writing credentials to file on disk (rung 4 violation)", async () => {
		const diskDiff = `diff --git a/scripts/setup.ts b/scripts/setup.ts
--- a/scripts/setup.ts
+++ b/scripts/setup.ts
@@ -10,1 +10,2 @@
+fs.writeFileSync(".env", \`API_KEY=\${secret}\`);
`;
		const verdict = await evaluateDiff(diskDiff, { provider: engine });
		expect(verdict.passed).toBe(false);
		const diskBlock = verdict.blocks.find((b) => b.rule === "disk_secret_persistence");
		expect(diskBlock).toBeDefined();
	});

	test("blocks diff invoking unverified sudo escalation", async () => {
		const sudoDiff = `diff --git a/deploy.sh b/deploy.sh
--- a/deploy.sh
+++ b/deploy.sh
@@ -1,2 +1,2 @@
-run_user_setup
+sudo -S chmod 777 /etc/environment
`;
		const verdict = await evaluateDiff(sudoDiff, { provider: engine });
		expect(verdict.passed).toBe(false);
		expect(verdict.blocks.some((b) => b.rule === "authority_escalation")).toBe(true);
	});

	test("blocks needless abstraction class with single-caller delegation", async () => {
		const sprawlDiff = `diff --git a/src/service.ts b/src/service.ts
--- a/src/service.ts
+++ b/src/service.ts
@@ -1,5 +1,9 @@
+class StatusFormatterService {
+	format(s: string): string {
+		return Formatter.format(s);
+	}
+}
`;
		const verdict = await evaluateDiff(sprawlDiff, { provider: engine });
		expect(verdict.passed).toBe(false);
		expect(verdict.blocks.some((b) => b.rule === "needless_abstraction")).toBe(true);
	});

	test("blocks pokayoke violation when fix silences error instead of structural fix", async () => {
		const badFixDiff = `diff --git a/src/reader.ts b/src/reader.ts
--- a/src/reader.ts
+++ b/src/reader.ts
@@ -20,2 +20,4 @@
-const data = parse(input);
+try {
+	const data = parse(input);
+} catch (e) {
+}
`;
		const verdict = await evaluateDiff(badFixDiff, { provider: engine });
		expect(verdict.passed).toBe(false);
		expect(verdict.blocks.some((b) => b.rule === "pokayoke_mechanism" || b.rule === "preserves_root_cause")).toBe(true);
	});

	test("blocks test padding tautologies", async () => {
		const paddingDiff = `diff --git a/test/sanity.test.ts b/test/sanity.test.ts
--- a/test/sanity.test.ts
+++ b/test/sanity.test.ts
@@ -1,5 +1,8 @@
+test("sanity check", () => {
+	expect(execute()).not.toThrow();
+	expect(true).toBe(true);
+});
`;
		const verdict = await evaluateDiff(paddingDiff, { provider: engine });
		expect(verdict.passed).toBe(false);
		expect(verdict.blocks.some((b) => b.rule === "is_test_padding")).toBe(true);
	});
});

describe("Diff Review - Providers & Resolution", () => {
	test("resolveProvider returns null when uncredentialed (does not fabricate verdicts)", () => {
		const prevTypeSafe = process.env.TYPESAFE_API_KEY;
		delete process.env.TYPESAFE_API_KEY;

		const provider = resolveProvider();
		expect(provider).toBeNull();

		if (prevTypeSafe) process.env.TYPESAFE_API_KEY = prevTypeSafe;
	});

	test("evaluateDiff handles uncredentialed state gracefully without fabricating answers", async () => {
		const prevTypeSafe = process.env.TYPESAFE_API_KEY;
		delete process.env.TYPESAFE_API_KEY;

		const verdict = await evaluateDiff("+const x = 1;", { provider: null });
		expect(verdict.enabled).toBe(false);
		expect(verdict.passed).toBe(true);
		expect(verdict.blocks.length).toBe(0);
		expect(verdict.summary).toContain("Diff review disabled");

		if (prevTypeSafe) process.env.TYPESAFE_API_KEY = prevTypeSafe;
	});

	test("forced heuristic returns HeuristicEngine explicitly", () => {
		const provider = resolveProvider("heuristic");
		expect(provider).not.toBeNull();
		expect(provider?.name).toBe("heuristic");
	});

	test("instantiates TypeSafeJevProvider with endpoint and key", () => {
		const p = new TypeSafeJevProvider("mock-key", "https://api.typesafe.ai/v1/systemone");
		expect(p.name).toBe("typesafe");
	});

	test("parses recorded TypeSafe System One HTTP API response fixture correctly", async () => {
		const fixtureResponse = {
			model: "jev-latest",
			answers: {
				credential_leak: {
					type: "noul",
					noul: 0.98,
				},
				pokayoke_mechanism: {
					type: "choice",
					choice: "structural_type_or_shape",
					probabilities: {
						structural_type_or_shape: 0.92,
						suppressed_symptom: 0.04,
						warning_or_comment: 0.04,
					},
					confidence: 0.91,
				},
				accidental_churn: {
					type: "score",
					score: 0.15,
					legend: { "0": "surgical", "1": "minor_noise", "2": "moderate_churn", "3": "severe_sprawl" },
					probabilities: { "0": 0.88, "1": 0.10, "2": 0.02, "3": 0.00 },
					confidence: 0.89,
				},
			},
			usage: { input_tokens: 1420, output_tokens: 36 },
		};

		// Mock fetch returning the canonical fixture
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => ({
			ok: true,
			status: 200,
			json: async () => fixtureResponse,
			text: async () => JSON.stringify(fixtureResponse),
		})) as unknown as typeof fetch;

		try {
			const provider = new TypeSafeJevProvider("test-key");
			const answers = await provider.evaluate("+const x = 1;", {
				credential_leak: { type: "noul", instructions: "test" },
				pokayoke_mechanism: {
					type: "choice",
					instructions: "test",
					criteria: { structural_type_or_shape: null, suppressed_symptom: null, warning_or_comment: null },
				},
				accidental_churn: {
					type: "score",
					instructions: "test",
					criteria: ["surgical", "minor_noise", "moderate_churn", "severe_sprawl"],
				},
			});

			expect(answers.credential_leak.type).toBe("noul");
			if (answers.credential_leak.type === "noul") {
				expect(answers.credential_leak.probability).toBe(0.98);
			}

			expect(answers.pokayoke_mechanism.type).toBe("choice");
			if (answers.pokayoke_mechanism.type === "choice") {
				expect(answers.pokayoke_mechanism.choice).toBe("structural_type_or_shape");
				expect(answers.pokayoke_mechanism.confidence).toBe(0.91);
			}

			expect(answers.accidental_churn.type).toBe("score");
			if (answers.accidental_churn.type === "score") {
				expect(answers.accidental_churn.score).toBe(0.15);
				expect(answers.accidental_churn.confidence).toBe(0.89);
			}
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
