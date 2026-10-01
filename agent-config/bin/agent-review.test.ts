import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash, createVerify, generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseVerdict, passes } from "./agent-review.ts";

const script = join(import.meta.dir, "agent-review.ts");
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "agent-review-"));
const repository = join(dir, "repository");
const runtime = join(dir, "runtime");
mkdirSync(runtime);
function git(...args: string[]): string {
	return execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd: repository, encoding: "utf8" }).trim();
}
function put(path: string, content: string | Buffer): void {
	mkdirSync(dirname(join(repository, path)), { recursive: true });
	writeFileSync(join(repository, path), content);
}
function commit(message: string): string {
	git("add", "-A");
	git("commit", "-qm", message);
	return git("rev-parse", "HEAD");
}
function candidate(files: Record<string, string | Buffer>): string {
	git("reset", "--hard", pull.base.sha);
	for (const [path, content] of Object.entries(files)) put(path, content);
	const head = commit("candidate");
	pull.head.sha = head;
	return head;
}
// Native protocol fixtures report independently scripted identities, never identities copied from argv.
const omp = join(dir, "omp");
writeFileSync(omp, `#!/usr/bin/env bun
const args = process.argv.slice(2);
const argvFile = ${JSON.stringify(join(dir, "argv.txt"))};
await Bun.write(argvFile, (await Bun.file(argvFile).text()) + JSON.stringify(args) + "\\n");
const configFile = ${JSON.stringify(join(dir, "config.txt"))};
const config = await Bun.file(args[args.indexOf("--config") + 1]).text();
await Bun.write(configFile, (await Bun.file(configFile).text()) + config + "\\n");
const attachment = args.find((arg) => arg.startsWith("@"));
if (attachment) {
	await Bun.write(${JSON.stringify(join(dir, "attached.bin"))}, await Bun.file(attachment.slice(1)).arrayBuffer());
	process.stdout.write(await Bun.file(${JSON.stringify(join(dir, "vision.txt"))}).text());
	process.exit(Number(await Bun.file(${JSON.stringify(join(dir, "vision-exit.txt"))}).text()));
}
await Bun.write(${JSON.stringify(join(dir, "prompt.txt"))}, await Bun.stdin.text());
if ((await Bun.file(${JSON.stringify(join(dir, "stall.txt"))}).text()).trim() === "yes") {
	Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("waiting") });
	await Promise.withResolvers().promise;
}
process.stdout.write(await Bun.file(${JSON.stringify(join(dir, "answer.txt"))}).text());
process.exit(Number(await Bun.file(${JSON.stringify(join(dir, "exit.txt"))}).text()));
`);
chmodSync(omp, 0o755);

type Pull = { state: string; title: string; body: string; user: { login: string }; head: { sha: string }; base: { ref: string; sha: string; repo: { clone_url: string } } };
let mergeBaseAfterModel: string | undefined;
let temporaryHead: string | undefined;
let reviewedHead: string;
let pull: Pull;
let headAfterModel: string | undefined;
let calls: { method: string; path: string; body: unknown }[] = [];
let authorized = true;
let pullReads = 0;
let changeAfterModel: Partial<Pull> | undefined;
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
			pullReads++;
			return Response.json(pullReads >= 2 ? { ...pull, ...changeAfterModel, ...(headAfterModel ? { head: { sha: headAfterModel } } : {}) } : pull);
		}
		if (url.pathname.includes("/compare/")) {
			const mergeBase = pullReads >= 2 && mergeBaseAfterModel ? mergeBaseAfterModel : pull.base.sha;
			if (pullReads === 1 && temporaryHead) {
				git("update-ref", "HEAD", temporaryHead);
				pull.head.sha = temporaryHead;
			}
			return Response.json({ merge_base_commit: { sha: mergeBase } });
		}
		if (request.method === "POST" && url.pathname.endsWith("/demo/labels")) {
			if (temporaryHead) {
				git("update-ref", "HEAD", reviewedHead);
				pull.head.sha = reviewedHead;
			}
			return new Response("{}", { status: labelCreateStatus });
		}
		if (request.method === "POST" && url.pathname.endsWith("/issues/7/labels")) return new Response("{}", { status: labelAddStatus });
		if (request.method === "POST" || request.method === "DELETE") return Response.json({});
		return new Response("missing", { status: 404 });
	},
});
afterAll(() => { server.stop(true); rmSync(dir, { recursive: true, force: true }); });

