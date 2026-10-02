import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluate, parseArgs, type Box, type Finding, type Measure } from "./review-check.ts";

const script = join(import.meta.dir, "review-check.ts");
const scratch = mkdtempSync(join(tmpdir(), "review-check-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function run(args: string[], env: Record<string, string> = {}) {
	const result = Bun.spawnSync([process.execPath, script, ...args], {
		env: { ...process.env, TMPDIR: scratch, ...env },
		stdout: "pipe",
		stderr: "pipe",
	});
	return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
}

function page(name: string, html: string): string {
	const path = join(scratch, name);
	writeFileSync(path, `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title>
<style>body{margin:0;font:15px/1.45 system-ui,sans-serif}main{max-width:760px;margin:0 auto;padding:22px 18px}
p{margin:0 0 12px}li{padding:4px 0}</style></head><body><main>${html}</main></body></html>`);
	return path;
}

function rulesFor(path: string, ...args: string[]): { code: number; rules: string[]; stats: Measure } {
	const { code, out, err } = run(["--json", ...args, path]);
	expect(err).toBe("");
	const [entry] = JSON.parse(out) as { findings: Finding[]; measure: Measure }[];
	return { code, rules: [...new Set(entry.findings.map((finding) => finding.rule))], stats: entry.measure };
}

// Ninety-five words of the prose a review page should not open with.
const OVERVIEW = Array(5).fill("Each fix landed as one more sentence in a skill, and the same few mistakes kept coming back every week.").join(" ");
const EVIDENCE_ROWS = Array.from({ length: 12 }, (_, n) => `<tr><td>Mistake ${n + 1}</td><td>3 times</td><td>Held until the next retro</td></tr>`).join("");
const ASKS = ["Approve the idle-engineer rule", "Approve one versioned brief sender", "Delete the prose code now enforces", "Weekly retro on Fridays"];

// The dense draft: prose first, the point and the asks where the scrolling starts.
const dense = page("dense.html", `
<h1>Kaylee retro</h1><p>Written for you from read-only evidence.</p>
<h2>Overview</h2><p>${OVERVIEW}</p><p>${OVERVIEW}</p><p>${OVERVIEW}</p><p>${OVERVIEW}</p>
<table>${EVIDENCE_ROWS}</table>
<p data-review="point">Prose fixes keep failing; code fixes hold.</p>
<ul>${ASKS.map((ask) => `<li data-review="ask">${ask}</li>`).join("")}</ul>`);

// The recut: same words and evidence, but the point and every ask lead and the rest folds.
const recutBody = (open: string) => `
<h1>Kaylee retro</h1>
<p data-review="point">Prose fixes keep failing; code fixes hold. Four small changes, mostly deletions.</p>
<ul>${ASKS.map((ask) => `<li data-review="ask">${ask}</li>`).join("")}</ul>
<details${open}><summary>Overview</summary><p>${OVERVIEW}</p><p>${OVERVIEW}</p></details>
<details><summary>Evidence</summary><table>${EVIDENCE_ROWS}</table></details>`;
const recut = page("recut.html", recutBody(""));

describe("real headless page", () => {
	test("rejects a dense first screen whose point and asks sit below the fold", () => {
		const { code, rules } = rulesFor(dense);
		expect(code).toBe(1);
		expect(rules).toEqual(["point-not-visible", "ask-not-visible", "dense-block", "dense-screen"]);
	});

	test("accepts the concise recut, with its detail folded rather than deleted", () => {
		const { code, rules, stats } = rulesFor(recut);
		expect(rules).toEqual([]);
		expect(code).toBe(0);
		expect(stats.points).toHaveLength(1);
		expect(stats.asks).toHaveLength(ASKS.length);
		// The folded overview and evidence are not what the reader sees first.
		expect(stats.screenWords).toBeLessThan(80);
	});

	test("unfolding the same detail makes the first screen dense again", () => {
		const open = page("recut-open.html", recutBody(" open"));
		const { code, rules } = rulesFor(open);
		expect(code).toBe(1);
		expect(rules).toContain("dense-block");
	});

	test("a page that marks nothing is refused, not guessed at", () => {
		const bare = page("bare.html", `<h1>Retro</h1><p>Prose fixes keep failing.</p><ul><li>Approve it</li></ul>`);
		const { code, rules } = rulesFor(bare);
		expect(code).toBe(1);
		expect(rules).toEqual(["point-missing", "ask-missing"]);
	});

	test("a page with nothing to decide says so on the first screen", () => {
		const fyi = page("fyi.html", `<h1>Audit</h1><p data-review="point">Nothing regressed this week.</p><p data-review="no-ask">Nothing for you to decide.</p>`);
		expect(rulesFor(fyi)).toMatchObject({ code: 0, rules: [] });
	});

	test("an ask folded into a closed detail is not on the first screen", () => {
		const folded = page("folded.html", `<p data-review="point">Code fixes hold.</p><details><summary>Decisions</summary><p data-review="ask">Approve it</p></details>`);
		const { code, rules } = rulesFor(folded);
		expect(code).toBe(1);
		expect(rules).toEqual(["ask-not-visible"]);
	});

	test("a shorter viewport pushes the last ask off the screen", () => {
		expect(rulesFor(recut, "--viewport", "1280x640").rules).toEqual([]);
		const { code, rules } = rulesFor(recut, "--viewport", "1280x150");
		expect(code).toBe(1);
		expect(rules).toContain("ask-not-visible");
	});

	test("pages that predate the markers pass their own selectors", () => {
		const old = page("old.html", `<h1>Retro</h1><p class="lede">Code fixes hold.</p><ol class="proposals"><li>Approve it</li></ol>`);
		expect(rulesFor(old, "--point", ".lede", "--ask", ".proposals li")).toMatchObject({ code: 0, rules: [] });
	});

	test("--screenshot saves the first screen it judged", () => {
		const png = join(scratch, "first.png");
		expect(run(["--screenshot", png, recut]).code).toBe(0);
		const bytes = readFileSync(png);
		expect([...bytes.subarray(1, 4)]).toEqual([...Buffer.from("PNG")]);
		expect(bytes.readUInt32BE(16)).toBe(1280);
		expect(bytes.readUInt32BE(20)).toBe(640);
	});

	test("an unrunnable check exits 2 and says why, never a pass", () => {
		const noBrowser = run([recut], { REVIEW_CHECK_CHROMIUM: "/nonexistent/chromium" });
		expect(noBrowser.code).toBe(2);
		expect(noBrowser.err).toContain("REVIEW_CHECK_CHROMIUM");
		const missing = run([join(scratch, "missing.html")]);
		expect(missing.code).toBe(2);
		expect(missing.err).toContain("did not load");
	});
});

describe("judgment", () => {
	const box = (bottom: number, over: Partial<Box> = {}): Box => ({ text: "x", visible: true, top: 10, left: 10, bottom, right: 200, ...over });
	const seen = (over: Partial<Measure>): Measure => ({
		width: 1280, height: 640, points: [box(40)], asks: [box(100)], noAsk: [], blocks: [], screenWords: 20, ...over,
	});
	const rules = (measure: Measure) => evaluate("p.html", measure).map((finding) => finding.rule);

	test("an ask must end inside the screen, to the pixel", () => {
		expect(rules(seen({ asks: [box(640)] }))).toEqual([]);
		expect(rules(seen({ asks: [box(641)] }))).toEqual(["ask-not-visible"]);
	});

	test("a hidden or sideways-clipped mark counts as not seen", () => {
		expect(rules(seen({ points: [box(40, { visible: false })] }))).toEqual(["point-not-visible"]);
		expect(rules(seen({ asks: [box(100, { right: 1300 })] }))).toEqual(["ask-not-visible"]);
	});

	test("word limits bite one past the line", () => {
		expect(rules(seen({ blocks: [{ text: "x", words: 35 }], screenWords: 300 }))).toEqual([]);
		expect(rules(seen({ blocks: [{ text: "x", words: 36 }], screenWords: 301 }))).toEqual(["dense-block", "dense-screen"]);
	});

	test("bad arguments are refused with the usage", () => {
		expect(() => parseArgs([])).toThrow("usage: review-check");
		expect(() => parseArgs(["--viewport", "wide", "p.html"])).toThrow("WIDTHxHEIGHT");
		expect(() => parseArgs(["--screenshot", "a.png", "a.html", "b.html"])).toThrow("exactly one page");
	});
});
