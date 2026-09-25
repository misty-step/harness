import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
			id: "misty-step.foundation", version: "1.1.0", catalog_sha256: hash(catalogBytes),
			source: "https://github.com/misty-step/harness/blob/1111111111111111111111111111111111111111/agent-config/skills/foundation/foundation-standard-v1.json",
			revision: "1111111111111111111111111111111111111111",
		},
		capabilities: ["User journey"],
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
	const result = spawnSync("bun", [script, ...args, "--repo", repo, "--catalog", catalog, "--stories-checker", checker, "--json"], { cwd: repo, encoding: "utf8" });
	return { status: result.status, output: JSON.parse(result.stdout) as { ok: boolean; errors: string[]; needs_evidence?: string[]; stories?: string[] } };
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
