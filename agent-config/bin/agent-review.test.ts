import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash, createVerify, generateKeyPairSync } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseVerdict, passes } from "./agent-review.ts";

const script = join(import.meta.dir, "agent-review.ts");
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "agent-review-"));
const runtime = join(dir, "runtime");
mkdirSync(runtime);
// Independent native-protocol fixtures: the process never derives its reported identity from argv.
const omp = join(dir, "omp");
writeFileSync(omp, `#!/usr/bin/env bun
await Bun.stdin.text();
if ((await Bun.file(${JSON.stringify(join(dir, "stall.txt"))}).text()).trim() === "yes") {
	Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("waiting") });
	await Promise.withResolvers().promise;
}
process.stdout.write(await Bun.file(${JSON.stringify(join(dir, "answer.txt"))}).text());
process.exit(Number(await Bun.file(${JSON.stringify(join(dir, "exit.txt"))}).text()));
`);
chmodSync(omp, 0o755);

type Pull = { state: string; title: string; body: string; user: { login: string }; head: { sha: string }; base: { ref: string; sha: string } };
let mergeBaseAfterModel: string | undefined;
let pull: Pull;
let headAfterModel: string | undefined;
let diff = "";
let calls: { method: string; path: string; body: unknown }[] = [];
let authorized = true;
let pullReads = 0;
let changeAfterModel: Partial<Pull> | undefined;
let diffAfterModel: string | undefined;
let labelCreateStatus = 201;
let labelAddStatus = 200;

const server = Bun.serve({
	port: 0,
	async fetch(request) {
		const url = new URL(request.url);
		const bearer = (request.headers.get("authorization") ?? "").replace("Bearer ", "");
		const body = request.method === "POST" ? await request.json() : undefined;
		calls.push({ method: request.method, path: url.pathname, body });
		if (url.pathname.endsWith("/installation") || url.pathname.endsWith("/access_tokens")) {
			// The app JWT must be a genuine RS256 signature by the configured key, backdated and short-lived.
			const [header, claims, signature] = bearer.split(".");
			const valid = createVerify("RSA-SHA256").update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature, "base64url"));
			const payload = JSON.parse(Buffer.from(claims, "base64url").toString());
			authorized = valid && payload.iss === "4978618" && payload.exp - payload.iat <= 600;
			if (!authorized) return new Response("bad jwt", { status: 401 });
			return Response.json(url.pathname.endsWith("/installation") ? { id: 99 } : { token: "install-token" });
		}
		if (bearer !== "install-token") return new Response("unauthorized", { status: 401 });
		if (url.pathname.endsWith("/pulls/7") && request.method === "GET") {
			// Reads before the model runs come first; anything after it sees what changed in the meantime.
			const after = pullReads >= 2;
			if (request.headers.get("accept")?.includes("diff")) return new Response(after && diffAfterModel !== undefined ? diffAfterModel : diff);
			pullReads++;
			return Response.json(pullReads >= 2 ? { ...pull, ...changeAfterModel, ...(headAfterModel ? { head: { sha: headAfterModel } } : {}) } : pull);
		}
		if (url.pathname.includes("/compare/")) return Response.json({ merge_base_commit: { sha: pullReads >= 2 && mergeBaseAfterModel ? mergeBaseAfterModel : "c".repeat(40) } });
		if (request.method === "POST" && url.pathname.endsWith("/demo/labels")) return new Response("{}", { status: labelCreateStatus });
		if (request.method === "POST" && url.pathname.endsWith("/issues/7/labels")) return new Response("{}", { status: labelAddStatus });
		if (request.method === "POST" || request.method === "DELETE") return Response.json({});
		return new Response("missing", { status: 404 });
	},
});
afterAll(() => { server.stop(true); rmSync(dir, { recursive: true, force: true }); });
afterEach(() => expect(readdirSync(runtime)).toEqual([]));

