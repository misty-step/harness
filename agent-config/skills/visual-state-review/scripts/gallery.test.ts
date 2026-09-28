import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "gallery.py");
const roots: string[] = [];

function dir(): string {
	const scratch = process.env.TMPDIR ?? join(homedir(), ".cache/tmp");
	mkdirSync(scratch, { recursive: true, mode: 0o700 });
	const root = mkdtempSync(join(scratch, "visual-state-review-"));
	roots.push(root);
	return root;
}

function run(args: string[]): { code: number; out: string; err: string } {
	const result = Bun.spawnSync(["python3", script, ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		code: result.exitCode ?? 1,
		out: result.stdout.toString(),
		err: result.stderr.toString(),
	};
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("US-006 self-test passes", () => {
	const result = run(["--self-test"]);
	expect(result.err).toBe("");
	expect(result.code).toBe(0);
	expect(result.out).toContain("gallery self-test OK");
});

test("US-006 --check fails when a captured file is missing", () => {
	const root = dir();
	const manifest = join(root, "manifest.json");
	writeFileSync(
		manifest,
		JSON.stringify({
			title: "Gap",
			states: [{ id: "01-home", file: "missing.png", status: "captured" }],
		}),
	);
	const result = run([manifest, "--check"]);
	expect(result.code).toBe(1);
	expect(result.err).toContain("01-home");
	expect(result.err).toContain("unverified");
});

test("US-006 duplicate state ids fail closed", () => {
	const root = dir();
	const manifest = join(root, "manifest.json");
	writeFileSync(
		manifest,
		JSON.stringify({
			title: "Dup",
			states: [
				{ id: "01-home", file: "a.png", status: "skipped", reason: "x" },
				{ id: "01-home", file: "b.png", status: "skipped", reason: "y" },
			],
		}),
	);
	const result = run([manifest, "--check"]);
	expect(result.code).toBe(1);
	expect(result.err).toContain("duplicate state id");
});

test("US-006 skipped state requires a reason", () => {
	const root = dir();
	const manifest = join(root, "manifest.json");
	writeFileSync(
		manifest,
		JSON.stringify({
			title: "Skip",
			states: [{ id: "02-empty", file: "02-empty.png", status: "skipped" }],
		}),
	);
	const result = run([manifest, "--check"]);
	expect(result.code).toBe(1);
	expect(result.err).toContain("no reason");
});

type PairManifest = {
	title: string;
	states: Array<{ id: string; file: string; group: string; size: string; theme: string; scroll: string; phase?: string; status: string; reason?: string }>;
	subtraction: Array<{
		before: string; after: string; job: string; kept: string[]; cut: string[]; deferred: string[];
		retained: Array<{ action: string; observed: string }>;
		access?: string[]; keptReason?: string;
	}>;
};

function pairedMap(root: string): PairManifest {
	writeFileSync(join(root, "before.png"), "before image");
	writeFileSync(join(root, "after.png"), "after image");
	return {
		title: "Map restraint",
		states: [
			{ id: "map-before", file: "before.png", group: "map", size: "390x844", theme: "light", scroll: "top", phase: "before", status: "captured" },
			{ id: "map-after", file: "after.png", group: "map", size: "390x844", theme: "light", scroll: "top", phase: "after", status: "captured" },
		],
		subtraction: [{
			before: "map-before",
			after: "map-after",
			job: "Inspect a goal and open a concept",
			kept: ["Goal title and due status", "Six linked concept rows and statuses", "Focus and pause actions"],
			cut: ["Repeated concept labels in the decorative chart"],
			deferred: [],
			retained: [{ action: "Open a concept from the list", observed: "Every concept remains in the status list" }],
		}],
	};
}

test("US-044 a paired subtraction passes and its retained evidence cannot inject markup", () => {
	const root = dir();
	const manifest = join(root, "manifest.json");
	const data = pairedMap(root);
	data.subtraction[0]!.retained[0]!.observed = "<script>alert(1)</script>";
	writeFileSync(manifest, JSON.stringify(data));
	const check = run([manifest, "--check", "--require-subtraction"]);
	expect(check.code).toBe(0);
	const render = run([manifest, "--out", join(root, "index.html")]);
	expect(render.code).toBe(0);
	const html = readFileSync(join(root, "index.html"), "utf8");
	expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
	expect(html).not.toContain("<script>alert(1)</script>");
});

test("US-044 a deferred route or a justified no-cut state can complete review", () => {
	for (const decision of ["defer", "keep"]) {
		const root = dir();
		const manifest = join(root, "manifest.json");
		const data = pairedMap(root);
		data.subtraction[0]!.cut = [];
		if (decision === "defer") {
			data.subtraction[0]!.deferred = ["Source detail"];
			data.subtraction[0]!.access = ["Open source detail from the goal"];
			data.subtraction[0]!.retained.push({ action: "Open source detail from the goal", observed: "Source detail opened with the original content" });
		} else {
			data.subtraction[0]!.keptReason = "All visible status is required for choosing a concept";
		}
		writeFileSync(manifest, JSON.stringify(data));
		expect(run([manifest, "--check", "--require-subtraction"]).code, decision).toBe(0);
	}
});

test("US-044 missing or mismatched subtraction proof is not a completed matrix", () => {
	const cases: [string, (data: PairManifest) => void, string][] = [
		["no pairs", data => { data.subtraction = []; }, "no before/after pairs"],
		["skipped baseline", data => { data.states[0]!.status = "skipped"; data.states[0]!.reason = "not reachable"; }, "must both be captured"],
		["different viewport", data => { data.states[1]!.size = "1280x720"; }, "size"],
		["same capture alias", data => { data.states[1]!.file = "./before.png"; }, "same file"],
		["no retained content inventory", data => { data.subtraction[0]!.kept = []; }, "kept"],
		["unobserved task", data => { data.subtraction[0]!.retained = []; }, "retained"],
		["no safe cut unexplained", data => { data.subtraction[0]!.cut = []; }, "keptReason"],
		["deferred but unreachable", data => { data.subtraction[0]!.deferred = ["Source detail"]; }, "access"],
		["deferred route not observed", data => { data.subtraction[0]!.deferred = ["Source detail"]; data.subtraction[0]!.access = ["Open source detail from the goal"]; }, "observed"],
	];
	for (const [name, mutate, message] of cases) {
		const root = dir();
		const manifest = join(root, "manifest.json");
		const data = pairedMap(root);
		mutate(data);
		writeFileSync(manifest, JSON.stringify(data));
		const result = run([manifest, "--check", "--require-subtraction"]);
		expect(result.code, name).toBe(1);
		expect(result.err, name).toContain(message);
	}
});

test("US-044 malformed subtraction data cannot pass an ordinary gallery check", () => {
	const root = dir();
	const manifest = join(root, "manifest.json");
	const data = pairedMap(root);
	const malformed = { ...data, subtraction: {} };
	delete malformed.states[0]!.phase;
	delete malformed.states[1]!.phase;
	writeFileSync(manifest, JSON.stringify(malformed));
	const result = run([manifest, "--check"]);
	expect(result.code).toBe(1);
	expect(result.err).toContain("subtraction: must be an array");
});

test("US-044 full-image links cannot become executable URLs", () => {
	const root = dir();
	const manifest = join(root, "manifest.json");
	const data = pairedMap(root);
	const filename = "javascript:alert(1).png";
	writeFileSync(join(root, filename), "image");
	data.states[1]!.file = filename;
	writeFileSync(manifest, JSON.stringify(data));
	const output = join(root, "index.html");
	const result = run([manifest, "--out", output]);
	expect(result.code).toBe(0);
	const links = [...readFileSync(output, "utf8").matchAll(/href="([^"]+)"/g)].map(match => match[1]!);
	const imageLink = links.find(link => link.includes("javascript"));
	expect(imageLink).toBeDefined();
	expect(imageLink).toMatch(/^\.\//);
	expect(imageLink).not.toMatch(/^javascript:/i);
});
