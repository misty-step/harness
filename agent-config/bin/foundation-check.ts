#!/usr/bin/env bun
// foundation-check: owned standalone launcher (misty-step/harness).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const skillRoot = resolve(scriptDir, "../skills");
const usage = `Usage: foundation-check <check|baseline|affected|receipt|review> [options]
  check [--base REV]      Check foundation.json, documents, stories, features and verify skill;
                          with --base, the bootstrap baseline may only shrink
  baseline --owner NAME [--write] [--expires YYYY-MM-DD] [--revision SHA] [--no-walk-gaps]
                          Record the current gaps as a bootstrap baseline (works
                          without foundation.json); --write saves foundation.json
  affected --base REV     Print affected live story ids (space-separated)
  receipt PATH [--base REV] [--all]
                          Validate a story-walk receipt; --all requires every live story
  review --pr N [--github-repo OWNER/NAME]
                          When the PR gives USER_STORIES.md its first stories or adds a
                          baseline extension record, require the designated reviewer's
                          approval on its head (GITHUB_TOKEN; GITHUB_REPOSITORY, GITHUB_API_URL)
Options:
  --repo DIR              Repository root (default: current directory)
  --catalog PATH          Foundation catalog JSON (otherwise source-relative or deployed)
  --stories-checker PATH  check-stories.sh (otherwise source-relative or deployed)
  --json                  Machine-readable result
  -h, --help              Show this help`;

type Command = "check" | "baseline" | "affected" | "receipt" | "review";
type Options = {
	command: Command; repo: string; catalog?: string; checker?: string; base?: string; receipt?: string; json: boolean;
	all: boolean; write: boolean; owner?: string; expires?: string; revision?: string; walkGaps: boolean;
	pr?: number; githubRepo?: string;
};
type Result = {
	ok: boolean; errors: string[]; needs_evidence?: string[]; stories?: string[]; baselined?: string[]; gaps?: string[];
	wrote?: string; adoption?: unknown; reasons?: string[]; approved_by?: string;
};
type Feature = { file: string; stories: string[]; sources: string[] };
type Story = { id: string; live: boolean; start: number; end: number };
/** A deficiency; `gap` is the stable key a bootstrap baseline can name. Adoption-record errors have none. */
type Issue = { gap?: string; message: string };
type Entry = { gap: string; owner: string; expires: string };
type Baseline = { mode: "bootstrap" | "enforced"; entries: Entry[] };

const storyHeader = /^## (US-\d{3})(?:\s|$)/;
const featureHeadings: Record<string, string> = {
	"Sub-features": "sub-features",
	"How to get to it (user POV)": "how-to-get-to-it",
	"Driving it": "driving-it",
	Gotchas: "gotchas",
};
// Each independent defect has its own key, so a baselined defect cannot cover a new one in the same file.
const gapPattern = new RegExp(
	"^(?:doc:(?:README\\.md|DESIGN\\.md|USER_STORIES\\.md|adr|postmortems)|stories:format|skill:verify|walk:US-\\d{3}" +
	"|map:(?:index|US-\\d{3}|features/[^/:]+\\.md:(?:unlinked|stories-line|source-line|story:US-\\d{3}|source:[^\\s,]+" +
	`|heading:(?:${Object.values(featureHeadings).join("|")}))))$`,
);
const extensionPath = /^foundation\/extensions\/[^/]+\.json$/;
const maxBaselineDays = 30;
const dayMs = 86_400_000;
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const today = (): string => new Date().toISOString().slice(0, 10);
const addDays = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * dayMs).toISOString().slice(0, 10);
const isDate = (value: unknown): value is string =>
	typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
	new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
const describe = (issue: Issue): string => (issue.gap ? `[${issue.gap}] ${issue.message}` : issue.message);