async function run(overrides: Record<string, string> = {}, slug = "misty-step/demo", args: string[] = []) {
	pullReads = 0;
	const env = { ...process.env };
	delete env.AGENT_REVIEW_MODEL;
	delete env.AGENT_REVIEW_THINKING;
	const child = Bun.spawn(["bun", script, "--repo", slug, "--pr", "7", ...args], {
		env: { ...env, TMPDIR: runtime, GITHUB_API_URL: server.url.origin, KAYLEE_GITHUB_APP_ID: "4978618", KAYLEE_GITHUB_APP_PEM: privateKey.export({ type: "pkcs8", format: "pem" }) as string, AGENT_REVIEW_OMP: omp, AGENT_REVIEW_AUTHOR_MODEL: "openai-codex/gpt-6.1-sol", AGENT_REVIEW_TIMEOUT_SECONDS: "20", ...overrides },
		stdout: "pipe", stderr: "pipe",
	});
	const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	return { status: child.exitCode, stdout, stderr };
}
const response = (verdict: unknown, selector = "anthropic/claude-sonnet-5-5", stopReason = "stop") => {
	const slash = selector.indexOf("/");
	return { type: "message_end", message: { role: "assistant", provider: selector.slice(0, slash), model: selector.slice(slash + 1), stopReason, content: [{ type: "text", text: typeof verdict === "string" ? verdict : JSON.stringify(verdict) }] } };
};
const events = (value: unknown[], exit = 0) => {
	writeFileSync(join(dir, "answer.txt"), value.map((event) => JSON.stringify(event)).join("\n"));
	writeFileSync(join(dir, "exit.txt"), String(exit));
};
const answer = (verdict: unknown, exit = 0, selector = "anthropic/claude-sonnet-5-5") => events([response(verdict, selector), { type: "agent_end", isTerminal: true }], exit);
const clean = { overall_correctness: "correct", explanation: "Small, tested, and consistent with the story.", findings: [{ title: "typo", body: "in a comment", priority: 3 }] };
const posted = (suffix: string) => calls.filter((call) => call.method !== "GET" && call.path.endsWith(suffix));
function reviewBody(): string {
	const value = posted("/reviews")[0]?.body;
	if (!value || typeof value !== "object" || !("body" in value) || typeof value.body !== "string") {
		throw new Error("no GitHub review body was posted");
	}
	return value.body;
}

beforeEach(() => {
	pull = { state: "open", title: "docs: note", body: "Stories: US-027", user: { login: "moomooskycow" }, head: { sha: "a".repeat(40) }, base: { ref: "master", sha: "9".repeat(40) } };
	mergeBaseAfterModel = undefined;
	headAfterModel = undefined;
	changeAfterModel = undefined;
	diffAfterModel = undefined;
	labelCreateStatus = 201;
	labelAddStatus = 200;
	diff = "diff --git a/README.md b/README.md\n+hello\n";
	calls = [];
	pullReads = 0;
	writeFileSync(join(dir, "stall.txt"), "no");
	answer(clean);
});

describe("agent-review verdicts", () => {
	test("only a correct verdict with nothing at priority 0 or 1 passes", () => {
		expect(passes(parseVerdict(JSON.stringify(clean)))).toBe(true);
		expect(passes(parseVerdict(JSON.stringify({ ...clean, findings: [{ title: "x", body: "y", priority: 1 }] })))).toBe(false);
		expect(passes(parseVerdict(JSON.stringify({ ...clean, findings: [{ title: "x", body: "y", priority: 0 }] })))).toBe(false);
		expect(passes(parseVerdict(JSON.stringify({ ...clean, overall_correctness: "incorrect" })))).toBe(false);
	});

	test("prose or a fence around the object is tolerated, but a wrong shape is rejected", () => {
		expect(parseVerdict(`Here you go:\n\`\`\`json\n${JSON.stringify(clean)}\n\`\`\``).overall_correctness).toBe("correct");
		for (const bad of ["approved!", "{}", JSON.stringify({ ...clean, overall_correctness: "mostly" }), JSON.stringify({ ...clean, findings: [{ title: "x", body: "y", priority: "high" }] }), JSON.stringify({ ...clean, findings: "none" }), JSON.stringify({ ...clean, explanation: " " })]) {
			expect(() => parseVerdict(bad)).toThrow();
		}
	});
});

