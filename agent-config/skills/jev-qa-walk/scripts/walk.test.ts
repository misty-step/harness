import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const script = join(import.meta.dir, "walk.py");
const fixtures = join(import.meta.dir, "fixtures");
const site = join(fixtures, "site");
const roots: string[] = [];
let server: ReturnType<typeof Bun.serve>;
let base = "";

function dir(): string {
	const scratch = process.env.TMPDIR ?? join(homedir(), ".cache/tmp");
	mkdirSync(scratch, { recursive: true, mode: 0o700 });
	const root = mkdtempSync(join(scratch, "jev-qa-walk-"));
	roots.push(root);
	return root;
}

function childEnv(extra: Record<string, string> = {}): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined && key !== "OPENROUTER_API_KEY") env[key] = value;
	}
	return { ...env, ...extra };
}

// Async spawn: the fixture server shares this process's event loop.
async function run(args: string[], extraEnv: Record<string, string> = {}) {
	const proc = Bun.spawn(["python3", script, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		env: childEnv(extraEnv),
	});
	const [out, err, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { code, out, err };
}

// Fixture story ids stay out of this file: read them from the fixture file.
function storyId(title: string): string {
	const text = readFileSync(join(fixtures, "stories.md"), "utf8");
	for (const [, id, heading] of text.matchAll(/^## (US-\d{3}) (.+)$/gm)) {
		if (heading.trim() === title) return id;
	}
	throw new Error(`fixture story not found: ${title}`);
}

function trace(path: string): any {
	return JSON.parse(readFileSync(path, "utf8"));
}

type Scenario = {
	story: string;
	start: string;
	mock: string;
	env?: Record<string, string>;
};

function scenarioFiles(scenario: Scenario): { stories: string; tracePath: string; env: Record<string, string> } {
	const root = dir();
	const stories = join(root, "stories.md");
	copyFileSync(join(fixtures, "stories.md"), stories);
	const env: Record<string, string> = { ...scenario.env };
	if (!env.WALK_MOCK_FIXTURE) {
		copyFileSync(join(fixtures, scenario.mock), join(root, "walk-mock.json"));
	}
	return { stories, tracePath: join(root, "trace.json"), env };
}

async function walk(scenario: Scenario) {
	const { stories, tracePath, env } = scenarioFiles(scenario);
	const result = await run(
		[
			"--url", `${base}${scenario.start}`,
			"--stories", stories,
			"--id", storyId(scenario.story),
			"--trace", tracePath,
			"--provider", "mock",
		],
		env,
	);
	return { ...result, trace: () => trace(tracePath) };
}

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		fetch(request) {
			const pathname = new URL(request.url).pathname;
			const file = join(site, basename(pathname === "/" ? "index.html" : pathname));
			if (!existsSync(file)) return new Response("not found", { status: 404 });
			return new Response(Bun.file(file), {
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		},
	});
	base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
	server.stop(true);
});

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("US-007 self-test passes on the frozen spike states", async () => {
	const result = await run(["--self-test"]);
	expect(result.err).toBe("");
	expect(result.code).toBe(0);
	expect(result.out).toContain("walk self-test OK");
});

test("US-007 passes a lookalike click that lands on the coded postcondition", async () => {
	const result = await walk({ story: "Reach the Habitat desk", start: "/index.html", mock: "mock-lookalike.json" });
	expect(result.err).toBe("");
	expect(result.code).toBe(0);
	expect(result.out).toContain("walk: pass");
	const step = result.trace().runs[0].criteria[0].steps[0];
	expect(step.route).toBe("act");
	expect(step.click).toBe("2");
	expect(step.click_gap).toBeGreaterThanOrEqual(0.15);
});

test("US-007 acts on a correct click at 0.67 operation confidence", async () => {
	const result = await walk({
		story: "Reach the Habitat desk",
		start: "/index.html",
		mock: "mock-lowconf.json",
		env: { WALK_MOCK_FIXTURE: join(fixtures, "mock-lowconf.json") },
	});
	expect(result.code).toBe(0);
	const step = result.trace().runs[0].criteria[0].steps[0];
	expect(step.op_conf).toBe(0.67);
	expect(step.route).toBe("act");
	expect(step.click).toBe("2");
});

test("US-007 fails a partial desk as fail_criterion", async () => {
	const result = await walk({ story: "Show the 7-day badges", start: "/partial.html", mock: "mock-partial.json" });
	expect(result.code).toBe(1);
	expect(result.out).toContain("fail (fail_criterion)");
	expect(result.trace().runs[0].reason).toBe("fail_criterion");
});

test("US-007 escalates a visual-only criterion", async () => {
	const result = await walk({ story: "Read the dark rail", start: "/visual.html", mock: "mock-visual.json" });
	expect(result.code).toBe(3);
	expect(result.out).toContain("escalate (vision)");
	expect(result.trace().runs[0].reason).toBe("vision");
});

test("US-007 never treats a copy-lie page as DONE", async () => {
	const result = await walk({ story: "Open the desk from a copy-lie page", start: "/copy-lie.html", mock: "mock-copy-lie.json" });
	expect(result.code).toBe(0);
	const steps = result.trace().runs[0].criteria[0].steps;
	expect(steps).toHaveLength(1);
	expect(steps[0].op).toBe("CLICK");
	expect(steps[0].copy_lie).toBeGreaterThanOrEqual(0.5);
	expect(result.out).toContain("walk: pass");
});

test("US-007 rejects a DONE claim the code postcondition disproves", async () => {
	const result = await walk({ story: "Show the 7-day badges", start: "/partial.html", mock: "mock-done-lie.json" });
	expect(result.code).toBe(1);
	expect(result.out).toContain("fail (lie)");
	expect(result.trace().runs[0].reason).toBe("lie");
});

test("US-007 walks a two-criterion chain", async () => {
	const result = await walk({ story: "Chain from the dashboard to pull requests", start: "/index.html", mock: "mock-chain.json" });
	expect(result.code).toBe(0);
	const criteria = result.trace().runs[0].criteria;
	expect(criteria.map((item: any) => item.outcome)).toEqual(["pass", "pass"]);
	expect(criteria[1].steps[0].click).toBe("3");
});

test("US-007 skips the model when the postcondition already holds", async () => {
	const result = await walk({
		story: "Already on the desk",
		start: "/habitat.html",
		mock: "missing.json",
		env: { WALK_MOCK_FIXTURE: join(fixtures, "missing.json") },
	});
	expect(result.code).toBe(0);
	expect(result.trace().runs[0].steps).toBe(0);
	expect(result.trace().runs[0].criteria[0].reason).toBe("code_postcondition");
});

test("US-007 exits 2 without a key when the provider is jev", async () => {
	const root = dir();
	const stories = join(root, "stories.md");
	copyFileSync(join(fixtures, "stories.md"), stories);
	const result = await run(["--url", `${base}/index.html`, "--stories", stories, "--provider", "jev"]);
	expect(result.code).toBe(2);
	expect(result.err).toContain("OPENROUTER_API_KEY");
});

test("US-007 exits 2 when mock has no recorded answers", async () => {
	const result = await walk({
		story: "Read the dark rail",
		start: "/visual.html",
		mock: "missing.json",
		env: { WALK_MOCK_FIXTURE: join(fixtures, "missing.json") },
	});
	expect(result.code).toBe(2);
	expect(result.err).toContain("mock fixture");
});

test("US-007 exits 2 on a malformed invocation", async () => {
	const result = await run(["--url", `${base}/index.html`]);
	expect(result.code).toBe(2);
	expect(result.err).toContain("--stories");
});
