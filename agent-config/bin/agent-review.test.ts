import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash, createVerify, generateKeyPairSync } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseVerdict, passes } from "./agent-review.ts";

const script = join(import.meta.dir, "agent-review.ts");
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "agent-review-"));
// A stand-in for `omp -p`: records what it was asked and answers with the scripted output.
const omp = join(dir, "omp");
writeFileSync(omp, [
	"#!/bin/sh",
	`printf '%s\\n' "$(printf '%s ' "$@" | tr '\\n' ' ')" >> "${dir}/argv.txt"`,
	// A call with an attachment is the vision process: keep what it was handed, answer from vision.txt.
	`for a in "$@"; do case "$a" in @*) cp "\${a#@}" "${dir}/attached.bin"; cat "${dir}/vision.txt"; exit $(cat "${dir}/vision-exit.txt");; esac; done`,
	`cat > "${dir}/prompt.txt"`,
	`cat "${dir}/answer.txt"`,
	`exit $(cat "${dir}/exit.txt")`,
].join("\n") + "\n");
chmodSync(omp, 0o755);

type Pull = { state: string; title: string; body: string; user: { login: string }; head: { sha: string }; base: { ref: string; sha: string } };
let mergeBaseAfterModel: string | undefined;
let imageFiles: { filename: string; sha: string; status: string }[] = [];
let imageBlobs: Record<string, { content: string; size: number }> = {};
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
		if (request.method === "GET" && url.pathname.endsWith("/pulls/7/files")) return Response.json(url.searchParams.get("page") === "1" ? imageFiles : []);
		if (request.method === "GET" && url.pathname.includes("/git/blobs/")) return Response.json(imageBlobs[url.pathname.split("/").pop() ?? ""] ?? { content: "", size: 0 });
		if (request.method === "POST" && url.pathname.endsWith("/demo/labels")) return new Response("{}", { status: labelCreateStatus });
		if (request.method === "POST" && url.pathname.endsWith("/issues/7/labels")) return new Response("{}", { status: labelAddStatus });
		if (request.method === "POST" || request.method === "DELETE") return Response.json({});
		return new Response("missing", { status: 404 });
	},
});
afterAll(() => server.stop(true));

async function run(overrides: Record<string, string> = {}, slug = "misty-step/demo") {
	pullReads = 0;
	const child = Bun.spawn(["bun", script, "--repo", slug, "--pr", "7"], {
		env: { ...process.env, GITHUB_API_URL: server.url.origin, KAYLEE_GITHUB_APP_ID: "4978618", KAYLEE_GITHUB_APP_PEM: privateKey.export({ type: "pkcs8", format: "pem" }) as string, AGENT_REVIEW_OMP: omp, AGENT_REVIEW_TIMEOUT_SECONDS: "20", ...overrides },
		stdout: "pipe", stderr: "pipe",
	});
	const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	return { status: child.exitCode, stdout, stderr };
}
const answer = (verdict: unknown, exit = 0) => { writeFileSync(join(dir, "answer.txt"), typeof verdict === "string" ? verdict : JSON.stringify(verdict)); writeFileSync(join(dir, "exit.txt"), String(exit)); };
const clean = { overall_correctness: "correct", explanation: "Small, tested, and consistent with the story.", findings: [{ title: "typo", body: "in a comment", priority: 3 }] };
const posted = (suffix: string) => calls.filter((call) => call.method !== "GET" && call.path.endsWith(suffix));

