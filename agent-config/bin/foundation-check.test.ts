import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const script = join(import.meta.dir, "foundation-check.ts");
const catalog = resolve(import.meta.dir, "../skills/foundation/foundation-standard-v1.json");
const checker = resolve(import.meta.dir, "../skills/user-stories/scripts/check-stories.sh");
const catalogBytes = readFileSync(catalog);
const catalogData = JSON.parse(catalogBytes.toString("utf8"));
const hash = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const scratchParent = join(homedir(), ".cache/tmp");
mkdirSync(scratchParent, { recursive: true });
const root = mkdtempSync(join(scratchParent, "foundation-check-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function exec(repo: string, args: string[], command = "git") {
	const result = spawnSync(command, args, { cwd: repo, encoding: "utf8" });
	if (result.status !== 0) throw new Error(`${command} ${args.join(" ")}: ${result.stderr}`);
	return result.stdout.trim();
}
function put(repo: string, file: string, content: string) {
	const target = join(repo, file);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, content);
}
function adoption() {
	return {
		schema: "foundation-adoption/1",
		standard: {
			id: "misty-step.foundation", version: catalogData.version, catalog_sha256: hash(catalogBytes),
			source: "https://github.com/misty-step/harness/blob/1111111111111111111111111111111111111111/agent-config/skills/foundation/foundation-standard-v1.json",
			revision: "1111111111111111111111111111111111111111",
		},
		capabilities: ["User journey"],
		// A library owes no ADR-005 operational obligations; tests that need an application say so.
		surfaces: ["library"],
		dispositions: Object.fromEntries([...catalogData.obligations, ...catalogData.approved_defaults].map(({ id }: { id: string }) => [id, { status: "pending", missing: "walk", owner: "team", next: "run walk" }])),
	};
}
const liveStory = `## US-001 Follow the journey

Statement: When I need a result, I want to follow the journey, so I can finish.

Criteria:
1. WHEN starting, THE SYSTEM SHALL show the result.
2. IF the result is missing, THEN THE SYSTEM SHALL say so.
`;
const retiredStory = `## US-002 Earlier journey

Retired: 2026-09-25 — no longer offered.
`;
// check-stories.sh also treats a "(retired)" heading as retired; so must the map.
const headingRetiredStory = `## US-003 Older journey (retired)

Retired on 2026-09-23 by operator decision; the id stays reserved.
`;
const feature = `# Journey

Stories: US-001
Source: src/**

## Sub-features
## How to get to it (user POV)
## Driving it
## Gotchas
`;
const skill = `# Verify

## Launch
## Doctor
## Drive
## Evidence
## Cleanup
`;
function fixture(name: string) {
	const repo = join(root, name);
	mkdirSync(repo, { recursive: true });
	exec(repo, ["init", "-q"]);
	exec(repo, ["config", "user.name", "Fixture"]);
	exec(repo, ["config", "user.email", "fixture@example.test"]);
	put(repo, "README.md", "# Journey\n");
	put(repo, "DESIGN.md", "# Design\n");
	put(repo, "USER_STORIES.md", `# Stories\n\n${liveStory}\n${retiredStory}\n${headingRetiredStory}`);
	put(repo, "docs/adr/001.md", "# Initial decision\n");
	put(repo, "docs/postmortems/README.md", "# Incidents\n");
	put(repo, "features/README.md", "# Index\n\n[Journey](journey.md)\n");
	put(repo, "features/journey.md", feature);
	put(repo, "src/nested/journey.ts", "export const result = 1;\n");
	put(repo, "skills/verify/SKILL.md", skill);
	put(repo, "foundation.json", `${JSON.stringify(adoption(), null, 2)}\n`);
	exec(repo, ["add", "."]);
	exec(repo, ["commit", "-qm", "baseline"]);
	return repo;
}
function cli(repo: string, ...args: string[]) {
	// A CI event file names the harness's own default branch, not the fixture's.
	const result = spawnSync("bun", [script, ...args, "--repo", repo, "--catalog", catalog, "--stories-checker", checker, "--json"], { cwd: repo, encoding: "utf8", env: { ...process.env, GITHUB_EVENT_PATH: "" } });
	return { status: result.status, output: JSON.parse(result.stdout) as { ok: boolean; errors: string[]; needs_evidence?: string[]; stories?: string[]; baselined?: string[]; gaps?: string[]; wrote?: string } };
}
function commit(repo: string, message = "change") {
	exec(repo, ["add", "."]);
	exec(repo, ["commit", "-qm", message]);
}
function receipt(repo: string, base: string) {
	put(repo, "walk/screens/US-001-1.png", "observed frame");
	return {
		schema: "foundation-walk-receipt/1", check: "journey-walk", run: "local-1",
		head: exec(repo, ["rev-parse", "HEAD"]), tree: exec(repo, ["rev-parse", "HEAD^{tree}"]), base,
		started_at: "2026-09-25T10:00:00Z", finished_at: "2026-09-25T10:01:00Z", exit: 0,
		stories: [{ id: "US-001", status: "pass", criteria: [{ n: 1, status: "pass", evidence: ["screens/US-001-1.png"] }, { n: 2, status: "pass", evidence: ["screens/US-001-1.png"] }] }],
		artifacts: [{ path: "screens/US-001-1.png", sha256: hash("observed frame") }],
	};
}

