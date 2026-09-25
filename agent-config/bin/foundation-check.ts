#!/usr/bin/env bun
// foundation-check: owned standalone launcher (misty-step/harness).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../skills");
const usage = `Usage: foundation-check <check|affected|receipt> [options]
  check                   Check foundation.json, documents, stories, features and verify skill
  affected --base REV     Print affected live story ids (space-separated)
  receipt PATH [--base REV] Validate a story-walk receipt
Options:
  --repo DIR              Repository root (default: current directory)
  --catalog PATH          Foundation catalog JSON (otherwise source-relative or deployed)
  --stories-checker PATH  check-stories.sh (otherwise source-relative or deployed)
  --json                  Machine-readable result
  -h, --help              Show this help`;

type Options = { command: "check" | "affected" | "receipt"; repo: string; catalog?: string; checker?: string; base?: string; receipt?: string; json: boolean };
type Result = { ok: boolean; errors: string[]; needs_evidence?: string[]; stories?: string[] };
type Feature = { file: string; stories: string[]; sources: string[] };
type Story = { id: string; live: boolean; start: number; end: number };
const storyHeader = /^## (US-\d{3})(?:\s|$)/;
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function args(argv: string[]): Options | "help" {
	if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) return "help";
	const [command, ...rest] = argv;
	if (command !== "check" && command !== "affected" && command !== "receipt") throw new Error("expected check, affected, or receipt");
	const options: Options = { command, repo: process.cwd(), json: false };
	for (let i = 0; i < rest.length; i++) {
		const arg = rest[i];
		if (arg === "--json") options.json = true;
		else if (arg === "--help" || arg === "-h") return "help";
		else if (["--repo", "--catalog", "--stories-checker", "--base"].includes(arg)) {
			const value = rest[++i];
			if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
			if (arg === "--repo") options.repo = value;
			else if (arg === "--catalog") options.catalog = value;
			else if (arg === "--stories-checker") options.checker = value;
			else options.base = value;
		} else if (command === "receipt" && !options.receipt && arg && !arg.startsWith("-")) options.receipt = arg;
		else throw new Error(`unexpected argument: ${arg}`);
	}
	if (command === "affected" && !options.base) throw new Error("affected requires --base REV");
	if (command === "receipt" && !options.receipt) throw new Error("receipt requires PATH");
	if (command === "check" && options.base) throw new Error("--base is only valid for affected or receipt");
	options.repo = resolve(options.repo);
	return options;
}