function args(argv: string[]): Options | "help" {
	if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) return "help";
	const commands: Command[] = ["check", "baseline", "affected", "receipt", "review"];
	const command = commands.find((name) => name === argv[0]);
	if (!command) throw new Error("expected check, baseline, affected, receipt, or review");
	const rest = argv.slice(1);
	const options: Options = { command, repo: process.cwd(), json: false, all: false, write: false, walkGaps: true };
	const valued = ["--repo", "--catalog", "--stories-checker", "--base", "--owner", "--expires", "--revision", "--pr", "--github-repo"];
	for (let i = 0; i < rest.length; i++) {
		const arg = rest[i];
		if (arg === "--json") options.json = true;
		else if (arg === "--all") options.all = true;
		else if (arg === "--write") options.write = true;
		else if (arg === "--no-walk-gaps") options.walkGaps = false;
		else if (arg === "--help" || arg === "-h") return "help";
		else if (valued.includes(arg)) {
			const value = rest[++i];
			if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
			if (arg === "--repo") options.repo = value;
			else if (arg === "--catalog") options.catalog = value;
			else if (arg === "--stories-checker") options.checker = value;
			else if (arg === "--base") options.base = value;
			else if (arg === "--owner") options.owner = value;
			else if (arg === "--expires") options.expires = value;
			else if (arg === "--revision") options.revision = value;
			else if (arg === "--pr") options.pr = /^[1-9]\d*$/.test(value) ? Number(value) : Number.NaN;
			else options.githubRepo = value;
		} else if (command === "receipt" && !options.receipt && arg && !arg.startsWith("-")) options.receipt = arg;
		else throw new Error(`unexpected argument: ${arg}`);
	}
	if (command === "affected" && !options.base) throw new Error("affected requires --base REV");
	if (command === "review" && options.base) throw new Error("review reads the pull request's base and head from GitHub; drop --base");
	if (command === "review" && !Number.isInteger(options.pr)) throw new Error("review requires --pr N (a pull request number)");
	if (command !== "review" && (options.pr !== undefined || options.githubRepo)) throw new Error("--pr and --github-repo are only valid for review");
	if (command === "receipt" && !options.receipt) throw new Error("receipt requires PATH");
	if (command === "baseline" && !text(options.owner)) throw new Error("baseline requires --owner NAME");
	if (command === "baseline" && options.base) throw new Error("--base is not valid for baseline");
	if (command !== "receipt" && options.all) throw new Error("--all is only valid for receipt");
	const baselineOnly = options.write || options.owner || options.expires || options.revision || !options.walkGaps;
	if (command !== "baseline" && baselineOnly) throw new Error("--write, --owner, --expires, --revision and --no-walk-gaps are only valid for baseline");
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
/** A file's contents at a revision, or undefined when the revision lacks it. */
function fileAt(repo: string, rev: string, path: string): string | undefined {
	const probe = spawnSync("git", ["cat-file", "-e", `${rev}:${path}`], { cwd: repo });
	return probe.status === 0 ? git(repo, "show", `${rev}:${path}`) : undefined;
}
/** Parsed JSON, or undefined for absent or malformed text; callers treat that as "no baseline", the strict reading. */
function jsonOrUndefined(contents: string | undefined): unknown {
	if (contents === undefined) return undefined;
	try {
		return JSON.parse(contents);
	} catch {
		return undefined;
	}
}
function candidate(explicit: string | undefined, name: string, relativePath: string): string {
	const paths = explicit ? [resolve(explicit)] : [
		join(skillRoot, relativePath),
		...(process.env.PI_CODING_AGENT_DIR ? [join(process.env.PI_CODING_AGENT_DIR, "skills", relativePath)] : []),
		join(homedir(), ".omp/agent/skills", relativePath),
		join(homedir(), ".pi/agent/skills", relativePath),
	];
	const found = paths.find((p) => existsSync(p) && statSync(p).isFile());
	if (!found) throw new Error(`Cannot find ${name}; pass --${name} PATH or install the ${relativePath.split("/")[0]} skill under ~/.omp/agent/skills or ~/.pi/agent/skills`);
	return found;
}
function readJson(path: string): unknown { return JSON.parse(readFileSync(path, "utf8")); }
function tools(options: Options) {
	const catalogPath = candidate(options.catalog, "catalog", "foundation/foundation-standard-v1.json");
	const checkerPath = candidate(options.checker, "stories-checker", "user-stories/scripts/check-stories.sh");
	const catalogBytes = readFileSync(catalogPath);
	return { catalog: JSON.parse(catalogBytes.toString("utf8")), catalogBytes, checkerPath };
}
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
function workingStories(repo: string): Story[] {
	const path = join(repo, "USER_STORIES.md");
	return existsSync(path) ? parseStories(readFileSync(path, "utf8")) : [];
}
function liveIds(stories: Story[]): Set<string> { return new Set(stories.filter((s) => s.live).map((s) => s.id)); }
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
function features(repo: string, files: string[], stories: Story[], issues: Issue[]): Feature[] {
	const featureFiles = files.filter((f) => /^features\/[^/]+\.md$/.test(f) && f !== "features/README.md");
	const index = join(repo, "features/README.md");
	if (!existsSync(index)) issues.push({ gap: "map:index", message: "missing features/README.md" });
	const indexText = existsSync(index) ? readFileSync(index, "utf8") : "";
	const links = new Set([...indexText.matchAll(/\]\((?:\.\/)?([^\s)#]+)(?:#[^)]+)?\)/g)].map((match) => match[1]));
	const live = liveIds(stories);
	const mapped = new Set<string>();
	const result: Feature[] = [];
	for (const file of featureFiles) {
		const gap = (defect: string) => `map:${file}:${defect}`;
		const body = readFileSync(join(repo, file), "utf8");
		if (!links.has(file.slice("features/".length)) && !links.has(file)) issues.push({ gap: gap("unlinked"), message: `${file}: not linked from features/README.md` });
		const storyLine = body.match(/^Stories:\s*(.*)$/m)?.[1];
		const sourceLine = body.match(/^Source:\s*(.*)$/m)?.[1];
		if (!text(storyLine)) issues.push({ gap: gap("stories-line"), message: `${file}: missing Stories: line` });
		if (!text(sourceLine)) issues.push({ gap: gap("source-line"), message: `${file}: missing Source: line` });
		const ids = storyLine?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
		const sources = sourceLine?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
		for (const id of ids) {
			if (!live.has(id)) issues.push({ gap: gap(`story:${id}`), message: `${file}: ${id} is not a live story` });
			else mapped.add(id);
		}
		for (const source of sources) {
			if (!files.some((f) => globRegex(source).test(f))) issues.push({ gap: gap(`source:${source}`), message: `${file}: Source: ${source} matches no tracked files` });
		}
		for (const [heading, slug] of Object.entries(featureHeadings)) {
			if (!body.split("\n").some((line) => line.startsWith(`## ${heading}`))) issues.push({ gap: gap(`heading:${slug}`), message: `${file}: missing ## ${heading}` });
		}
		result.push({ file, stories: ids, sources });
	}
	for (const story of live) if (!mapped.has(story)) issues.push({ gap: `map:${story}`, message: `${story}: absent from every feature` });
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
function changedFiles(repo: string, base: string, filter?: string): string[] {
	return git(repo, "diff", "--name-only", ...(filter ? [`--diff-filter=${filter}`] : []), "-z", `${base}...HEAD`).split("\0").filter(Boolean);
}
/** Live stories whose sections a change edits; a story file new at the base counts every section as edited. */
function editedStories(repo: string, base: string, head: Story[]): Set<string> {
	const ids = new Set<string>();
	if (!changedFiles(repo, base).includes("USER_STORIES.md")) return ids;
	const live = liveIds(head);
	const old = parseStories(fileAt(repo, git(repo, "merge-base", base, "HEAD").trim(), "USER_STORIES.md") ?? "");
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
	return ids;
}
function affected(repo: string, base: string, report: Issue[]): string[] {
	const head = parseStories(readFileSync(join(repo, "USER_STORIES.md"), "utf8"));
	const live = liveIds(head);
	const mapping = features(repo, tracked(repo), head, report);
	const changed = changedFiles(repo, base);
	const ids = editedStories(repo, base, head);
	for (const feature of mapping) {
		if (changed.includes(feature.file) || changed.some((file) => feature.sources.some((glob) => globRegex(glob).test(file)))) {
			for (const id of feature.stories) if (live.has(id)) ids.add(id);
		}
	}
	return [...ids].sort();
}
function validateAdoption(adoption: unknown, catalog: { id: string; version: string; obligations: { id: string }[]; approved_defaults: { id: string }[] }, catalogBytes: Buffer, errors: string[], needs_evidence: string[]): void {
	if (!record(adoption) || adoption.schema !== "foundation-adoption/1") errors.push("foundation.json: invalid schema");
	const standard = record(adoption) ? adoption.standard : undefined;
	if (!record(standard) || standard.id !== catalog.id || standard.version !== catalog.version) errors.push("foundation.json: standard id or version differs from catalog");
	if (!record(standard) || standard.catalog_sha256 !== sha256(catalogBytes)) errors.push("foundation.json: catalog_sha256 differs from catalog bytes");
	if (!record(standard) || !/^[0-9a-f]{40}$/.test(String(standard.revision)) ||
		standard.source !== `https://github.com/misty-step/harness/blob/${standard.revision}/agent-config/skills/foundation/foundation-standard-v1.json`)
		errors.push("foundation.json: source must pin its 40-hex revision and canonical catalog path");
	if (!record(adoption) || !Array.isArray(adoption.capabilities) || !adoption.capabilities.every(text)) errors.push("foundation.json: capabilities must be an array of descriptions");
	const dispositions = record(adoption) ? adoption.dispositions : undefined;
	const ids = [...catalog.obligations, ...catalog.approved_defaults].map((item) => item.id);
	if (!record(dispositions)) { errors.push("foundation.json: dispositions must be an object"); return; }
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
/** Documents, stories, map and verify skill: the gaps a bootstrap baseline may name. */
function contentIssues(repo: string, checkerPath: string): Issue[] {
	const issues: Issue[] = [];
	for (const path of ["README.md", "DESIGN.md", "USER_STORIES.md"]) {
		if (!existsSync(join(repo, path))) issues.push({ gap: `doc:${path}`, message: `FND-DOC-001: missing ${path}` });
	}
	const adr = join(repo, "docs/adr");
	if (!existsSync(adr) || !readdirSync(adr).some((f) => f.endsWith(".md") && statSync(join(adr, f)).isFile())) {
		issues.push({ gap: "doc:adr", message: "FND-DOC-001: docs/adr/ needs at least one ADR" });
	}
	if (!["README.md", "TEMPLATE.md"].some((f) => existsSync(join(repo, "docs/postmortems", f)))) {
		issues.push({ gap: "doc:postmortems", message: "FND-DOC-001: docs/postmortems/ needs README.md or TEMPLATE.md" });
	}
	if (existsSync(join(repo, "USER_STORIES.md"))) {
		const checker = spawnSync("sh", [checkerPath, repo], { cwd: repo, encoding: "utf8" });
		if (checker.error || checker.status !== 0) {
			issues.push({ gap: "stories:format", message: `check-stories.sh: ${checker.error?.message || (checker.stderr || checker.stdout).trim()}` });
		}
	}
	// The map is checked even before stories exist, so a first baseline records every map gap.
	features(repo, tracked(repo), workingStories(repo), issues);
	const skillFiles = tracked(repo).filter((f) => /^(?:\.agents\/skills|skills)\/[^/]+\/SKILL\.md$/.test(f));
	if (!skillFiles.some((f) => {
		const body = readFileSync(join(repo, f), "utf8");
		return ["Launch", "Doctor", "Drive", "Evidence", "Cleanup"].every((h) => body.split("\n").some((line) => line.startsWith(`## ${h}`)));
	})) issues.push({ gap: "skill:verify", message: "missing verify skill with ## Launch, ## Doctor, ## Drive, ## Evidence and ## Cleanup" });
	return issues;
}
/** The adoption's mode and well-formed baseline entries; shape, expiry and horizon problems go to errors. */
function readBaseline(adoption: unknown, live: Set<string>, errors: string[], now: string): Baseline {
	if (!record(adoption)) return { mode: "enforced", entries: [] };
	const mode = adoption.mode ?? "enforced";
	if (mode !== "bootstrap" && mode !== "enforced") errors.push("foundation.json: mode must be bootstrap or enforced");
	const raw = adoption.baseline ?? [];
	const entries: Entry[] = [];
	if (!Array.isArray(raw)) errors.push("foundation.json: baseline must be an array");
	else {
		const seen = new Set<string>();
		for (const item of raw) {
			if (!record(item) || !text(item.gap) || !gapPattern.test(item.gap)) {
				errors.push(`foundation.json: invalid baseline gap ${JSON.stringify(record(item) ? item.gap : item)}`);
				continue;
			}
			if (!text(item.owner) || !isDate(item.expires)) { errors.push(`baseline ${item.gap}: needs an owner and expires YYYY-MM-DD`); continue; }
			if (seen.has(item.gap)) { errors.push(`baseline ${item.gap}: duplicate entry`); continue; }
			seen.add(item.gap);
			entries.push({ gap: item.gap, owner: item.owner, expires: item.expires });
		}
		if (mode === "bootstrap" && raw.length === 0) errors.push("foundation.json: bootstrap mode needs a baseline; an empty baseline means mode enforced");
	}
	if (mode === "enforced" && entries.length > 0) errors.push("foundation.json: an enforced adoption cannot carry a baseline; use mode bootstrap");
	const horizon = addDays(now, maxBaselineDays);
	for (const entry of entries) {
		if (entry.expires < now) errors.push(`baseline ${entry.gap}: expired ${entry.expires}; fix the gap and remove the entry`);
		else if (entry.expires > horizon) errors.push(`baseline ${entry.gap}: expires ${entry.expires}, more than ${maxBaselineDays} days out`);
		const story = entry.gap.match(/^walk:(US-\d{3})$/)?.[1];
		if (story && !live.has(story)) errors.push(`baseline ${entry.gap}: ${story} is not a live story`);
	}
	return { mode: mode === "bootstrap" ? "bootstrap" : "enforced", entries };
}
/** Entries that may excuse a gap now: bootstrap mode, well formed, unexpired, within the horizon, live walk stories. */
function covering(baseline: Baseline, live: Set<string>, now: string): Map<string, Entry> {
	if (baseline.mode !== "bootstrap") return new Map();
	const horizon = addDays(now, maxBaselineDays);
	return new Map(baseline.entries.filter((entry) => {
		const story = entry.gap.match(/^walk:(US-\d{3})$/)?.[1];
		return entry.expires >= now && entry.expires <= horizon && (!story || live.has(story));
	}).map((entry) => [entry.gap, entry]));
}
/** Map diagnostics a valid baseline does not cover; affected-story selection still uses the whole map. */
function uncovered(report: Issue[], adoption: unknown, live: Set<string>): string[] {
	const now = today();
	const excused = covering(readBaseline(adoption, live, [], now), live, now);
	return report.filter((issue) => !issue.gap || !excused.has(issue.gap)).map(describe);
}
/** Gap and expiry of each entry in the extension records a change adds. */
function extensionRecords(repo: string, base: string, errors: string[]): Map<string, string> {
	const extended = new Map<string, string>();
	for (const path of changedFiles(repo, base, "A").filter((f) => extensionPath.test(f))) {
		const value = jsonOrUndefined(fileAt(repo, "HEAD", path));
		if (!record(value) || value.schema !== "foundation-baseline-extension/1" || !text(value.reason) || !Array.isArray(value.entries) || value.entries.length === 0) {
			errors.push(`${path}: needs schema foundation-baseline-extension/1, a reason and entries`);
			continue;
		}
		for (const entry of value.entries) {
			if (!record(entry) || !text(entry.gap) || !gapPattern.test(entry.gap) || !isDate(entry.expires)) { errors.push(`${path}: invalid entry ${JSON.stringify(entry)}`); continue; }
			if (extended.has(entry.gap)) errors.push(`${path}: ${entry.gap} is extended twice`);
			extended.set(entry.gap, entry.expires);
		}
	}
	return extended;
}
/** Against a base revision: the baseline only shrinks, and edited stories cannot stay unmapped. */
function ratchet(repo: string, base: string, baseline: Baseline, errors: string[]): void {
	const mergeBase = git(repo, "merge-base", base, "HEAD").trim();
	for (const id of editedStories(repo, base, workingStories(repo))) {
		if (baseline.entries.some((entry) => entry.gap === `map:${id}`)) errors.push(`${id}: edited in this change, so it must be mapped; remove baseline map:${id}`);
	}
	const baseText = fileAt(repo, mergeBase, "foundation.json");
	// A first adoption creates the baseline; check has already bound it to the gaps that exist.
	if (baseText === undefined) return;
	const prior = jsonOrUndefined(baseText);
	const baseExpiry = new Map<string, string>();
	if (record(prior) && prior.mode === "bootstrap" && Array.isArray(prior.baseline)) {
		for (const item of prior.baseline) if (record(item) && text(item.gap) && isDate(item.expires)) baseExpiry.set(item.gap, item.expires);
	}
	const extended = baseline.entries.filter((entry) => {
		const was = baseExpiry.get(entry.gap);
		return was === undefined || entry.expires > was;
	});
	const records = extensionRecords(repo, base, errors);
	for (const entry of extended) {
		if (records.get(entry.gap) === entry.expires) continue;
		const change = baseExpiry.has(entry.gap) ? `expiry moved from ${baseExpiry.get(entry.gap)} to ${entry.expires}` : "new entry";
		errors.push(`baseline ${entry.gap}: ${change}; add a foundation/extensions/ record for the designated agent reviewer to approve`);
	}
	for (const [gap, expires] of records) {
		if (!extended.some((entry) => entry.gap === gap && entry.expires === expires)) errors.push(`foundation/extensions: ${gap} (${expires}) is not an extension in this change`);
	}
}
function check(options: Options): Result {
	const errors: string[] = [];
	const needs_evidence: string[] = [];
	const { catalog, catalogBytes, checkerPath } = tools(options);
	const path = join(options.repo, "foundation.json");
	const adoption = existsSync(path) ? readJson(path) : undefined;
	if (adoption === undefined) errors.push("foundation.json: missing; `foundation-check baseline --owner NAME --write` records the current gaps as a bootstrap baseline");
	else validateAdoption(adoption, catalog, catalogBytes, errors, needs_evidence);
	const issues = contentIssues(options.repo, checkerPath);
	const now = today();
	const live = liveIds(workingStories(options.repo));
	const baseline = readBaseline(adoption, live, errors, now);
	const excused = covering(baseline, live, now);
	const baselined: string[] = [];
	for (const issue of issues) {
		const entry = issue.gap ? excused.get(issue.gap) : undefined;
		if (entry) baselined.push(`${describe(issue)} (owner ${entry.owner}, expires ${entry.expires})`);
		else errors.push(describe(issue));
	}
	const open = new Set(issues.map((issue) => issue.gap).filter(text));
	for (const entry of baseline.entries) {
		// Walk gaps are proven by receipts, which flag an entry whose story now passes.
		if (!entry.gap.startsWith("walk:") && !open.has(entry.gap)) errors.push(`baseline ${entry.gap}: the gap is fixed; remove the entry`);
	}
	if (options.base) ratchet(options.repo, options.base, baseline, errors);
	return { ok: errors.length === 0, errors, needs_evidence, baselined };
}
/** The harness revision of this checker's source checkout, for a new adoption record's pin. */
function harnessRevision(): string {
	const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: scriptDir, encoding: "utf8" });
	const revision = result.status === 0 ? result.stdout.trim() : "";
	if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error("pass --revision SHA: the harness revision this repository's CI pins");
	return revision;
}
function baseline(options: Options): Result {
	const { catalog, catalogBytes, checkerPath } = tools(options);
	const now = today();
	const expires = options.expires ?? addDays(now, maxBaselineDays);
	if (!isDate(expires) || expires < now || expires > addDays(now, maxBaselineDays)) throw new Error(`--expires must be a date from today to ${maxBaselineDays} days out`);
	const path = join(options.repo, "foundation.json");
	const existing = existsSync(path) ? readJson(path) : undefined;
	if (existing !== undefined && !record(existing)) throw new Error("foundation.json is not a JSON object");
	const owner = options.owner!;
	const revision = existing === undefined ? (options.revision ?? harnessRevision()) : undefined;
	if (revision !== undefined && !/^[0-9a-f]{40}$/.test(revision)) throw new Error("--revision must be a 40-hex commit");
	const adoption: Record<string, unknown> = existing ?? {
		schema: "foundation-adoption/1",
		standard: {
			id: catalog.id, version: catalog.version, catalog_sha256: sha256(catalogBytes), revision,
			source: `https://github.com/misty-step/harness/blob/${revision}/agent-config/skills/foundation/foundation-standard-v1.json`,
		},
		capabilities: [],
		dispositions: Object.fromEntries([...catalog.obligations, ...catalog.approved_defaults].map(({ id }: { id: string }) => [
			id, { status: "pending", missing: "Foundation assessment", owner, next: "Assess this obligation with the foundation skill" },
		])),
	};
	const issues = contentIssues(options.repo, checkerPath);
	const live = [...liveIds(workingStories(options.repo))];
	const gaps = [...new Set([...issues.map((issue) => issue.gap).filter(text), ...(options.walkGaps ? live.map((id) => `walk:${id}`) : [])])].sort();
	const prior = new Map((Array.isArray(adoption.baseline) ? adoption.baseline : []).filter(record).map((entry) => [entry.gap, entry]));
	const entries: Entry[] = gaps.map((gap) => {
		const kept = prior.get(gap);
		return kept && text(kept.owner) && isDate(kept.expires) ? { gap, owner: kept.owner, expires: kept.expires } : { gap, owner, expires };
	});
	if (entries.length > 0) {
		adoption.mode = "bootstrap";
		adoption.baseline = entries;
	} else {
		adoption.mode = "enforced";
		delete adoption.baseline;
	}
	const listed = entries.map((entry) => `${entry.gap} (owner ${entry.owner}, expires ${entry.expires})`);
	if (options.write) {
		writeFileSync(path, `${JSON.stringify(adoption, null, 2)}\n`);
		return { ok: true, errors: [], gaps: listed, wrote: path };
	}
	return { ok: true, errors: [], gaps: listed, adoption };
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
	const adoption = jsonOrUndefined(fileAt(options.repo, "HEAD", "foundation.json"));
	const storiesAtHead = git(options.repo, "show", "HEAD:USER_STORIES.md");
	const live = liveIds(parseStories(storiesAtHead));
	// Stories the map does not place in any feature: a change's impact on them cannot be computed.
	const unmapped = new Set<string>();
	if (options.base) {
		const base = git(options.repo, "rev-parse", `${options.base}^{commit}`).trim();
		if (value.base !== base) errors.push("receipt: base differs from requested base");
		const report: Issue[] = [];
		expected = affected(options.repo, options.base, report);
		for (const issue of report) {
			const story = issue.gap?.match(/^map:(US-\d{3})$/)?.[1];
			if (story) unmapped.add(story);
		}
		errors.push(...uncovered(report, adoption, live));
	} else if (value.base !== null && !/^[0-9a-f]{40}$/.test(String(value.base))) errors.push("receipt: base must be a commit or null");
	// A valid bootstrap baseline may excuse a story from being walked, but only when the story is provably
	// unaffected: judged against --base with the story mapped, or in a full walk (base null) that judges no change.
	const now = today();
	const baseline = readBaseline(adoption, live, [], now);
	const excused = covering(baseline, live, now);
	const provable = options.base !== undefined || value.base === null;
	const artifacts = new Set<string>();
	if (!Array.isArray(value.artifacts)) errors.push("receipt: artifacts must be an array");
	else for (const artifact of value.artifacts) {
		if (!record(artifact) || !safePath(artifact.path as string) || !/^[0-9a-f]{64}$/.test(String(artifact.sha256))) { errors.push("receipt: invalid artifact entry"); continue; }
		const name = artifact.path as string;
		if (artifacts.has(name)) errors.push(`receipt: duplicate artifact ${name}`);
		artifacts.add(name);
		const file = join(dirname(path), name);
		if (!existsSync(file) || !statSync(file).isFile() || sha256(readFileSync(file)) !== artifact.sha256) errors.push(`receipt: artifact ${name} missing or digest mismatch`);
	}
	const reported = new Set<string>();
	// Bind criteria to the candidate: each story must report exactly its numbered criteria at HEAD.
	const criteriaAtHead = storyCriteria(storiesAtHead);
	if (!Array.isArray(value.stories)) errors.push("receipt: stories must be an array");
	else for (const story of value.stories) {
		if (!record(story) || !/^US-\d{3}$/.test(String(story.id)) || !["pass", "fail", "unwalked"].includes(String(story.status))) { errors.push("receipt: invalid story entry"); continue; }
		const id = story.id as string;
		if (reported.has(id)) errors.push(`receipt: duplicate story ${id}`);
		reported.add(id);
		if (!criteriaAtHead.has(id)) { errors.push(`receipt: ${id} is not a story at HEAD`); continue; }
		if (story.status === "unwalked") {
			if (!excused.has(`walk:${id}`)) errors.push(`receipt: ${id} is unwalked`);
			else if (!provable) errors.push(`receipt: ${id} is unwalked; a change receipt needs --base to prove it unaffected`);
			else if (unmapped.has(id)) errors.push(`receipt: ${id} is unwalked but unmapped, so this change's effect on it is unknown; map or walk it`);
			else if (expected.includes(id)) errors.push(`receipt: ${id} is affected by this change and must be walked`);
			continue;
		}
		if (story.status !== "pass") errors.push(`receipt: ${id} is ${story.status}`);
		else if (options.all && baseline.entries.some((entry) => entry.gap === `walk:${id}`)) errors.push(`receipt: ${id} passed; remove baseline walk:${id}`);
		if (!Array.isArray(story.criteria) || story.criteria.length === 0) errors.push(`receipt: ${id} needs criteria`);
		else {
			for (const criterion of story.criteria) {
				if (!record(criterion) || !Number.isInteger(criterion.n) || criterion.status !== "pass" || !Array.isArray(criterion.evidence)) { errors.push(`receipt: ${id} has unpassed or invalid criterion`); continue; }
				for (const evidence of criterion.evidence) if (!safePath(evidence) || !artifacts.has(evidence)) errors.push(`receipt: ${id} evidence ${String(evidence)} is not listed in artifacts`);
			}
			const expectedCriteria = criteriaAtHead.get(id)!;
			const numbers = story.criteria.map((criterion: unknown) => (record(criterion) ? Number(criterion.n) : Number.NaN)).sort((a: number, b: number) => a - b);
			if (numbers.join(",") !== expectedCriteria.join(",")) errors.push(`receipt: ${id} criteria ${numbers.join(", ")} do not match story criteria ${expectedCriteria.join(", ")}`);
		}
	}
	for (const id of expected) if (!reported.has(id)) errors.push(`receipt: affected ${id} is missing`);
	if (options.all) {
		for (const id of live) if (!reported.has(id)) errors.push(`receipt: ${id} is missing from a full walk`);
	}
	return { ok: errors.length === 0, errors };
}
/**
 * Designated agent reviewer per organisation (ADR-003 Review authority). It lives in this pinned checker, so
 * neither the repository under review nor a command-line flag can change who may approve. It is the only
 * identity the gate trusts: agent sessions also act under the operator's GitHub account, so an approval from
 * that account proves nothing about who gave it.
 */
const reviewerRegistry: Record<string, string> = {
	"misty-step": "kaylee-agent[bot]",
};
const escalationMarker = "foundation-escalation: product-direction";
const resolutionMarker = "foundation-escalation: resolved";
/** Why a PR needs the designated reviewer, judged on its own base and head: first user stories or an added extension record. */
function reviewTriggers(repo: string, base: string, head: string): string[] {
	const mergeBase = git(repo, "merge-base", base, head).trim();
	const reasons: string[] = [];
	const before = parseStories(fileAt(repo, mergeBase, "USER_STORIES.md") ?? "");
	const after = parseStories(fileAt(repo, head, "USER_STORIES.md") ?? "");
	if (before.length === 0 && after.length > 0) reasons.push("first user stories: USER_STORIES.md gains its first stories");
	const added = git(repo, "diff", "--name-only", "--no-renames", "--diff-filter=A", "-z", mergeBase, head).split("\0").filter(Boolean);
	for (const path of added.filter((f) => extensionPath.test(f))) reasons.push(`baseline extension: ${path}`);
	return reasons;
}
async function github(path: string, token: string): Promise<unknown> {
	const api = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");
	const response = await fetch(`${api}${path}`, {
		headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "foundation-check" },
	});
	if (!response.ok) throw new Error(`GitHub API ${path}: HTTP ${response.status}`);
	return response.json();
}
const reviewer = (entry: Record<string, unknown>): string => (record(entry.user) && typeof entry.user.login === "string" ? entry.user.login : "");
async function review(options: Options): Promise<Result> {
	const [org, name, extra] = (options.githubRepo ?? process.env.GITHUB_REPOSITORY ?? "").split("/");
	if (!org || !name || extra !== undefined) throw new Error("review needs --github-repo OWNER/NAME or GITHUB_REPOSITORY");
	const token = process.env.GITHUB_TOKEN;
	if (!text(token)) throw new Error("review needs GITHUB_TOKEN to read the pull request");
	// The PR's own base and head decide whether review is needed, never whatever the checkout happens to be.
	const pull = await github(`/repos/${org}/${name}/pulls/${options.pr}`, token);
	const head = record(pull) && record(pull.head) && typeof pull.head.sha === "string" ? pull.head.sha : undefined;
	const base = record(pull) && record(pull.base) && typeof pull.base.sha === "string" ? pull.base.sha : undefined;
	const author = record(pull) && record(pull.user) && typeof pull.user.login === "string" ? pull.user.login : undefined;
	if (!head || !base || !author) throw new Error(`GitHub API: pull request ${options.pr} has no head, base or author`);
	for (const sha of [head, base]) {
		if (spawnSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: options.repo }).status !== 0) {
			throw new Error(`the checkout lacks commit ${sha.slice(0, 12)} of pull request ${options.pr}; check out with fetch-depth: 0`);
		}
	}
	const reasons = reviewTriggers(options.repo, base, head);
	if (reasons.length === 0) return { ok: true, errors: [], reasons };
	const agent = reviewerRegistry[org];
	if (!agent) throw new Error(`no designated reviewer for ${org}`);
	if (agent === author) return { ok: false, errors: [`the designated agent reviewer ${agent} authored this PR, so it cannot approve it`], reasons };
	const reviews: Record<string, unknown>[] = [];
	for (let page = 1; ; page++) {
		const batch = await github(`/repos/${org}/${name}/pulls/${options.pr}/reviews?per_page=100&page=${page}`, token);
		if (!Array.isArray(batch)) throw new Error("GitHub API: reviews is not a list");
		reviews.push(...batch.filter(record));
		if (batch.length < 100) break;
	}
	const own = (entry: Record<string, unknown>) => reviewer(entry) === agent;
	// A marker that holds a PR back counts anywhere in the review; one that clears it must stand on a line of its
	// own, so a review quoting PR text (a description, a diff line, a blockquote) cannot grant approval by accident.
	const says = (entry: Record<string, unknown>, marker: string) => typeof entry.body === "string" && entry.body.includes(marker);
	const states = (entry: Record<string, unknown>, marker: string) =>
		typeof entry.body === "string" && entry.body.split("\n").some((line) => line.trimEnd() === marker);
	// Escalation is the agent reviewer's marked, non-approving review on this head; a marker on an older commit
	// does not carry over. The operator decides out of band, and only a later approval from the agent reviewer
	// that records the decision clears it, so a routine or earlier approval never does.
	let escalation = -1;
	reviews.forEach((entry, index) => {
		if (own(entry) && entry.commit_id === head && (entry.state === "COMMENTED" || entry.state === "CHANGES_REQUESTED") && says(entry, escalationMarker)) escalation = index;
	});
	// Reviews arrive in submission order. As on GitHub, each reviewer's latest approval, change request or
	// dismissal stands; comments do not change it.
	let decision: { entry: Record<string, unknown>; index: number } | undefined;
	reviews.forEach((entry, index) => {
		if (own(entry) && (entry.state === "APPROVED" || entry.state === "CHANGES_REQUESTED" || entry.state === "DISMISSED")) decision = { entry, index };
	});
	const approved = decision?.entry.state === "APPROVED" && decision.entry.commit_id === head;
	const errors: string[] = [];
	if (escalation >= 0 && !(approved && decision!.index > escalation && states(decision!.entry, resolutionMarker))) {
		errors.push(`escalated to the operator on head ${head.slice(0, 12)}; needs a later approving review from ${agent} that records the operator's decision and has "${resolutionMarker}" on a line of its own`);
	} else if (!approved) errors.push(`needs an approving review from the designated agent reviewer ${agent} on head ${head.slice(0, 12)}`);
	return { ok: errors.length === 0, errors, reasons, approved_by: errors.length === 0 ? agent : undefined };
}
function print(result: Result, json: boolean, command: Command): void {
	if (json) { console.log(JSON.stringify(result)); return; }
	if (command === "affected") {
		for (const error of result.errors) console.error(`FAIL: ${error}`);
		if (result.ok) console.log((result.stories ?? []).join(" "));
		return;
	}
	for (const error of result.errors) console.log(`FAIL: ${error}`);
	for (const line of result.baselined ?? []) console.log(`baselined: ${line}`);
	for (const id of result.needs_evidence ?? []) console.log(`needs-evidence: ${id}`);
	if (command === "baseline") {
		for (const gap of result.gaps ?? []) console.log(`gap: ${gap}`);
		if (result.adoption !== undefined) console.log(JSON.stringify(result.adoption, null, 2));
		console.log(`foundation-check baseline: ${result.wrote ? `wrote ${result.wrote}` : "dry run; pass --write to save foundation.json"}`);
		return;
	}
	if (command === "review") {
		for (const reason of result.reasons ?? []) console.log(`requires review: ${reason}`);
		if (result.approved_by) console.log(`approved by: ${result.approved_by}`);
		if (result.ok && (result.reasons ?? []).length === 0) console.log("no agent review required");
	}
	console.log(`foundation-check ${command}: ${result.ok ? "PASS" : "FAIL"}`);
}
try {
	const options = args(process.argv.slice(2));
	if (options === "help") { console.log(usage); process.exit(0); }
	let result: Result;
	try {
		if (options.command === "check") result = check(options);
		else if (options.command === "baseline") result = baseline(options);
		else if (options.command === "affected") {
			const report: Issue[] = [];
			const stories = affected(options.repo, options.base!, report);
			const adoptionPath = join(options.repo, "foundation.json");
			const adoption = existsSync(adoptionPath) ? readJson(adoptionPath) : undefined;
			const errors = uncovered(report, adoption, liveIds(workingStories(options.repo)));
			result = { ok: errors.length === 0, errors, stories };
		} else if (options.command === "review") result = await review(options);
		else result = receipt(options);
	} catch (error) { result = { ok: false, errors: [error instanceof Error ? error.message : String(error)] }; }
	print(result, options.json, options.command);
	if (!result.ok) process.exitCode = 1;
} catch (error) {
	console.error(`${error instanceof Error ? error.message : String(error)}\n${usage}`);
	process.exitCode = 2;
}