describe("foundation-check (US-024)", () => {
	test("adoption rejects unknown, omitted, and wrong-digest obligations; honest pending passes without compliance claim", () => {
		const repo = fixture("adoption");
		const valid = cli(repo, "check");
		expect(valid.status).toBe(0);
		expect(valid.output.needs_evidence).toContain("FND-DOC-001");
		const sourceRelative = spawnSync("bun", [script, "check", "--repo", repo, "--json"], { cwd: repo, encoding: "utf8" });
		expect(sourceRelative.status).toBe(0);
		expect(JSON.parse(sourceRelative.stdout).needs_evidence).toContain("FND-WS-001");
		const value = adoption();
		value.dispositions["FND-UNKNOWN-001"] = { status: "pending", missing: "walk", owner: "team", next: "run walk" };
		put(repo, "foundation.json", JSON.stringify(value));
		const unknown = cli(repo, "check");
		expect(unknown.status).toBe(1);
		expect(unknown.output.errors.join(" ")).toContain("unknown id FND-UNKNOWN-001");
		delete value.dispositions["FND-UNKNOWN-001"];
		delete value.dispositions["FND-DOC-001"];
		put(repo, "foundation.json", JSON.stringify(value));
		expect(cli(repo, "check").output.errors.join(" ")).toContain("missing or invalid FND-DOC-001");
		value.dispositions["FND-DOC-001"] = adoption().dispositions["FND-DOC-001"];
		value.standard.catalog_sha256 = "0".repeat(64);
		put(repo, "foundation.json", JSON.stringify(value));
		expect(cli(repo, "check").output.errors.join(" ")).toContain("catalog_sha256 differs");
	});

	test("documents, feature map, source matches and verify skill are enforced", () => {
		const repo = fixture("map");
		rmSync(join(repo, "docs/adr/001.md"));
		expect(cli(repo, "check").output.errors.join(" ")).toContain("FND-DOC-001: docs/adr/");
		put(repo, "docs/adr/001.md", "# Decision\n");
		put(repo, "features/journey.md", feature.replace("src/**", "ghost/**"));
		expect(cli(repo, "check").output.errors.join(" ")).toContain("matches no tracked files");
		put(repo, "features/journey.md", feature.replace("src/**", "src/*"));
		expect(cli(repo, "check").output.errors.join(" ")).toContain("Source: src/* matches no tracked files");
		put(repo, "features/journey.md", feature.replace("## Driving it", "## Driving it with a browser"));
		expect(cli(repo, "check").status).toBe(0);
		put(repo, "features/journey.md", feature.replace("## Driving it", "## Another heading"));
		expect(cli(repo, "check").output.errors.join(" ")).toContain("missing ## Driving it");
		put(repo, "features/journey.md", feature.replace("Stories: US-001", "Stories: US-002"));
		const missing = cli(repo, "check").output.errors.join(" ");
		expect(missing).toContain("US-001: absent from every feature");
		expect(missing).toContain("US-002 is not a live story");
		put(repo, "features/journey.md", feature);
		put(repo, "skills/verify/SKILL.md", skill.replace("## Evidence", "## Other"));
		expect(cli(repo, "check").output.errors.join(" ")).toContain("missing verify skill");
	});

	test("invalid CLI invocation exits with usage status", () => {
		const repo = fixture("usage");
		const result = spawnSync("bun", [script, "affected", "--repo", repo], { cwd: repo, encoding: "utf8" });
		expect(result.status).toBe(2);
		expect(result.stderr).toContain("affected requires --base REV");
	});

	test("affected finds source, feature and edited story sections but not unrelated or retired stories", () => {
		const repo = fixture("affected");
		const base = exec(repo, ["rev-parse", "HEAD"]);
		put(repo, "src/nested/journey.ts", "export const result = 2;\n");
		commit(repo, "source");
		expect(cli(repo, "affected", "--base", base).output.stories).toEqual(["US-001"]);
		const source = exec(repo, ["rev-parse", "HEAD"]);
		put(repo, "features/journey.md", `${feature}\nAdditional instructions.\n`);
		commit(repo, "feature");
		expect(cli(repo, "affected", "--base", source).output.stories).toEqual(["US-001"]);
		const featureBase = exec(repo, ["rev-parse", "HEAD"]);
		put(repo, "USER_STORIES.md", `# Stories\n\n${liveStory.replace("show the result", "display the result")}\n${retiredStory.replace("no longer offered", "historically offered")}`);
		commit(repo, "story wording");
		expect(cli(repo, "affected", "--base", featureBase).output.stories).toEqual(["US-001"]);
	});

	test("the change that first creates the map marks stories only through changed source or edited stories", () => {
		const repo = fixture("first-map");
		put(repo, "USER_STORIES.md", `# Stories\n\n${liveStory}\n${otherStory}\n${retiredStory}\n${headingRetiredStory}`);
		exec(repo, ["rm", "-q", "features/README.md", "features/journey.md"]);
		commit(repo, "no map yet");
		const base = exec(repo, ["rev-parse", "HEAD"]);
		put(repo, "features/README.md", "# Index\n\n[Journey](journey.md)\n[Other](other.md)\n");
		put(repo, "features/journey.md", feature);
		put(repo, "features/other.md", feature.replace("# Journey", "# Other").replace("Stories: US-001", "Stories: US-004").replace("Source: src/**", "Source: lib/**"));
		commit(repo, "first map");
		expect(cli(repo, "affected", "--base", base).output.stories).toEqual([]);
		put(repo, "src/nested/journey.ts", "export const result = 3;\n");
		commit(repo, "source in the same change");
		expect(cli(repo, "affected", "--base", base).output.stories).toEqual(["US-001"]);
		// Once the map exists, editing a feature file affects its stories again.
		const mapped = exec(repo, ["rev-parse", "HEAD"]);
		put(repo, "features/other.md", `${readFileSync(join(repo, "features/other.md"), "utf8")}\nMore detail.\n`);
		commit(repo, "edit feature");
		expect(cli(repo, "affected", "--base", mapped).output.stories).toEqual(["US-004"]);
		// Once any map file exists, even without the index, edited or renamed feature files count again.
		const partial = fixture("first-map-partial");
		exec(partial, ["rm", "-q", "features/README.md"]);
		commit(partial, "index missing, feature present");
		const partialBase = exec(partial, ["rev-parse", "HEAD"]);
		put(partial, "features/README.md", "# Index\n\n[Journey](journey.md)\n");
		put(partial, "features/journey.md", feature.replace("Source: src/**", "Source: lib/**"));
		put(partial, "src/nested/journey.ts", "export const result = 4;\n");
		commit(partial, "restore index and move the source glob away from the changed file");
		expect(cli(partial, "affected", "--base", partialBase).output.stories).toEqual(["US-001"]);
		exec(partial, ["mv", "features/journey.md", "features/journeys.md"]);
		put(partial, "features/README.md", "# Index\n\n[Journey](journeys.md)\n");
		put(partial, "src/nested/journey.ts", "export const result = 5;\n");
		commit(partial, "rename the feature too");
		expect(cli(partial, "affected", "--base", partialBase).output.stories).toEqual(["US-001"]);
	});

	test("receipt binds head, tree, affected status, criteria and retained evidence", () => {
		const repo = fixture("receipts");
		const base = exec(repo, ["rev-parse", "HEAD"]);
		put(repo, "src/nested/journey.ts", "export const result = 2;\n");
		commit(repo);
		const valid = receipt(repo, base);
		const save = (value: typeof valid) => put(repo, "walk/walk-receipt.json", JSON.stringify(value));
		const inspect = () => cli(repo, "receipt", "walk/walk-receipt.json", "--base", base);
		save(valid);
		expect(inspect().status).toBe(0);
		save({ ...valid, head: base, tree: base });
		const wrong = inspect().output.errors.join(" ");
		expect(wrong).toContain("head differs");
		expect(wrong).toContain("tree differs");
		save({ ...valid, stories: [] });
		expect(inspect().output.errors.join(" ")).toContain("affected US-001 is missing");
		save({ ...valid, stories: [{ ...valid.stories[0], status: "unwalked" }] });
		expect(inspect().output.errors.join(" ")).toContain("is unwalked");
		save({ ...valid, stories: [{ ...valid.stories[0], criteria: [{ n: 1, status: "fail", evidence: ["screens/US-001-1.png"] }] }] });
		expect(inspect().output.errors.join(" ")).toContain("unpassed or invalid criterion");
		save({ ...valid, artifacts: [{ ...valid.artifacts[0], sha256: "0".repeat(64) }] });
		expect(inspect().output.errors.join(" ")).toContain("digest mismatch");
		const [first, second] = valid.stories[0].criteria;
		save({ ...valid, stories: [{ ...valid.stories[0], criteria: [first] }] });
		expect(inspect().output.errors.join(" ")).toContain("US-001 criteria 1 do not match story criteria 1, 2");
		save({ ...valid, stories: [{ ...valid.stories[0], criteria: [first, first] }] });
		expect(inspect().output.errors.join(" ")).toContain("US-001 criteria 1, 1 do not match story criteria 1, 2");
		save({ ...valid, stories: [{ ...valid.stories[0], criteria: [first, second, { ...second, n: 3 }] }] });
		expect(inspect().output.errors.join(" ")).toContain("do not match story criteria 1, 2");
		save({ ...valid, stories: [...valid.stories, { ...valid.stories[0], id: "US-009" }] });
		expect(inspect().output.errors.join(" ")).toContain("US-009 is not a story at HEAD");
		save({ ...valid, artifacts: [] });
		expect(inspect().output.errors.join(" ")).toContain("not listed in artifacts");
	});
});

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const otherStory = `## US-004 Review the other journey

Statement: When I review, I want the other journey, so I can compare.

Criteria:
1. WHEN reviewing, THE SYSTEM SHALL show the other journey.
`;
function bootstrap(repo: string, baseline: unknown[], mode = "bootstrap") {
	put(repo, "foundation.json", `${JSON.stringify({ ...adoption(), mode, baseline }, null, 2)}\n`);
}