describe("agent-review independence", () => {
	test("OpenAI authors get verified Sonnet high and Anthropic authors get verified Sol medium", async () => {
		const openai = await run();
		expect(openai.status).toBe(0);
		expect(reviewBody()).toContain("Reviewer: anthropic/claude-sonnet-5-5 (high)");
		calls = [];
		answer(clean, 0, "openai-codex/gpt-6.1-sol");
		const anthropic = await run({ AGENT_REVIEW_AUTHOR_MODEL: "anthropic/claude-opus-5-5" });
		expect(anthropic.status).toBe(0);
		expect(reviewBody()).toContain("Reviewer: openai-codex/gpt-6.1-sol (medium)");
	});

	test("an explicit author selector controls routing and records the caller's declaration", async () => {
		const result = await run({ AGENT_REVIEW_AUTHOR_MODEL: "anthropic/claude-opus-5-5" }, "misty-step/demo", ["--author-model", "openai-codex/gpt-6.1-sol:xhigh"]);
		expect(result.status).toBe(0);
		expect(reviewBody()).toContain("Reviewer: anthropic/claude-sonnet-5-5 (high)");
		expect(reviewBody().match(/^agent-review-declared-author-model: (.+)$/m)?.[1]).toBe("openai-codex/gpt-6.1-sol:xhigh");
	});

	test("missing or unknown author evidence refuses before any GitHub mutation", async () => {
		for (const author of ["", "gpt-6.1-sol", "unknown/model", "anthropic/not-a-model", "google-antigravity/gemini-3.8-flash"]) {
			calls = [];
			const result = await run({ AGENT_REVIEW_AUTHOR_MODEL: author });
			expect(result.status).toBe(3);
			expect(result.stderr).toMatch(/required|concrete|unknown model family|no review route/);
			expect(calls).toEqual([]);
		}
	});

	test("same-family and unclassifiable reviewer overrides never approve", async () => {
		for (const [author, reviewer, reason] of [
			["openai-codex/gpt-6.1-sol", "openai-codex/gpt-6-luna:max", "shares the author's openai"],
			["openai-codex/gpt-6.1-sol", "openrouter/openai/gpt-6.1-sol:medium", "shares the author's openai"],
			["anthropic/claude-sonnet-5-5", "anthropic/claude-opus-5-5:high", "shares the author's anthropic"],
			["anthropic/claude-opus-5-5", "openrouter/anthropic/claude-sonnet-5-5", "shares the author's anthropic"],
			["openai-codex/gpt-6.1-sol", "@reviewer", "concrete"],
			["openai-codex/gpt-6.1-sol", "unknown/model", "unknown model family"],
		]) {
			calls = [];
			const result = await run({ AGENT_REVIEW_AUTHOR_MODEL: author, AGENT_REVIEW_MODEL: reviewer });
			expect(result.status).toBe(3);
			expect(result.stderr).toContain(reason);
			expect(calls).toEqual([]);
		}
	});

	test("a concrete cross-family override remains usable with an explicit thinking level", async () => {
		answer(clean, 0, "anthropic/claude-opus-5-5");
		const result = await run({ AGENT_REVIEW_MODEL: "anthropic/claude-opus-5-5:medium", AGENT_REVIEW_THINKING: "high" });
		expect(result.status).toBe(0);
		expect(reviewBody()).toContain("Reviewer: anthropic/claude-opus-5-5 (high)");
	});

	test("a successful verdict from a different actual model cannot be mislabeled as an approval", async () => {
		for (const actual of ["openai-codex/gpt-6.1-sol", "anthropic/claude-opus-5-5"]) {
			calls = [];
			answer(clean, 0, actual);
			const result = await run();
			expect(result.status).toBe(3);
			expect(result.stderr).toContain(`OMP resolved the reviewer to ${actual}`);
			expect(posted("/reviews")).toEqual([]);
		}
	});

	test("native terminal completion is required, and only same-model failed attempts may precede it", async () => {
		const terminal = { type: "agent_end", isTerminal: true };
		events([response("", "anthropic/claude-sonnet-5-5", "error"), terminal, response(clean), terminal]);
		expect((await run()).status).toBe(0);
		for (const output of [
			[clean],
			[{ ...response(clean), message: { ...response(clean).message, role: "user" } }, terminal],
			[response(clean)],
			[response(clean), { type: "agent_end", isTerminal: false }],
			[response(clean, "anthropic/claude-sonnet-5-5", "error"), terminal],
			[response(clean, "anthropic/claude-sonnet-5-5", "aborted"), terminal],
			[response("", "openai-codex/gpt-6.1-sol", "error"), response(clean), terminal],
			[{ type: "retry_fallback_applied", from: "anthropic/claude-sonnet-5-5:high", to: "openai-codex/gpt-6.1-sol:medium", role: "default" }, response(clean), terminal],
		]) {
			calls = [];
			events(output);
			expect((await run()).status).toBe(3);
			expect(posted("/reviews")).toEqual([]);
		}
	});

	test("a timeout or failed process launch posts no approval and leaves no temporary config", async () => {
		// Separate-process watchdog enforcement uses the platform clock; fake timers cannot drive the child.
		writeFileSync(join(dir, "stall.txt"), "yes");
		const timedOut = await run({ AGENT_REVIEW_TIMEOUT_SECONDS: "0.05" });
		expect(timedOut.status).toBe(3);
		expect(timedOut.stderr).toContain("did not answer within");
		expect(posted("/reviews")).toEqual([]);
		expect(readdirSync(runtime)).toEqual([]);
		calls = [];
		const missing = await run({ AGENT_REVIEW_OMP: join(dir, "missing-omp") });
		expect(missing.status).toBe(3);
		expect(posted("/reviews")).toEqual([]);
	});
});