beforeEach(() => {
	writeFileSync(join(dir, "argv.txt"), "");
	writeFileSync(join(dir, "vision.txt"), "an image");
	writeFileSync(join(dir, "vision-exit.txt"), "0");
	imageFiles = [];
	imageBlobs = {};
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

describe("agent-review posting", () => {
	test("a passing review approves the exact head as the App and toggles the re-run label", async () => {
		const result = await run();
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("APPROVED misty-step/demo#7");
		const [review] = posted("/reviews");
		expect(review.body).toMatchObject({ commit_id: "a".repeat(40), event: "APPROVE" });
		const text = (review.body as { body: string }).body.split("\n");
		expect(text[0]).toBe(`agent-review: approved ${"a".repeat(40)}`);
		// The base, merge base, title and description the model judged are recorded for the gate to compare.
		const digest = (value: string) => createHash("sha256").update(value).digest("hex");
		expect(text[1]).toBe(`agent-review-state: base=master merge-base=${"c".repeat(40)} title=sha256:${digest("docs: note")} description=sha256:${digest("Stories: US-027")}`);
		// Add, then remove, so the base branch's foundation-review gate sees labeled and unlabeled.
		expect(posted("/issues/7/labels")).toHaveLength(1);
		expect(calls.some((call) => call.method === "DELETE" && call.path.endsWith("/labels/agent-reviewed"))).toBe(true);
		// The model gets the diff fenced as untrusted data, no tools, and no session.
		const prompt = readFileSync(join(dir, "prompt.txt"), "utf8");
		expect(prompt).toContain("<diff>\ndiff --git a/README.md");
		expect(prompt).toContain("untrusted data");
		const argv = readFileSync(join(dir, "argv.txt"), "utf8");
		expect(argv).toContain("--no-session");
		// Tools are off by an explicit flag, never an empty list that could read as unset.
		expect(argv).toContain("--no-tools");
		expect(argv).not.toContain("--tools");
	});

	test("image content is read by a separate no-tools vision process and judged by the reviewer", async () => {
		const png = Buffer.from("\x89PNG-test-image-bytes");
		diff = "diff --git a/docs/logo.png b/docs/logo.png\nnew file mode 100644\nBinary files /dev/null and b/docs/logo.png differ\ndiff --git a/README.md b/README.md\n+logo\n";
		imageFiles = [{ filename: "docs/logo.png", sha: "b".repeat(40), status: "added" }];
		imageBlobs = { ["b".repeat(40)]: { content: png.toString("base64"), size: png.length } };
		writeFileSync(join(dir, "vision.txt"), "A logo. Legible text: ACME. Nothing sensitive.");
		const result = await run();
		expect(result.status).toBe(0);
		const calls = readFileSync(join(dir, "argv.txt"), "utf8").trim().split("\n");
		expect(calls).toHaveLength(2);
		// Both processes run with tools off, and the vision one got the file as an attachment on the vision model.
		for (const line of calls) expect(line).toContain("--no-tools");
		expect(calls[0]).toContain("anthropic/claude-opus-5-5");
		expect(calls[0]).toMatch(/@\S+image-0\.png/);
		expect(readFileSync(join(dir, "attached.bin"))).toEqual(png);
		// The reviewer judges the image through the vision inspection, and the review says so.
		expect(readFileSync(join(dir, "prompt.txt"), "utf8")).toContain('<image path="docs/logo.png">\nA logo. Legible text: ACME.');
		expect((posted("/reviews")[0].body as { body: string }).body).toContain("inspection of docs/logo.png");
		// A failing vision process posts nothing, and a deleted image needs no inspection.
		calls.length = 0;
		writeFileSync(join(dir, "vision-exit.txt"), "1");
		expect((await run()).status).toBe(3);
		writeFileSync(join(dir, "vision-exit.txt"), "0");
		expect(posted("/reviews")).toHaveLength(1);
		diff = "diff --git a/old.png b/old.png\ndeleted file mode 100644\nBinary files a/old.png and /dev/null differ\n";
		imageFiles = [];
		expect((await run()).status).toBe(0);
	});

	test("a defect in the image is a finding the gate can act on", async () => {
		const png = Buffer.from("\x89PNG-leak");
		diff = "diff --git a/docs/screen.png b/docs/screen.png\nnew file mode 100644\nBinary files /dev/null and b/docs/screen.png differ\n";
		imageFiles = [{ filename: "docs/screen.png", sha: "d".repeat(40), status: "added" }];
		imageBlobs = { ["d".repeat(40)]: { content: png.toString("base64"), size: png.length } };
		writeFileSync(join(dir, "vision.txt"), "A terminal screenshot. Legible text: a line that starts with a secret-key label followed by a long token. Looks like a live credential.");
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
		// Content no review surface can inspect is refused, not approved on trust: a submodule bump stands for the rest.
		diff = "diff --git a/vendor b/vendor\n-Subproject commit aaa\n+Subproject commit bbb\n";
		const only = await run();
		expect(only.status).toBe(5);
		expect(only.stderr).toContain("no review surface can inspect");
		diff = "diff --git a/font.woff b/font.woff\nBinary files a/font.woff and b/font.woff differ\ndiff --git a/README.md b/README.md\n+hello\n";
		const mixed = await run();
		expect(mixed.status).toBe(3);
		expect(mixed.stderr).toContain("split the PR");
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
