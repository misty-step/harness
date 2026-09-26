import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
const pending = () => ({ status: "pending", missing: "assessment", owner: "team", next: "Run the relevant check" });
function adoption() {
	return {
		schema: "foundation-adoption/1",
		standard: {
			id: "misty-step.foundation", version: catalogData.version, catalog_sha256: hash(catalogBytes),
			source: "https://github.com/misty-step/harness/blob/1111111111111111111111111111111111111111/agent-config/skills/foundation/foundation-standard-v1.json",
			revision: "1111111111111111111111111111111111111111",
		},
		capabilities: ["User journey"],
		surfaces: ["library"],
		dispositions: Object.fromEntries([...catalogData.obligations, ...catalogData.approved_defaults].map(({ id }: { id: string }) =>
			[id, { status: "satisfied", receipt: `foundation/receipts/${id}.json` }])),
		security: {
			secrets: { workflow: ".github/workflows/security.yml", job: "secrets" },
			dependencies: { bot: "dependabot", config: ".github/dependabot.yml", automerge: { workflow: ".github/workflows/dependencies.yml", job: "automerge" } },
			authorization: { workflow: ".github/workflows/security.yml", job: "auth", test: "tests/auth.test.ts" },
		},
	};
}
function issueEvidence(repo: string) {
	const revision = exec(repo, ["rev-parse", "HEAD"]);
	for (const { id } of [...catalogData.obligations, ...catalogData.approved_defaults]) {
		const path = `foundation/receipts/${id}.json`;
		const bytes = `Executed ${id} against ${revision}\n`;
		put(repo, `foundation/receipts/${id}.txt`, bytes);
		put(repo, path, JSON.stringify({
			schema: "foundation-evidence/1", obligation: id, revision,
			path: `${id}.txt`, sha256: hash(bytes), check: `verify ${id}`, run: `fixture-${revision}`, exit: 0,
		}));
	}
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
	put(repo, ".gitignore", "foundation/receipts/\n");
	put(repo, "README.md", "# Journey\n");
	put(repo, "DESIGN.md", "# Interface design\n\nThe journey has a direct result.\n");
	put(repo, "docs/runbook.md", "# Runbook\n\n## Release\n\nShip a green revision.\n\n## Rollback\n\nRestore the previous revision.\n\n## Recover\n\nRestore service.\n\n## Incidents\n\nInvestigate a controlled alert.\n");
	put(repo, "AGENTS.md", "# Agents\n\n## Routing\n\n| Owner | Command |\n| --- | --- |\n| Gate | `scripts/check` |\n\nRead `DOMAIN.md` for invariants.\n");
	put(repo, "DOMAIN.md", "# Domain\n\n## Glossary\n\nResult: the user outcome.\n\n## Boundaries\n\nThe library owns its result.\n\n## Invariants\n\n- **INV-001** The repository gate decides whether a change is safe. Enforced by `scripts/check`.\n\n## Code map\n\nSource lives under src/.\n");
	put(repo, "USER_STORIES.md", `# Stories\n\n${liveStory}\n${retiredStory}\n${headingRetiredStory}`);
	put(repo, "docs/adr/0001-initial.md", "# Initial decision\n\nStatus: Accepted\n");
	put(repo, "features/README.md", "# Index\n\n[Journey](journey.md)\n");
	put(repo, "features/journey.md", feature);
	put(repo, "src/nested/journey.ts", "export const result = 1;\n");
	put(repo, "skills/verify/SKILL.md", skill);
	put(repo, "scripts/check", "#!/bin/sh\nexit 0\n");
	chmodSync(join(repo, "scripts/check"), 0o755);
	put(repo, ".github/workflows/ci.yml", "name: ci\non: [push, pull_request]\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: scripts/check\n");
	put(repo, ".github/workflows/security.yml", "name: security\non: [push, pull_request]\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: scripts/check\n  secrets:\n    runs-on: ubuntu-latest\n    steps:\n      - run: gitleaks detect --source .\n  auth:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bun test tests/auth.test.ts\n");
	put(repo, ".github/workflows/dependencies.yml", "name: dependencies\non: pull_request\njobs:\n  gate:\n    runs-on: ubuntu-latest\n    steps:\n      - run: scripts/check\n  automerge:\n    if: github.actor == 'dependabot[bot]'\n    needs: [gate]\n    runs-on: ubuntu-latest\n    steps:\n      - uses: dependabot/fetch-metadata@v2\n        id: metadata\n      - run: gh pr merge --auto --squash \"$PR_URL\"\n        if: \"steps.metadata.outputs.update-type == 'version-update:semver-patch' || steps.metadata.outputs.update-type == 'version-update:semver-minor'\"\n");
	put(repo, ".github/workflows/foundation-review.yml", "name: foundation-review\non: pull_request_target\njobs:\n  foundation-review:\n    runs-on: ubuntu-latest\n    steps:\n      - run: foundation-check review --pr \"$PR_NUMBER\"\n");
	put(repo, ".github/dependabot.yml", "version: 2\nupdates:\n  - package-ecosystem: npm\n    directory: /\n    schedule:\n      interval: weekly\n");
	put(repo, "tests/auth.test.ts", "import { expect, test } from 'bun:test';\nconst get = (role: string) => { if (role !== 'owner') throw new Error('forbidden'); return 1; };\ntest('authorization boundary', () => { expect(() => get('stranger')).toThrow('forbidden'); expect(get('owner')).toBe(1); });\n");
	const state = adoption();
	if (name.startsWith("gate-")) for (const id of ["FND-REV-001", "FND-CIT-001"]) state.dispositions[id] = pending();
	put(repo, "foundation.json", `${JSON.stringify(state, null, 2)}\n`);
	exec(repo, ["add", "."]);
	exec(repo, ["commit", "-qm", "baseline"]);
	issueEvidence(repo);
	return repo;
}
function cli(repo: string, ...args: string[]) {
	// A CI event file names the harness's own default branch, not the fixture's.
	const result = spawnSync("bun", [script, ...args, "--repo", repo, "--catalog", catalog, "--stories-checker", checker, "--json"], { cwd: repo, encoding: "utf8", env: { ...process.env, GITHUB_EVENT_PATH: "" } });
	return { status: result.status, output: JSON.parse(result.stdout) as { ok: boolean; errors: string[]; needs_evidence?: string[]; stories?: string[]; baselined?: string[]; advisory?: string[]; gaps?: string[]; wrote?: string } };
}
function commit(repo: string, message = "change") {
	exec(repo, ["add", "."]);
	exec(repo, ["commit", "-qm", message]);
	issueEvidence(repo);
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
	test("adoption rejects unknown, omitted, and wrong-digest obligations; an honestly pending item needs a dated gap", () => {
		const repo = fixture("adoption");
		const valid = cli(repo, "check");
		expect(valid.status).toBe(0);
		const sourceRelative = spawnSync("bun", [script, "check", "--repo", repo, "--json"], { cwd: repo, encoding: "utf8" });
		expect(sourceRelative.status).toBe(0);
		const value = adoption();
		value.dispositions["FND-DOC-001"] = pending();
		put(repo, "foundation.json", JSON.stringify(value));
		expect(cli(repo, "check").output.errors.join(" ")).toContain("obl:FND-DOC-001");
		value.mode = "bootstrap";
		value.baseline = [{ gap: "obl:FND-DOC-001", owner: "team", expires: day(10) }];
		put(repo, "foundation.json", JSON.stringify(value));
		expect(cli(repo, "check").output.needs_evidence).toContain("FND-DOC-001");
		value.baseline = [{ gap: "obl:FND-DOC-001", owner: "team", expires: day(-1) }];
		put(repo, "foundation.json", JSON.stringify(value));
		expect(cli(repo, "check").output.errors.join(" ")).toContain("baseline obl:FND-DOC-001: expired");
		value.baseline = [{ gap: "obl:FND-DOC-001", owner: "team", expires: day(31) }];
		put(repo, "foundation.json", JSON.stringify(value));
		expect(cli(repo, "check").output.errors.join(" ")).toContain("baseline obl:FND-DOC-001: expires");
		value.baseline = [{ gap: "obl:FND-DOC-001", owner: "team", expires: day(10) }];
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

	test("satisfied claims require a same-head, untracked receipt with an intact payload", () => {
		const repo = fixture("evidence-identity");
		const path = "foundation/receipts/FND-DOC-001.json";
		const original = JSON.parse(readFileSync(join(repo, path), "utf8"));
		const failures = () => cli(repo, "check").output.errors.join("\n");
		expect(cli(repo, "check").status).toBe(0);
		put(repo, path, JSON.stringify({ ...original, revision: "0".repeat(40) }));
		expect(failures()).toContain("FND-DOC-001: foundation/receipts/FND-DOC-001.json needs foundation-evidence/1");
		put(repo, path, JSON.stringify({ ...original, sha256: "0".repeat(64) }));
		expect(failures()).toContain("payload is missing, escapes its receipt directory, or has a different SHA-256");
		put(repo, path, JSON.stringify(original));
		put(repo, "foundation/receipts/FND-DOC-001.txt", "tampered output\n");
		expect(failures()).toContain("different SHA-256");
		rmSync(join(repo, path));
		expect(failures()).toContain("receipt must be an untracked foundation/receipts/*.json");
	});

	test("not_applicable and exception require a tracked record matching HEAD, disposition and expiry", () => {
		const repo = fixture("approval-record");
		const id = "FND-DOC-001";
		const value = adoption();
		const reason = "Documentation is delegated to a generated contract";
		const substitute = "Generation and review";
		const approval_ref = "foundation/approvals/document.json";
		value.dispositions[id] = { status: "not_applicable", reason, substitute, approval_ref };
		put(repo, "foundation.json", JSON.stringify(value));
		expect(cli(repo, "check").output.errors.join("\n")).toContain("must be a tracked foundation-approval/1 record at HEAD");
		const approval = { schema: "foundation-approval/1", obligation: id, disposition: "not_applicable", reason, substitute };
		put(repo, approval_ref, JSON.stringify(approval));
		expect(cli(repo, "check").status).toBe(1); // still absent at HEAD
		commit(repo, "reviewable approval record");
		expect(cli(repo, "check").status).toBe(0);
		put(repo, "foundation.json", JSON.stringify({ ...value, dispositions: { ...value.dispositions, [id]: { ...value.dispositions[id], reason: "Changed reason" } } }));
		expect(cli(repo, "check").output.errors.join("\n")).toContain("exactly matching the disposition");
		const expires = day(10);
		value.dispositions[id] = { status: "exception", reason, substitute, approval_ref, expires };
		put(repo, "foundation.json", JSON.stringify(value));
		put(repo, approval_ref, JSON.stringify({ ...approval, disposition: "exception", expires: day(11) }));
		commit(repo, "mismatched exception");
		expect(cli(repo, "check").output.errors.join("\n")).toContain("exactly matching the disposition");
		put(repo, approval_ref, JSON.stringify({ ...approval, disposition: "exception", expires }));
		commit(repo, "match exception");
		expect(cli(repo, "check").status).toBe(0);
	});

	test("ADR-004 core documents, aliases, HEAD references, routing and ledger targets are checked", () => {
		const repo = fixture("core-documents");
		const errors = () => cli(repo, "check").output.errors.join("\n");
		expect(cli(repo, "check").status).toBe(0);
		rmSync(join(repo, "AGENTS.md"));
		expect(errors()).toContain("[doc:AGENTS.md]");
		put(repo, "AGENTS.md", "# Agents\n\n## Routing\n\n| Owner | Command |\n| --- | --- |\n| Gate | `npm run gate` |\n\nRead `DOMAIN.md` for invariants.\n");
		expect(errors()).toContain("routing command npm run gate has no script");
		put(repo, "package.json", JSON.stringify({ scripts: { gate: "scripts/check" } }));
		expect(errors()).toContain("routing command npm run gate has no script"); // untracked manifest is not HEAD
		commit(repo, "track package script");
		expect(cli(repo, "check").status).toBe(0);
		put(repo, "AGENTS.md", "# Agents\n\n## Routing\n\n| Owner | Command |\n| --- | --- |\n| Gate | `npm run gate` |\n");
		expect(errors()).toContain("AGENTS.md must route reviewers to DOMAIN.md");
		put(repo, "AGENTS.md", "# Agents\n\n## Routing\n\n| Owner | Command |\n| --- | --- |\n| Gate | `missing-target` |\n\nRead `DOMAIN.md` for invariants.\n");
		expect(errors()).toContain("routing command missing-target has no script");
		put(repo, "AGENTS.md", "# Agents\n\n## Routing\n\n| Owner | Command |\n| --- | --- |\n| Gate | `npm run gate` |\n\nRead `DOMAIN.md` for invariants.\n");
		put(repo, "README.md", "# Journey\n\n[New path](docs/new.md)\n");
		put(repo, "docs/new.md", "# New\n");
		expect(errors()).toContain("[doc:refs] README.md: Markdown link docs/new.md does not resolve");
		commit(repo, "track linked path");
		expect(cli(repo, "check").status).toBe(0);
		put(repo, "../outside.md", "# Outside repository\n");
		symlinkSync("../../outside.md", join(repo, "docs/escaped.md"));
		put(repo, "README.md", "# Journey\n\n[Escaping link](docs/escaped.md)\n");
		commit(repo, "track outside symlink");
		expect(errors()).toContain("[doc:refs] README.md: Markdown link docs/escaped.md does not resolve");
		put(repo, "README.md", "# Journey\n\n[New path](docs/new.md)\n");
		expect(cli(repo, "check").status).toBe(0);
		put(repo, "CLAUDE.md", "copy of operating rules\n");
		expect(errors()).toContain("[doc:aliases]");
		rmSync(join(repo, "CLAUDE.md"));
		symlinkSync("AGENTS.md", join(repo, "CLAUDE.md"));
		commit(repo, "alias");
		expect(cli(repo, "check").status).toBe(0);
		const baseDomain = readFileSync(join(repo, "DOMAIN.md"), "utf8");
		put(repo, "DOMAIN.md", baseDomain.replace("Enforced by `scripts/check`", "Check: `scripts/check`"));
		expect(errors()).toContain("invalid invariant bullet");
		put(repo, "DOMAIN.md", baseDomain.replace("scripts/check", "scripts/missing.sh"));
		expect(errors()).toContain("INV-001 cites missing check scripts/missing.sh");
		put(repo, "DOMAIN.md", baseDomain.replace("scripts/check", "npm run missing"));
		expect(errors()).toContain("INV-001 cites missing check npm run missing");
		put(repo, "DOMAIN.md", baseDomain.replace("scripts/check", "npm run gate"));
		expect(cli(repo, "check").status).toBe(0);
		put(repo, "DOMAIN.md", baseDomain.replace("Enforced by `scripts/check`.", "`unenforced`. Why: reviewer decision. Scope: src/**."));
		expect(cli(repo, "check").status).toBe(0);
		put(repo, "DOMAIN.md", baseDomain.replace("scripts/check", "eslint/no-restricted-imports"));
		expect(cli(repo, "check").status).toBe(0); // a lint rule id is well-formed but not resolvable from the repo
		put(repo, "DOMAIN.md", baseDomain.replace("## Code map", "- **INV-001** Duplicate rule. `unenforced`\n\n## Code map"));
		expect(errors()).toContain("duplicate INV-001");
		chmodSync(join(repo, "scripts/check"), 0o644);
		expect(errors()).toContain("[entry:check] scripts/check must exist and be executable");
		chmodSync(join(repo, "scripts/check"), 0o755);
		put(repo, "DOMAIN.md", baseDomain);
		for (const name of ["ci", "security", "dependencies"]) {
			const path = `.github/workflows/${name}.yml`;
			put(repo, path, readFileSync(join(repo, path), "utf8").replace("run: scripts/check", "run: echo omitted\n      # scripts/check"));
		}
		expect(errors()).toContain("[entry:check] a CI workflow must invoke scripts/check");
	});

	test("wrapped ledger checks and routing paths resolve from HEAD, not the staged index or working tree", () => {
		const repo = fixture("ledger-head");
		const original = readFileSync(join(repo, "DOMAIN.md"), "utf8");
		const errors = () => cli(repo, "check").output.errors.join("\n");
		put(repo, "DOMAIN.md", original.replace(" Enforced by `scripts/check`", "\n  Enforced by `scripts/check`"));
		expect(cli(repo, "check").status).toBe(0);
		put(repo, "DOMAIN.md", original.replace(" Enforced by `scripts/check`", "\n  Enforced by `scripts/absent`"));
		expect(errors()).toContain("INV-001 cites missing check scripts/absent");
		put(repo, "scripts/new-check", "#!/bin/sh\nexit 0\n");
		exec(repo, ["add", "scripts/new-check"]);
		put(repo, "DOMAIN.md", original.replace("scripts/check", "scripts/new-check"));
		expect(errors()).toContain("INV-001 cites missing check scripts/new-check");
		commit(repo, "track new check");
		expect(cli(repo, "check").status).toBe(0);
		put(repo, "Makefile", "verify:\n\t@true\n");
		put(repo, "DOMAIN.md", original.replace("scripts/check", "make verify"));
		expect(errors()).toContain("INV-001 cites missing check make verify");
		exec(repo, ["add", "Makefile"]);
		expect(errors()).toContain("INV-001 cites missing check make verify");
		commit(repo, "track make target");
		expect(cli(repo, "check").status).toBe(0);
		put(repo, "Makefile", "verify:\n\t@true\nstaged:\n\t@true\n");
		put(repo, "DOMAIN.md", original.replace("scripts/check", "make staged"));
		exec(repo, ["add", "Makefile"]);
		expect(errors()).toContain("INV-001 cites missing check make staged");
		put(repo, "DOMAIN.md", original);
		put(repo, "AGENTS.md", "# Agents\n\n## Route the change\n\n| Path | Command | Owns |\n| --- | --- | --- |\n| `src/` | `scripts/check` | Tools including `not-a-command` |\n\nRead `DOMAIN.md` for invariants.\n");
		expect(cli(repo, "check").status).toBe(0);
		put(repo, "AGENTS.md", readFileSync(join(repo, "AGENTS.md"), "utf8").replace("`src/`", "`src/absent/`"));
		expect(errors()).toContain("routing path src/absent/ does not resolve at HEAD");
	});

	test("enforcement symlinks must resolve entirely within the HEAD tree", () => {
		const repo = fixture("head-target-symlink");
		symlinkSync("../generated/check.sh", join(repo, "scripts/alias"));
		commit(repo, "track symlink without target");
		put(repo, "generated/check.sh", "#!/bin/sh\nexit 0\n");
		const original = readFileSync(join(repo, "DOMAIN.md"), "utf8");
		put(repo, "DOMAIN.md", original.replace("scripts/check", "scripts/alias"));
		put(repo, "AGENTS.md", "# Agents\n\n## Routing\n\n| Owner | Command |\n| --- | --- |\n| Gate | `scripts/alias` |\n\nRead `DOMAIN.md` for invariants.\n");
		const errors = () => cli(repo, "check").output.errors.join("\n");
		expect(errors()).toContain("INV-001 cites missing check scripts/alias");
		expect(errors()).toContain("routing command scripts/alias has no script");
		exec(repo, ["add", "generated/check.sh"]);
		expect(errors()).toContain("INV-001 cites missing check scripts/alias");
		commit(repo, "track link target");
		expect(cli(repo, "check").status).toBe(0);
	});

	test("enforcement targets follow committed symlinks in intermediate directory components", () => {
		const repo = fixture("head-target-directory-symlink");
		mkdirSync(join(repo, "checks"));
		put(repo, "checks/check.sh", "#!/bin/sh\nexit 0\n");
		symlinkSync("checks", join(repo, "checks-link"));
		symlinkSync("../checks-link/check.sh", join(repo, "scripts/alias"));
		commit(repo, "track directory symlink chain");
		const original = readFileSync(join(repo, "DOMAIN.md"), "utf8");
		put(repo, "DOMAIN.md", original.replace("scripts/check", "scripts/alias"));
		put(repo, "AGENTS.md", "# Agents\n\n## Routing\n\n| Owner | Command |\n| --- | --- |\n| Gate | `scripts/alias` |\n\nRead `DOMAIN.md` for invariants.\n");
		expect(cli(repo, "check").status).toBe(0);
	});

	test("symlinked directory parents preserve subsequent '..' components", () => {
		const repo = fixture("head-target-symlink-parent");
		mkdirSync(join(repo, "deep/checks"), { recursive: true });
		put(repo, "check.sh", "#!/bin/sh\nexit 0\n");
		put(repo, "deep/checks/check.sh", "#!/bin/sh\nexit 0\n");
		symlinkSync("deep/checks", join(repo, "checks-link"));
		symlinkSync("../checks-link/../check.sh", join(repo, "scripts/alias"));
		commit(repo, "track symlink path with missing resolved target");
		const original = readFileSync(join(repo, "DOMAIN.md"), "utf8");
		put(repo, "DOMAIN.md", original.replace("scripts/check", "scripts/alias"));
		put(repo, "AGENTS.md", "# Agents\n\n## Routing\n\n| Owner | Command |\n| --- | --- |\n| Gate | `scripts/alias` |\n\nRead `DOMAIN.md` for invariants.\n");
		const errors = cli(repo, "check").output.errors.join("\n");
		expect(errors).toContain("INV-001 cites missing check scripts/alias");
		expect(errors).toContain("routing command scripts/alias has no script");
	});

	test("surface checks and enforced story evidence reject missing owners", () => {
		const repo = fixture("surface-documents");
		const value = { ...adoption(), surfaces: ["ui", "deployed", "content"], content: { schema: "content/schema.json", lint: "scripts/check" } };
		put(repo, "foundation.json", JSON.stringify(value));
		rmSync(join(repo, "DESIGN.md"));
		expect(cli(repo, "check").output.errors.join("\n")).toContain("[doc:DESIGN.md]");
		put(repo, "DESIGN.md", "# Interface\n");
		expect(cli(repo, "check").output.errors.join("\n")).toContain("[doc:content-schema]");
		put(repo, "content/schema.json", "{}");
		commit(repo, "content contract");
		expect(cli(repo, "check").output.errors.join("\n")).not.toContain("[doc:content-schema]");
		const storiesRepo = fixture("strict-story-evidence");
		put(storiesRepo, "USER_STORIES.md", `# Stories\n\n${liveStory}\nEvidence: \`not-present.md\`\n`);
		expect(cli(storiesRepo, "check").output.errors.join("\n")).toContain("[stories:format]");
		const bootstrapValue = { ...adoption(), mode: "bootstrap", baseline: [{ gap: "walk:US-001", owner: "team", expires: day(10) }] };
		put(storiesRepo, "foundation.json", JSON.stringify(bootstrapValue));
		expect(cli(storiesRepo, "check").status).toBe(0);
	});

	test("names-only credential manifests reject value and shell syntax without disclosing it", () => {
		const repo = fixture("env-pass");
		put(repo, ".env.pass", "TOKEN=sample/credential\nBAD=$(unsafe)\n");
		commit(repo, "malformed manifest");
		const failure = cli(repo, "check").output.errors.join("\n");
		expect(failure).toContain("[doc:env-pass] .env.pass: line 2");
		expect(failure).not.toContain("unsafe");
		put(repo, ".env.pass", "# References only\nTOKEN=sample/credential\n");
		expect(cli(repo, "check").status).toBe(0);
	});

	test("ADR integrity rejects duplicate numbers, missing supersession and wrong homes", () => {
		const repo = fixture("adr-integrity");
		put(repo, "docs/adr/0001-another.md", "# Duplicate\n\nStatus: Accepted\n");
		commit(repo, "duplicate ADR number");
		expect(cli(repo, "check").output.errors.join(" ")).toContain("duplicate ADR 1");
		exec(repo, ["rm", "-q", "docs/adr/0001-another.md"]);
		put(repo, "docs/adr/0001-initial.md", "# Decision\n\nStatus: Superseded\n\nSuperseded by ADR-0002\n");
		expect(cli(repo, "check").output.errors.join(" ")).toContain("Superseded by 0002 does not resolve");
		put(repo, "docs/adr/0001-initial.md", "# Decision\n\nStatus: Accepted\n");
		put(repo, "docs/decisions/0002-retired.md", "# Wrong home\n\nStatus: Accepted\n");
		commit(repo, "outside ADR home");
		expect(cli(repo, "check").output.errors.join(" ")).toContain("ADRs belong only in docs/adr/");
	});

	test("generated ADR index and tracked dated postmortem are not decision records", () => {
		const repo = fixture("adr-index-history");
		put(repo, "docs/adr/README.md", "# Decision index\n");
		put(repo, "docs/postmortems/2026-09-01-stale-cache.md", "# Incident record\n");
		commit(repo, "track decision index and incident");
		expect(cli(repo, "check").status).toBe(0);
	});

	test("documents, feature map, source matches and verify skill are enforced", () => {
		const repo = fixture("map");
		put(repo, "docs/adr/0001-initial.md", "# Decision without status\n");
		expect(cli(repo, "check").output.errors.join(" ")).toContain("doc:adr");
		put(repo, "docs/adr/0001-initial.md", "# Decision\n\nStatus: Accepted\n");
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
		rmSync(join(repo, "DOMAIN.md"));
		const result = cli(repo, "check");
		expect(result.status).toBe(1);
		expect(result.output.errors.join("\n")).toContain("foundation.json: missing");
		expect(result.output.errors.join("\n")).toContain("doc:DOMAIN.md");
	});

	test("baseline adopts a never-set-up repository; check passes only while its gaps stay baselined", () => {
		const repo = fixture("bootstrap");
		exec(repo, ["rm", "-q", "foundation.json", "DOMAIN.md", "features/README.md", "features/journey.md"]);
		commit(repo, "strip");
		const revision = "1".repeat(40);
		const dry = cli(repo, "baseline", "--owner", "team", "--revision", revision, "--surfaces", "library");
		expect(dry.status).toBe(0);
		expect(dry.output.gaps?.map((item) => item.split(" ")[0])).toEqual([...catalogData.obligations, ...catalogData.approved_defaults].map(({ id }: { id: string }) => `obl:${id}`).filter((gap) => !["obl:FND-REL-001", "obl:FND-ALR-001", "obl:FND-INC-001"].includes(gap)).concat(["doc:DOMAIN.md", "map:US-001", "map:index", "walk:US-001"]).sort());
		expect(existsSync(join(repo, "foundation.json"))).toBe(false);
		expect(cli(repo, "baseline", "--owner", "team", "--revision", revision, "--surfaces", "library", "--write").output.wrote).toBe(join(repo, "foundation.json"));
		const adopted = cli(repo, "check");
		expect(adopted.output.errors).toEqual([]);
		expect(adopted.output.baselined?.some((line) => line.includes("[doc:DOMAIN.md]"))).toBe(true);
		put(repo, "DOMAIN.md", "# Domain\n\n## Invariants\n\n- **INV-001** The gate decides whether a change is safe. Enforced by `scripts/check`.\n");
		expect(cli(repo, "check").output.errors.join("\n")).toContain("baseline doc:DOMAIN.md: the gap is fixed; remove the entry");
		expect(cli(repo, "baseline", "--owner", "other", "--write").status).toBe(0);
		const shrunk = JSON.parse(readFileSync(join(repo, "foundation.json"), "utf8"));
		expect(shrunk.baseline.map((entry: { gap: string }) => entry.gap)).not.toContain("doc:DOMAIN.md");
		expect(cli(repo, "check").status).toBe(0);
	});

	test("bootstrap does not baseline advisory evidence; enforced transition requires its paths", () => {
		const repo = fixture("bootstrap-evidence");
		exec(repo, ["rm", "-q", "foundation.json", "DOMAIN.md"]);
		commit(repo, "unadopted repository");
		put(repo, "USER_STORIES.md", `# Stories\n\n${liveStory}\nEvidence: \`not-present.md\`\n`);
		const adopted = cli(repo, "baseline", "--owner", "team", "--revision", "1".repeat(40), "--surfaces", "library", "--write");
		expect(adopted.status).toBe(0);
		expect(adopted.output.gaps?.join("\n")).not.toContain("stories:format");
		expect(cli(repo, "check").status).toBe(0);
		const ready = fixture("enforced-evidence");
		put(ready, "USER_STORIES.md", `# Stories\n\n${liveStory}\nEvidence: \`not-present.md\`\n`);
		const before = readFileSync(join(ready, "foundation.json"), "utf8");
		const blocked = cli(ready, "baseline", "--owner", "team", "--no-walk-gaps", "--write");
		expect(blocked.status).toBe(1);
		expect(blocked.output.errors.join("\n")).toContain("[stories:format]");
		expect(readFileSync(join(ready, "foundation.json"), "utf8")).toBe(before);
	});

	test("baseline entries must be well formed, current, at most 30 days out, and only in bootstrap mode", () => {
		const repo = fixture("ratchet-rules");
		rmSync(join(repo, "DOMAIN.md"));
		const errors = () => cli(repo, "check").output.errors.join("\n");
		bootstrap(repo, [{ gap: "doc:DOMAIN.md", owner: "team", expires: day(10) }]);
		expect(cli(repo, "check").status).toBe(0);
		bootstrap(repo, [{ gap: "doc:DOMAIN.md", owner: "team", expires: day(-1) }]);
		expect(errors()).toContain(`baseline doc:DOMAIN.md: expired ${day(-1)}`);
		expect(errors()).toContain("doc:DOMAIN.md");
		bootstrap(repo, [{ gap: "doc:DOMAIN.md", owner: "team", expires: day(31) }]);
		expect(errors()).toContain("more than 30 days out");
		bootstrap(repo, [{ gap: "doc:DOMAIN.md", owner: "team", expires: day(5) }, { gap: "foundation.json", owner: "team", expires: day(5) }]);
		expect(errors()).toContain('invalid baseline gap "foundation.json"');
		bootstrap(repo, [{ gap: "doc:DOMAIN.md", owner: "team", expires: day(5) }], "enforced");
		expect(errors()).toContain("an enforced adoption cannot carry a baseline");
		bootstrap(repo, []);
		expect(errors()).toContain("bootstrap mode needs a baseline");
		bootstrap(repo, [{ gap: "doc:DOMAIN.md", owner: "team", expires: day(5) }, { gap: "walk:US-002", owner: "team", expires: day(5) }]);
		expect(errors()).toContain("baseline walk:US-002: US-002 is not a live story");
	});

	test("against a base, the baseline only shrinks unless an extension record names the change", () => {
		const repo = fixture("ratchet-base");
		exec(repo, ["rm", "-q", "DOMAIN.md"]);
		bootstrap(repo, [{ gap: "doc:DOMAIN.md", owner: "team", expires: day(10) }]);
		commit(repo, "bootstrap");
		const base = exec(repo, ["rev-parse", "HEAD"]);
		const fromBase = (name: string) => exec(repo, ["checkout", "-q", "-B", name, base]);
		const against = () => cli(repo, "check", "--base", base);
		fromBase("shrink");
		put(repo, "DOMAIN.md", "# Domain\n\n## Invariants\n\n- **INV-001** The gate decides whether a change is safe. Enforced by `scripts/check`.\n");
		put(repo, "foundation.json", `${JSON.stringify(adoption(), null, 2)}\n`);
		commit(repo, "fix domain");
		expect(against().status).toBe(0);
		fromBase("later");
		bootstrap(repo, [{ gap: "doc:DOMAIN.md", owner: "team", expires: day(20) }]);
		commit(repo, "extend");
		expect(against().output.errors.join("\n")).toContain(`baseline doc:DOMAIN.md: expiry moved from ${day(10)} to ${day(20)}`);
		put(repo, "foundation/extensions/domain.json", JSON.stringify({ schema: "foundation-baseline-extension/1", reason: "Domain review waits on the boundary decision", entries: [{ gap: "doc:DOMAIN.md", expires: day(20) }] }));
		commit(repo, "record");
		expect(against().status).toBe(0);
		fromBase("new-entry");
		put(repo, "docs/adr/0001-initial.md", "# Decision missing status\n");
		bootstrap(repo, [{ gap: "doc:DOMAIN.md", owner: "team", expires: day(10) }, { gap: "doc:adr", owner: "team", expires: day(10) }]);
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

	test("an unwalked story with a walk entry is advisory, affected or not; a failed walk or an entry-less unwalked story fails", () => {
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
		expect(inspect("--base", base).output.errors).toContain("receipt: US-001 is unwalked and has no valid walk:US-001 baseline entry");
		bootstrap(repo, [{ gap: "walk:US-001", owner: "team", expires: day(10) }, { gap: "walk:US-004", owner: "team", expires: day(10) }]);
		commit(repo, "baseline US-001");
		save({ ...receipt(repo, base), stories: [{ id: "US-001", status: "unwalked" }, unwalked] });
		// US-001 has no walk yet and this change touches it: the gate reports it and still passes.
		const affectedNoWalk = inspect("--base", base);
		expect(affectedNoWalk.status).toBe(0);
		expect(affectedNoWalk.output.advisory).toContain(`US-001 unwalked: no walk yet (walk:US-001, owner team, expires ${day(10)}); affected by this change`);
		// A walk that ran and failed still fails the gate, entry or not.
		save({ ...receipt(repo, base), stories: [{ id: "US-001", status: "fail", criteria: [{ n: 1, status: "fail", evidence: [] }, { n: 2, status: "pass", evidence: [] }] }, unwalked] });
		expect(inspect("--base", base).output.errors).toContain("receipt: US-001 is fail");
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
		expect(inspect("--all").output.errors).toContain("receipt: US-004 is unwalked and has no valid walk:US-004 baseline entry");
	});

	test("a baselined map gap does not block affected, and an unmapped story with no walk yet is advisory", () => {
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
		// Its walk entry says US-004 has no walk yet, so reporting it unwalked is advisory even though no feature places it.
		const change = cli(repo, "receipt", "walk/walk-receipt.json", "--base", base);
		expect(change.output.errors).toEqual([]);
		expect(change.output.advisory).toEqual([`US-004 unwalked: no walk yet (walk:US-004, owner team, expires ${day(10)})`]);
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
		expect(cli(repo, "receipt", "walk/walk-receipt.json", "--all").output.errors).toContain("receipt: US-004 is unwalked and has no valid walk:US-004 baseline entry");
		bootstrap(repo, [{ gap: "walk:US-004", owner: "team", expires: day(45) }]);
		commit(repo, "far entry");
		put(repo, "walk/walk-receipt.json", JSON.stringify({ ...full, head: exec(repo, ["rev-parse", "HEAD"]), tree: exec(repo, ["rev-parse", "HEAD^{tree}"]), stories: [...full.stories, { id: "US-004", status: "unwalked" }] }));
		expect(cli(repo, "receipt", "walk/walk-receipt.json", "--all").output.errors).toContain("receipt: US-004 is unwalked and has no valid walk:US-004 baseline entry");
	});

	test("a first baseline records map gaps before stories exist, and one feature defect cannot cover another", () => {
		const repo = fixture("map-keys");
		exec(repo, ["rm", "-q", "foundation.json", "USER_STORIES.md", "features/README.md", "features/journey.md"]);
		commit(repo, "bare");
		expect(cli(repo, "baseline", "--owner", "team", "--revision", "1".repeat(40)).output.errors.join(" ")).toContain("requires --surfaces");
		const gaps = cli(repo, "baseline", "--owner", "team", "--revision", "1".repeat(40), "--surfaces", "library").output.gaps?.map((gap) => gap.split(" ")[0]);
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
		edit(repo, (adoption) => {
			adoption.surfaces = ["ui", "deployed"];
			for (const id of ops) adoption.dispositions[id] = pending();
		});
		const pendingResult = cli(repo, "check");
		expect(pendingResult.status).toBe(1);
		for (const id of ops) expect(pendingResult.output.errors.join("\n")).toContain(`${id}: not yet met by this application`);
		expect(cli(repo, "baseline", "--owner", "team", "--write").status).toBe(0);
		const baselined = cli(repo, "check");
		expect(baselined.status).toBe(0);
		for (const gap of ["ops:ship", "ops:alert", "ops:incident"]) expect(baselined.output.baselined!.join("\n")).toContain(`[${gap}]`);
		edit(repo, (adoption) => {
			adoption.dispositions["FND-REL-001"] = { status: "exception", approval_ref: "foundation/approvals/rel.json", reason: "Temporary", substitute: "Alternative", expires: day(10) };
			adoption.dispositions["FND-ALR-001"] = { status: "not_applicable", approval_ref: "foundation/approvals/alr.json", reason: "Library", substitute: "None" };
		});
		expect(errors(repo)).toContain("FND-REL-001: no exception is allowed");
		expect(errors(repo)).toContain("FND-ALR-001: applies to every application");
		// A repository without surfaces is treated as an application, so it cannot opt out either.
		edit(repo, (adoption) => { delete adoption.surfaces; });
		expect(errors(repo)).toContain("FND-ALR-001: applies to every application");
		// A library may be not_applicable only with an independently reviewed, tracked record.
		edit(repo, (adoption) => {
			adoption.surfaces = ["library"];
			for (const id of ops) adoption.dispositions[id] = {
				status: "not_applicable", reason: "This library has no running service", substitute: "Consumers own production operation",
				approval_ref: `foundation/approvals/${id}.json`,
			};
			delete adoption.baseline;
			delete adoption.mode;
		});
		for (const id of ops) put(repo, `foundation/approvals/${id}.json`, JSON.stringify({
			schema: "foundation-approval/1", obligation: id, disposition: "not_applicable",
			reason: "This library has no running service", substitute: "Consumers own production operation",
		}));
		commit(repo, "approve library applicability");
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
		put(repo, "docs/runbook.md", "# Runbook\n\n## Release\n\nShip after green.\n\n## Rollback\n\nRestore prior release.\n\n## Recover\n\nRestore service.\n\n## Incidents\n\nSentry and the health probe alert kaylee-alert-intake; triage owns the incident and writes docs/postmortems/.\n");
		const postmortem = (status: string, followUp: string) => put(repo, "docs/postmortems/2026-09-01-stale-cache.md",
			`# Postmortem: stale cache\n\n- **Status:** ${status}\n\n## Summary\n\nx\n\n## Pokayoke\n\nThe cache key now includes the release.\n\n## Follow-up\n\n${followUp}\n`);
		postmortem("closed", "Closed by #42 with a regression test.");
		edit(repo, (adoption) => {
			adoption.surfaces = ["ui", "deployed"];
			for (const id of ops) adoption.dispositions[id] = { status: "satisfied", receipt: `foundation/receipts/${id}.json` };
			adoption.operations = {
				ship: { branch: "main", workflow: ".github/workflows/deploy.yml", job: "deploy", tenancy: { model: "single" } },
				alert: { errors: { provider: "sentry", init: "src/instrument.ts" }, health: { monitor: ".github/workflows/health.yml" }, destination: "kaylee-alert-intake" },
			};
		});
		expect(cli(repo, "check").output.errors).toEqual([]);
		for (const destination of ["phaedrus@example.com", "Discord #alerts"]) {
			edit(repo, (adoption) => { adoption.operations.alert.destination = destination; });
			expect(cli(repo, "check").output.errors).toEqual([
				"FND-ALR-001: satisfied, but operations.alert.destination must name an approved agent triage route: kaylee-alert-intake",
			]);
		}
		edit(repo, (adoption) => { adoption.operations.alert.destination = "kaylee-alert-intake"; });
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
		put(repo, "docs/runbook.md", "# Runbook\n\n## Release\n\nShip it.\n\n## Rollback\n\nRestore.\n\n## Recover\n\nRestart.\n");
		expect(cli(repo, "check").output.errors).toEqual(["FND-INC-001: satisfied, but docs/runbook.md needs a non-empty ## Incidents section"]);
		// A platform deploy (a git integration) proves itself in the receipt rather than a workflow file.
		edit(repo, (adoption) => { adoption.operations.ship = { branch: "main", platform: "vercel", tenancy: { model: "single" } }; });
		rmSync(join(repo, ".github/workflows/deploy.yml"));
		expect(cli(repo, "check").output.errors).toEqual(["FND-INC-001: satisfied, but docs/runbook.md needs a non-empty ## Incidents section"]);
	});

	test("a satisfied ship validates tenancy, migration order and reviewed exclusions", () => {
		const repo = fixture("ops-tenancy");
		exec(repo, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
		exec(repo, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
		put(repo, ".github/workflows/deploy.yml", `name: deploy
on:
  push:
    branches: [main]
jobs:
  gate:
    runs-on: ubuntu-latest
    steps: [{ run: "true" }]
  migrate:
    needs: [gate]
    runs-on: ubuntu-latest
    steps: [{ run: "true" }]
  ready:
    needs: [migrate]
    runs-on: ubuntu-latest
    steps: [{ run: "true" }]
  ship:
    needs: [ready]
    runs-on: ubuntu-latest
    steps: [{ run: "true" }]
`);
		put(repo, "tenants/registry.txt", "acme\nbravo\n");
		put(repo, "scripts/tenant-state.sh", "#!/bin/sh\n# Report each tenant's deployed revision and migration level.\n");
		edit(repo, (adoption) => {
			adoption.surfaces = ["deployed"];
			adoption.dispositions["FND-REL-001"] = { status: "satisfied", receipt: "foundation/receipts/FND-REL-001.json" };
			adoption.operations = {
				ship: { branch: "main", workflow: ".github/workflows/deploy.yml", job: "ship" },
			};
		});
		const shipErrors = () => cli(repo, "check").output.errors.filter((message) => message.startsWith("FND-REL-001:"));
		expect(shipErrors()).toContain("FND-REL-001: satisfied, but operations.ship.tenancy must declare model single or multi");
		put(repo, ".github/workflows/deploy.yml", readFileSync(join(repo, ".github/workflows/deploy.yml"), "utf8").replace("  push:\n    branches: [main]", "  workflow_dispatch:"));
		expect(shipErrors()).toContain("FND-REL-001: satisfied, but .github/workflows/deploy.yml does not run on every push to main");
		put(repo, ".github/workflows/deploy.yml", readFileSync(join(repo, ".github/workflows/deploy.yml"), "utf8").replace("  workflow_dispatch:", "  push:\n    branches: [main]"));
		edit(repo, (adoption) => { adoption.operations.ship.tenancy = { model: "single" }; });
		expect(shipErrors()).toEqual([]);
		const multi = { model: "multi", registry: "tenants/registry.txt", state: "scripts/tenant-state.sh", migrate: "migrate", excluded: [{ tenant: "bravo", reason: "Contractual maintenance window" }] };
		edit(repo, (adoption) => { adoption.operations.ship.tenancy = multi; });
		expect(shipErrors()).toEqual([]);
		put(repo, "tenants/registry.txt", "tenants:\n  acme: {}\n  bravo: {}\n");
		expect(shipErrors()).toEqual([]);
		put(repo, "tenants/registry.txt", "acme\nbravo\n");
		edit(repo, (adoption) => { adoption.operations.ship = { branch: "main", platform: "vercel", tenancy: multi }; });
		expect(shipErrors()).toContain("FND-REL-001: satisfied, but multi-tenant shipping needs a workflow job, not a platform, to verify migration order");
		edit(repo, (adoption) => { adoption.operations.ship = { branch: "main", workflow: ".github/workflows/deploy.yml", job: "ship", tenancy: multi }; });
		edit(repo, (adoption) => { adoption.operations.ship.tenancy.migrate = "gate"; });
		expect(shipErrors()).toEqual([]);
		edit(repo, (adoption) => { adoption.operations.ship.tenancy.migrate = "other"; });
		expect(shipErrors()).toContain("FND-REL-001: satisfied, but operations.ship.tenancy.migrate must name an existing job in .github/workflows/deploy.yml");
		put(repo, ".github/workflows/deploy.yml", readFileSync(join(repo, ".github/workflows/deploy.yml"), "utf8").replace("  ship:\n    needs: [ready]", "  other:\n    runs-on: ubuntu-latest\n    steps: [{ run: \"true\" }]\n  ship:\n    needs: [ready]"));
		expect(shipErrors()).toContain("FND-REL-001: satisfied, but job other must be in the transitive needs chain before ship");
		edit(repo, (adoption) => { adoption.operations.ship.tenancy.migrate = "migrate"; });
		put(repo, ".github/workflows/deploy.yml", readFileSync(join(repo, ".github/workflows/deploy.yml"), "utf8").replace("  migrate:\n    needs: [gate]", "  migrate:\n    needs: [gate]\n    if: always()"));
		expect(shipErrors()).toContain("FND-REL-001: satisfied, but job migrate has if: always(), which does not ship every green push");
		put(repo, ".github/workflows/deploy.yml", readFileSync(join(repo, ".github/workflows/deploy.yml"), "utf8").replace("    if: always()\n", ""));
		expect(shipErrors()).toEqual([]);
		edit(repo, (adoption) => { adoption.operations.ship.tenancy.registry = "tenants/missing.txt"; });
		expect(shipErrors()).toContain("FND-REL-001: satisfied, but operations.ship.tenancy.registry must name an existing repository file listing every tenant");
		edit(repo, (adoption) => { adoption.operations.ship.tenancy.registry = multi.registry; adoption.operations.ship.tenancy.state = "scripts/missing.sh"; });
		expect(shipErrors()).toContain("FND-REL-001: satisfied, but operations.ship.tenancy.state must name an existing repository file reporting each tenant's deployed revision and migration level");
		edit(repo, (adoption) => { adoption.operations.ship.tenancy.state = multi.state; adoption.operations.ship.tenancy.excluded[0].reason = " "; });
		expect(shipErrors()).toContain("FND-REL-001: satisfied, but operations.ship.tenancy.excluded[0].reason must be non-empty");
		edit(repo, (adoption) => { adoption.operations.ship.tenancy.excluded[0] = { tenant: "charlie", reason: "Controlled exception" }; });
		expect(shipErrors()).toContain("FND-REL-001: satisfied, but operations.ship.tenancy.excluded[0].tenant charlie is not in tenants/registry.txt");
		edit(repo, (adoption) => { adoption.operations.ship.tenancy.excluded[0].tenant = "ac"; });
		expect(shipErrors()).toContain("FND-REL-001: satisfied, but operations.ship.tenancy.excluded[0].tenant ac is not in tenants/registry.txt");
		edit(repo, (adoption) => { adoption.operations.ship.tenancy.excluded[0].tenant = ""; });
		expect(shipErrors()).toContain("FND-REL-001: satisfied, but operations.ship.tenancy.excluded[0].tenant must be non-empty");
		edit(repo, (adoption) => { adoption.operations.ship.tenancy.model = "unknown"; });
		expect(shipErrors()).toContain("FND-REL-001: satisfied, but operations.ship.tenancy.model must be single or multi");
	});

	test("baseline re-pins an existing record and starts obligations the catalog gained as pending", () => {
		const repo = fixture("ops-repin");
		edit(repo, (adoption) => { for (const id of [...ops, "FND-REV-001", "FND-SEC-001", "FND-CIT-001"]) delete adoption.dispositions[id]; });
		expect(errors(repo)).toContain("foundation.json: missing or invalid FND-REL-001");
		const revision = "2".repeat(40);
		expect(cli(repo, "baseline", "--owner", "team", "--revision", revision, "--write").status).toBe(0);
		const repinned = JSON.parse(readFileSync(join(repo, "foundation.json"), "utf8"));
		expect(repinned.standard.revision).toBe(revision);
		expect(repinned.standard.source).toContain(revision);
		for (const id of [...ops, "FND-REV-001", "FND-SEC-001", "FND-CIT-001"]) expect(repinned.dispositions[id].status).toBe("pending");
		// A re-pin dates new obligations, retaining only existing walk entries.
		expect(repinned.baseline.map((entry: { gap: string }) => entry.gap)).toEqual(
			["FND-REV-001", "FND-SEC-001", "FND-CIT-001"].map((id) => `obl:${id}`).sort(),
		);
		expect(repinned.dispositions["FND-CHG-001"]).toEqual(adoption().dispositions["FND-CHG-001"]);
		expect(cli(repo, "check").status).toBe(0);
	});
});

describe("foundation-check security baseline (ADR-006, US-024)", () => {
	test("a satisfied security claim checks secret scan, bot update gate and application authorization test", () => {
		const repo = fixture("security-baseline");
		const value = JSON.parse(readFileSync(join(repo, "foundation.json"), "utf8"));
		const save = () => put(repo, "foundation.json", JSON.stringify(value));
		const errors = () => cli(repo, "check").output.errors.join("\n");
		expect(cli(repo, "check").status).toBe(0);
		const workflow = readFileSync(join(repo, ".github/workflows/security.yml"), "utf8");
		put(repo, ".github/workflows/security.yml", workflow.replace("gitleaks detect --source .", "echo skipped"));
		expect(errors()).toContain("FND-SEC-001: satisfied, but security.secrets job must run a secret scanner");
		put(repo, ".github/workflows/security.yml", workflow);
		put(repo, ".github/workflows/security.yml", workflow.replace("  secrets:\n    runs-on:", "  secrets:\n    continue-on-error: true\n    runs-on:"));
		expect(errors()).toContain("security.secrets scanner job and relevant steps must block the gate on failure");
		put(repo, ".github/workflows/security.yml", workflow.replace("      - run: gitleaks detect --source .", "      - run: gitleaks detect --source .\n        continue-on-error: true"));
		expect(errors()).toContain("security.secrets scanner job and relevant steps must block the gate on failure");
		put(repo, ".github/workflows/security.yml", workflow.replace("  secrets:\n    runs-on:", "  secrets:\n    if: github.event_name == 'push'\n    runs-on:"));
		expect(errors()).toContain("security.secrets scanner job and relevant steps must run on every applicable PR and push");
		put(repo, ".github/workflows/security.yml", workflow.replace("      - run: gitleaks detect --source .", "      - run: gitleaks detect --source .\n        if: false"));
		expect(errors()).toContain("security.secrets scanner job and relevant steps must run on every applicable PR and push");
		put(repo, ".github/workflows/security.yml", workflow.replace("on: [push, pull_request]",
			"on:\n  push:\n    paths: ['src/**']\n  pull_request:\n    paths: ['src/**']"));
		expect(errors()).toContain("security.secrets workflow cannot filter push changes");
		expect(errors()).toContain("security.secrets workflow cannot filter pull_request changes");
		put(repo, ".github/workflows/security.yml", workflow.replace("on: [push, pull_request]",
			"on:\n  push:\n  pull_request:\n    types: [closed]"));
		expect(errors()).toContain("security.secrets workflow must scan opened, synchronized and reopened PRs");
		put(repo, ".github/workflows/security.yml", workflow);
		value.security.secrets.job = "absent";
		save();
		expect(errors()).toContain("security.secrets: .github/workflows/security.yml has no job absent");
		value.security.secrets.job = "secrets";
		value.security.dependencies.bot = "none";
		save();
		expect(errors()).toContain("security.dependencies needs a configured Dependabot");
		value.security.dependencies.bot = "dependabot";
		const merge = readFileSync(join(repo, ".github/workflows/dependencies.yml"), "utf8");
		put(repo, ".github/workflows/dependencies.yml", merge.replace("needs: [gate]", "needs: [missing]"));
		save();
		expect(errors()).toContain("security.dependencies.automerge job needs an existing blocking gate job");
		put(repo, ".github/workflows/dependencies.yml", merge.replace("      - run: scripts/check", "      - run: scripts/check\n        continue-on-error: true"));
		expect(errors()).toContain("security.dependencies.automerge job needs an existing blocking gate job");
		put(repo, ".github/workflows/dependencies.yml", merge.replace("      - run: scripts/check", "      - run: scripts/check\n        if: false"));
		expect(errors()).toContain("security.dependencies.automerge job needs an existing blocking gate job");
		put(repo, ".github/workflows/dependencies.yml", merge.replace("      - run: scripts/check", "      - run: scripts/check\n      - run: echo upload\n        if: always()"));
		expect(errors()).not.toContain("security.dependencies.automerge job needs an existing blocking gate job");
		put(repo, ".github/workflows/dependencies.yml", merge.replace("  gate:\n    runs-on:", "  gate:\n    if: always()\n    runs-on:"));
		expect(errors()).toContain("security.dependencies.automerge job needs an existing blocking gate job");
		put(repo, ".github/workflows/dependencies.yml", merge.replace("  gate:\n    runs-on:",
			"  upstream:\n    runs-on: ubuntu-latest\n    steps:\n      - run: scripts/check\n        continue-on-error: true\n  gate:\n    needs: [upstream]\n    runs-on:"));
		expect(errors()).toContain("security.dependencies.automerge job needs an existing blocking gate job");
		put(repo, ".github/workflows/dependencies.yml", merge.replace("github.actor == 'dependabot[bot]'", "github.actor == 'engineer'"));
		expect(errors()).toContain("security.dependencies.automerge job must be restricted to the dependency bot");
		put(repo, ".github/workflows/dependencies.yml", merge.replace("version-update:semver-minor", "version-update:semver-major"));
		expect(errors()).toContain("security.dependencies.automerge needs Dependabot metadata and a patch-or-minor-only merge guard");
		put(repo, ".github/workflows/dependencies.yml", merge.replace("github.actor == 'dependabot[bot]'", "true || github.actor == 'dependabot[bot]'"));
		expect(errors()).toContain("security.dependencies.automerge job must be restricted to the dependency bot");
		put(repo, ".github/workflows/dependencies.yml", merge);
		value.surfaces = ["ui"];
		save();
		expect(errors()).not.toContain("FND-SEC-001");
		value.security.authorization.test = "tests/missing.test.ts";
		save();
		expect(errors()).toContain("security.authorization.test must name a tracked authorization-boundary test");
		value.security.authorization.test = "tests/auth.test.ts";
		put(repo, ".github/workflows/security.yml", workflow.replace("bun test tests/auth.test.ts", "echo no authorization test"));
		save();
		expect(errors()).toContain("security.authorization job must run its named test");
		put(repo, ".github/workflows/security.yml", workflow.replace("      - run: bun test tests/auth.test.ts", "      - run: bun test tests/auth.test.ts\n        if: false"));
		expect(errors()).toContain("security.authorization test job and relevant steps must run on every applicable PR and push");
		put(repo, ".github/workflows/security.yml", workflow.replace("  auth:\n    runs-on:", "  auth:\n    continue-on-error: true\n    runs-on:"));
		expect(errors()).toContain("security.authorization test job and relevant steps must block the gate on failure");
		put(repo, ".github/workflows/security.yml", workflow.replace("      - run: bun test tests/auth.test.ts", "      - run: bun test tests/auth.test.ts\n        continue-on-error: true"));
		expect(errors()).toContain("security.authorization test job and relevant steps must block the gate on failure");
		put(repo, ".github/workflows/security.yml", workflow.replace("  auth:\n    runs-on:",
			"  auth:\n    if: github.event_name == 'pull_request'\n    runs-on:"));
		expect(errors()).not.toContain("FND-SEC-001");
	});

	test("secret scanning and authorization reject skipped or nonblocking prerequisite jobs", () => {
		const repo = fixture("security-prerequisites");
		const value = adoption();
		value.surfaces = ["ui"];
		put(repo, "foundation.json", JSON.stringify(value));
		const original = readFileSync(join(repo, ".github/workflows/security.yml"), "utf8");
		const chained = original.replace("  secrets:\n    runs-on:", "  secrets:\n    needs: [preflight]\n    runs-on:")
			.replace("  auth:\n    runs-on:", "  auth:\n    needs: [preflight]\n    runs-on:");
		const errors = () => cli(repo, "check").output.errors.join("\n");
		for (const guard of ["if: false", "continue-on-error: true"]) {
			put(repo, ".github/workflows/security.yml", chained.replace("  secrets:", `  preflight:\n    ${guard}\n    runs-on: ubuntu-latest\n    steps:\n      - run: scripts/check\n  secrets:`));
			expect(errors()).toContain("security.secrets scanner prerequisite jobs must run and block");
			expect(errors()).toContain("security.authorization test prerequisite jobs must run and block");
		}
		put(repo, ".github/workflows/security.yml", chained.replace("  secrets:", "  upstream:\n    if: false\n    runs-on: ubuntu-latest\n    steps:\n      - run: scripts/check\n  preflight:\n    needs: [upstream]\n    runs-on: ubuntu-latest\n    steps:\n      - run: scripts/check\n  secrets:"));
		expect(errors()).toContain("security.secrets scanner prerequisite jobs must run and block");
		put(repo, ".github/workflows/security.yml", chained.replace("  secrets:", "  preflight:\n    runs-on: ubuntu-latest\n    steps:\n      - run: scripts/check\n  secrets:"));
		expect(errors()).not.toContain("FND-SEC-001");
	});

	test("dependency gate accepts failure-only diagnostics but never a conditional check or job", () => {
		const repo = fixture("dependency-diagnostics");
		const original = readFileSync(join(repo, ".github/workflows/dependencies.yml"), "utf8");
		const errors = () => cli(repo, "check").output.errors.join("\n");
		const upload = "      - uses: actions/upload-artifact@v4\n        if: failure()\n        with:\n          name: diagnostics\n          path: logs/\n";
		put(repo, ".github/workflows/dependencies.yml", original.replace("      - run: scripts/check\n", `      - run: scripts/check\n${upload}`));
		expect(errors()).not.toContain("security.dependencies.automerge job needs an existing blocking gate job");
		put(repo, ".github/workflows/dependencies.yml", original.replace("      - run: scripts/check\n", `      - run: scripts/check\n        if: failure()\n${upload}`));
		expect(errors()).toContain("security.dependencies.automerge job needs an existing blocking gate job");
		put(repo, ".github/workflows/dependencies.yml", original.replace("      - run: scripts/check\n", upload));
		expect(errors()).toContain("security.dependencies.automerge job needs an existing blocking gate job");
		put(repo, ".github/workflows/dependencies.yml", original.replace("  gate:\n    runs-on:", "  gate:\n    if: failure()\n    runs-on:"));
		expect(errors()).toContain("security.dependencies.automerge job needs an existing blocking gate job");
	});
	test("authorization PR workflow rejects closed-only and path-filtered triggers", () => {
		const repo = fixture("authorization-trigger");
		const value = adoption();
		value.surfaces = ["ui"];
		value.security.authorization.workflow = ".github/workflows/authorization.yml";
		const authWorkflow = "name: authorization\non:\n  pull_request:\n    types: [opened, synchronize, reopened]\njobs:\n  auth:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bun test tests/auth.test.ts\n";
		put(repo, ".github/workflows/authorization.yml", authWorkflow);
		commit(repo, "track authorization workflow");
		put(repo, "foundation.json", JSON.stringify(value));
		const errors = () => cli(repo, "check").output.errors.join("\n");
		put(repo, ".github/workflows/authorization.yml", authWorkflow.replace("opened, synchronize, reopened", "closed"));
		expect(errors()).toContain("security.authorization workflow must scan opened, synchronized and reopened PRs");
		put(repo, ".github/workflows/authorization.yml", authWorkflow.replace("    types:", "    paths: ['src/**']\n    types:"));
		expect(errors()).toContain("security.authorization workflow cannot filter pull_request changes");
		put(repo, ".github/workflows/authorization.yml", authWorkflow);
		expect(errors()).not.toContain("FND-SEC-001");
	});

});

describe("foundation-check review gate (US-027)", () => {
	const agent = "kaylee-agent[bot]";
	const operator = "moomooskycow";
	const marker = "foundation-escalation: product-direction";
	const resolved = "foundation-escalation: resolved\r\nOperator decided on 2026-09-25 to keep the quoted rebrand:\r\n~~~\r\nRebrand the landing page\r\n~~~\r\n";
	let pull = { head: { sha: "" }, base: { sha: "" }, user: { login: "engineer" }, body: "" };
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
	const opened = (base: string, head: string, author = "engineer", body = "") => { pull = { head: { sha: head }, base: { sha: base }, user: { login: author }, body }; };
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

	test("ordinary PRs need independent review and mapped source citations, not a designated-review trigger", async () => {
		const repo = fixture("gate-quiet");
		const base = exec(repo, ["rev-parse", "HEAD"]);
		put(repo, "src/nested/journey.ts", "export const result = 2;\n");
		commit(repo, "source");
		const head = exec(repo, ["rev-parse", "HEAD"]);
		opened(base, head);
		reviews = [said("engineer", head)];
		const missing = await gate(repo);
		expect(missing.output.errors.join("\n")).toContain("FND-CIT-001");
		expect(missing.output.errors.join("\n")).toContain("FND-REV-001");
		opened(base, head, "engineer", "Stories: US-001");
		reviews = [said("engineer", head)];
		expect((await gate(repo)).output.errors.join("\n")).toContain("FND-REV-001");
		reviews = [said("teammate", base)];
		expect((await gate(repo)).status).toBe(1);
		reviews = [said("teammate", head)];
		const result = await gate(repo);
		expect(result.status).toBe(0);
		expect(result.output.reasons).toEqual([]);
		expect(result.output.approved_by).toBe("teammate");
		expect(calls.some((path) => path.endsWith("/reviews"))).toBe(true);
	});

	test("citation covers each mapped source story even when the review checkout stays at the base", async () => {
		const repo = fixture("gate-citation");
		put(repo, "USER_STORIES.md", `# Stories\n\n${liveStory}\n${otherStory}`);
		put(repo, "features/journey.md", feature.replace("Stories: US-001", "Stories: US-001, US-004"));
		commit(repo, "two mapped stories");
		const base = exec(repo, ["rev-parse", "HEAD"]);
		put(repo, "src/nested/journey.ts", "export const result = 4;\n");
		commit(repo, "mapped source");
		const head = exec(repo, ["rev-parse", "HEAD"]);
		reviews = [said("teammate", head)];
		opened(base, head, "engineer", "Stories: US-001");
		exec(repo, ["checkout", "-q", base]); // review runs from the trusted base, not PR files
		expect((await gate(repo)).output.errors.join("\n")).toContain("must cite mapped source story US-004");
		opened(base, head, "engineer", "Stories: US-001, US-004");
		expect((await gate(repo)).status).toBe(0);
	});

	test("PR citations cover source remaps but do not apply to story-only or feature-only changes", async () => {
		const repo = fixture("gate-remap");
		put(repo, "lib/journey.ts", "export const alternate = 1;\n");
		commit(repo, "add alternate source");
		const base = exec(repo, ["rev-parse", "HEAD"]);
		put(repo, "src/nested/journey.ts", "export const result = 2;\n");
		put(repo, "features/journey.md", feature.replace("Source: src/**", "Source: lib/**"));
		commit(repo, "move map away from changed source");
		const head = exec(repo, ["rev-parse", "HEAD"]);
		reviews = [said("teammate", head)];
		opened(base, head);
		expect((await gate(repo)).output.errors.join("\n")).toContain("must cite mapped source story US-001");
		opened(base, head, "engineer", "Stories: US-001");
		expect((await gate(repo)).status).toBe(0);
		put(repo, "USER_STORIES.md", `# Stories\n\n${liveStory.replace("show the result", "display the result")}${retiredStory}${headingRetiredStory}`);
		commit(repo, "edit story criterion");
		const storyHead = exec(repo, ["rev-parse", "HEAD"]);
		reviews = [said("teammate", storyHead)];
		opened(head, storyHead);
		expect((await gate(repo)).status).toBe(0);
		put(repo, "features/journey.md", `${readFileSync(join(repo, "features/journey.md"), "utf8")}\nClarified journey.\n`);
		commit(repo, "clarify feature guidance");
		const featureHead = exec(repo, ["rev-parse", "HEAD"]);
		reviews = [said("teammate", featureHead)];
		opened(storyHead, featureHead);
		expect((await gate(repo)).status).toBe(0);
	});

	test("deleting the feature map cannot erase citations for changed source at the base", async () => {
		const repo = fixture("gate-deleted-map");
		const base = exec(repo, ["rev-parse", "HEAD"]);
		put(repo, "src/nested/journey.ts", "export const result = 2;\n");
		exec(repo, ["rm", "features/journey.md"]);
		commit(repo, "remove map while changing source");
		const head = exec(repo, ["rev-parse", "HEAD"]);
		reviews = [said("teammate", head)];
		opened(base, head);
		exec(repo, ["checkout", "-q", base]);
		expect((await gate(repo)).output.errors.join("\n")).toContain("must cite mapped source story US-001");
		opened(base, head, "engineer", "Stories: US-001");
		expect((await gate(repo)).status).toBe(0);
	});

	test("a rename away from base-mapped source still requires its live story citation", async () => {
		const repo = fixture("gate-renamed-source");
		put(repo, "lib/journey.ts", "export const alternate = 1;\n");
		commit(repo, "add alternate source");
		const base = exec(repo, ["rev-parse", "HEAD"]);
		mkdirSync(join(repo, "archive"), { recursive: true });
		exec(repo, ["mv", "src/nested/journey.ts", "archive/journey.ts"]);
		put(repo, "features/journey.md", feature.replace("Source: src/**", "Source: lib/**"));
		commit(repo, "rename mapped source and remap feature");
		const head = exec(repo, ["rev-parse", "HEAD"]);
		reviews = [said("teammate", head)];
		opened(base, head);
		exec(repo, ["checkout", "-q", base]);
		expect((await gate(repo)).output.errors.join("\n")).toContain("must cite mapped source story US-001");
		opened(base, head, "engineer", "Stories: US-001");
		expect((await gate(repo)).status).toBe(0);
	});

	test("ledger edits and disposition approvals require the designated reviewer on the head", async () => {
		const repo = fixture("gate-ledger");
		const base = exec(repo, ["rev-parse", "HEAD"]);
		put(repo, "DOMAIN.md", readFileSync(join(repo, "DOMAIN.md"), "utf8").replace("The repository gate decides", "The independent gate decides"));
		commit(repo, "change invariant");
		const head = exec(repo, ["rev-parse", "HEAD"]);
		opened(base, head);
		reviews = [said("teammate", head)];
		const ledger = await gate(repo);
		expect(ledger.output.reasons).toEqual(["invariants ledger: DOMAIN.md policy changes"]);
		expect(ledger.output.errors.join("\n")).toContain("designated agent reviewer");
		reviews = [said(agent, head)];
		expect((await gate(repo)).status).toBe(0);
		const approvedBase = head;
		const value = JSON.parse(readFileSync(join(repo, "foundation.json"), "utf8"));
		const id = "FND-DOC-001";
		const decision = { schema: "foundation-approval/1", obligation: id, disposition: "not_applicable", reason: "No authored docs", substitute: "Generated reference" };
		const approval_ref = "foundation/approvals/docs.json";
		value.dispositions[id] = { status: "not_applicable", reason: decision.reason, substitute: decision.substitute, approval_ref };
		put(repo, "foundation.json", JSON.stringify(value));
		put(repo, approval_ref, JSON.stringify(decision));
		commit(repo, "submit disposition");
		const dispositionHead = exec(repo, ["rev-parse", "HEAD"]);
		opened(approvedBase, dispositionHead);
		reviews = [said("teammate", dispositionHead)];
		expect((await gate(repo)).output.reasons).toEqual([`disposition approval: ${id} not_applicable`]);
		reviews = [said(agent, dispositionHead)];
		expect((await gate(repo)).status).toBe(0);
		put(repo, approval_ref, JSON.stringify({ ...decision, reason: "Mismatch" }));
		commit(repo, "tamper record");
		opened(approvedBase, exec(repo, ["rev-parse", "HEAD"]));
		reviews = [said(agent, exec(repo, ["rev-parse", "HEAD"]))];
		expect((await gate(repo)).output.errors.join("\n")).toContain("exactly matching the disposition");
	});

	test("appended invariants sections cannot evade validation or designated review", async () => {
		const repo = fixture("gate-duplicate-ledger");
		const base = exec(repo, ["rev-parse", "HEAD"]);
		put(repo, "DOMAIN.md", `${readFileSync(join(repo, "DOMAIN.md"), "utf8")}\n## Invariants\n\n- **INV-002** Review the boundary. \`unenforced\`: reviewers judge it.\n`);
		expect(cli(repo, "check").output.errors.join("\n")).toContain("duplicate ## Invariants");
		commit(repo, "append second ledger");
		const head = exec(repo, ["rev-parse", "HEAD"]);
		opened(base, head);
		reviews = [said("teammate", head)];
		const result = await gate(repo);
		expect(result.output.reasons).toContain("invariants ledger: DOMAIN.md policy changes");
		expect(result.output.errors.join("\n")).toContain("designated agent reviewer");
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
		expect(missing.output.errors.join("\n")).toContain(`needs an approving review from the designated agent reviewer ${agent}`);
		expect(missing.output.errors.join("\n")).not.toContain("FND-CIT-001");
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
		expect((await gate(repo)).output.errors.join("\n")).toContain("authored this PR, so it cannot approve it");
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