function run(command: string, argv: string[], repo: string): string {
	const result = spawnSync(command, argv, { cwd: repo, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
	if (result.error) throw new Error(`${command}: ${result.error.message}`);
	if (result.status !== 0) throw new Error(`${command} ${argv.join(" ")}: ${(result.stderr || result.stdout).trim() || `exit ${result.status}`}`);
	return result.stdout;
}
function git(repo: string, ...argv: string[]): string { return run("git", argv, repo); }
function candidate(explicit: string | undefined, name: string, relativePath: string): string {
	const paths = explicit ? [resolve(explicit)] : [
		join(skillRoot, relativePath),
		...(process.env.PI_CODING_AGENT_DIR ? [join(process.env.PI_CODING_AGENT_DIR, "skills", relativePath)] : []),
		join(homedir(), ".omp/agent/skills", relativePath),
		join(homedir(), ".pi/agent/skills", relativePath),
	];
	const found = paths.find((p) => existsSync(p) && statSync(p).isFile());
	if (!found) throw new Error(`Cannot find ${name}; pass ${name === "catalog" ? "--catalog PATH" : "--stories-checker PATH"} or install the ${relativePath.split("/")[0]} skill under ~/.omp/agent/skills or ~/.pi/agent/skills`);
	return found;
}
function readJson(path: string): unknown { return JSON.parse(readFileSync(path, "utf8")); }
function parseStories(contents: string): Story[] {
	const lines = contents.split("\n");
	const stories: Story[] = [];
	let current: Story | undefined;
	for (let i = 0; i < lines.length; i++) {
		const id = lines[i].match(storyHeader)?.[1];
		if (id) {
			if (current) current.end = i;
			current = { id, live: !/\(retired\)/.test(lines[i]), start: i + 1, end: lines.length };
			stories.push(current);
		} else if (/^## /.test(lines[i])) {
			if (current) current.end = i;
			current = undefined;
		}
		if (current && (/^Retired:/.test(lines[i]) || /Superseded by US-\d{3}/.test(lines[i]))) current.live = false;
	}
	return stories;
}
function tracked(repo: string): string[] { return git(repo, "ls-files", "-z").split("\0").filter(Boolean); }
function globRegex(glob: string): RegExp {
	let source = "^";
	for (let i = 0; i < glob.length; i++) {
		const ch = glob[i];
		if (ch === "*" && glob[i + 1] === "*") {
			i++;
			if (glob[i + 1] === "/") { i++; source += "(?:.*/)?"; }
			else source += ".*";
		} else if (ch === "*") source += "[^/]*";
		else source += ch.replace(/[\\^$+?.()|{}\[\]]/g, "\\$&");
	}
	return new RegExp(`${source}$`);
}
function features(repo: string, files: string[], stories: Story[], errors: string[]): Feature[] {
	const featureFiles = files.filter((f) => /^features\/[^/]+\.md$/.test(f) && f !== "features/README.md");
	const index = join(repo, "features/README.md");
	if (!existsSync(index)) errors.push("missing features/README.md");
	const indexText = existsSync(index) ? readFileSync(index, "utf8") : "";
	const links = new Set([...indexText.matchAll(/\]\((?:\.\/)?([^\s)#]+)(?:#[^)]+)?\)/g)].map((match) => match[1]));
	const live = new Set(stories.filter((s) => s.live).map((s) => s.id));
	const mapped = new Set<string>();
	const result: Feature[] = [];
	for (const file of featureFiles) {
		const body = readFileSync(join(repo, file), "utf8");
		if (!links.has(file.slice("features/".length)) && !links.has(file)) errors.push(`${file}: not linked from features/README.md`);
		const storyLine = body.match(/^Stories:\s*(.*)$/m)?.[1];
		const sourceLine = body.match(/^Source:\s*(.*)$/m)?.[1];
		if (!text(storyLine)) errors.push(`${file}: missing Stories: line`);
		if (!text(sourceLine)) errors.push(`${file}: missing Source: line`);
		const ids = storyLine?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
		const sources = sourceLine?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
		for (const id of ids) {
			if (!live.has(id)) errors.push(`${file}: ${id} is not a live story`);
			else mapped.add(id);
		}
		for (const source of sources) {
			if (!files.some((f) => globRegex(source).test(f))) errors.push(`${file}: Source: ${source} matches no tracked files`);
		}
		for (const heading of ["Sub-features", "How to get to it (user POV)", "Driving it", "Gotchas"]) {
			if (!body.split("\n").some((line) => line.startsWith(`## ${heading}`))) errors.push(`${file}: missing ## ${heading}`);
		}
		result.push({ file, stories: ids, sources });
	}
	for (const story of live) if (!mapped.has(story)) errors.push(`${story}: absent from every feature`);
	return result;
}
function storyForLine(stories: Story[], line: number): string | undefined {
	return stories.find((s) => s.start <= line && line <= s.end)?.id;
}
function storyCriteria(contents: string): Map<string, number[]> {
	const criteria = new Map<string, number[]>();
	let id: string | undefined;
	let inCriteria = false;
	for (const line of contents.split("\n")) {
		const header = line.match(storyHeader)?.[1];
		if (header) { id = header; inCriteria = false; criteria.set(id, []); continue; }
		if (/^## /.test(line)) { id = undefined; continue; }
		if (!id) continue;
		if (/^Criteria:/.test(line)) { inCriteria = true; continue; }
		if (/^[A-Z][A-Za-z-]*:/.test(line)) { inCriteria = false; continue; }
		const n = inCriteria ? line.match(/^(\d+)\. /)?.[1] : undefined;
		if (n) criteria.get(id)!.push(Number(n));
	}
	for (const list of criteria.values()) list.sort((a, b) => a - b);
	return criteria;
}
function affected(repo: string, base: string, report: string[]): string[] {
	const headText = readFileSync(join(repo, "USER_STORIES.md"), "utf8");
	const head = parseStories(headText);
	const live = new Set(head.filter((s) => s.live).map((s) => s.id));
	const files = tracked(repo);
	const mapping = features(repo, files, head, report);
	const changed = git(repo, "diff", "--name-only", "-z", `${base}...HEAD`).split("\0").filter(Boolean);
	const ids = new Set<string>();
	for (const feature of mapping) {
		if (changed.includes(feature.file) || changed.some((file) => feature.sources.some((glob) => globRegex(glob).test(file)))) {
			for (const id of feature.stories) if (live.has(id)) ids.add(id);
		}
	}
	if (changed.includes("USER_STORIES.md")) {
		const oldText = git(repo, "show", `${git(repo, "merge-base", base, "HEAD").trim()}:USER_STORIES.md`);
		const old = parseStories(oldText);
		const diff = git(repo, "diff", "-U0", `${base}...HEAD`, "--", "USER_STORIES.md");
		let oldLine = 0;
		let newLine = 0;
		for (const line of diff.split("\n")) {
			const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
			if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); }
			else if (line.startsWith("+") && !line.startsWith("+++")) {
				const id = storyForLine(head, newLine++);
				if (id && live.has(id)) ids.add(id);
			} else if (line.startsWith("-") && !line.startsWith("---")) {
				const id = storyForLine(old, oldLine++);
				if (id && live.has(id)) ids.add(id);
			} else if (line.startsWith(" ")) { oldLine++; newLine++; }
		}
	}
	return [...ids].sort();
}
function check(options: Options): Result {
	const errors: string[] = [];
	const needs_evidence: string[] = [];
	const repo = options.repo;
	const catalogPath = candidate(options.catalog, "catalog", "foundation/foundation-standard-v1.json");
	const checkerPath = candidate(options.checker, "stories-checker", "user-stories/scripts/check-stories.sh");
	const catalogBytes = readFileSync(catalogPath);
	const catalog = JSON.parse(catalogBytes.toString("utf8"));
	const adoption = readJson(join(repo, "foundation.json"));
	if (!record(adoption) || adoption.schema !== "foundation-adoption/1") errors.push("foundation.json: invalid schema");
	const standard = record(adoption) ? adoption.standard : undefined;
	if (!record(standard) || standard.id !== catalog.id || standard.version !== catalog.version) errors.push("foundation.json: standard id or version differs from catalog");
	if (!record(standard) || standard.catalog_sha256 !== sha256(catalogBytes)) errors.push("foundation.json: catalog_sha256 differs from catalog bytes");
	if (!record(standard) || !/^[0-9a-f]{40}$/.test(String(standard.revision)) ||
		standard.source !== `https://github.com/misty-step/harness/blob/${standard.revision}/agent-config/skills/foundation/foundation-standard-v1.json`)
		errors.push("foundation.json: source must pin its 40-hex revision and canonical catalog path");
	if (!record(adoption) || !Array.isArray(adoption.capabilities) || !adoption.capabilities.every(text)) errors.push("foundation.json: capabilities must be an array of descriptions");
	const dispositions = record(adoption) ? adoption.dispositions : undefined;
	const ids: string[] = [...catalog.obligations, ...catalog.approved_defaults].map((item: { id: string }) => item.id);
	if (!record(dispositions)) errors.push("foundation.json: dispositions must be an object");
	else {
		for (const id of Object.keys(dispositions)) if (!ids.includes(id)) errors.push(`foundation.json: unknown id ${id}`);
		for (const id of ids) {
			const value = dispositions[id];
			if (!record(value)) { errors.push(`foundation.json: missing or invalid ${id}`); continue; }
			switch (value.status) {
				case "pending":
					if (![value.missing, value.owner, value.next].every(text)) errors.push(`${id}: pending requires missing, owner and next`);
					else needs_evidence.push(id);
					break;
				case "satisfied": if (!text(value.receipt)) errors.push(`${id}: satisfied requires receipt`); break;
				case "not_applicable": if (!text(value.decision)) errors.push(`${id}: not_applicable requires decision`); break;
				case "exception": if (!text(value.decision) || !/^\d{4}-\d{2}-\d{2}$/.test(String(value.expires))) errors.push(`${id}: exception requires decision and expires date`); break;
				default: errors.push(`${id}: unknown disposition`);
			}
		}
	}
	for (const path of ["README.md", "DESIGN.md", "USER_STORIES.md"]) if (!existsSync(join(repo, path))) errors.push(`FND-DOC-001: missing ${path}`);
	const adr = join(repo, "docs/adr");
	if (!existsSync(adr) || !readdirSync(adr).some((f) => f.endsWith(".md") && statSync(join(adr, f)).isFile())) errors.push("FND-DOC-001: docs/adr/ needs at least one ADR");
	const postmortems = join(repo, "docs/postmortems");
	if (!["README.md", "TEMPLATE.md"].some((f) => existsSync(join(postmortems, f)))) errors.push("FND-DOC-001: docs/postmortems/ needs README.md or TEMPLATE.md");
	const checker = spawnSync("sh", [checkerPath, repo], { cwd: repo, encoding: "utf8" });
	if (checker.error || checker.status !== 0) errors.push(`check-stories.sh: ${checker.error?.message || (checker.stderr || checker.stdout).trim()}`);
	if (existsSync(join(repo, "USER_STORIES.md"))) features(repo, tracked(repo), parseStories(readFileSync(join(repo, "USER_STORIES.md"), "utf8")), errors);
	const skillFiles = tracked(repo).filter((f) => /^(?:\.agents\/skills|skills)\/[^/]+\/SKILL\.md$/.test(f));
	if (!skillFiles.some((f) => {
		const body = readFileSync(join(repo, f), "utf8");
		return ["Launch", "Doctor", "Drive", "Evidence", "Cleanup"].every((h) => body.split("\n").some((line) => line.startsWith(`## ${h}`)));
	})) errors.push("missing verify skill with ## Launch, ## Doctor, ## Drive, ## Evidence and ## Cleanup");
	return { ok: errors.length === 0, errors, needs_evidence };
}
function safePath(path: string): boolean {
	return text(path) && !isAbsolute(path) && !path.split(/[\\/]/).some((part) => part === ".." || part === "." || part === "");
}
function receipt(options: Options): Result {
	const errors: string[] = [];
	const path = resolve(options.repo, options.receipt!);
	const value = readJson(path);
	if (!record(value) || value.schema !== "foundation-walk-receipt/1") return { ok: false, errors: ["receipt: invalid schema"] };
	if (!text(value.check) || !text(value.run) || !text(value.started_at) || !text(value.finished_at)) errors.push("receipt: check, run and timestamps required");
	if (value.head !== git(options.repo, "rev-parse", "HEAD").trim()) errors.push("receipt: head differs from HEAD");
	if (value.tree !== git(options.repo, "rev-parse", "HEAD^{tree}").trim()) errors.push("receipt: tree differs from HEAD tree");
	if (value.exit !== 0) errors.push("receipt: exit must be 0");
	let expected: string[] = [];
	if (options.base) {
		const base = git(options.repo, "rev-parse", `${options.base}^{commit}`).trim();
		if (value.base !== base) errors.push("receipt: base differs from requested base");
		expected = affected(options.repo, options.base, errors);
	} else if (value.base !== null && !/^[0-9a-f]{40}$/.test(String(value.base))) errors.push("receipt: base must be a commit or null");
	const artifacts = new Set<string>();
	if (!Array.isArray(value.artifacts)) errors.push("receipt: artifacts must be an array");
	else for (const artifact of value.artifacts) {
		if (!record(artifact) || !safePath(artifact.path as string) || !/^[0-9a-f]{64}$/.test(String(artifact.sha256))) { errors.push("receipt: invalid artifact entry"); continue; }
		const name = artifact.path as string;
		if (artifacts.has(name)) errors.push(`receipt: duplicate artifact ${name}`);
		artifacts.add(name);
		const file = join(dirname(path), name);
		if (!existsSync(file) || !statSync(file).isFile() || sha256(readFileSync(file)) !== artifact.sha256) errors.push(`receipt: artifact ${name} missing or digest mismatch`);
	};
	const passed = new Set<string>();
	// Bind criteria to the candidate: each story must report exactly its numbered criteria at HEAD.
	const criteriaAtHead = storyCriteria(git(options.repo, "show", "HEAD:USER_STORIES.md"));
	if (!Array.isArray(value.stories)) errors.push("receipt: stories must be an array");
	else for (const story of value.stories) {
		if (!record(story) || !/^US-\d{3}$/.test(String(story.id)) || !["pass", "fail", "unwalked"].includes(String(story.status))) { errors.push("receipt: invalid story entry"); continue; }
		const id = story.id as string;
		if (passed.has(id)) errors.push(`receipt: duplicate story ${id}`);
		passed.add(id);
		if (story.status !== "pass") errors.push(`receipt: ${id} is ${story.status}`);
		if (!Array.isArray(story.criteria) || story.criteria.length === 0) errors.push(`receipt: ${id} needs criteria`);
		else {
			for (const criterion of story.criteria) {
				if (!record(criterion) || !Number.isInteger(criterion.n) || criterion.status !== "pass" || !Array.isArray(criterion.evidence)) { errors.push(`receipt: ${id} has unpassed or invalid criterion`); continue; }
				for (const evidence of criterion.evidence) if (!safePath(evidence) || !artifacts.has(evidence)) errors.push(`receipt: ${id} evidence ${String(evidence)} is not listed in artifacts`);
			}
			const expectedCriteria = criteriaAtHead.get(id);
			const reported = story.criteria.map((criterion: unknown) => (record(criterion) ? Number(criterion.n) : Number.NaN)).sort((a: number, b: number) => a - b);
			if (!expectedCriteria) errors.push(`receipt: ${id} is not a story at HEAD`);
			else if (reported.join(",") !== expectedCriteria.join(",")) errors.push(`receipt: ${id} criteria ${reported.join(", ")} do not match story criteria ${expectedCriteria.join(", ")}`);
		}
	}
	for (const id of expected) if (!passed.has(id)) errors.push(`receipt: affected ${id} is missing`);
	return { ok: errors.length === 0, errors };
}
function print(result: Result, json: boolean, command: Options["command"]): void {
	if (json) console.log(JSON.stringify(result));
	else if (command === "affected") {
		for (const error of result.errors) console.error(`FAIL: ${error}`);
		if (result.ok) console.log((result.stories ?? []).join(" "));
	} else {
		for (const error of result.errors) console.log(`FAIL: ${error}`);
		for (const id of result.needs_evidence ?? []) console.log(`needs-evidence: ${id}`);
		console.log(`foundation-check ${command}: ${result.ok ? "PASS" : "FAIL"}`);
	}
}
try {
	const options = args(process.argv.slice(2));
	if (options === "help") { console.log(usage); process.exit(0); }
	let result: Result;
	try {
		if (options.command === "check") result = check(options);
		else if (options.command === "affected") {
			const errors: string[] = [];
			const stories = affected(options.repo, options.base!, errors);
			result = { ok: errors.length === 0, errors, stories };
		} else result = receipt(options);
	} catch (error) { result = { ok: false, errors: [error instanceof Error ? error.message : String(error)] }; }
	print(result, options.json, options.command);
	if (!result.ok) process.exitCode = 1;
} catch (error) {
	console.error(`${error instanceof Error ? error.message : String(error)}\n${usage}`);
	process.exitCode = 2;
}