describe("foundation-check ratchet (US-027)", () => {
	test("check lists the gaps instead of crashing when foundation.json is missing", () => {
		const repo = fixture("no-adoption");
		rmSync(join(repo, "foundation.json"));
		rmSync(join(repo, "DESIGN.md"));
		const result = cli(repo, "check");
		expect(result.status).toBe(1);
		expect(result.output.errors.join("\n")).toContain("foundation.json: missing");
		expect(result.output.errors).toContain("[doc:DESIGN.md] FND-DOC-001: missing DESIGN.md");
	});

	test("baseline adopts a never-set-up repository; check passes only while its gaps stay baselined", () => {
		const repo = fixture("bootstrap");
		exec(repo, ["rm", "-q", "foundation.json", "DESIGN.md", "features/README.md", "features/journey.md"]);
		commit(repo, "strip");
		const revision = "1".repeat(40);
		const dry = cli(repo, "baseline", "--owner", "team", "--revision", revision, "--surfaces", "library");
		expect(dry.status).toBe(0);
		expect(dry.output.gaps).toEqual(["doc:DESIGN.md", "map:US-001", "map:index", "walk:US-001"].map((gap) => `${gap} (owner team, expires ${day(30)})`));
		expect(existsSync(join(repo, "foundation.json"))).toBe(false);
		expect(cli(repo, "baseline", "--owner", "team", "--revision", revision, "--surfaces", "library", "--write").output.wrote).toBe(join(repo, "foundation.json"));
		const adopted = cli(repo, "check");
		expect(adopted.status).toBe(0);
		expect(adopted.output.baselined).toHaveLength(3);
		put(repo, "DESIGN.md", "# Design\n");
		expect(cli(repo, "check").output.errors).toContain("baseline doc:DESIGN.md: the gap is fixed; remove the entry");
		expect(cli(repo, "baseline", "--owner", "other", "--write").status).toBe(0);
		const shrunk = JSON.parse(readFileSync(join(repo, "foundation.json"), "utf8"));
		expect(shrunk.baseline.map((entry: { gap: string; owner: string }) => `${entry.gap}:${entry.owner}`)).toEqual(["map:US-001:team", "map:index:team", "walk:US-001:team"]);
		expect(cli(repo, "check").status).toBe(0);
	});

	test("baseline entries must be well formed, current, at most 30 days out, and only in bootstrap mode", () => {
		const repo = fixture("ratchet-rules");
		rmSync(join(repo, "DESIGN.md"));
		const errors = () => cli(repo, "check").output.errors.join("\n");
		bootstrap(repo, [{ gap: "doc:DESIGN.md", owner: "team", expires: day(10) }]);
		expect(cli(repo, "check").status).toBe(0);
		bootstrap(repo, [{ gap: "doc:DESIGN.md", owner: "team", expires: day(-1) }]);
		expect(errors()).toContain(`baseline doc:DESIGN.md: expired ${day(-1)}`);
		expect(errors()).toContain("[doc:DESIGN.md] FND-DOC-001: missing DESIGN.md");
		bootstrap(repo, [{ gap: "doc:DESIGN.md", owner: "team", expires: day(31) }]);
		expect(errors()).toContain("more than 30 days out");
		bootstrap(repo, [{ gap: "doc:DESIGN.md", owner: "team", expires: day(5) }, { gap: "foundation.json", owner: "team", expires: day(5) }]);
		expect(errors()).toContain('invalid baseline gap "foundation.json"');
		bootstrap(repo, [{ gap: "doc:DESIGN.md", owner: "team", expires: day(5) }], "enforced");
		expect(errors()).toContain("an enforced adoption cannot carry a baseline");
		bootstrap(repo, []);
		expect(errors()).toContain("bootstrap mode needs a baseline");
		bootstrap(repo, [{ gap: "doc:DESIGN.md", owner: "team", expires: day(5) }, { gap: "walk:US-002", owner: "team", expires: day(5) }]);
		expect(errors()).toContain("baseline walk:US-002: US-002 is not a live story");
	});

	test("against a base, the baseline only shrinks unless an extension record names the change", () => {
		const repo = fixture("ratchet-base");
		exec(repo, ["rm", "-q", "DESIGN.md"]);
		bootstrap(repo, [{ gap: "doc:DESIGN.md", owner: "team", expires: day(10) }]);
		commit(repo, "bootstrap");
		const base = exec(repo, ["rev-parse", "HEAD"]);
		const fromBase = (name: string) => exec(repo, ["checkout", "-q", "-B", name, base]);
		const against = () => cli(repo, "check", "--base", base);
		fromBase("shrink");
		put(repo, "DESIGN.md", "# Design\n");
		put(repo, "foundation.json", `${JSON.stringify(adoption(), null, 2)}\n`);
		commit(repo, "fix design");
		expect(against().status).toBe(0);
		fromBase("later");
		bootstrap(repo, [{ gap: "doc:DESIGN.md", owner: "team", expires: day(20) }]);
		commit(repo, "extend");
		expect(against().output.errors.join("\n")).toContain(`baseline doc:DESIGN.md: expiry moved from ${day(10)} to ${day(20)}`);
		put(repo, "foundation/extensions/design.json", JSON.stringify({ schema: "foundation-baseline-extension/1", reason: "Design review waits on the rebrand", entries: [{ gap: "doc:DESIGN.md", expires: day(20) }] }));
		commit(repo, "record");
		expect(against().status).toBe(0);
		fromBase("new-entry");
		exec(repo, ["rm", "-q", "docs/adr/001.md"]);
		bootstrap(repo, [{ gap: "doc:DESIGN.md", owner: "team", expires: day(10) }, { gap: "doc:adr", owner: "team", expires: day(10) }]);
		put(repo, "foundation/extensions/stale.json", JSON.stringify({ schema: "foundation-baseline-extension/1", reason: "Unrelated", entries: [{ gap: "skill:verify", expires: day(10) }] }));
		commit(repo, "regress");
		const regressed = against().output.errors.join("\n");
		expect(regressed).toContain("baseline doc:adr: new entry");
		expect(regressed).toContain("skill:verify");
		expect(regressed).toContain("is not an extension in this change");
	});

	test("a first adoption may create its baseline, but a story edited against a base must be mapped", () => {
		const repo = fixture("ratchet-first");
		exec(repo, ["rm", "-q", "foundation.json", "features/journey.md"]);
		commit(repo, "before adoption");
		const base = exec(repo, ["rev-parse", "HEAD"]);
		bootstrap(repo, [{ gap: "map:US-001", owner: "team", expires: day(10) }]);
		commit(repo, "adopt");
		expect(cli(repo, "check", "--base", base).status).toBe(0);
		const adopted = exec(repo, ["rev-parse", "HEAD"]);
		put(repo, "USER_STORIES.md", `# Stories\n\n${liveStory.replace("show the result", "display the result")}\n${retiredStory}\n${headingRetiredStory}`);
		commit(repo, "edit story");
		expect(cli(repo, "check", "--base", adopted).output.errors).toContain("US-001: edited in this change, so it must be mapped; remove baseline map:US-001");
	});

	test("receipts accept unwalked only for baselined, unaffected stories; --all requires every live story", () => {
		const repo = fixture("receipt-baseline");
		put(repo, "USER_STORIES.md", `# Stories\n\n${liveStory}\n${otherStory}\n${retiredStory}\n${headingRetiredStory}`);
		put(repo, "features/README.md", "# Index\n\n[Journey](journey.md)\n[Other](other.md)\n");
		put(repo, "features/other.md", feature.replace("US-001", "US-004").replace("src/**", "other/**"));
		put(repo, "other/review.ts", "export const other = 1;\n");
		bootstrap(repo, [{ gap: "walk:US-004", owner: "team", expires: day(10) }]);
		commit(repo, "second story");
		const base = exec(repo, ["rev-parse", "HEAD"]);
		put(repo, "src/nested/journey.ts", "export const result = 2;\n");
		commit(repo, "source");
		const walked = receipt(repo, base);
		const unwalked = { id: "US-004", status: "unwalked" };
		const save = (value: object) => put(repo, "walk/walk-receipt.json", JSON.stringify(value));
		const inspect = (...args: string[]) => cli(repo, "receipt", "walk/walk-receipt.json", ...args);
		save({ ...walked, stories: [...walked.stories, unwalked] });
		expect(inspect("--base", base).status).toBe(0);
		save({ ...walked, stories: [{ id: "US-001", status: "unwalked" }, unwalked] });
		expect(inspect("--base", base).output.errors).toContain("receipt: US-001 is unwalked");
		bootstrap(repo, [{ gap: "walk:US-001", owner: "team", expires: day(10) }, { gap: "walk:US-004", owner: "team", expires: day(10) }]);
		commit(repo, "baseline US-001");
		save({ ...receipt(repo, base), stories: [{ id: "US-001", status: "unwalked" }, unwalked] });
		expect(inspect("--base", base).output.errors).toContain("receipt: US-001 is affected by this change and must be walked");
		bootstrap(repo, [{ gap: "walk:US-004", owner: "team", expires: day(10) }]);
		commit(repo, "full walk");
		const full = { ...receipt(repo, base), base: null };
		save(full);
		expect(inspect("--all").output.errors).toContain("receipt: US-004 is missing from a full walk");
		save({ ...full, stories: [...full.stories, unwalked] });
		expect(inspect("--all").status).toBe(0);
		const passedOther = { id: "US-004", status: "pass", criteria: [{ n: 1, status: "pass", evidence: ["screens/US-001-1.png"] }] };
		save({ ...full, stories: [...full.stories, passedOther] });
		expect(inspect("--all").output.errors).toContain("receipt: US-004 passed; remove baseline walk:US-004");
		bootstrap(repo, [{ gap: "walk:US-004", owner: "team", expires: day(-1) }]);
		commit(repo, "expired");
		save({ ...receipt(repo, base), base: null, stories: [...full.stories, unwalked] });
		expect(inspect("--all").output.errors).toContain("receipt: US-004 is unwalked");
	});

	test("a baselined map gap does not block affected, but a change receipt cannot excuse an unmapped story", () => {
		const repo = fixture("baselined-map");
		put(repo, "USER_STORIES.md", `# Stories\n\n${liveStory}\n${otherStory}\n${retiredStory}\n${headingRetiredStory}`);
		bootstrap(repo, [{ gap: "map:US-004", owner: "team", expires: day(10) }, { gap: "walk:US-004", owner: "team", expires: day(10) }]);
		commit(repo, "unmapped second story");
		const base = exec(repo, ["rev-parse", "HEAD"]);
		put(repo, "src/nested/journey.ts", "export const result = 2;\n");
		commit(repo, "source");
		const touched = cli(repo, "affected", "--base", base);
		expect(touched.status).toBe(0);
		expect(touched.output.stories).toEqual(["US-001"]);
		const walked = receipt(repo, base);
		put(repo, "walk/walk-receipt.json", JSON.stringify({ ...walked, stories: [...walked.stories, { id: "US-004", status: "unwalked" }] }));
		// No feature places US-004, so nothing shows this change leaves it unaffected: it must be mapped or walked.
		expect(cli(repo, "receipt", "walk/walk-receipt.json", "--base", base).output.errors).toEqual([
			"receipt: US-004 is unwalked but unmapped, so this change's effect on it is unknown; map or walk it",
		]);
		expect(cli(repo, "receipt", "walk/walk-receipt.json").output.errors).toContain("receipt: US-004 is unwalked; a change receipt needs --base to prove it unaffected");
		// A full walk judges no change, so its walk entry still covers the story until it expires.
		put(repo, "walk/walk-receipt.json", JSON.stringify({ ...walked, base: null, stories: [...walked.stories, { id: "US-004", status: "unwalked" }] }));
		expect(cli(repo, "receipt", "walk/walk-receipt.json", "--all").status).toBe(0);
	});

	test("a malformed or far-future walk entry excuses nothing", () => {
		const repo = fixture("bad-walk-entry");
		put(repo, "USER_STORIES.md", `# Stories\n\n${liveStory}\n${otherStory}\n${retiredStory}\n${headingRetiredStory}`);
		put(repo, "features/journey.md", feature.replace("Stories: US-001", "Stories: US-001, US-004"));
		bootstrap(repo, [{ gap: "walk:US-004", expires: "9999-12-31" }]);
		commit(repo, "bad entry");
		const full = { ...receipt(repo, exec(repo, ["rev-parse", "HEAD"])), base: null };
		put(repo, "walk/walk-receipt.json", JSON.stringify({ ...full, stories: [...full.stories, { id: "US-004", status: "unwalked" }] }));
		expect(cli(repo, "receipt", "walk/walk-receipt.json", "--all").output.errors).toContain("receipt: US-004 is unwalked");
		bootstrap(repo, [{ gap: "walk:US-004", owner: "team", expires: day(45) }]);
		commit(repo, "far entry");
		put(repo, "walk/walk-receipt.json", JSON.stringify({ ...full, head: exec(repo, ["rev-parse", "HEAD"]), tree: exec(repo, ["rev-parse", "HEAD^{tree}"]), stories: [...full.stories, { id: "US-004", status: "unwalked" }] }));
		expect(cli(repo, "receipt", "walk/walk-receipt.json", "--all").output.errors).toContain("receipt: US-004 is unwalked");
	});

	test("a first baseline records map gaps before stories exist, and one feature defect cannot cover another", () => {
		const repo = fixture("map-keys");
		exec(repo, ["rm", "-q", "foundation.json", "USER_STORIES.md", "features/README.md", "features/journey.md"]);
		commit(repo, "bare");
		const gaps = cli(repo, "baseline", "--owner", "team", "--revision", "1".repeat(40)).output.gaps?.map((gap) => gap.split(" ")[0]);
		expect(gaps).toContain("map:index");
		expect(gaps).toContain("doc:USER_STORIES.md");
		const mapped = fixture("feature-keys");
		put(mapped, "features/journey.md", feature.replace("## Gotchas\n", ""));
		bootstrap(mapped, [{ gap: "map:features/journey.md:heading:gotchas", owner: "team", expires: day(10) }]);
		expect(cli(mapped, "check").status).toBe(0);
		put(mapped, "features/journey.md", feature.replace("Source: src/**\n", ""));
		const errors = cli(mapped, "check").output.errors;
		expect(errors).toContain("[map:features/journey.md:source-line] features/journey.md: missing Source: line");
		expect(errors).toContain("baseline map:features/journey.md:heading:gotchas: the gap is fixed; remove the entry");
	});
});

