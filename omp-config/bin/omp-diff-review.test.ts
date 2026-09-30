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

	test("warns on needless abstraction class with single-caller delegation", async () => {
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
		expect(verdict.passed).toBe(true);
		expect(verdict.clean).toBe(false);
		expect(verdict.blocks).toHaveLength(0);
		expect(verdict.warnings.some((warning) => warning.rule === "needless_abstraction")).toBe(true);
	});

	test("warns on pokayoke violation when fix silences error instead of structural fix", async () => {
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
		expect(verdict.passed).toBe(true);
		expect(verdict.clean).toBe(false);
		expect(verdict.blocks).toHaveLength(0);
		expect(verdict.warnings.some((warning) => warning.rule === "pokayoke_mechanism")).toBe(true);
		expect(verdict.warnings.some((warning) => warning.rule === "preserves_root_cause")).toBe(true);
	});

	test("warns on test padding tautologies", async () => {
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
		expect(verdict.passed).toBe(true);
		expect(verdict.clean).toBe(false);
		expect(verdict.blocks).toHaveLength(0);
		expect(verdict.warnings.some((warning) => warning.rule === "is_test_padding")).toBe(true);
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
	test("generic OpenRouter credentials cannot fund Jev when the dedicated key is absent", () => {
		const previous = {
			typeSafe: process.env.TYPESAFE_API_KEY,
			dedicated: process.env.JEV_OPENROUTER_API_KEY,
			generic: process.env.OPENROUTER_API_KEY,
		};
		try {
			delete process.env.TYPESAFE_API_KEY;
			delete process.env.JEV_OPENROUTER_API_KEY;
			process.env.OPENROUTER_API_KEY = ["generic", "chat", "fixture"].join("-");
			expect(resolveProvider()).toBeNull();
		} finally {
			for (const [name, value] of [
				["TYPESAFE_API_KEY", previous.typeSafe],
				["JEV_OPENROUTER_API_KEY", previous.dedicated],
				["OPENROUTER_API_KEY", previous.generic],
			] as const) {
				if (value === undefined) delete process.env[name];
				else process.env[name] = value;
			}
		}
	});

	test("evaluateDiff handles uncredentialed state gracefully without fabricating answers", async () => {
		const verdict = await evaluateDiff("+const x = 1;", { provider: null });
		expect(verdict.enabled).toBe(false);
		expect(verdict.passed).toBe(true);
		expect(verdict.blocks.length).toBe(0);
		expect(verdict.summary).toContain("Diff review disabled");
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

	test("resolveProvider sends the dedicated Jev key, never the generic chat key", async () => {
		const previous = {
			typeSafe: process.env.TYPESAFE_API_KEY,
			dedicated: process.env.JEV_OPENROUTER_API_KEY,
			generic: process.env.OPENROUTER_API_KEY,
			fetch: globalThis.fetch,
		};
		try {
			delete process.env.TYPESAFE_API_KEY;
			process.env.JEV_OPENROUTER_API_KEY = ["dedicated", "jev", "fixture"].join("-");
			process.env.OPENROUTER_API_KEY = ["generic", "chat", "fixture"].join("-");
			globalThis.fetch = async (_input, init) => {
				expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${["dedicated", "jev", "fixture"].join("-")}`);
				return new Response(JSON.stringify({ model: "typesafe/jev-1.13", answers: {} }), { status: 200 });
			};
			const provider = resolveProvider();
			expect(provider).toBeInstanceOf(OpenRouterJevProvider);
			expect(await provider!.evaluate("test", {})).toEqual({});
		} finally {
			globalThis.fetch = previous.fetch;
			for (const [name, value] of [
				["TYPESAFE_API_KEY", previous.typeSafe],
				["JEV_OPENROUTER_API_KEY", previous.dedicated],
				["OPENROUTER_API_KEY", previous.generic],
			] as const) {
				if (value === undefined) delete process.env[name];
				else process.env[name] = value;
			}
		}
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

	test("evaluates every chunk with at most two Jev calls in flight", async () => {
		const diff = ["one", "two", "three", "four"]
			.map((name) => `diff --git a/src/${name}.ts b/src/${name}.ts
--- a/src/${name}.ts
+++ b/src/${name}.ts
@@ -0,0 +1 @@
+export const ${name} = true;
`)
			.join("");
		const release = Promise.withResolvers<void>();
		let active = 0;
		let peak = 0;
		let calls = 0;
		const provider = {
			name: "fixture" as const,
			async evaluate() {
				calls++;
				peak = Math.max(peak, ++active);
				await release.promise;
				active--;
				return {};
			},
		};
		const review = evaluateDiff(diff, { provider, chunkSize: 200 });
		await Promise.resolve();
		expect(calls).toBe(2);
		release.resolve();
		const verdict = await review;
		expect(calls).toBe(4);
		expect(peak).toBe(2);
		expect(verdict.summary).toContain("across 4 chunk(s)");
	});

	test("does not pass a diff when the Jev provider rejects a chunk", async () => {
		const provider = {
			name: "fixture" as const,
			async evaluate() {
				throw new Error("quota exceeded");
			},
		};
		const verdict = await evaluateDiff("+export const answer = 42;\n", { provider });
		expect(verdict.passed).toBe(false);
		expect(verdict.clean).toBe(false);
		expect(verdict.blocks).toHaveLength(0);
		expect(verdict.warnings.map((warning) => warning.rule)).toContain("provider_error");
		expect(verdict.summary).toContain("Review INCOMPLETE");
	});

	test("getGitDiff preserves file identity with mnemonic prefixes and untracked files", () => {
		const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
		const { tmpdir } = require("node:os");
		const { join } = require("node:path");
		const { spawnSync } = require("node:child_process");

		const tmp = mkdtempSync(join(tmpdir(), "harness-diff-untracked-"));
		try {
			spawnSync("git", ["init"], { cwd: tmp });
			spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: tmp });
			spawnSync("git", ["config", "user.name", "Test User"], { cwd: tmp });
			spawnSync("git", ["config", "diff.mnemonicPrefix", "true"], { cwd: tmp });

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
			expect(parseDiffStats(fullDiff).filesChanged).toBe(2);
			expect(splitDiffIntoFiles(fullDiff).map((file) => file.path)).toEqual(["tracked.txt", "untracked.txt"]);

			// 2. includeUntracked: false sees only tracked
			const trackedOnly = getGitDiff({ cwd: tmp, includeUntracked: false });
			expect(trackedOnly).toContain("tracked.txt");
			expect(trackedOnly).not.toContain("untracked.txt");
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});
});

describe("Diff Review - getGitDiff Range Forms", () => {
	const createRangeFixture = () => {
		const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
		const { tmpdir } = require("node:os");
		const { join } = require("node:path");
		const { spawnSync } = require("node:child_process");

		const root = mkdtempSync(join(tmpdir(), "harness-diff-range-"));
		const work = join(root, "work");
		mkdirSync(work);
		const origin = join(root, "origin.git");
		const run = (argv: string[]) => spawnSync("git", argv, { cwd: work, encoding: "utf8" });
		run(["init", "-q", "--bare", origin]);

		run(["init", "-q", "-b", "main"]);
		run(["config", "user.email", "test@example.com"]);
		run(["config", "user.name", "Test User"]);
		writeFileSync(join(work, "base.txt"), "base\n");
		run(["add", "."]);
		run(["commit", "-q", "-m", "base"]);
		run(["remote", "add", "origin", origin]);
		run(["push", "-q", "origin", "main"]);
		// A second remote branch reproduces the production trap: several remote
		// tips make `git diff <rev> --not --remotes` emit a combined diff.
		run(["push", "-q", "origin", "main:refs/heads/side"]);

		writeFileSync(join(work, "outgoing.txt"), "outgoing line 1\noutgoing line 2\n");
		run(["add", "."]);
		run(["commit", "-q", "-m", "outgoing"]);
		const head = run(["rev-parse", "HEAD"]).stdout.trim();
		run(["fetch", "-q", "origin"]);
		const originMain = run(["rev-parse", "--verify", "origin/main"]);
		if (originMain.status !== 0) {
			throw new Error(`fixture setup failed — origin/main missing: ${originMain.stderr}`);
		}
		const base = originMain.stdout.trim();

		return { root, work, base, head, run };
	};

	test("multi-token range yields standard per-commit patches, not a combined diff", () => {
		const { rmSync } = require("node:fs");
		const { root, work, head, run } = createRangeFixture();
		try {
			// Spread tokens are valid git argv (exit 0), but `git diff` over
			// several remote tips renders a combined diff the parsers cannot read.
			const combined = run(["diff", head, "--not", "--remotes"]);
			expect(combined.status).toBe(0);
			expect(combined.stdout.startsWith("diff --cc")).toBe(true);

			// The engine renders token arrays as standard per-commit patches.
			const logp = run(["log", "-p", head, "--not", "--remotes"]);
			expect(logp.status).toBe(0);
			const diff = getGitDiff({ cwd: work, range: [head, "--not", "--remotes"] });
			expect(diff).toBe(logp.stdout);
			expect(diff).toContain("diff --git a/outgoing.txt b/outgoing.txt");
			expect(diff).toContain("+outgoing line 1");
			expect(diff).not.toContain("--cc");
			expect(diff).not.toContain("base.txt");

			// Strings are never split: the joined form stays one bogus revision
			// (git exit 128, empty diff) — the pre-fix defect stays detectable.
			const joined = getGitDiff({ cwd: work, range: `${head} --not --remotes` });
			expect(joined).toBe("");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("single-token A..B range keeps working", () => {
		const { rmSync } = require("node:fs");
		const { root, work, base, head } = createRangeFixture();
		try {
			const diff = getGitDiff({ cwd: work, range: `${base}..${head}` });
			expect(diff).toContain("outgoing.txt");
			expect(diff).not.toContain("base.txt");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
