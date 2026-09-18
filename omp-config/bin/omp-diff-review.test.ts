import { describe, expect, test } from "bun:test";
import {
	evaluateDiff,
	getGitDiff,
	HeuristicEngine,
	parseDiffStats,
	resolveProvider,
	TypeSafeJevProvider,
	OpenRouterJevProvider,
	splitDiffIntoFiles,
	bundleDiffChunks,
	routeBatteryForChunk,
	generateStructuralMap,
	HARNESS_BATTERY,
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
		test("warns on Hickey complecting, erasure, and small_app strategy findings", async () => {
			const strategyDiff = `diff --git a/src/core.ts b/src/core.ts
--- a/src/core.ts
+++ b/src/core.ts
@@ -1,3 +1,6 @@
+// complect: braided_state across domains
+// deletable_feature with speculative_flag
+// kernel_framework instead of focused tool
`;
			const verdict = await evaluateDiff(strategyDiff, { provider: engine, batteryName: "strategy" });
			expect(verdict.passed).toBe(true);
			expect(verdict.warnings.some((w) => w.rule === "hickey_complecting")).toBe(true);
			expect(verdict.warnings.some((w) => w.rule === "erasure")).toBe(true);
			expect(verdict.warnings.some((w) => w.rule === "small_app")).toBe(true);
		});
	});

