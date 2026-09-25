import { afterAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const script = join(import.meta.dir, "feature-map.ts");
const parent = join(homedir(), ".cache/tmp");
mkdirSync(parent, { recursive: true });
const scratch = mkdtempSync(join(parent, "feature-map-pilot-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function git(repo: string, ...args: string[]): void {
	const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
	if (result.status !== 0) throw new Error(result.stderr);
}
function put(repo: string, path: string, text: string): void {
	const file = join(repo, path);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, text);
}
function fixture(name: string, count = 3, extra = 0, entry = false, duplicate = false): string {
	const repo = join(scratch, name);
	mkdirSync(repo, { recursive: true });
	git(repo, "init", "-q");
	git(repo, "config", "user.name", "Fixture");
	git(repo, "config", "user.email", "fixture@example.test");
	const extraStories = Array.from({ length: extra }, (_, i) => `\n\n## US-${String(i + 5).padStart(3, "0")} Extra study\n\nStatement: When I review more items, I want another study option, so I learn.\n\nCriteria:\n1. WHEN I study, THE SYSTEM SHALL show another question.`);
	put(repo, "USER_STORIES.md", `# Stories\n\n## Capability: Capture\n\n## US-001 Capture an item\n\nStatement: When I find an item, I want to save it, so I can use it later.\n\nCriteria:\n1. WHEN I submit an item, THE SYSTEM SHALL save it.\n\n## US-002 Find an item\n\nStatement: When I need an item, I want to find it, so I can review it.\n\nCriteria:\n1. WHEN I search, THE SYSTEM SHALL return saved items.\n\n## Capability: Study\n\n## US-003 Study an item\n\nStatement: When I review, I want to study saved items, so I learn.\n\nCriteria:\n1. WHEN I study, THE SYSTEM SHALL offer questions.${extraStories.join("")}\n\n## US-004 Old flow (retired)\n\nRetired: use the new Study flow.\n`);
	if (duplicate) put(repo, "USER_STORIES.md", readFileSync(join(repo, "USER_STORIES.md"), "utf8") + "\n## Capability: Study\n\n## US-038 Revisit an item\n\nStatement: When I revisit, I want another study mode, so I learn.\n\nCriteria:\n1. WHEN I revisit, THE SYSTEM SHALL offer the new mode.\n");
	for (let i = 0; i < count; i++) {
		put(repo, `src/area${i}/first.ts`, `export const first${i} = true;\n`);
		put(repo, `src/area${i}/second.ts`, `export const second${i} = true;\n`);
	}
	if (entry) put(repo, "src/entry/main.ts", "export function start() { return true; }\n");
	put(repo, "docs/irrelevant.ts", "export const notCode = true;\n");
	put(repo, "src/area0/first.test.ts", "throw Error('not source');\n");
	put(repo, "features/README.md", "# Features\n\n- [Capture](capture.md)\n- [Study](study.md)\n");
	put(repo, "features/capture.md", "# Capture\n\nStories: US-001, US-002\nSource: src/area0/**, src/area1/**\n");
	put(repo, "features/study.md", "# Study\n\nStories: US-003\nSource: src/area2/**\n");
	git(repo, "add", ".");
	git(repo, "commit", "-qm", "fixture");
	return repo;
}
async function cli(...args: string[]) {
	const child = spawn("bun", [script, ...args], { env: { ...process.env, OPENROUTER_API_KEY: "" } });
	const stdout: Buffer[] = [], stderr: Buffer[] = [];
	child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
	child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
	const status = await new Promise<number | null>((resolve) => child.once("close", resolve));
	return { status, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

describe("feature-map CLI", () => {
	test("batches every live story/area Noul within the documented context budget and composes thresholded source lines", async () => {
		const repo = fixture("batch", 3, 33, true, true);
		const batches: Record<string, { type: string; instructions: string }>[] = [];
		const server = Bun.serve({ port: 0, async fetch(request) {
			const raw = await request.text();
			expect(raw.length).toBeLessThanOrEqual(48_000);
			const body = JSON.parse(raw) as { model: string; questions: Record<string, { type: string; instructions: string }> };
			batches.push(body.questions);
			expect(body.model).toBe("typesafe/jev-1.13");
			expect(Object.keys(body.questions).length).toBeLessThanOrEqual(32);
			const answers = Object.fromEntries(Object.entries(body.questions).map(([id, question]) => {
				const relevant = /area0\b/.test(question.instructions) && /US-001|US-002/.test(question.instructions) || /area2\b/.test(question.instructions) && /US-003|US-038/.test(question.instructions);
				return [id, { type: "noul", noul: relevant ? 0.20 : 0.19 }];
			}));
			return Response.json({ model: "jev-1.13.0", answers });
		} });
		try {
			const out = join(scratch, "batched-draft");
			const result = await cli("draft", "--repo", repo, "--out", out, "--endpoint", `http://127.0.0.1:${server.port}`, "--json");
			expect(result.status).toBe(0);
			expect(JSON.parse(result.stdout)).toMatchObject({ question_count: 185, call_count: 10, threshold: 0.20, features: 3 });
			expect(batches.map((batch) => Object.keys(batch).length)).toEqual([32, 5, 32, 5, 32, 5, 32, 5, 32, 5]);
			const draft = JSON.parse(readFileSync(join(out, "draft.json"), "utf8"));
			expect(draft.answers).toHaveLength(185);
			expect(draft.calls.every((call: { latency_ms: number }) => call.latency_ms >= 0)).toBe(true);
			expect(draft.stories.map((story: { id: string }) => story.id)).toEqual(["US-001", "US-002", "US-003", ...Array.from({ length: 33 }, (_, i) => `US-${String(i + 5).padStart(3, "0")}`), "US-038"]);
			expect(batches[0]["q0"].instructions).toContain("WHEN I submit an item");
			expect(draft.areas.map((area: { path: string }) => area.path)).not.toContain("docs");
			expect(draft.areas.map((area: { path: string }) => area.path)).toContain("src/entry/main.ts");
			expect(readFileSync(join(out, "capture.md"), "utf8")).toContain("Source: src/area0/**");
			expect(readFileSync(join(out, "study.md"), "utf8")).toContain("Source: src/area2/**");
			expect(readFileSync(join(out, "study-2.md"), "utf8")).toContain("Stories: US-038\nSource: src/area2/**");
			expect(readFileSync(join(out, "capture.md"), "utf8")).not.toContain("src/area1/**");
			expect(readFileSync(join(out, "capture.md"), "utf8")).toContain("## Gotchas\n\n(draft: fill from the product)");
		} finally { server.stop(true); }
	});

	test("does not call a remote provider or write a draft without a key or explicit endpoint", async () => {
		const repo = fixture("missing-key");
		const result = await cli("draft", "--repo", repo, "--out", join(scratch, "no-key"));
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("OPENROUTER_API_KEY is missing");
		expect(result.stderr).toContain("pass-env");
		expect(existsSync(join(scratch, "no-key"))).toBe(false);
		expect(readFileSync(join(repo, "features/capture.md"), "utf8")).toContain("Source: src/area0/**");
	});

	test("normalizes glob-covered code files to areas and computes micro precision/recall plus co-membership agreement", async () => {
		const repo = fixture("compare");
		const draft = join(scratch, "compare-draft");
		put(draft, "README.md", "# Index\n\n- [First](first.md)\n- [Second](second.md)\n");
		put(draft, "first.md", "# First\n\nStories: US-001, US-003\nSource: src/area0/*.ts, src/area2/**\n");
		put(draft, "second.md", "# Second\n\nStories: US-002\nSource: src/area0/**\n");
		const result = await cli("compare", "--repo", repo, "--draft", draft, "--json");
		expect(result.status).toBe(0);
		const report = JSON.parse(result.stdout);
		expect(report.stories.map((row: { precision: number; recall: number; grouping: { agreement: number } }) => [row.precision, row.recall, row.grouping.agreement])).toEqual([[0.5, 0.5, 0], [1, 0.5, 0.5], [0.5, 1, 0.5]]);
		expect(report.overall).toMatchObject({ true_positives: 3, draft_areas: 5, reference_areas: 5, precision: 0.6, recall: 0.6, grouping_agreement: 1 / 3 });
	});
});