async function run(overrides: Record<string, string> = {}, slug = "misty-step/demo") {
	pullReads = 0;
	const child = Bun.spawn(["bun", script, "--repo", slug, "--pr", "7"], {
		env: { ...process.env, TMPDIR: runtime, GITHUB_API_URL: server.url.origin, KAYLEE_GITHUB_APP_ID: "4978618", KAYLEE_GITHUB_APP_PEM: privateKey.export({ type: "pkcs8", format: "pem" }) as string, AGENT_REVIEW_OMP: omp, AGENT_REVIEW_MODEL: "anthropic/claude-sonnet-5-5", AGENT_REVIEW_THINKING: "high", AGENT_REVIEW_VISION_MODEL: "anthropic/claude-opus-5-5", AGENT_REVIEW_VISION_THINKING: "high", AGENT_REVIEW_TIMEOUT_SECONDS: "20", ...overrides },
		stdout: "pipe", stderr: "pipe",
	});
	const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	return { status: child.exitCode, stdout, stderr };
}
const response = (text: string, selector = "anthropic/claude-sonnet-5-5", stopReason = "stop") => {
	const slash = selector.indexOf("/");
	return { type: "message_end", message: { role: "assistant", provider: selector.slice(0, slash), model: selector.slice(slash + 1), stopReason, content: [{ type: "text", text }] } };
};
const terminal = { type: "agent_end", isTerminal: true };
function output(events: unknown[]): string {
	return events.map((event) => JSON.stringify(event)).join("\n");
}
const answer = (verdict: unknown, exit = 0) => { writeFileSync(join(dir, "answer.txt"), output([response(typeof verdict === "string" ? verdict : JSON.stringify(verdict)), terminal])); writeFileSync(join(dir, "exit.txt"), String(exit)); };
const vision = (text: string) => writeFileSync(join(dir, "vision.txt"), output([response(text, "anthropic/claude-opus-5-5"), terminal]));
const clean = { overall_correctness: "correct", explanation: "Small, tested, and consistent with the story.", findings: [{ title: "typo", body: "in a comment", priority: 3 }] };
const posted = (suffix: string) => calls.filter((call) => call.method !== "GET" && call.path.endsWith(suffix));
function reviewBody(): string {
	const value = posted("/reviews")[0]?.body;
	if (!value || typeof value !== "object" || !("body" in value) || typeof value.body !== "string") throw new Error("no GitHub review body was posted");
	return value.body;
}

beforeEach(() => {
	writeFileSync(join(dir, "argv.txt"), "");
	writeFileSync(join(dir, "config.txt"), "");
	writeFileSync(join(dir, "stall.txt"), "no");
	vision("an image");
	writeFileSync(join(dir, "vision-exit.txt"), "0");
	rmSync(repository, { recursive: true, force: true });
	mkdirSync(repository);
	git("init", "-q");
	git("config", "user.name", "Reviewer fixture");
	git("config", "user.email", "reviewer@example.test");
	put("README.md", "old\n");
	const base = commit("base");
	put("README.md", "hello\n");
	reviewedHead = commit("head");
	pull = { state: "open", title: "docs: note", body: "Stories: US-027", user: { login: "moomooskycow" }, head: { sha: reviewedHead }, base: { ref: "master", sha: base, repo: { clone_url: `file://${repository}` } } };
	temporaryHead = undefined;
	mergeBaseAfterModel = undefined;
	headAfterModel = undefined;
	changeAfterModel = undefined;
	labelCreateStatus = 201;
	labelAddStatus = 200;
	calls = [];
	pullReads = 0;
	answer(clean);
});