describe("Diff Review - Providers & Resolution", () => {
	test("resolveProvider returns null when uncredentialed (does not fabricate verdicts)", () => {
		const prevTypeSafe = process.env.TYPESAFE_API_KEY;
		const prevOpenRouter = process.env.OPENROUTER_API_KEY;
		delete process.env.TYPESAFE_API_KEY;
		delete process.env.OPENROUTER_API_KEY;

		const provider = resolveProvider();
		expect(provider).toBeNull();

		if (prevTypeSafe) process.env.TYPESAFE_API_KEY = prevTypeSafe;
		if (prevOpenRouter) process.env.OPENROUTER_API_KEY = prevOpenRouter;
	});

	test("evaluateDiff handles uncredentialed state gracefully without fabricating answers", async () => {
		const prevTypeSafe = process.env.TYPESAFE_API_KEY;
		const prevOpenRouter = process.env.OPENROUTER_API_KEY;
		delete process.env.TYPESAFE_API_KEY;
		delete process.env.OPENROUTER_API_KEY;

		const verdict = await evaluateDiff("+const x = 1;", { provider: null });
		expect(verdict.enabled).toBe(false);
		expect(verdict.passed).toBe(true);
		expect(verdict.blocks.length).toBe(0);
		expect(verdict.summary).toContain("Diff review disabled");

		if (prevTypeSafe) process.env.TYPESAFE_API_KEY = prevTypeSafe;
		if (prevOpenRouter) process.env.OPENROUTER_API_KEY = prevOpenRouter;
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

	test("instantiates OpenRouterJevProvider with decisions endpoint and key", () => {
		const p = new OpenRouterJevProvider("mock-or-key", "typesafe/jev-1.13");
		expect(p.name).toBe("openrouter");
	});

	test("resolveProvider prioritizes OpenRouter when OPENROUTER_API_KEY is present", () => {
		const prevTypeSafe = process.env.TYPESAFE_API_KEY;
		const prevOpenRouter = process.env.OPENROUTER_API_KEY;
		delete process.env.TYPESAFE_API_KEY;
		process.env.OPENROUTER_API_KEY = "sk-or-test-key";

		const provider = resolveProvider();
		expect(provider).not.toBeNull();
		expect(provider?.name).toBe("openrouter");

		if (prevTypeSafe) process.env.TYPESAFE_API_KEY = prevTypeSafe;
		else delete process.env.TYPESAFE_API_KEY;
		if (prevOpenRouter) process.env.OPENROUTER_API_KEY = prevOpenRouter;
		else delete process.env.OPENROUTER_API_KEY;
	});

	test("parses recorded OpenRouter / TypeSafe System One response fixture correctly", async () => {
		const fixtureResponse = {
			model: "typesafe/jev-1.13",
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

		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => ({
			ok: true,
			status: 200,
			json: async () => fixtureResponse,
			text: async () => JSON.stringify(fixtureResponse),
		})) as unknown as typeof fetch;

		try {
			const provider = new OpenRouterJevProvider("test-key", "typesafe/jev-1.13");
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

describe("Diff Review - Semantic Chunking & Routing", () => {
	test("splitDiffIntoFiles splits unified diff into distinct files", () => {
		const sampleDiff = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,2 @@
+const a = 1;
diff --git a/src/b.ts b/src/b.ts
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,1 +1,2 @@
+const b = 2;
`;
		const files = splitDiffIntoFiles(sampleDiff);
		expect(files.length).toBe(2);
		expect(files[0].path).toBe("src/a.ts");
		expect(files[1].path).toBe("src/b.ts");
	});

	test("bundleDiffChunks bundles small files together under char limit", () => {
		const files = [
			{ path: "src/a.ts", diff: "diff A content", linesAdded: 1, linesRemoved: 0 },
			{ path: "src/b.ts", diff: "diff B content", linesAdded: 1, linesRemoved: 0 },
		];
		const chunks = bundleDiffChunks(files, 500);
		expect(chunks.length).toBe(1);
		expect(chunks[0].paths).toEqual(["src/a.ts", "src/b.ts"]);
	});

	test("routeBatteryForChunk omits code architecture rules on doc-only chunks", () => {
		const docBattery = routeBatteryForChunk(HARNESS_BATTERY, ["README.md", "docs/architecture.md"]);
		expect(docBattery.torvalds_taste).toBeUndefined();
		expect(docBattery.ousterhout_complexity).toBeUndefined();
		expect(docBattery.credential_leak).toBeDefined();
	});

	test("routeBatteryForChunk omits tests_missing rule on test-only chunks", () => {
		const testBattery = routeBatteryForChunk(HARNESS_BATTERY, [
			"src/math.test.ts",
			"tests/integration.test.ts",
		]);
		expect(testBattery.tests_missing).toBeUndefined();
		expect(testBattery.credential_leak).toBeDefined();
	});

	test("generateStructuralMap extracts symbols and stats concisely", () => {
		const sampleDiff = `diff --git a/src/math.ts b/src/math.ts
new file mode 100644
--- /dev/null
+++ b/src/math.ts
@@ -0,0 +1,5 @@
+export function add(a: number, b: number): number {
+	return a + b;
+}
+export const PI = 3.14159;
`;
		const map = generateStructuralMap(sampleDiff);
		expect(map).toContain("Structural Diff Map");
		expect(map).toContain("src/math.ts");
		expect(map).toContain("add");
	});

	test("evaluateDiff evaluates multi-chunk diffs in parallel without truncating", async () => {
		const engine = new HeuristicEngine();
		const multiFileDiff = `diff --git a/src/one.ts b/src/one.ts
--- a/src/one.ts
+++ b/src/one.ts
@@ -1,1 +1,2 @@
+export function one() { return 1; }
diff --git a/src/two.ts b/src/two.ts
--- a/src/two.ts
+++ b/src/two.ts
@@ -1,1 +1,2 @@
+export function two() { return 2; }
`;
		const verdict = await evaluateDiff(multiFileDiff, { provider: engine, chunkSize: 100 });
		expect(verdict.passed).toBe(true);
		expect(verdict.summary).toContain("across 4 chunk(s)");
	});

	test("getGitDiff includes untracked files by default and excludes them when disabled", () => {
		const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
		const { tmpdir } = require("node:os");
		const { join } = require("node:path");
		const { spawnSync } = require("node:child_process");

		const tmp = mkdtempSync(join(tmpdir(), "harness-diff-untracked-"));
		try {
			spawnSync("git", ["init"], { cwd: tmp });
			spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: tmp });
			spawnSync("git", ["config", "user.name", "Test User"], { cwd: tmp });

			writeFileSync(join(tmp, "tracked.txt"), "line 1\n");
			spawnSync("git", ["add", "tracked.txt"], { cwd: tmp });
			spawnSync("git", ["commit", "-m", "initial"], { cwd: tmp });

			writeFileSync(join(tmp, "tracked.txt"), "line 1\nline 2\n");
			writeFileSync(join(tmp, "untracked.txt"), "brand new untracked content\n");

			// 1. Default (includeUntracked: true) sees both
			const fullDiff = getGitDiff({ cwd: tmp });
			expect(fullDiff).toContain("tracked.txt");
			expect(fullDiff).toContain("line 2");
			expect(fullDiff).toContain("untracked.txt");
			expect(fullDiff).toContain("brand new untracked content");

			// 2. includeUntracked: false sees only tracked
			const trackedOnly = getGitDiff({ cwd: tmp, includeUntracked: false });
			expect(trackedOnly).toContain("tracked.txt");
			expect(trackedOnly).not.toContain("untracked.txt");
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});
});