describe("foundation-check operational obligations (ADR-005, US-040)", () => {
	const ops = ["FND-REL-001", "FND-ALR-001", "FND-INC-001"];
	const edit = (repo: string, change: (adoption: Record<string, any>) => void) => {
		const adoption = JSON.parse(readFileSync(join(repo, "foundation.json"), "utf8"));
		change(adoption);
		put(repo, "foundation.json", `${JSON.stringify(adoption, null, 2)}\n`);
	};
	const errors = (repo: string) => cli(repo, "check").output.errors.join("\n");

	test("an application owes all three: pending is a timed gap, and neither a waiver nor not_applicable passes", () => {
		const repo = fixture("ops-pending");
		edit(repo, (adoption) => { adoption.surfaces = ["ui", "deployed"]; });
		const pending = cli(repo, "check");
		expect(pending.status).toBe(1);
		for (const id of ops) expect(pending.output.errors.join("\n")).toContain(`${id}: not yet met by this application`);
		expect(cli(repo, "baseline", "--owner", "team", "--write").status).toBe(0);
		const baselined = cli(repo, "check");
		expect(baselined.status).toBe(0);
		for (const gap of ["ops:ship", "ops:alert", "ops:incident"]) expect(baselined.output.baselined!.join("\n")).toContain(`[${gap}]`);
		edit(repo, (adoption) => {
			adoption.dispositions["FND-REL-001"] = { status: "exception", decision: "approvals/rel.json", expires: day(10) };
			adoption.dispositions["FND-ALR-001"] = { status: "not_applicable", decision: "approvals/alr.json" };
		});
		expect(errors(repo)).toContain("FND-REL-001: no exception is allowed");
		expect(errors(repo)).toContain("FND-ALR-001: applies to every application");
		// A repository without surfaces is treated as an application, so it cannot opt out either.
		edit(repo, (adoption) => { delete adoption.surfaces; });
		expect(errors(repo)).toContain("FND-ALR-001: applies to every application");
		// A library is not an application: not_applicable holds and nothing is owed.
		edit(repo, (adoption) => {
			adoption.surfaces = ["library"];
			for (const id of ops) adoption.dispositions[id] = { status: "not_applicable", decision: "approvals/library.json" };
			delete adoption.baseline;
			delete adoption.mode;
		});
		expect(cli(repo, "check").status).toBe(0);
	});

	test("a satisfied claim must hold up: a gated ship job, named alerting, and postmortems that link their class fix", () => {
		const repo = fixture("ops-satisfied");
		// The checker confirms the declared branch is the default one; a clone knows it through origin/HEAD.
		exec(repo, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
		exec(repo, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
		const deploy = (on: string, job: string, gate = "") => put(repo, ".github/workflows/deploy.yml", `name: deploy\non:\n${on}\njobs:\n  test:\n    runs-on: ubuntu-latest\n${gate}    steps: [{ run: "true" }]\n  deploy:\n    runs-on: ubuntu-latest\n${job}    steps: [{ run: "true" }]\n`);
		deploy("  push:\n    branches: [main]", "    needs: [test]\n");
		put(repo, "src/instrument.ts", "import * as Sentry from \"@sentry/node\";\nSentry.init({ release: process.env.RELEASE });\n");
		put(repo, ".github/workflows/health.yml", "name: health\non:\n  schedule:\n    - cron: \"*/5 * * * *\"\njobs:\n  probe:\n    runs-on: ubuntu-latest\n    steps: [{ run: \"curl -f https://example.test/health\" }]\n");
		put(repo, "docs/runbook.md", "# Runbook\n\n## Incidents\n\nSentry and the health probe page Discord #alerts; the on-call agent owns the incident and writes docs/postmortems/.\n");
		const postmortem = (status: string, followUp: string) => put(repo, "docs/postmortems/2026-09-01-stale-cache.md",
			`# Postmortem: stale cache\n\n- **Status:** ${status}\n\n## Summary\n\nx\n\n## Pokayoke\n\nThe cache key now includes the release.\n\n## Follow-up\n\n${followUp}\n`);
		postmortem("closed", "Closed by #42 with a regression test.");
		edit(repo, (adoption) => {
			adoption.surfaces = ["ui", "deployed"];
			for (const id of ops) adoption.dispositions[id] = { status: "satisfied", receipt: `receipts/${id}.json` };
			adoption.operations = {
				ship: { branch: "main", workflow: ".github/workflows/deploy.yml", job: "deploy" },
				alert: { errors: { provider: "sentry", init: "src/instrument.ts" }, health: { monitor: ".github/workflows/health.yml" }, destination: "Discord #alerts" },
			};
		});
		expect(cli(repo, "check").output.errors).toEqual([]);
		const refused = (on: string, job: string, reason: string) => { deploy(on, job); expect(errors(repo)).toContain(`FND-REL-001: satisfied, but ${reason}`); };
		refused("  workflow_dispatch:", "    needs: [test]\n", ".github/workflows/deploy.yml does not run on every push to main");
		refused("  push:\n    branches-ignore: [main]", "    needs: [test]\n", ".github/workflows/deploy.yml does not run on every push to main");
		refused("  push:\n    branches: [main]\n    paths: [src/**]", "    needs: [test]\n", ".github/workflows/deploy.yml does not run on every push to main");
		refused("  push:\n    tags-ignore: [v*]", "    needs: [test]\n", ".github/workflows/deploy.yml does not run on every push to main");
		refused("  push:\n    branches: ['**', '!main']", "    needs: [test]\n", ".github/workflows/deploy.yml does not run on every push to main");
		refused("  push:\n    branches: [main]", "", "job deploy ships without waiting on the gate");
		refused("  push:\n    branches: [main]", "    needs: [test]\n    if: always()\n", "job deploy has if: always()");
		refused("  push:\n  workflow_dispatch:", "    needs: [test]\n    if: github.event_name == 'workflow_dispatch'\n", "job deploy has if: github.event_name == 'workflow_dispatch'");
		refused("  push:", "    needs: [test]\n    if: github.ref == 'refs/heads/production'\n", "job deploy has if: github.ref == 'refs/heads/production'");
		refused("  push:\n    branches: [main]", "    needs: [test]\n    if: contains(github.event.head_commit.message, '[deploy]')\n", "job deploy has if: contains(github.event.head_commit.message, '[deploy]')");
		// The jobs the ship job needs are part of the gate: an opt-in, a non-blocking or a missing one is not shipping on green.
		deploy("  push:\n    branches: [main]", "    needs: [test]\n", "    if: contains(github.event.head_commit.message, '[deploy]')\n");
		expect(errors(repo)).toContain("FND-REL-001: satisfied, but job test has if: contains(github.event.head_commit.message, '[deploy]')");
		deploy("  push:\n    branches: [main]", "    needs: [test]\n", "    continue-on-error: true\n");
		expect(errors(repo)).toContain("FND-REL-001: satisfied, but job test gates the ship job but has continue-on-error");
		refused("  push:\n    branches: [main]", "    needs: [lint]\n", "job deploy needs lint, which does not exist");
		// Globs, a string branch filter, and the usual push guards all ship every green push to main.
		for (const [on, job] of [["  push:\n    branches: ['**']", ""], ["  push:\n    branches: main", ""], ["  push:\n  pull_request:", "    if: github.event_name != 'pull_request'\n"],
			["  push:", "    if: ${{ github.ref == 'refs/heads/main' && github.event_name == 'push' }}\n"], ["  push:", "    if: github.ref_name == github.event.repository.default_branch\n"]]) {
			deploy(on, `    needs: [test]\n${job}`);
			expect(cli(repo, "check").output.errors).toEqual([]);
		}
		// A workflow_run ships only when the workflow it follows is itself the push-triggered gate.
		const upstream = (on: string) => put(repo, ".github/workflows/ci.yml", `name: ci\non:\n${on}\njobs:\n  gate:\n    runs-on: ubuntu-latest\n    steps: [{ run: "true" }]\n`);
		upstream("  push:\n    branches: [main]");
		deploy("  workflow_run:\n    workflows: [ci]\n    types: [completed]", "    if: github.event.workflow_run.conclusion == 'success'\n");
		expect(cli(repo, "check").output.errors).toEqual([]);
		upstream("  workflow_dispatch:");
		expect(errors(repo)).toContain("FND-REL-001: satisfied, but .github/workflows/deploy.yml follows ci, which does not run on every push to main");
		upstream("  push:\n    branches: [main]");
		deploy("  workflow_run:\n    workflows: [Release]\n    types: [completed]", "    if: github.event.workflow_run.conclusion == 'success'\n");
		expect(errors(repo)).toContain("follows Release, which does not run on every push to main");
		deploy("  workflow_run:\n    workflows: [ci]\n    types: [completed]", "    if: github.event.workflow_run.conclusion == 'success'\n");
		edit(repo, (adoption) => { adoption.operations.ship.branch = "release"; });
		expect(errors(repo)).toContain("FND-REL-001: satisfied, but operations.ship.branch is release, but the default branch is main");
		edit(repo, (adoption) => { adoption.operations.ship.branch = "main"; });
		put(repo, "src/instrument.ts", "console.error('no remote capture');\n");
		expect(errors(repo)).toContain("FND-ALR-001: satisfied, but src/instrument.ts does not reference sentry");
		put(repo, "src/instrument.ts", "import * as Sentry from \"@sentry/node\";\n");
		put(repo, ".github/workflows/health.yml", "name: health\non:\n  push:\njobs:\n  probe:\n    runs-on: ubuntu-latest\n    steps: [{ run: \"true\" }]\n");
		expect(errors(repo)).toContain("FND-ALR-001: satisfied, but .github/workflows/health.yml does not run on a schedule");
		edit(repo, (adoption) => { adoption.operations.alert.health = { external: "uptime monitor linejam-prod" }; });
		postmortem("closed", "We will be more careful.");
		expect(errors(repo)).toContain("FND-INC-001: satisfied, but docs/postmortems/2026-09-01-stale-cache.md: a closed postmortem must link the change");
		postmortem("open", "Fix in progress.");
		put(repo, "docs/runbook.md", "# Runbook\n\n## Release\n\nShip it.\n");
		expect(cli(repo, "check").output.errors).toEqual(["FND-INC-001: satisfied, but docs/runbook.md needs a non-empty ## Incidents section"]);
		// A platform deploy (a git integration) proves itself in the receipt rather than a workflow file.
		edit(repo, (adoption) => { adoption.operations.ship = { branch: "main", platform: "vercel" }; });
		rmSync(join(repo, ".github/workflows/deploy.yml"));
		expect(cli(repo, "check").output.errors).toEqual(["FND-INC-001: satisfied, but docs/runbook.md needs a non-empty ## Incidents section"]);
	});

	test("baseline re-pins an existing record and starts obligations the catalog gained as pending", () => {
		const repo = fixture("ops-repin");
		edit(repo, (adoption) => { for (const id of ops) delete adoption.dispositions[id]; });
		expect(errors(repo)).toContain("foundation.json: missing or invalid FND-REL-001");
		const revision = "2".repeat(40);
		expect(cli(repo, "baseline", "--owner", "team", "--revision", revision, "--write").status).toBe(0);
		const repinned = JSON.parse(readFileSync(join(repo, "foundation.json"), "utf8"));
		expect(repinned.standard.revision).toBe(revision);
		expect(repinned.standard.source).toContain(revision);
		for (const id of ops) expect(repinned.dispositions[id].status).toBe("pending");
		// A re-pin keeps the walk entries a record has; it never re-baselines stories.
		expect(repinned.baseline).toBeUndefined();
		expect(repinned.dispositions["FND-CHG-001"]).toEqual(adoption().dispositions["FND-CHG-001"]);
		expect(cli(repo, "check").status).toBe(0);
	});
});

describe("foundation-check review gate (US-027)", () => {
	const agent = "kaylee-agent[bot]";
	const operator = "moomooskycow";
	const marker = "foundation-escalation: product-direction";
	const resolved = "foundation-escalation: resolved\r\nOperator decided on 2026-09-25 to keep the quoted rebrand:\r\n~~~\r\nRebrand the landing page\r\n~~~\r\n";
	let pull = { head: { sha: "" }, base: { sha: "" }, user: { login: "engineer" } };
	let reviews: { user: { login: string }; state: string; commit_id: string; body: string; submitted_at?: string }[] = [];
	let comments: { user: { login: string }; body: string; created_at: string }[] = [];
	let calls: string[] = [];
	const server = Bun.serve({
		port: 0,
		fetch(request) {
			const url = new URL(request.url);
			calls.push(url.pathname);
			if (request.headers.get("authorization") !== "Bearer test-token") return new Response("unauthorized", { status: 401 });
			if (url.pathname.endsWith("/pulls/7")) return Response.json(pull);
			if (url.pathname.endsWith("/pulls/7/reviews")) return Response.json(url.searchParams.get("page") === "1" ? reviews : []);
			if (url.pathname.endsWith("/issues/7/comments")) return Response.json(url.searchParams.get("page") === "1" ? comments : []);
			return new Response("missing", { status: 404 });
		},
	});
	afterAll(() => server.stop(true));
	const said = (login: string, commit: string, state = "APPROVED", body = "") => ({ user: { login }, state, commit_id: commit, body });
	const opened = (base: string, head: string, author = "engineer") => { pull = { head: { sha: head }, base: { sha: base }, user: { login: author } }; };
	async function gate(repo: string, slug = "misty-step/demo") {
		const child = Bun.spawn(["bun", script, "review", "--pr", "7", "--github-repo", slug, "--repo", repo, "--json"], {
			cwd: repo, env: { ...process.env, GITHUB_TOKEN: "test-token", GITHUB_API_URL: server.url.origin }, stdout: "pipe", stderr: "pipe",
		});
		const [stdout] = await Promise.all([new Response(child.stdout).text(), child.exited]);
		return { status: child.exitCode, output: JSON.parse(stdout) as { ok: boolean; errors: string[]; reasons?: string[]; approved_by?: string } };
	}

	test("declaring that the repository is no longer an application needs the designated reviewer", async () => {
		const repo = fixture("gate-surfaces");
		const setSurfaces = (surfaces: string[]) => {
			const adoption = JSON.parse(readFileSync(join(repo, "foundation.json"), "utf8"));
			adoption.surfaces = surfaces;
			put(repo, "foundation.json", `${JSON.stringify(adoption, null, 2)}\n`);
		};
		setSurfaces(["ui", "deployed"]);
		commit(repo, "an application");
		const base = exec(repo, ["rev-parse", "HEAD"]);
		setSurfaces(["library"]);
		commit(repo, "claims to be a library");
		opened(base, exec(repo, ["rev-parse", "HEAD"]));
		reviews = [];
		const result = await gate(repo);
		expect(result.status).toBe(1);
		expect(result.output.reasons).toEqual(["surfaces: foundation.json stops declaring an application (ADR-005)"]);
	});

	test("a PR without first stories or an extension record needs no review and reads no reviews", async () => {
		const repo = fixture("gate-quiet");
		const base = exec(repo, ["rev-parse", "HEAD"]);
		put(repo, "src/nested/journey.ts", "export const result = 2;\n");
		commit(repo, "source");
		opened(base, exec(repo, ["rev-parse", "HEAD"]));
		calls = [];
		const result = await gate(repo);
		expect(result.status).toBe(0);
		expect(result.output.reasons).toEqual([]);
		expect(calls.some((path) => path.endsWith("/reviews"))).toBe(false);
	});

	test("first stories need the agent reviewer's current approval, never the author's or the operator account's", async () => {
		const repo = fixture("gate-stories");
		put(repo, "USER_STORIES.md", "# Stories\n");
		commit(repo, "placeholder without stories");
		const base = exec(repo, ["rev-parse", "HEAD"]);
		put(repo, "USER_STORIES.md", `# Stories\n\n${liveStory}`);
		commit(repo, "first stories");
		const head = exec(repo, ["rev-parse", "HEAD"]);
		opened(base, head);
		reviews = [];
		const missing = await gate(repo);
		expect(missing.status).toBe(1);
		expect(missing.output.reasons).toEqual(["first user stories: USER_STORIES.md gains its first stories"]);
		expect(missing.output.errors[0]).toContain(`needs an approving review from the designated agent reviewer ${agent}`);
		// The PR's own revisions decide, not the checkout: a checkout parked on the base still needs the approval.
		exec(repo, ["checkout", "-q", base]);
		expect((await gate(repo)).status).toBe(1);
		reviews = [said(agent, base)];
		expect((await gate(repo)).status).toBe(1);
		reviews = [said(operator, head)];
		expect((await gate(repo)).status).toBe(1);
		reviews = [said(agent, head)];
		const approved = await gate(repo);
		expect(approved.status).toBe(0);
		expect(approved.output.approved_by).toBe(agent);
		reviews = [said(agent, head), said(agent, head, "CHANGES_REQUESTED")];
		expect((await gate(repo)).status).toBe(1);
		opened(base, head, agent);
		reviews = [said(agent, head)];
		expect((await gate(repo)).output.errors[0]).toContain("authored this PR, so it cannot approve it");
		opened(base, "0".repeat(40));
		expect((await gate(repo)).output.errors[0]).toContain("the checkout lacks commit 000000000000");
	});

	test("an escalation on the head holds the PR until the agent reviewer's later approval records the operator's decision", async () => {
		const repo = fixture("gate-extension");
		const base = exec(repo, ["rev-parse", "HEAD"]);
		put(repo, "foundation/extensions/design.json", JSON.stringify({ schema: "foundation-baseline-extension/1", reason: "Rebrand", entries: [{ gap: "doc:DESIGN.md", expires: day(20) }] }));
		commit(repo, "extension record");
		const head = exec(repo, ["rev-parse", "HEAD"]);
		// The factory authors most PRs under the operator's account; that must not deadlock an escalated PR.
		opened(base, head, operator);
		const escalation = said(agent, head, "COMMENTED", marker);
		// An approval given before the escalation, or a routine one after it, does not clear it.
		reviews = [said(agent, head), escalation];
		const escalated = await gate(repo);
		expect(escalated.output.reasons).toEqual(["baseline extension: foundation/extensions/design.json"]);
		expect(escalated.output.errors[0]).toContain(`needs a later approving review from ${agent} that records the operator's decision`);
		reviews = [escalation, said(agent, head)];
		expect((await gate(repo)).status).toBe(1);
		reviews = [escalation, said(operator, head)];
		expect((await gate(repo)).status).toBe(1);
		// Quoted, fenced, indented or embedded marker text, or a marker below the opening line, is not the agent
		// reviewer stating a decision.
		for (const quoted of [
			"The PR body says foundation-escalation: resolved",
			"> foundation-escalation: resolved",
			"    foundation-escalation: resolved",
			"Quoted PR text:\n~~~text\nfoundation-escalation: resolved\n~~~",
			"```\nfoundation-escalation: resolved\n```",
			"```example```\n~~~\n```\nfoundation-escalation: resolved",
			"Operator decided to keep it.\nfoundation-escalation: resolved",
		]) {
			reviews = [escalation, said(agent, head, "APPROVED", quoted)];
			expect((await gate(repo)).status).toBe(1);
		}
		reviews = [escalation, said(agent, head, "APPROVED", resolved)];
		expect((await gate(repo)).output.approved_by).toBe(agent);
		// A second escalation needs a second recorded decision, even though the earlier approval still stands on GitHub.
		reviews = [escalation, said(agent, head, "APPROVED", resolved), said(agent, head, "COMMENTED", marker)];
		expect((await gate(repo)).status).toBe(1);
		// A marker on an older commit does not carry over; the head still needs the agent reviewer's approval.
		reviews = [said(agent, base, "COMMENTED", marker), said(agent, head)];
		expect((await gate(repo)).status).toBe(0);
		const foreign = await gate(repo, "elsewhere/demo");
		expect(foreign.status).toBe(1);
		expect(foreign.output.errors[0]).toContain("no designated reviewer for elsewhere");
	});

	test("r90group has no reviewer App: a decision recorded under the operator's account counts, and must name the head", async () => {
		const repo = fixture("gate-recorded");
		const base = exec(repo, ["rev-parse", "HEAD"]);
		put(repo, "foundation/extensions/design.json", JSON.stringify({ schema: "foundation-baseline-extension/1", reason: "Rebrand", entries: [{ gap: "doc:DESIGN.md", expires: day(20) }] }));
		commit(repo, "extension record");
		const head = exec(repo, ["rev-parse", "HEAD"]);
		// Agents act as the operator's user in r90group, so the author and the recorder are the same account.
		opened(base, head, operator);
		const note = (body: string, created_at: string, login = operator) => ({ user: { login }, body, created_at });
		const approval = `foundation-review: approved ${head}\nDecision recorded for the agent reviewer.`;
		const recorded = (reviewList: typeof reviews, commentList: typeof comments) => { reviews = reviewList; comments = commentList; return gate(repo, "r90group/habitat"); };
		expect((await recorded([], [])).output.errors[0]).toContain(`first line "foundation-review: approved ${head}"`);
		expect((await recorded([], [note(approval, "2026-09-25T10:00:00Z")])).output.approved_by).toBe(`${operator} (recorded decision)`);
		expect((await recorded([{ ...said(operator, head, "COMMENTED", approval), submitted_at: "2026-09-25T10:00:00Z" }], [])).status).toBe(0);
		// An unsubmitted draft review records nothing.
		expect((await recorded([said(operator, head, "PENDING", approval)], [])).status).toBe(1);
		// Another head, another account, or a quoted marker records nothing.
		expect((await recorded([], [note(`foundation-review: approved ${base}`, "2026-09-25T10:00:00Z")])).status).toBe(1);
		expect((await recorded([], [note(approval, "2026-09-25T10:00:00Z", "engineer")])).status).toBe(1);
		expect((await recorded([], [note(`> ${approval}`, "2026-09-25T10:00:00Z")])).status).toBe(1);
		// An escalation, in either a review or a comment, holds the PR until a later recorded resolution for this head.
		const escalation = note(`${marker}\nNeeds Phaedrus.`, "2026-09-25T11:00:00Z");
		const resolution = (at: string) => note(`foundation-escalation: resolved ${head}\nPhaedrus decided to keep it.`, at);
		expect((await recorded([], [note(approval, "2026-09-25T10:00:00Z"), escalation])).output.errors[0]).toContain("escalated to the operator");
		expect((await recorded([{ ...said(operator, head, "COMMENTED", marker), submitted_at: "2026-09-25T11:00:00Z" }], [note(approval, "2026-09-25T12:00:00Z")])).status).toBe(1);
		expect((await recorded([], [resolution("2026-09-25T09:00:00Z"), escalation])).status).toBe(1);
		expect((await recorded([], [escalation, resolution("2026-09-25T12:00:00Z")])).status).toBe(0);
		// Reviews and comments are ordered only by time, so a resolution in the same second as an escalation review
		// does not clear it.
		expect((await recorded([{ ...said(operator, head, "COMMENTED", marker), submitted_at: "2026-09-25T11:00:00Z" }], [resolution("2026-09-25T11:00:00Z")])).status).toBe(1);
		comments = [];
	});
});