describe("agent-review posting", () => {
	test("a passing review approves the exact head as the App and toggles the re-run label", async () => {
		const result = await run();
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("APPROVED misty-step/demo#7");
		const [review] = posted("/reviews");
		expect(review.body).toMatchObject({ commit_id: "a".repeat(40), event: "APPROVE" });
		const text = reviewBody().split("\n");
		expect(text[0]).toBe(`agent-review: approved ${"a".repeat(40)}`);
		// The base, merge base, title and description the model judged are recorded for the gate to compare.
		const digest = (value: string) => createHash("sha256").update(value).digest("hex");
		expect(text[1]).toBe(`agent-review-state: base=master merge-base=${"c".repeat(40)} title=sha256:${digest("docs: note")} description=sha256:${digest("Stories: US-027")}`);
		// Add, then remove, so the base branch's foundation-review gate sees labeled and unlabeled.
		expect(posted("/issues/7/labels")).toHaveLength(1);
		expect(calls.some((call) => call.method === "DELETE" && call.path.endsWith("/labels/agent-reviewed"))).toBe(true);
	});

	test("a blocking finding requests changes and never approves", async () => {
		answer({ ...clean, overall_correctness: "incorrect", findings: [{ title: "data loss", body: "drops rows", priority: 0 }] });
		const result = await run();
		expect(result.status).toBe(1);
		expect(posted("/reviews")[0].body).toMatchObject({ event: "REQUEST_CHANGES" });
	});

	test("nothing is posted when the model fails, answers unusably, or the PR changes during review", async () => {
		answer("", 1);
		expect((await run()).status).toBe(3);
		answer("looks good to me");
		expect((await run()).status).toBe(3);
		answer(clean);
		headAfterModel = "b".repeat(40);
		const moved = await run();
		expect(moved.status).toBe(3);
		expect(moved.stderr).toContain("head moved");
		headAfterModel = undefined;
		// A retarget or description edit keeps the head but changes what was reviewed; GitHub would keep the approval.
		changeAfterModel = { base: { ref: "release" } };
		expect((await run()).stderr).toContain("base, description or diff changed");
		changeAfterModel = { body: "Stories: US-999" };
		expect((await run()).stderr).toContain("base, description or diff changed");
		changeAfterModel = undefined;
		diffAfterModel = "diff --git a/README.md b/README.md\n+something else\n";
		expect((await run()).stderr).toContain("base, description or diff changed");
		diffAfterModel = undefined;
		mergeBaseAfterModel = "d".repeat(40);
		expect((await run()).stderr).toContain("base, description or diff changed");
		expect(posted("/reviews")).toHaveLength(0);
	});

	test("the re-run label exists before any review is recorded, and a label failure never leaves a silent approval", async () => {
		const okay = await run();
		expect(okay.status).toBe(0);
		const order = calls.filter((call) => call.method === "POST").map((call) => call.path.split("/").slice(-2).join("/"));
		expect(order.indexOf("demo/labels")).toBeGreaterThanOrEqual(0);
		expect(order.indexOf("demo/labels")).toBeLessThan(order.indexOf("7/reviews"));
		// The label cannot be created: nothing is reviewed at all.
		calls = [];
		labelCreateStatus = 403;
		expect((await run()).status).toBe(3);
		expect(posted("/reviews")).toHaveLength(0);
		// An existing label answers 422 and is fine.
		labelCreateStatus = 422;
		expect((await run()).status).toBe(0);
		// The review is recorded but the toggle fails: the operator is told to re-run the gate by hand.
		labelCreateStatus = 201;
		labelAddStatus = 500;
		const stuck = await run();
		expect(stuck.status).toBe(4);
		expect(stuck.stderr).toContain("the gate was not re-run");
	});

	test("refuses a PR the App authored, a closed PR, an oversized diff, and any org but misty-step", async () => {
		pull.user.login = "kaylee-agent[bot]";
		expect((await run()).stderr).toContain("cannot review it");
		pull.user.login = "moomooskycow";
		pull.state = "closed";
		expect((await run()).stderr).toContain("is closed");
		pull.state = "open";
		expect((await run({ AGENT_REVIEW_MAX_DIFF_BYTES: "10" })).stderr).toContain("split the change");
		// A binary change shows only that a path changed: the model cannot judge what it now contains.
		diff = "diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\n";
		expect((await run()).stderr).toContain("cannot inspect");
		diff = "diff --git a/vendor b/vendor\n-Subproject commit aaa\n+Subproject commit bbb\n";
		expect((await run()).stderr).toContain("cannot inspect");
		diff = "diff --git a/README.md b/README.md\n+hello\n";
		const other = await run({}, "r90group/demo");
		expect(other.status).toBe(3);
		expect(other.stderr).toContain("no designated agent reviewer");
		expect(posted("/reviews")).toHaveLength(0);
	});

	test("missing credentials fail before any request", async () => {
		const result = await run({ KAYLEE_GITHUB_APP_PEM: "" });
		expect(result.status).toBe(3);
		expect(calls).toHaveLength(0);
	});
});