describe("agent-review immutable Git metadata", () => {
	test("quoted and tab-containing image paths are inspected from their actual head blobs", async () => {
		const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 0, 2]);
		for (const path of ["docs/café.png", "docs/logo\tprivate.png"]) {
			calls = [];
			candidate({ [path]: png });
			expect((await run()).status).toBe(0);
			expect(readFileSync(join(dir, "attached.bin"))).toEqual(png);
			expect(reviewBody()).toContain(`inspection of ${path}`);
		}
	});

	test("rename-only images are inspected, while opaque renames cannot slip into a mixed text review", async () => {
		const bytes = Buffer.from([0, 1, 0, 2]);
		git("reset", "--hard", pull.base.sha);
		put("asset.dat", bytes);
		pull.base.sha = commit("old binary");
		renameSync(join(repository, "asset.dat"), join(repository, "logo.png"));
		pull.head.sha = commit("rename to image");
		expect(git("diff", "--find-renames", pull.base.sha, pull.head.sha)).toContain("similarity index 100%");
		expect((await run()).status).toBe(0);
		expect(readFileSync(join(dir, "attached.bin"))).toEqual(bytes);
		calls = [];
		git("reset", "--hard", pull.base.sha);
		renameSync(join(repository, "asset.dat"), join(repository, "font.woff"));
		pull.head.sha = commit("rename opaque");
		expect((await run()).status).toBe(0);
		expect(posted("/reviews")[0].body).toMatchObject({ event: "COMMENT" });
		calls = [];
		put("README.md", "text too\n");
		pull.head.sha = commit("opaque rename and text");
		const mixed = await run();
		expect(mixed.status).toBe(3);
		expect(mixed.stderr).toContain("split the PR");
		expect(posted("/reviews")).toHaveLength(0);
	});

	test("ordinary Subproject commit text and a gitlink-to-text transition are reviewable", async () => {
		candidate({ "README.md": "Subproject commit ccc\n" });
		expect((await run()).status).toBe(0);
		expect(posted("/reviews")[0].body).toMatchObject({ event: "APPROVE" });
		calls = [];
		git("reset", "--hard", pull.base.sha);
		git("update-index", "--add", "--cacheinfo", `160000,${"a".repeat(40)},vendor`);
		git("commit", "-qm", "gitlink");
		pull.base.sha = git("rev-parse", "HEAD");
		git("rm", "--cached", "vendor");
		put("vendor", "Subproject commit is ordinary documentation\n");
		pull.head.sha = commit("gitlink becomes text");
		expect((await run()).status).toBe(0);
		expect(posted("/reviews")[0].body).toMatchObject({ event: "APPROVE" });
	});

	test("a temporary A to B to A push never substitutes B's harmless image bytes", async () => {
		const original = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 7, 0, 8]);
		const replacement = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 9, 0, 10]);
		reviewedHead = candidate({ "screen.png": original });
		put("screen.png", replacement);
		temporaryHead = commit("temporary harmless replacement");
		git("update-ref", "HEAD", reviewedHead);
		const result = await run();
		expect(result.status).toBe(0);
		expect(readFileSync(join(dir, "attached.bin"))).toEqual(original);
		expect(posted("/reviews")[0].body).toMatchObject({ commit_id: reviewedHead, event: "APPROVE" });
	});

	test("image discovery has no PR-file pagination limit", async () => {
		const files: Record<string, string | Buffer> = {};
		for (let index = 0; index < 1001; index++) files[`many/file-${index.toString().padStart(4, "0")}.txt`] = "note\n";
		const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 11, 0, 12]);
		files["z-last.png"] = image;
		candidate(files);
		expect((await run()).status).toBe(0);
		expect(readFileSync(join(dir, "attached.bin"))).toEqual(image);
		expect(reviewBody()).toContain("inspection of z-last.png");
	});

	test("the full vision inspection reaches the reviewer, or the review refuses rather than truncate it", async () => {
		candidate({ "wall.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 0, 2]) });
		const inspection = `${"legible text ".repeat(800)}\nBLOCKING EVIDENCE AT THE END`;
		vision(inspection);
		expect((await run()).status).toBe(0);
		expect(readFileSync(join(dir, "prompt.txt"), "utf8")).toContain(inspection);
		calls = [];
		vision("x".repeat(20_001));
		const result = await run();
		expect(result.status).toBe(3);
		expect(result.stderr).toContain("a partial account is not a review");
		expect(posted("/reviews")).toHaveLength(0);
	});

	test("failed immutable Git inspection posts nothing", async () => {
		pull.head.sha = "e".repeat(40);
		const result = await run();
		expect(result.status).toBe(3);
		expect(result.stderr).toContain("git fetch");
		expect(posted("/reviews")).toHaveLength(0);
	});
});

describe("agent-review native model isolation", () => {
	test("both image and text processes receive the supported no-tools/no-fallback configuration", async () => {
		candidate({ "logo.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 0, 2]) });
		expect((await run()).status).toBe(0);
		const argv: string[][] = readFileSync(join(dir, "argv.txt"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
		const configs = readFileSync(join(dir, "config.txt"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
		expect(argv).toHaveLength(2);
		for (const [index, args] of argv.entries()) {
			expect(args).toEqual(expect.arrayContaining(["--mode", "json", "--print", "--no-session", "--config", "--no-tools", "--no-extensions", "--no-skills", "--no-rules", "--no-lsp", "--no-title"]));
			expect(args).not.toContain("--tools");
			const model = index === 0 ? "anthropic/claude-opus-5-5" : "anthropic/claude-sonnet-5-5";
			expect(args[args.indexOf("--model") + 1]).toBe(model);
			expect(args[args.indexOf("--thinking") + 1]).toBe("high");
			const chains: Record<string, string[]> = { default: [], reviewer: [], "security-reviewer": [], "anthropic/*": [], [model]: [] };
			for (const effort of ["off", "minimal", "low", "medium", "high", "xhigh", "max"]) chains[`${model}:${effort}`] = [];
			expect(configs[index]).toMatchObject({ retry: { modelFallback: false, fallbackChains: chains }, advisor: { enabled: false } });
		}
	});

	test("a fallback or wrong actual model can never yield an approval, even when its verdict is clean", async () => {
		for (const events of [
			[response(JSON.stringify(clean), "openai-codex/gpt-6.1-sol"), terminal],
			[{ type: "retry_fallback_applied" }, response(JSON.stringify(clean)), terminal],
			[response(JSON.stringify(clean))],
			[response(JSON.stringify(clean)), { type: "agent_end", isTerminal: false }],
			[response(JSON.stringify(clean), "anthropic/claude-sonnet-5-5", "error"), terminal],
		]) {
			calls = [];
			writeFileSync(join(dir, "answer.txt"), output(events));
			expect((await run()).status).toBe(3);
			expect(posted("/reviews")).toHaveLength(0);
		}
		// Same-model retries remain usable, but every completed attempt must have that identity.
		writeFileSync(join(dir, "answer.txt"), output([response("", "anthropic/claude-sonnet-5-5", "error"), terminal, response(JSON.stringify(clean)), terminal]));
		expect((await run()).status).toBe(0);
	});

	test("vision identity and terminal completion are checked independently of the text review", async () => {
		candidate({ "logo.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 3, 0, 4]) });
		for (const events of [
			[response("a harmless image"), terminal],
			[{ type: "retry_fallback_applied" }, response("a harmless image", "anthropic/claude-opus-5-5"), terminal],
			[response("a harmless image", "anthropic/claude-opus-5-5")],
		]) {
			calls = [];
			writeFileSync(join(dir, "vision.txt"), output(events));
			expect((await run()).status).toBe(3);
			expect(posted("/reviews")).toHaveLength(0);
		}
	});

	test("timeout and failed launch remove private scratch without posting a review", async () => {
		writeFileSync(join(dir, "stall.txt"), "yes");
		const timedOut = await run({ AGENT_REVIEW_TIMEOUT_SECONDS: "0.05" });
		expect(timedOut.status).toBe(3);
		expect(timedOut.stderr).toContain("did not answer within");
		expect(posted("/reviews")).toHaveLength(0);
		expect(readdirSync(runtime)).toEqual([]);
		const failed = await run({ AGENT_REVIEW_OMP: join(dir, "missing-omp") });
		expect(failed.status).toBe(3);
		expect(posted("/reviews")).toHaveLength(0);
		expect(readdirSync(runtime)).toEqual([]);
	});
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

describe("agent-review posting", () => {
	test("a passing review approves the exact head as the App and toggles the re-run label", async () => {
		const result = await run();
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("APPROVED misty-step/demo#7");
		const [review] = posted("/reviews");
		expect(review.body).toMatchObject({ commit_id: pull.head.sha, event: "APPROVE" });
		const text = reviewBody().split("\n");
		expect(text[0]).toBe(`agent-review: approved ${pull.head.sha}`);
		// The base, merge base, title and description the model judged are recorded for the gate to compare.
		const digest = (value: string) => createHash("sha256").update(value).digest("hex");
		expect(text[1]).toBe(`agent-review-state: base=master merge-base=${pull.base.sha} title=sha256:${digest("docs: note")} description=sha256:${digest("Stories: US-027")}`);
		// Add, then remove, so the base branch's foundation-review gate sees labeled and unlabeled.
		expect(posted("/issues/7/labels")).toHaveLength(1);
		expect(calls.some((call) => call.method === "DELETE" && call.path.endsWith("/labels/agent-reviewed"))).toBe(true);
	});

	test("image content is read by a separate no-tools vision process and judged by the reviewer", async () => {
		const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 0, 2]);
		candidate({ "docs/logo.png": png, "README.md": "logo\n" });
		vision("A logo. Legible text: ACME. Nothing sensitive.");
		const result = await run();
		expect(result.status).toBe(0);
		expect(readFileSync(join(dir, "attached.bin"))).toEqual(png);
		expect(reviewBody()).toContain("inspection of docs/logo.png");
		// A failing vision process posts nothing, and a deleted image needs no inspection.
		calls = [];
		writeFileSync(join(dir, "vision-exit.txt"), "1");
		expect((await run()).status).toBe(3);
		expect(posted("/reviews")).toHaveLength(0);
		writeFileSync(join(dir, "vision-exit.txt"), "0");
		git("reset", "--hard", pull.base.sha);
		put("old.png", png);
		pull.base.sha = commit("image in base");
		git("rm", "old.png");
		pull.head.sha = commit("deleted image");
		expect((await run()).status).toBe(0);
		expect(reviewBody()).not.toContain("inspection of old.png");
	});

	test("a defect in the image is a finding the gate can act on", async () => {
		candidate({ "docs/screen.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 3, 0, 4]) });
		vision("A terminal screenshot. Legible text: a line that starts with a secret-key label followed by a long token. Looks like a live credential.");
		answer({ ...clean, overall_correctness: "incorrect", findings: [{ title: "credential in image", body: "screenshot shows an API key", priority: 0 }] });
		const result = await run();
		expect(result.status).toBe(1);
		expect(posted("/reviews")[0].body).toMatchObject({ event: "REQUEST_CHANGES" });
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
		changeAfterModel = { base: { ...pull.base, ref: "release" } };
		expect((await run()).stderr).toContain("base, description or diff changed");
		changeAfterModel = { body: "Stories: US-999" };
		expect((await run()).stderr).toContain("base, description or diff changed");
		changeAfterModel = undefined;
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
		// Only the metadata of opaque content is reviewable, so a clean verdict comments and a defect requests changes.
		git("reset", "--hard", pull.base.sha);
		git("update-index", "--add", "--cacheinfo", `160000,${"a".repeat(40)},vendor`);
		git("commit", "-qm", "submodule");
		pull.head.sha = git("rev-parse", "HEAD");
		const only = await run();
		expect(only.status).toBe(0);
		expect(posted("/reviews")[0].body).toMatchObject({ event: "COMMENT", commit_id: pull.head.sha });
		const metadataBody = reviewBody();
		expect(metadataBody).toContain(`agent-review: metadata reviewed ${pull.head.sha}`);
		expect(metadataBody).toContain("agent-review-scope: metadata-only");
		expect(metadataBody).toContain("no opaque file bytes or submodule contents were inspected");
		expect(metadataBody).not.toContain("inspection of");
		calls = [];
		answer({ ...clean, findings: [{ title: "wrong pointer", body: "contradicts the PR description", priority: 1 }] });
		expect((await run()).status).toBe(1);
		expect(posted("/reviews")[0].body).toMatchObject({ event: "REQUEST_CHANGES" });
		calls = [];
		answer(clean);
		candidate({ "font.woff": Buffer.from([0, 1, 0, 2]), "README.md": "hello\n" });
		const mixed = await run();
		expect(mixed.status).toBe(3);
		expect(mixed.stderr).toContain("split the PR");
		candidate({ "README.md": "hello\n" });
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
