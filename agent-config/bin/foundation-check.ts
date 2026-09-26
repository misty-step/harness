#!/usr/bin/env bun
// foundation-check: owned standalone launcher (misty-step/harness).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const skillRoot = resolve(scriptDir, "../skills");
const usage = `Usage: foundation-check <check|baseline|affected|receipt|review> [options]
  check [--base REV]      Check foundation.json, documents, stories, features and verify skill;
                          with --base, the bootstrap baseline may only shrink
  baseline --owner NAME [--write] [--expires YYYY-MM-DD] [--revision SHA] [--surfaces a,b] [--no-walk-gaps]
                          Record current gaps; --surfaces is required when no
                          surface is declared. --write saves foundation.json.
                          On an existing record, adds dispositions for new catalog
                          obligations and --revision re-pins the standard
  affected --base REV     Print affected live story ids (space-separated)
  receipt PATH [--base REV] [--all]
                          Validate a story-walk receipt; --all requires every live story
  review --pr N [--github-repo OWNER/NAME]
                          Enforce first stories, extensions, nonapplication,
                          ledger and disposition approvals; also PR obligations
                          (GITHUB_TOKEN; GITHUB_REPOSITORY, GITHUB_API_URL)
Options:
  --repo DIR              Repository root (default: current directory)
  --catalog PATH          Foundation catalog JSON (otherwise source-relative or deployed)
  --stories-checker PATH  check-stories.sh (otherwise source-relative or deployed)
  --json                  Machine-readable result
  -h, --help              Show this help`;

type Command = "check" | "baseline" | "affected" | "receipt" | "review";
type Options = {
	command: Command; repo: string; catalog?: string; checker?: string; base?: string; receipt?: string; json: boolean;
	all: boolean; write: boolean; owner?: string; expires?: string; revision?: string; surfaces?: string[]; walkGaps: boolean;
	pr?: number; githubRepo?: string;
};
type Result = {
	ok: boolean; errors: string[]; needs_evidence?: string[]; stories?: string[]; baselined?: string[]; advisory?: string[]; gaps?: string[];
	wrote?: string; adoption?: unknown; reasons?: string[]; approved_by?: string;
};
type Feature = { file: string; stories: string[]; sources: string[] };
type Story = { id: string; live: boolean; start: number; end: number };
/** A deficiency; `gap` is the stable key a bootstrap baseline can name. Invalid adoption claims have none. */
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
	"^(?:doc:(?:README\\.md|AGENTS\\.md|DOMAIN\\.md|DESIGN\\.md|USER_STORIES\\.md|runbook|content-schema|env-pass|aliases|refs|adr)" +
	"|entry:check|stories:format|skill:verify|walk:US-\\d{3}|obl:FND-[A-Z]+(?:-[A-Z]+)*-\\d{3}" +
	"|ops:(?:ship|alert|incident)" +
	"|map:(?:index|US-\\d{3}|features/[^/:]+\\.md:(?:unlinked|stories-line|source-line|story:US-\\d{3}|source:[^\\s,]+" +
	`|heading:(?:${Object.values(featureHeadings).join("|")}))))$`,
);
const extensionPath = /^foundation\/extensions\/[^/]+\.json$/;
const approvalPath = /^foundation\/approvals\/[^/]+\.json$/;
const receiptPath = /^foundation\/receipts\/[^/]+\.json$/;
const maxBaselineDays = 30;
// ADR-004's surface vocabulary. Any of the application surfaces makes a repository an application (ADR-005).
const surfaceVocabulary = ["ui", "cli", "library", "api", "deployed", "content", "public"];
const applicationSurfaces = ["ui", "cli", "api", "deployed"];
// ADR-005: the operational obligations every application owes, and the gap each one is while pending.
const operationsGaps: Record<string, string> = { "FND-REL-001": "ops:ship", "FND-ALR-001": "ops:alert", "FND-INC-001": "ops:incident" };
// ADR-005 (operator decision 2026-09-26): repositories name a route, never an individual endpoint.
const approvedAlertRoutes: Record<string, string> = {
	"kaylee-alert-intake": "Kaylee's alert intake: Sentry internal integration → Cloudflare Worker kaylee-alert-intake → Hermes cron alert-triage → Kaylee's bot chat (hermes-config docs/alert-routing.md)",
};
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
	const valued = ["--repo", "--catalog", "--stories-checker", "--base", "--owner", "--expires", "--revision", "--surfaces", "--pr", "--github-repo"];
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
			else if (arg === "--surfaces") options.surfaces = value.split(",").map((part) => part.trim()).filter(Boolean);
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
	const baselineOnly = options.write || options.owner || options.expires || options.revision || options.surfaces || !options.walkGaps;
	if (command !== "baseline" && baselineOnly) throw new Error("--write, --owner, --expires, --revision, --surfaces and --no-walk-gaps are only valid for baseline");
	if (options.surfaces && !options.surfaces.every((surface) => surfaceVocabulary.includes(surface))) {
		throw new Error(`--surfaces takes a comma-separated list from: ${surfaceVocabulary.join(", ")}`);
	}
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
function changedFiles(repo: string, base: string, filter?: string, head = "HEAD"): string[] {
	// A rename changes both the old source owner and the destination: --name-only otherwise hides the old path.
	return git(repo, "diff", "--no-renames", "--name-only", ...(filter ? [`--diff-filter=${filter}`] : []), "-z", `${base}...${head}`).split("\0").filter(Boolean);
}
/** Live stories whose sections a change edits; a story file new at the base counts every section as edited. */
function editedStories(repo: string, base: string, head: Story[], revision = "HEAD"): Set<string> {
	const ids = new Set<string>();
	if (!changedFiles(repo, base, undefined, revision).includes("USER_STORIES.md")) return ids;
	const live = liveIds(head);
	const old = parseStories(fileAt(repo, git(repo, "merge-base", base, revision).trim(), "USER_STORIES.md") ?? "");
	const diff = git(repo, "diff", "-U0", `${base}...${revision}`, "--", "USER_STORIES.md");
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
/** Use the same affected-story rules for local CLI and the PR gate; review only reads candidate git objects. */
function changedStoryIds(repo: string, base: string, mapping: Feature[], head: Story[], revision = "HEAD"): string[] {
	const live = liveIds(head);
	const changed = changedFiles(repo, base, undefined, revision);
	const ids = editedStories(repo, base, head, revision);
	// Creating the map itself is metadata; once a map exists, changed feature files also affect their stories.
	const mergeBase = git(repo, "merge-base", base, revision).trim();
	const mapExisted = git(repo, "ls-tree", "--name-only", mergeBase, "features/").trim() !== "";
	for (const feature of mapping) {
		const featureChanged = mapExisted && changed.includes(feature.file);
		if (featureChanged || changed.some((file) => feature.sources.some((glob) => globRegex(glob).test(file))))
			for (const id of feature.stories) if (live.has(id)) ids.add(id);
	}
	return [...ids].sort();
}
function affected(repo: string, base: string, report: Issue[]): string[] {
	const head = parseStories(readFileSync(join(repo, "USER_STORIES.md"), "utf8"));
	return changedStoryIds(repo, base, features(repo, tracked(repo), head, report), head);
}
type Catalog = { id: string; version: string; obligations: { id: string }[]; approved_defaults: { id: string }[] };
function pendingIssues(adoption: unknown, catalog: Catalog): Issue[] {
	const dispositions = record(adoption) && record(adoption.dispositions) ? adoption.dispositions : {};
	// ADR-005's existing ops: keys remain the one gap for its three application obligations.
	return [...catalog.obligations, ...catalog.approved_defaults]
		.filter(({ id }) => !(id in operationsGaps) && record(dispositions[id]) && dispositions[id].status === "pending")
		.map(({ id }) => ({ gap: `obl:${id}`, message: `${id}: pending needs a dated baseline gap until independently approved not_applicable or satisfied` }));
}
function evidenceReceipt(repo: string, id: string, path: unknown, errors: string[]): void {
	if (!text(path) || !receiptPath.test(path) || !safePath(path) || !repositoryFile(repo, path)) {
		errors.push(`${id}: receipt must be an untracked foundation/receipts/*.json file from the same check job`);
		return;
	}
	if (git(repo, "ls-files", "--", path).trim()) {
		errors.push(`${id}: receipt ${path} must be untracked, outside the committed tree`);
		return;
	}
	const value = jsonOrUndefined(readFileSync(join(repo, path), "utf8"));
	if (!record(value) || value.schema !== "foundation-evidence/1" || value.obligation !== id ||
		!text(value.check) || !text(value.run) || value.exit !== 0 ||
		!/^[0-9a-f]{40}$/.test(String(value.revision)) || value.revision !== git(repo, "rev-parse", "HEAD").trim() ||
		!/^[0-9a-f]{64}$/.test(String(value.sha256)) || !safePath(value.path as string)) {
		errors.push(`${id}: ${path} needs foundation-evidence/1, this obligation, HEAD revision, check/run, exit 0 and a relative payload SHA-256`);
		return;
	}
	const directory = realpathSync(dirname(join(repo, path)));
	const payload = resolve(directory, value.path as string);
	const within = relative(directory, payload);
	if (within === ".." || within.startsWith("../") || isAbsolute(within) ||
		!existsSync(payload) || !statSync(payload).isFile() ||
		!realpathSync(payload).startsWith(`${directory}/`) || sha256(readFileSync(payload)) !== value.sha256)
		errors.push(`${id}: ${path} payload is missing, escapes its receipt directory, or has a different SHA-256`);
}
function approvalRecord(repo: string, id: string, disposition: Record<string, unknown>, errors: string[], revision = "HEAD"): void {
	const { status, reason, substitute, approval_ref, expires } = disposition;
	if (!text(reason) || !text(substitute) || !text(approval_ref) || !approvalPath.test(approval_ref) || !safePath(approval_ref) ||
		(status === "exception" && (!isDate(expires) || expires < today() || expires > addDays(today(), maxBaselineDays))) ||
		(status === "not_applicable" && expires !== undefined) ||
		Object.keys(disposition).some((key) => !["status", "reason", "substitute", "approval_ref", ...(status === "exception" ? ["expires"] : [])].includes(key))) {
		errors.push(`${id}: ${status} requires reason, substitute, tracked approval_ref and ${status === "exception" ? "a current expiry within 30 days" : "no expiry"}`);
		return;
	}
	const source = fileAt(repo, revision, approval_ref);
	const value = jsonOrUndefined(source);
	if (!record(value) || value.schema !== "foundation-approval/1" || value.obligation !== id ||
		value.disposition !== status || value.reason !== reason || value.substitute !== substitute ||
		(status === "exception" ? value.expires !== expires : value.expires !== undefined) ||
		Object.keys(value).some((key) => !["schema", "obligation", "disposition", "reason", "substitute", ...(status === "exception" ? ["expires"] : [])].includes(key)))
		errors.push(`${id}: ${approval_ref} must be a tracked foundation-approval/1 record at HEAD exactly matching the disposition; the designated reviewer approves the PR, not a name in JSON`);
}
function validateAdoption(repo: string, adoption: unknown, catalog: Catalog, catalogBytes: Buffer, errors: string[], needs_evidence: string[]): void {
	if (!record(adoption) || adoption.schema !== "foundation-adoption/1") errors.push("foundation.json: invalid schema");
	const standard = record(adoption) ? adoption.standard : undefined;
	if (!record(standard) || standard.id !== catalog.id || standard.version !== catalog.version) errors.push("foundation.json: standard id or version differs from catalog");
	if (!record(standard) || standard.catalog_sha256 !== sha256(catalogBytes)) errors.push("foundation.json: catalog_sha256 differs from catalog bytes");
	if (!record(standard) || !/^[0-9a-f]{40}$/.test(String(standard.revision)) ||
		standard.source !== `https://github.com/misty-step/harness/blob/${standard.revision}/agent-config/skills/foundation/foundation-standard-v1.json`)
		errors.push("foundation.json: source must pin its 40-hex revision and canonical catalog path");
	if (!record(adoption) || !Array.isArray(adoption.capabilities) || !adoption.capabilities.every(text)) errors.push("foundation.json: capabilities must be an array of descriptions");
	const surfaces = record(adoption) ? adoption.surfaces : undefined;
	if (!Array.isArray(surfaces) || surfaces.length === 0 || new Set(surfaces).size !== surfaces.length ||
		!surfaces.every((surface) => typeof surface === "string" && surfaceVocabulary.includes(surface)))
		errors.push(`foundation.json: surfaces must be a non-empty list of distinct values from ${surfaceVocabulary.join(", ")}`);
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
			case "satisfied": evidenceReceipt(repo, id, value.receipt, errors); break;
			case "not_applicable":
			case "exception": approvalRecord(repo, id, value, errors); break;
			default: errors.push(`${id}: unknown disposition`);
		}
	}
	for (const id of Object.keys(operationsGaps)) {
		const status = record(dispositions[id]) ? dispositions[id].status : undefined;
		if (status === "exception") errors.push(`${id}: no exception is allowed; every application owes it (ADR-005)`);
		if (status === "not_applicable" && isApplication(adoption))
			errors.push(`${id}: applies to every application; not_applicable needs surfaces without ${applicationSurfaces.join(", ")} (ADR-005)`);
	}
}
/** An application changes a live system or ships something users run. Without surfaces, assume it is one. */
function isApplication(adoption: unknown): boolean {
	const surfaces = record(adoption) ? adoption.surfaces : undefined;
	return !Array.isArray(surfaces) || surfaces.some((surface) => applicationSurfaces.includes(surface));
}
/** Resolve only local, repository-owned targets; an escaped path is never evidence of a valid reference. */
function repositoryFile(repo: string, path: unknown): path is string {
	if (!text(path) || !safePath(path)) return false;
	const target = resolve(repo, path);
	if (relative(repo, target).startsWith("..") || !existsSync(target)) return false;
	const real = realpathSync(target);
	const inside = relative(realpathSync(repo), real);
	return inside !== ".." && !inside.startsWith("../") && !isAbsolute(inside) && statSync(real).isFile();
}
function packageScripts(repo: string): Record<string, unknown> {
	const value = jsonOrUndefined(fileAt(repo, "HEAD", "package.json"));
	return record(value) && record(value.scripts) ? value.scripts : {};
}
/** Follow committed symlink blobs, not worktree links: the terminal check must be a file in HEAD. */
function headFilePath(repo: string, path: string, modes: Map<string, string>): string | undefined {
	const seen = new Set<string>();
	while (!seen.has(path)) {
		seen.add(path);
		const mode = modes.get(path);
		if (mode === "100644" || mode === "100755") return path;
		if (mode !== "120000") return undefined;
		const target = fileAt(repo, "HEAD", path);
		if (!text(target)) return undefined;
		const resolved = relative(repo, resolve(repo, dirname(path), target));
		if (!resolved || resolved === ".." || resolved.startsWith("../") || isAbsolute(resolved)) return undefined;
		path = resolved;
	}
	return undefined;
}
/** Resolve repository paths and package targets; bare lint rule names have no deterministic local resolver. */
function commandTarget(repo: string, target: string, files: Map<string, string>): boolean {
	const script = target.match(/^(?:(?:npm|pnpm|yarn|bun) run |(?:npm|pnpm|yarn|bun) )(?:-- )?([-\w.:]+)$/);
	if (script) return files.has("package.json") && text(packageScripts(repo)[script[1]]);
	const file = target.replace(/^(?:(?:sh|bash|bun|node|python3?) )?(?:\.\/)?/, "").split(/\s+/)[0];
	if (headFilePath(repo, file, files)) return true;
	if (/^make [-\w.]+$/.test(target)) {
		const path = headFilePath(repo, "Makefile", files);
		const makefile = path ? fileAt(repo, "HEAD", path) : undefined;
		return makefile !== undefined && new RegExp(`^${target.slice(5)}\\s*:`, "m").test(makefile);
	}
	return false;
}
function ledgerTarget(repo: string, target: string, files: Map<string, string>): "resolved" | "unresolved" | "missing" {
	if (!text(target) || /[\n\r`]/.test(target)) return "missing";
	if (commandTarget(repo, target, files)) return "resolved";
	// A rule id is well-formed but unresolved; explicit repository paths and package scripts must exist at HEAD.
	if (/^(?:@[-\w]+\/)?[-\w]+(?:\/[-\w]+)?$/.test(target) &&
		!["scripts/", "tests/", "src/"].some((prefix) => target.startsWith(prefix))) return "unresolved";
	return "missing";
}
function ledgerSections(domain: string): string[] {
	return [...domain.matchAll(/^## Invariants[ \t]*\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)].map((match) => match[1]);
}
function ledgerIssues(repo: string, files: Map<string, string>, issues: Issue[]): void {
	if (!files.has("DOMAIN.md") || !repositoryFile(repo, "DOMAIN.md")) return;
	const sections = ledgerSections(readFileSync(join(repo, "DOMAIN.md"), "utf8"));
	if (sections.length !== 1 || !sections[0].trim()) {
		issues.push({ gap: "doc:DOMAIN.md", message: sections.length > 1 ? "DOMAIN.md: duplicate ## Invariants sections" : "DOMAIN.md: needs a non-empty ## Invariants ledger" });
		return;
	}
	const ids = new Set<string>();
	const bullets: string[] = [];
	for (const line of sections[0].split("\n")) {
		if (/^[-*]\s/.test(line)) bullets.push(line);
		else if (/^[ \t]+\S/.test(line) && bullets.length > 0) bullets[bullets.length - 1] += ` ${line.trim()}`;
	}
	for (const bullet of bullets) {
		const match = bullet.match(/^- \*\*(INV-\d{3})\*\* (.+?)\. (?:Enforced by `([^`]+)`\.?|(`unenforced`)(?:: reviewers judge it)?\.?)(?: Why: (.+?))?(?: Scope: (.+))?$/);
		if (!match || bullet.includes("Check:")) { issues.push({ gap: "doc:DOMAIN.md", message: `DOMAIN.md: invalid invariant bullet: ${bullet}` }); continue; }
		if (ids.has(match[1])) issues.push({ gap: "doc:DOMAIN.md", message: `DOMAIN.md: duplicate ${match[1]}` });
		ids.add(match[1]);
		if (match[3] && ledgerTarget(repo, match[3], files) === "missing")
			issues.push({ gap: "doc:DOMAIN.md", message: `DOMAIN.md: ${match[1]} cites missing check ${match[3]}` });
	}
	if (bullets.length === 0) issues.push({ gap: "doc:DOMAIN.md", message: "DOMAIN.md: ## Invariants needs at least one rule" });
}
function headDirectory(path: string, files: Map<string, string>): boolean {
	const prefix = `${path}/`;
	for (const file of files.keys()) if (file.startsWith(prefix)) return true;
	return false;
}
function coreReferences(repo: string, files: Map<string, string>, documents: string[], issues: Issue[]): void {
	const root = realpathSync(repo);
	for (const doc of documents) {
		if (!files.has(doc) || !repositoryFile(repo, doc)) continue;
		const contents = readFileSync(join(repo, doc), "utf8");
		for (const match of contents.matchAll(/!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^)\s]+))(?:\s+["'][^"']+["'])?\s*\)/g)) {
			const href = match[1] ?? match[2];
			if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#|\/)/i.test(href)) continue;
			let path: string;
			try { path = decodeURIComponent(href.split("#")[0].split("?")[0]); } catch { path = ""; }
			if (!path) continue;
			const resolved = resolve(repo, dirname(doc), path);
			const within = relative(repo, resolved);
			// A path that exists only in the working tree is not evidence for a candidate revision.
			const atHead = within === "" || files.has(within) || headDirectory(within, files);
			const canonical = existsSync(resolved) ? relative(root, realpathSync(resolved)) : "..";
			const canonicalAtHead = canonical === "" || files.has(canonical) || headDirectory(canonical, files);
			if (within === ".." || within.startsWith("../") || isAbsolute(within) ||
				canonical === ".." || canonical.startsWith("../") || isAbsolute(canonical) || !atHead || !canonicalAtHead)
				issues.push({ gap: "doc:refs", message: `${doc}: Markdown link ${href} does not resolve in the repository at HEAD` });
		}
	}
	// Only declared routing cells are targets: paths are directories or files, and description cells are prose.
	if (!files.has("AGENTS.md") || !repositoryFile(repo, "AGENTS.md")) return;
	const agents = readFileSync(join(repo, "AGENTS.md"), "utf8");
	const routing = agents.match(/^#{1,3} [^\n]*(?:Rout|rout)[^\n]*\n([\s\S]*?)(?=^#{1,3} |$(?![\s\S]))/m)?.[1] ?? "";
	const rows = routing.split("\n").filter((line) => line.startsWith("|") && !/^\|[\s|:-]+\|?$/.test(line));
	const cells = (row: string) => row.split("|").slice(1, -1).map((cell) => cell.trim());
	const headers = cells(rows.shift() ?? "");
	for (const row of rows) {
		const values = cells(row);
		for (const [index, header] of headers.entries()) {
			for (const [, target] of (values[index] ?? "").matchAll(/`([^`]+)`/g)) {
				if (/^(?:path|directory)$/i.test(header)) {
					const path = target.replace(/\/$/, "");
					const resolved = resolve(repo, path);
					const atHead = target.endsWith("/") ? headDirectory(path, files) : !!headFilePath(repo, path, files);
					const real = existsSync(resolved) ? realpathSync(resolved) : "";
					const within = real ? relative(realpathSync(repo), real) : "..";
					if (!safePath(path) || !atHead || within === ".." || within.startsWith("../") || isAbsolute(within) ||
						!existsSync(resolved) || (target.endsWith("/") ? !statSync(real).isDirectory() : !statSync(real).isFile()))
						issues.push({ gap: "doc:refs", message: `AGENTS.md: routing path ${target} does not resolve at HEAD` });
				} else if (/^(?:command|script|target|check|walk|release)(?:\s+command)?$/i.test(header) && !commandTarget(repo, target, files))
					issues.push({ gap: "doc:refs", message: `AGENTS.md: routing command ${target} has no script, package script or target` });
			}
		}
	}
}
function adrIssues(repo: string, files: string[], issues: Issue[]): void {
	// A date-prefixed postmortem is not a decision. Recognize explicit ADR names and the old decisions homes.
	const numbered = files.filter((path) =>
		/(?:^|\/)ADR[-_]?\d{3,4}[-_][^/]+\.md$/i.test(path) ||
		/(?:^|\/)(?:docs\/decisions|decisions)\/\d{3,4}[-_][^/]+\.md$/i.test(path));
	for (const path of numbered) {
		if (!/(?:^|\/)docs\/adr\/[^/]+\.md$/.test(path))
			issues.push({ gap: "doc:adr", message: `${path}: ADRs belong only in docs/adr/ (a monorepo may have one per component)` });
	}
	const dirs = new Map<string, Map<string, string>>();
	for (const path of files.filter((name) => /(?:^|\/)docs\/adr\/[^/]+\.md$/.test(name))) {
		const dir = dirname(path);
		const name = path.slice(dir.length + 1);
		if (/^(?:README|INDEX)\.md$/i.test(name)) continue;
		const match = name.match(/^(\d{3,4})[-_].+\.md$/);
		if (!match) { issues.push({ gap: "doc:adr", message: `${path}: ADR name needs a numbered slug` }); continue; }
		const group = dirs.get(dir) ?? new Map<string, string>();
		const number = String(Number(match[1]));
		if (group.has(number)) issues.push({ gap: "doc:adr", message: `${path}: duplicate ADR ${number} in ${dir}` });
		group.set(number, path);
		dirs.set(dir, group);
		if (!repositoryFile(repo, path)) continue;
		const body = readFileSync(join(repo, path), "utf8");
		if (!/^Status:\s*\S.+$/m.test(body)) issues.push({ gap: "doc:adr", message: `${path}: missing Status: line` });
		for (const target of body.matchAll(/\bSuperseded by\s+(?:\[)?(?:ADR[- ]?)?(\d{3,4})\b/gi)) {
			if (!files.some((name) => dirname(name) === dir && new RegExp(`^0*${Number(target[1])}[-_]`).test(name.slice(dir.length + 1))))
				issues.push({ gap: "doc:adr", message: `${path}: Superseded by ${target[1]} does not resolve in ${dir}` });
		}
	}
}
/** ADR-004 stage 1 documents, references, aliases, ledger and the fixed gate entry point. */
function contentIssues(repo: string, checkerPath: string, adoption: unknown): Issue[] {
	const issues: Issue[] = [];
	const files = tracked(repo);
	// An unborn repository has no candidate tree; the installer smoke still needs the missing-adoption
	// diagnostic, while no index-only path may satisfy a HEAD reference.
	const tree = spawnSync("git", ["ls-tree", "-r", "-z", "HEAD"], { cwd: repo, encoding: "utf8" });
	if (tree.error) throw new Error(`git ls-tree: ${tree.error.message}`);
	if (tree.status !== 0 && spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: repo, stdio: "ignore" }).status === 0)
		throw new Error(`git ls-tree: ${tree.stderr.trim()}`);
	const headFiles = new Map<string, string>();
	if (tree.status === 0) for (const entry of tree.stdout.split("\0")) {
		const separator = entry.indexOf("\t");
		if (separator !== -1) headFiles.set(entry.slice(separator + 1), entry.slice(0, 6));
	}
	const names = new Set(files);
	const surfaces = record(adoption) && Array.isArray(adoption.surfaces) ? adoption.surfaces : [];
	const required = ["README.md", "AGENTS.md", "DOMAIN.md", "USER_STORIES.md"];
	if (surfaces.includes("ui")) required.push("DESIGN.md");
	if (surfaces.includes("deployed")) required.push("docs/runbook.md");
	for (const path of required) {
		if (!repositoryFile(repo, path)) issues.push({ gap: path === "docs/runbook.md" ? "doc:runbook" : `doc:${path}`, message: `FND-DOC-001: missing ${path}` });
	}
	if (repositoryFile(repo, "AGENTS.md") && !readFileSync(join(repo, "AGENTS.md"), "utf8").includes("DOMAIN.md"))
		issues.push({ gap: "doc:AGENTS.md", message: "AGENTS.md must route reviewers to DOMAIN.md's invariants ledger" });
	if (surfaces.includes("deployed") && repositoryFile(repo, "docs/runbook.md")) {
		const body = readFileSync(join(repo, "docs/runbook.md"), "utf8");
		for (const heading of ["Release", "Rollback", "Recover"])
			if (!new RegExp(`^## ${heading}\\s*$`, "m").test(body)) issues.push({ gap: "doc:runbook", message: `docs/runbook.md: missing ## ${heading}` });
	}
	if (surfaces.includes("content")) {
		const content = record(adoption) ? adoption.content : undefined;
		if (!record(content) || !text(content.schema) || !names.has(content.schema) || !repositoryFile(repo, content.schema) ||
			!text(content.lint) || !commandTarget(repo, content.lint, headFiles))
			issues.push({ gap: "doc:content-schema", message: "content requires content.schema (tracked file) and content.lint (script or package script)" });
	}
	if (names.has(".env.pass")) {
		if (!repositoryFile(repo, ".env.pass")) issues.push({ gap: "doc:env-pass", message: ".env.pass: tracked credential manifest is missing" });
		else for (const [index, line] of readFileSync(join(repo, ".env.pass"), "utf8").split("\n").entries()) {
			if (line.trim() && !line.startsWith("#") && !/^[A-Za-z_][A-Za-z0-9_]*=[A-Za-z0-9._/@-]+$/.test(line))
				issues.push({ gap: "doc:env-pass", message: `.env.pass: line ${index + 1} must be a names-only NAME=pass-entry mapping` });
		}
	}
	for (const alias of ["CLAUDE.md", "GEMINI.md"]) {
		if (!existsSync(join(repo, alias)) && !names.has(alias)) continue;
		const stage = git(repo, "ls-files", "--stage", "--", alias);
		if (!stage.startsWith("120000 ") || fileAt(repo, "HEAD", alias)?.trim() !== "AGENTS.md")
			issues.push({ gap: "doc:aliases", message: `${alias}: must be a tracked symlink to AGENTS.md` });
	}
	ledgerIssues(repo, headFiles, issues);
	coreReferences(repo, headFiles, [...required, ...files.filter((file) => /(?:^|\/)docs\/adr\/[^/]+\.md$/.test(file))], issues);
	adrIssues(repo, files, issues);
	if (!repositoryFile(repo, "scripts/check") || (statSync(join(repo, "scripts/check")).mode & 0o111) === 0)
		issues.push({ gap: "entry:check", message: "scripts/check must exist and be executable" });
	const workflows = files.filter((name) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(name));
	if (!workflows.some((name) => {
		const workflow = workflowAt(repo, name);
		return typeof workflow !== "string" && Object.values(workflow.jobs).some((job) =>
			record(job) && Array.isArray(job.steps) && job.steps.some((step: unknown) =>
				record(step) && text(step.run) && /^\s*(?:(?:exec|sh|bash)\s+)?(?:\.\/)?scripts\/check(?:\s|$)/m.test(step.run)));
	})) issues.push({ gap: "entry:check", message: "a CI workflow must invoke scripts/check" });
	if (repositoryFile(repo, "USER_STORIES.md")) {
		const enforced = !record(adoption) || adoption.mode !== "bootstrap";
		const checker = spawnSync("sh", [checkerPath, ...(enforced ? ["--strict-evidence"] : []), repo], { cwd: repo, encoding: "utf8" });
		if (checker.error || checker.status !== 0) {
			issues.push({ gap: "stories:format", message: `check-stories.sh: ${checker.error?.message || (checker.stderr || checker.stdout).trim()}` });
		}
	}
	features(repo, files, workingStories(repo), issues);
	const skillFiles = files.filter((f) => /^(?:\.agents\/skills|skills)\/[^/]+\/SKILL\.md$/.test(f));
	if (!skillFiles.some((f) => {
		const body = readFileSync(join(repo, f), "utf8");
		return ["Launch", "Doctor", "Drive", "Evidence", "Cleanup"].every((h) => body.split("\n").some((line) => line.startsWith(`## ${h}`)));
	})) issues.push({ gap: "skill:verify", message: "missing verify skill with ## Launch, ## Doctor, ## Drive, ## Evidence and ## Cleanup" });
	return issues;
}
/** A workflow file's triggers as an object, whatever YAML shape `on:` takes. */
function workflowAt(repo: string, path: unknown): { name: string; on: Record<string, unknown>; jobs: Record<string, unknown> } | string {
	if (!text(path) || !safePath(path) || !/^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) return `${String(path)} is not a .github/workflows/*.yml path`;
	if (!existsSync(join(repo, path))) return `${path} does not exist`;
	let doc: unknown;
	try { doc = Bun.YAML.parse(readFileSync(join(repo, path), "utf8")); } catch { return `${path} is not valid YAML`; }
	if (!record(doc)) return `${path} is not a workflow`;
	const raw = doc.on ?? (doc as Record<string, unknown>)["true"];
	const on = typeof raw === "string" ? { [raw]: null } : Array.isArray(raw) ? Object.fromEntries(raw.map((name) => [String(name), null])) : record(raw) ? raw : {};
	// GitHub names a workflow by its `name:`, or by its path when it has none; workflow_run refers to that name.
	return { name: text(doc.name) ? doc.name : path, on, jobs: record(doc.jobs) ? doc.jobs : {} };
}
/** GitHub's branch filter semantics: `*` stays within a path segment, `**` crosses them, and a later `!pattern` excludes. */
function branchMatches(patterns: unknown, branch: string): boolean {
	const list = typeof patterns === "string" ? [patterns] : Array.isArray(patterns) ? patterns.map(String) : [];
	const glob = (pattern: string) => new RegExp(`^${pattern.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, ".").replace(/\u0000/g, ".*")}$`);
	let included = false;
	for (const pattern of list) {
		if (pattern.startsWith("!")) { if (glob(pattern.slice(1)).test(branch)) included = false; }
		else if (glob(pattern).test(branch)) included = true;
	}
	return included;
}
/** Whether a push or workflow_run trigger fires for every push to `branch`: branch filters honoured, no path or tag-only filters. */
function firesOn(trigger: unknown, branch: string): boolean {
	if (trigger === null || trigger === undefined) return true;
	if (!record(trigger)) return false;
	// A path filter skips some green pushes, and a tag filter without a branch filter means tags only.
	if (["paths", "paths-ignore"].some((key) => key in trigger)) return false;
	const branches = "branches" in trigger, ignored = "branches-ignore" in trigger;
	if (!branches && !ignored && ("tags" in trigger || "tags-ignore" in trigger)) return false;
	if (branches && !branchMatches(trigger.branches, branch)) return false;
	if (ignored && branchMatches(trigger["branches-ignore"], branch)) return false;
	return true;
}
/** The GitHub event payload in CI, when there is one. */
function ciEvent(): Record<string, unknown> | undefined {
	const path = process.env.GITHUB_EVENT_PATH;
	const event = path && existsSync(path) ? jsonOrUndefined(readFileSync(path, "utf8")) : undefined;
	return record(event) ? event : undefined;
}
/** The repository's default branch, from the CI event or the clone's origin/HEAD; undefined when neither says. */
function defaultBranch(repo: string): string | undefined {
	const repository = ciEvent()?.repository;
	if (record(repository) && text(repository.default_branch)) return repository.default_branch;
	const head = spawnSync("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { cwd: repo, encoding: "utf8" });
	return head.status === 0 && head.stdout.trim().startsWith("origin/") ? head.stdout.trim().slice("origin/".length) : undefined;
}
/**
 * Terms a ship job, or a job it needs, may combine with `&&` and still run on every green push to the default
 * branch. Anything else (a promotion branch, a commit-message opt-in, a repository toggle, always()) fails closed.
 */
function guardAllowed(branch: string): (term: string) => boolean {
	const quoted = (value: string) => `['"]${value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}['"]`;
	const repository = ciEvent()?.repository;
	const fullName = process.env.GITHUB_REPOSITORY || (record(repository) && text(repository.full_name) ? repository.full_name : undefined);
	const allowed = [
		/^success\(\)$/,
		new RegExp(`^github\\.event_name==${quoted("push")}$`),
		new RegExp(`^github\\.event_name!=${quoted("pull_request")}$`),
		new RegExp(`^github\\.ref==${quoted(`refs/heads/${branch}`)}$`),
		new RegExp(`^github\\.ref_name==${quoted(branch)}$`),
		/^github\.ref_name==github\.event\.repository\.default_branch$/,
		/^github\.ref==format\(['"]refs\/heads\/\{0\}['"],github\.event\.repository\.default_branch\)$/,
		new RegExp(`^github\\.event\\.workflow_run\\.conclusion==${quoted("success")}$`),
		new RegExp(`^github\\.event\\.workflow_run\\.head_branch==${quoted(branch)}$`),
		new RegExp(`^github\\.event\\.workflow_run\\.event==${quoted("push")}$`),
		...(fullName ? [new RegExp(`^github\\.repository==${quoted(fullName)}$`)] : []),
	];
	return (term) => allowed.some((pattern) => pattern.test(term));
}
const guardTerms = (condition: unknown): string[] => {
	const bare = condition === undefined ? "" : String(condition).replace(/^\s*\$\{\{([\s\S]*)\}\}\s*$/, "$1").replace(/\s+/g, "");
	return bare === "" ? [] : bare.split("&&").map((term) => term.replace(/^\((.*)\)$/, "$1"));
};
const needsOf = (job: Record<string, unknown>): string[] => (typeof job.needs === "string" ? [job.needs] : Array.isArray(job.needs) ? job.needs.map(String) : []);
/** FND-REL-001: a green default branch ships through a job that waits on the gate; the receipt proves runtime tenant fan-out. */
function shipProblems(repo: string, ship: unknown): string[] {
	if (!record(ship) || !text(ship.branch)) return ["operations.ship must name the default branch and a workflow and job, or a platform"];
	const problems: string[] = [];
	const tenancy = ship.tenancy;
	const multi = record(tenancy) && tenancy.model === "multi";
	if (!record(tenancy) || !text(tenancy.model)) problems.push("operations.ship.tenancy must declare model single or multi");
	else if (tenancy.model !== "single" && !multi) problems.push("operations.ship.tenancy.model must be single or multi");
	if (multi) {
		const file = (path: unknown): path is string => text(path) && safePath(path) && existsSync(join(repo, path)) && statSync(join(repo, path)).isFile();
		const registryFile = file(tenancy.registry);
		if (!registryFile) problems.push("operations.ship.tenancy.registry must name an existing repository file listing every tenant");
		if (!file(tenancy.state)) problems.push("operations.ship.tenancy.state must name an existing repository file reporting each tenant's deployed revision and migration level");
		if (tenancy.excluded !== undefined && !Array.isArray(tenancy.excluded)) problems.push("operations.ship.tenancy.excluded must be an array of tenant and reason entries");
		else if (Array.isArray(tenancy.excluded)) {
			const registry = registryFile ? readFileSync(join(repo, tenancy.registry), "utf8") : undefined;
			for (const [index, exclusion] of tenancy.excluded.entries()) {
				if (!record(exclusion) || !text(exclusion.tenant)) problems.push(`operations.ship.tenancy.excluded[${index}].tenant must be non-empty`);
				else if (registry !== undefined) {
					// Complete identifiers in text, JSON or YAML; ": " ends a YAML key, "a:b" remains one ID.
					const tenant = exclusion.tenant.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
					if (!new RegExp(`(?<![\\p{L}\\p{N}_.:-])${tenant}(?![\\p{L}\\p{N}_.-]|:\\S)`, "u").test(registry))
						problems.push(`operations.ship.tenancy.excluded[${index}].tenant ${exclusion.tenant} is not in ${tenancy.registry}`);
				}
				if (!record(exclusion) || !text(exclusion.reason)) problems.push(`operations.ship.tenancy.excluded[${index}].reason must be non-empty`);
			}
		}
	}
	const branch = defaultBranch(repo);
	if (branch === undefined) return [...problems, "cannot confirm the default branch (no GITHUB_EVENT_PATH repository and no origin/HEAD)"];
	if (ship.branch !== branch) return [...problems, `operations.ship.branch is ${ship.branch}, but the default branch is ${branch}`];
	if (text(ship.platform)) {
		if (multi) problems.push("multi-tenant shipping needs a workflow job, not a platform, to verify migration order");
		return problems;
	}
	const workflow = workflowAt(repo, ship.workflow);
	if (typeof workflow === "string") return [...problems, workflow];
	const job = text(ship.job) ? workflow.jobs[ship.job] : undefined;
	if (!record(job)) return [...problems, `${String(ship.workflow)} has no job ${String(ship.job)}`];
	const triggerStart = problems.length;
	const onPush = "push" in workflow.on && firesOn(workflow.on.push, branch);
	const run = workflow.on.workflow_run;
	let onRun = "workflow_run" in workflow.on && firesOn(run, branch);
	if (onRun) {
		// The upstream a workflow_run follows must itself be the gate that fires on every push; a dispatch-only
		// or scheduled upstream is a manual or periodic promotion.
		const upstream = record(run) ? (typeof run.workflows === "string" ? [run.workflows] : Array.isArray(run.workflows) ? run.workflows.map(String) : []) : [];
		const files = existsSync(join(repo, ".github/workflows")) ? readdirSync(join(repo, ".github/workflows")).filter((f) => /\.ya?ml$/.test(f)) : [];
		const named = new Map(files.map((f) => workflowAt(repo, `.github/workflows/${f}`)).filter((w): w is Exclude<typeof w, string> => typeof w !== "string").map((w) => [w.name, w]));
		const gates = upstream.map((name) => named.get(name));
		if (upstream.length === 0 || gates.some((gate) => !gate || !("push" in gate.on) || !firesOn(gate.on.push, branch))) {
			problems.push(`${String(ship.workflow)} follows ${upstream.join(", ") || "no workflow"}, which does not run on every push to ${branch}`);
			onRun = false;
		}
	}
	if (!onPush && !onRun && problems.length === triggerStart) problems.push(`${String(ship.workflow)} does not run on every push to ${branch}`);
	// The ship job and every job it needs, transitively, must exist, run on every green push, and block on failure:
	// an opt-in or non-blocking gate one hop up is still not shipping on green.
	const allowed = guardAllowed(branch);
	const seen = new Set<string>();
	const pending = [ship.job];
	while (pending.length > 0) {
		const name = pending.shift()!;
		if (seen.has(name)) continue;
		seen.add(name);
		const current = workflow.jobs[name];
		if (!record(current)) { problems.push(`job ${ship.job} needs ${name}, which does not exist`); continue; }
		if (!guardTerms(current.if).every(allowed)) problems.push(`job ${name} has if: ${String(current.if)}, which does not ship every green push`);
		if (name !== ship.job && current["continue-on-error"] !== undefined && current["continue-on-error"] !== false) problems.push(`job ${name} gates the ship job but has continue-on-error`);
		pending.push(...needsOf(current));
	}
	const afterGreenRun = onRun && guardTerms(job.if).some((term) => /^github\.event\.workflow_run\.conclusion==['"]success['"]$/.test(term));
	if (needsOf(job).length === 0 && !afterGreenRun) problems.push(`job ${ship.job} ships without waiting on the gate: give it needs, or run it from workflow_run only when the conclusion is success`);
	if (multi) {
		if (!text(tenancy.migrate) || !record(workflow.jobs[tenancy.migrate])) problems.push(`operations.ship.tenancy.migrate must name an existing job in ${ship.workflow}`);
		else if (tenancy.migrate === ship.job || !seen.has(tenancy.migrate)) problems.push(`job ${tenancy.migrate} must be in the transitive needs chain before ${ship.job}`);
	}
	return problems;
}
/** FND-ALR-001: remote error capture, an outside health check and an approved agent triage destination. */
function alertProblems(repo: string, alert: unknown): string[] {
	if (!record(alert)) return ["operations.alert must name errors, health and destination"];
	const problems: string[] = [];
	const errors = alert.errors;
	if (!record(errors) || !text(errors.provider) || !text(errors.init) || !safePath(errors.init)) problems.push("operations.alert.errors needs a provider and the path that initialises it");
	else if (!existsSync(join(repo, errors.init))) problems.push(`${errors.init} does not exist`);
	else if (!readFileSync(join(repo, errors.init), "utf8").toLowerCase().includes(errors.provider.toLowerCase())) problems.push(`${errors.init} does not reference ${errors.provider}`);
	const health = alert.health;
	if (record(health) && text(health.external)) { /* an outside monitor proves itself in the receipt */ }
	else if (record(health) && health.monitor !== undefined) {
		const monitor = workflowAt(repo, health.monitor);
		if (typeof monitor === "string") problems.push(monitor);
		else if (!("schedule" in monitor.on)) problems.push(`${String(health.monitor)} does not run on a schedule`);
	} else problems.push("operations.alert.health needs a scheduled monitor workflow or a named external monitor");
	if (!text(alert.destination)) problems.push("operations.alert.destination must name where alerts go");
	else if (!Object.hasOwn(approvedAlertRoutes, alert.destination)) problems.push(`operations.alert.destination must name an approved agent triage route: ${Object.keys(approvedAlertRoutes).join(", ")}`);
	return problems;
}
/** FND-INC-001: the runbook says how incidents run, and every closed postmortem links the change that closed its class. */
function incidentProblems(repo: string): string[] {
	const problems: string[] = [];
	const runbook = join(repo, "docs/runbook.md");
	const section = (body: string, heading: string) => body.split(/^## /m).find((part) => part.startsWith(`${heading}\n`))?.slice(heading.length).trim();
	if (!existsSync(runbook) || !section(readFileSync(runbook, "utf8"), "Incidents")) problems.push("docs/runbook.md needs a non-empty ## Incidents section");
	const dir = join(repo, "docs/postmortems");
	const reports = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md" && f !== "TEMPLATE.md") : [];
	for (const file of reports) {
		const body = readFileSync(join(dir, file), "utf8");
		const pokayoke = section(body, "Pokayoke");
		const followUp = section(body, "Follow-up");
		if (!pokayoke || followUp === undefined) { problems.push(`docs/postmortems/${file}: needs ## Pokayoke and ## Follow-up sections`); continue; }
		const open = /^- \*\*Status:\*\*\s*open\b/im.test(body);
		if (!open && !/https?:\/\/\S+|#\d+\b|\b[0-9a-f]{7,40}\b/.test(followUp)) problems.push(`docs/postmortems/${file}: a closed postmortem must link the change that ruled out its class`);
	}
	return problems;
}
/** Repository-side security evidence; only an executed receipt can establish actual scan, safe merge and auth behavior. */
function securityIssues(repo: string, adoption: unknown): Issue[] {
	if (!record(adoption) || !record(adoption.dispositions) ||
		!record(adoption.dispositions["FND-SEC-001"]) || adoption.dispositions["FND-SEC-001"].status !== "satisfied") return [];
	const problems: string[] = [];
	const files = new Set(tracked(repo));
	const security = record(adoption.security) ? adoption.security : {};
	const jobAt = (claim: unknown, event: string, label: string) => {
		if (!record(claim) || !text(claim.job)) { problems.push(`${label} needs a workflow and job`); return undefined; }
		if (!text(claim.workflow) || !files.has(claim.workflow)) { problems.push(`${label}: workflow must be tracked at HEAD`); return undefined; }
		const workflow = workflowAt(repo, claim.workflow);
		if (typeof workflow === "string") { problems.push(`${label}: ${workflow}`); return undefined; }
		if (!(event in workflow.on)) problems.push(`${label}: ${String(claim.workflow)} must run on ${event}`);
		const job = workflow.jobs[claim.job];
		if (!record(job)) { problems.push(`${label}: ${String(claim.workflow)} has no job ${claim.job}`); return undefined; }
		return { job, workflow };
	};
	const stepsOf = (job: Record<string, unknown>): Record<string, unknown>[] => Array.isArray(job.steps) ? job.steps.filter(record) : [];
	const conditionAllowed = (condition: unknown, events: string[], bot = false): boolean =>
		guardTerms(condition).every((term) => term === "success()" ||
			(events.length === 1 && (term === `github.event_name=='${events[0]}'` || term === `github.event_name=="${events[0]}"`)) ||
			(bot && /^github\.actor==['"]dependabot\[bot\]['"]$/.test(term)));
	const diagnosticStep = (step: Record<string, unknown>): boolean =>
		/^actions\/upload-artifact@/.test(String(step.uses)) ||
		(text(step.run) && /^(?:echo|printf)\s+[^;\n|&]+$/.test(step.run.trim()));
	const optionalDiagnosticCondition = (condition: unknown): boolean =>
		typeof condition === "string" && /^\s*(?:\$\{\{\s*)?(?:always|failure)\(\)(?:\s*\}\})?\s*$/.test(condition);
	// Every prerequisite must itself be an unconditional blocking gate, recursively; diagnostics may
	// upload on failure, but a failure-only check does not establish a green PR gate.
	const prerequisitesBlock = (
		workflow: { jobs: Record<string, unknown> }, job: Record<string, unknown>, events: string[], bot = false,
	): boolean => {
		const active = new Set<string>();
		const checked = new Map<string, boolean>();
		const gateBlocks = (name: string): boolean => {
			if (checked.has(name)) return checked.get(name)!;
			if (active.has(name)) return false;
			const gate = workflow.jobs[name];
			if (!record(gate) || gate["continue-on-error"] !== undefined && gate["continue-on-error"] !== false ||
				!conditionAllowed(gate.if, events, bot)) return false;
			active.add(name);
			const steps = stepsOf(gate);
			const result = steps.some((step) => !diagnosticStep(step) && (text(step.run) || text(step.uses))) &&
				steps.every((step) => diagnosticStep(step)
					? conditionAllowed(step.if, events, bot) || optionalDiagnosticCondition(step.if)
					: (step["continue-on-error"] === undefined || step["continue-on-error"] === false) &&
						conditionAllowed(step.if, events, bot)) &&
				needsOf(gate).every(gateBlocks);
			active.delete(name);
			checked.set(name, result);
			return result;
		};
		return needsOf(job).every(gateBlocks);
	};
	const blocking = (
		workflow: { jobs: Record<string, unknown> }, job: Record<string, unknown>, steps: Record<string, unknown>[],
		label: string, events: string[],
	) => {
		const guarded = [job, ...steps];
		if (guarded.some((item) => item["continue-on-error"] !== undefined && item["continue-on-error"] !== false))
			problems.push(`${label} job and relevant steps must block the gate on failure`);
		if (guarded.some((item) => !conditionAllowed(item.if, events)))
			problems.push(`${label} job and relevant steps must run on every applicable PR and push`);
		if (!prerequisitesBlock(workflow, job, events))
			problems.push(`${label} prerequisite jobs must run and block on every applicable PR and push`);
	};
	const checkPullRequestTrigger = (workflow: { on: Record<string, unknown> }, label: string) => {
		const trigger = workflow.on.pull_request;
		if (!record(trigger)) return;
		if (["paths", "paths-ignore", "branches", "branches-ignore", "tags", "tags-ignore"].some((key) => key in trigger))
			problems.push(`${label} workflow cannot filter pull_request changes`);
		if (trigger.types !== undefined &&
			(!Array.isArray(trigger.types) || !["opened", "synchronize", "reopened"].every((type) => trigger.types.includes(type))))
			problems.push(`${label} workflow must scan opened, synchronized and reopened PRs`);
	};
	const secrets = jobAt(security.secrets, "pull_request", "security.secrets");
	if (secrets) {
		if (!("push" in secrets.workflow.on)) problems.push("security.secrets workflow must also scan pushes");
		const push = secrets.workflow.on.push;
		if (record(push) && ["paths", "paths-ignore", "branches", "branches-ignore", "tags", "tags-ignore"].some((key) => key in push))
			problems.push("security.secrets workflow cannot filter push changes");
		checkPullRequestTrigger(secrets.workflow, "security.secrets");
		const scanner = /^\s*(?:\S*\/)?(?:gitleaks|trufflehog|detect-secrets)(?:\s|$)/m;
		const steps = stepsOf(secrets.job).filter((step) => text(step.run) && scanner.test(step.run));
		if (steps.length === 0) problems.push("security.secrets job must run a secret scanner");
		else blocking(secrets.workflow, secrets.job, steps, "security.secrets scanner", ["pull_request", "push"]);
	}
	const dependencies = record(security.dependencies) ? security.dependencies : {};
	if (dependencies.bot !== "dependabot" || dependencies.config !== ".github/dependabot.yml" ||
		!files.has(".github/dependabot.yml") || !repositoryFile(repo, ".github/dependabot.yml"))
		problems.push("security.dependencies needs a configured Dependabot at .github/dependabot.yml");
	else {
		let config: unknown;
		try { config = Bun.YAML.parse(readFileSync(join(repo, ".github/dependabot.yml"), "utf8")); } catch { /* invalid config is a gap */ }
		if (!record(config) || !Array.isArray(config.updates) || config.updates.length === 0)
			problems.push("security.dependencies bot config needs at least one update source");
	}
	const merge = jobAt(dependencies.automerge, "pull_request", "security.dependencies.automerge");
	if (merge) {
		checkPullRequestTrigger(merge.workflow, "security.dependencies.automerge");
		const actor = String(merge.job.if).replace(/^\s*\$\{\{([\s\S]*)\}\}\s*$/, "$1").replace(/\s+/g, "");
		if (!/^github\.actor==['"]dependabot\[bot\]['"]$/.test(actor))
			problems.push("security.dependencies.automerge job must be restricted to the dependency bot");
		const gates = needsOf(merge.job);
		if (gates.length === 0 || !prerequisitesBlock(merge.workflow, merge.job, ["pull_request"], true))
			problems.push("security.dependencies.automerge job needs an existing blocking gate job");
		const steps = Array.isArray(merge.job.steps) ? merge.job.steps.filter(record) : [];
		const mergeStep = steps.find((step) => text(step.run) && /\bgh pr merge\b[^\n]*--auto\b/.test(step.run));
		if (!mergeStep) problems.push("security.dependencies.automerge job must auto-merge green bot updates");
		const metadata = steps.some((step) => step.id === "metadata" && /^dependabot\/fetch-metadata@/.test(String(step.uses)));
		const condition = String(mergeStep?.if ?? "").replace(/^\s*\$\{\{([\s\S]*)\}\}\s*$/, "$1").replace(/\s+/g, "");
		const terms = condition.split("||");
		if (!metadata || terms.length !== 2 ||
			!terms.includes("steps.metadata.outputs.update-type=='version-update:semver-patch'") ||
			!terms.includes("steps.metadata.outputs.update-type=='version-update:semver-minor'"))
			problems.push("security.dependencies.automerge needs Dependabot metadata and a patch-or-minor-only merge guard");
	}
	if (isApplication(adoption)) {
		const auth = record(security.authorization) ? security.authorization : {};
		const check = jobAt(auth, "pull_request", "security.authorization");
		if (check) checkPullRequestTrigger(check.workflow, "security.authorization");
		if (!repositoryFile(repo, auth.test) || !files.has(auth.test as string))
			problems.push("security.authorization.test must name a tracked authorization-boundary test");
		else if (check) {
			const steps = stepsOf(check.job).filter((step) => text(step.run) && step.run.includes(auth.test as string));
			if (steps.length === 0) problems.push("security.authorization job must run its named test");
			else blocking(check.workflow, check.job, steps, "security.authorization test", ["pull_request"]);
		}
	}
	return problems.map((problem) => ({ message: `FND-SEC-001: satisfied, but ${problem}` }));
}
/** ADR-005 gaps and false claims for an application: pending is a gap the ratchet times; satisfied must hold up. */
function operationsIssues(repo: string, adoption: unknown): Issue[] {
	if (!record(adoption) || !isApplication(adoption)) return [];
	const dispositions = record(adoption.dispositions) ? adoption.dispositions : {};
	const operations = record(adoption.operations) ? adoption.operations : {};
	const checks: Record<string, () => string[]> = {
		"FND-REL-001": () => shipProblems(repo, operations.ship),
		"FND-ALR-001": () => alertProblems(repo, operations.alert),
		"FND-INC-001": () => incidentProblems(repo),
	};
	const issues: Issue[] = [];
	for (const [id, gap] of Object.entries(operationsGaps)) {
		const status = record(dispositions[id]) ? dispositions[id].status : undefined;
		if (status === "satisfied") for (const problem of checks[id]()) issues.push({ message: `${id}: satisfied, but ${problem}` });
		else if (status !== "not_applicable" && status !== "exception") issues.push({ gap, message: `${id}: not yet met by this application (ADR-005)` });
	}
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
	else validateAdoption(options.repo, adoption, catalog, catalogBytes, errors, needs_evidence);
	const issues = [...contentIssues(options.repo, checkerPath, adoption), ...operationsIssues(options.repo, adoption), ...pendingIssues(adoption, catalog), ...securityIssues(options.repo, adoption)];
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
	if (!options.surfaces && (!record(existing) || !Array.isArray(existing.surfaces) || existing.surfaces.length === 0))
		throw new Error("baseline requires --surfaces for a record without a declared surface");
	const owner = options.owner!;
	const revision = existing === undefined ? (options.revision ?? harnessRevision()) : options.revision;
	if (revision !== undefined && !/^[0-9a-f]{40}$/.test(revision)) throw new Error("--revision must be a 40-hex commit");
	const pending = { status: "pending", missing: "Foundation assessment", owner, next: "Assess this obligation with the foundation skill" };
	const adoption: Record<string, unknown> = existing ?? { schema: "foundation-adoption/1", capabilities: [], dispositions: {} };
	// A new record, or a re-pin with --revision (a pin-bump PR), takes this checker's catalog.
	if (revision !== undefined) {
		adoption.standard = {
			id: catalog.id, version: catalog.version, catalog_sha256: sha256(catalogBytes), revision,
			source: `https://github.com/misty-step/harness/blob/${revision}/agent-config/skills/foundation/foundation-standard-v1.json`,
		};
	}
	if (options.surfaces) adoption.surfaces = options.surfaces;
	// Obligations the catalog gained since the record was written start pending; existing dispositions stay.
	const dispositions = record(adoption.dispositions) ? adoption.dispositions : {};
	for (const { id } of [...catalog.obligations, ...catalog.approved_defaults] as { id: string }[]) if (!(id in dispositions)) dispositions[id] = { ...pending };
	adoption.dispositions = dispositions;
	// A bootstrap makes missing story evidence advisory; collect gaps under the mode to be written,
	// not the absent/old mode. An empty baseline can enter enforced mode only after strict evidence passes.
	adoption.mode = "bootstrap";
	const issues = [...contentIssues(options.repo, checkerPath, adoption), ...operationsIssues(options.repo, adoption), ...pendingIssues(adoption, catalog), ...securityIssues(options.repo, adoption)];
	const live = [...liveIds(workingStories(options.repo))];
	const prior = new Map((Array.isArray(adoption.baseline) ? adoption.baseline : []).filter(record).map((entry) => [entry.gap, entry]));
	// A new record baselines a walk for every live story; an existing one keeps the walk entries it has, so a
	// re-pin never re-baselines stories that already walk.
	const walks = !options.walkGaps ? [] : existing === undefined ? live.map((id) => `walk:${id}`) : live.map((id) => `walk:${id}`).filter((gap) => prior.has(gap));
	const gaps = [...new Set([...issues.map((issue) => issue.gap).filter(text), ...walks])].sort();
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
		const strictEvidence = contentIssues(options.repo, checkerPath, adoption).filter((issue) => issue.gap === "stories:format");
		if (strictEvidence.length > 0)
			return { ok: false, errors: strictEvidence.map(describe), gaps: [] };
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
	if (options.base) {
		const base = git(options.repo, "rev-parse", `${options.base}^{commit}`).trim();
		if (value.base !== base) errors.push("receipt: base differs from requested base");
		const report: Issue[] = [];
		expected = affected(options.repo, options.base, report);
		errors.push(...uncovered(report, adoption, live));
	} else if (value.base !== null && !/^[0-9a-f]{40}$/.test(String(value.base))) errors.push("receipt: base must be a commit or null");
	// A story with no walk yet is one a valid bootstrap baseline names (walk:US-nnn, owner and expiry). Reporting it
	// unwalked is advisory whether or not the change affects it (operator decision 2026-09-26): only a walk that
	// ran and failed, or an unwalked story without such an entry, fails the receipt.
	const now = today();
	const baseline = readBaseline(adoption, live, [], now);
	const excused = covering(baseline, live, now);
	const advisory: string[] = [];
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
			const entry = excused.get(`walk:${id}`);
			if (!entry) errors.push(`receipt: ${id} is unwalked and has no valid walk:${id} baseline entry`);
			else advisory.push(`${id} unwalked: no walk yet (walk:${id}, owner ${entry.owner}, expires ${entry.expires})${expected.includes(id) ? "; affected by this change" : ""}`);
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
	return { ok: errors.length === 0, errors, advisory };
}
/**
 * Designated reviewer per organisation (ADR-003 Review authority). It lives in this pinned checker, so neither
 * the repository under review nor a command-line flag can change who may approve.
 * - `app`: a GitHub App, the only identity the gate trusts. Agent sessions also act under the operator's GitHub
 *   account, so an approval from that account proves nothing about who gave it.
 * - `recorded`: the organisation has no reviewer App (operator decision for r90group, 2026-09-25). Agents act as
 *   the operator's user there, so the agent reviewer records its decision as a review or comment from that user.
 *   The record shows what was decided, not who decided it; that organisation's checks stay advisory.
 */
type Reviewer = { app: string } | { recorded: string };
const reviewerRegistry: Record<string, Reviewer> = {
	"misty-step": { app: "kaylee-agent[bot]" },
	"r90group": { recorded: "moomooskycow" },
};
const approvalMarker = "foundation-review: approved";
const escalationMarker = "foundation-escalation: product-direction";
const resolutionMarker = "foundation-escalation: resolved";
/** Static map from the PR's git objects: pull_request_target never checks out or executes proposed files. */
function mappedSourceStories(repo: string, base: string, head: string): string[] {
	const mapAt = (revision: string): Feature[] =>
		git(repo, "ls-tree", "-r", "--name-only", "-z", revision).split("\0")
			.filter((file) => /^features\/[^/]+\.md$/.test(file) && file !== "features/README.md")
			.map((file) => {
				const body = fileAt(repo, revision, file) ?? "";
				return {
					file,
					stories: body.match(/^Stories:\s*(.*)$/m)?.[1]?.split(",").map((id) => id.trim()).filter(Boolean) ?? [],
					sources: body.match(/^Source:\s*(.*)$/m)?.[1]?.split(",").map((glob) => glob.trim()).filter(Boolean) ?? [],
				};
			});
	const mapping = mapAt(head);
	const prior = mapAt(git(repo, "merge-base", base, head).trim());
	const changed = changedFiles(repo, base, undefined, head);
	// Source removed from the candidate map still belongs to the stories it served at the base.
	const matching = [...prior, ...mapping].filter((feature) => feature.sources.some((source) =>
		changed.some((file) => globRegex(source).test(file))));
	if (matching.length === 0) return [];
	const stories = parseStories(fileAt(repo, head, "USER_STORIES.md") ?? "");
	const live = liveIds(stories);
	return [...new Set([...matching.flatMap((feature) => feature.stories), ...changedStoryIds(repo, base, mapping, stories, head)])]
		.filter((id) => live.has(id)).sort();
}
/** ADR-003's five designated-review triggers, judged against the PR's base ledger and candidate records. */
function reviewTriggers(repo: string, base: string, head: string, errors: string[]): string[] {
	const mergeBase = git(repo, "merge-base", base, head).trim();
	const reasons: string[] = [];
	const before = parseStories(fileAt(repo, mergeBase, "USER_STORIES.md") ?? "");
	const after = parseStories(fileAt(repo, head, "USER_STORIES.md") ?? "");
	if (before.length === 0 && after.length > 0) reasons.push("first user stories: USER_STORIES.md gains its first stories");
	const added = git(repo, "diff", "--name-only", "--no-renames", "--diff-filter=A", "-z", mergeBase, head).split("\0").filter(Boolean);
	for (const path of added.filter((file) => extensionPath.test(file))) reasons.push(`baseline extension: ${path}`);
	const adoptionAt = (rev: string) => jsonOrUndefined(fileAt(repo, rev, "foundation.json"));
	const prior = adoptionAt(mergeBase);
	const current = adoptionAt(head);
	if (isApplication(prior) && !isApplication(current)) reasons.push("surfaces: foundation.json stops declaring an application (ADR-005)");
	const ledger = (rev: string) => ledgerSections(fileAt(repo, rev, "DOMAIN.md") ?? "");
	if (JSON.stringify(ledger(mergeBase)) !== JSON.stringify(ledger(head))) reasons.push("invariants ledger: DOMAIN.md policy changes");
	const priorDispositions = record(prior) && record(prior.dispositions) ? prior.dispositions : {};
	const dispositions = record(current) && record(current.dispositions) ? current.dispositions : {};
	for (const [id, disposition] of Object.entries(dispositions)) {
		if (!record(disposition) || !["not_applicable", "exception"].includes(String(disposition.status))) continue;
		approvalRecord(repo, id, disposition, errors, head);
		if (JSON.stringify(disposition) !== JSON.stringify(priorDispositions[id]) ||
			(text(disposition.approval_ref) && fileAt(repo, mergeBase, disposition.approval_ref) !== fileAt(repo, head, disposition.approval_ref)))
			reasons.push(`disposition approval: ${id} ${disposition.status}`);
	}
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
	const errors: string[] = [];
	const reasons = reviewTriggers(options.repo, base, head, errors);
	const mapped = mappedSourceStories(options.repo, base, head);
	const citations = typeof pull.body === "string" ? [...pull.body.matchAll(/^Stories:\s*(US-\d{3}(?:\s*,\s*US-\d{3})*)\s*$/gm)]
		.flatMap((match) => match[1].split(",").map((id) => id.trim())) : [];
	for (const id of mapped) if (!citations.includes(id)) errors.push(`FND-CIT-001: PR description must cite mapped source story ${id} in a Stories: line`);
	const designated = reviewerRegistry[org];
	if (!designated) throw new Error(`no designated reviewer for ${org}`);
	const list = async (path: string) => {
		const items: Record<string, unknown>[] = [];
		for (let page = 1; ; page++) {
			const batch = await github(`/repos/${org}/${name}/${path}?per_page=100&page=${page}`, token);
			if (!Array.isArray(batch)) throw new Error(`GitHub API: ${path} is not a list`);
			items.push(...batch.filter(record));
			if (batch.length < 100) break;
		}
		return items;
	};
	const firstLine = (entry: Record<string, unknown>) => (typeof entry.body === "string" ? entry.body.split("\n")[0].trimEnd() : "");
	if ("recorded" in designated) {
		// Every marker must be an entry's exact first line: the shared account writes a great deal of other text,
		// and a decision names the head it covers, because an issue comment is not tied to a commit.
		const login = designated.recorded;
		// Only submitted entries record anything: a pending review (the account's own unsubmitted draft, visible when
		// that account runs the check) has no submission time and is not a decision.
		const stamped = (entry: Record<string, unknown>, field: string) => ({ at: typeof entry[field] === "string" ? entry[field] as string : "", entry });
		const entries = [...(await list(`pulls/${options.pr}/reviews`)).map((entry) => stamped(entry, "submitted_at")), ...(await list(`issues/${options.pr}/comments`)).map((entry) => stamped(entry, "created_at"))]
			.filter(({ at, entry }) => at !== "" && entry.state !== "PENDING" && reviewer(entry) === login);
		// Reviews and comments come from two endpoints, so order comes from their timestamps alone, and a decision
		// must be strictly later than the last escalation: a tie stays escalated.
		const escalatedAt = entries.reduce((latest, { at, entry }) => (firstLine(entry) === escalationMarker && at > latest ? at : latest), "");
		const escalated = escalatedAt !== "";
		const marker = escalated ? resolutionMarker : approvalMarker;
		const decided = entries.some(({ at, entry }) => at > escalatedAt && firstLine(entry) === `${marker} ${head}`);
		if (!decided) errors.push(escalated
			? `escalated to the operator; needs a later review or comment from ${login} whose first line is "${marker} ${head}"`
			: `needs a review or comment from ${login} recording the agent reviewer's decision, with first line "${marker} ${head}"`);
		return { ok: errors.length === 0, errors, reasons, approved_by: decided ? `${login} (recorded decision)` : undefined };
	}
	const agent = designated.app;
	if (agent === author && reasons.length > 0) return { ok: false, errors: [...errors, `the designated agent reviewer ${agent} authored this PR, so it cannot approve it`], reasons };
	const reviews = await list(`pulls/${options.pr}/reviews`);
	const own = (entry: Record<string, unknown>) => reviewer(entry) === agent;
	// A marker that holds a PR back counts anywhere in the review. One that clears it must be the review's exact
	// first line: quoted PR text (a description, a diff line, a blockquote, a fenced or indented block) always
	// sits below the reviewer's own opening, or behind markup on that line, so it cannot grant approval by
	// accident, and no Markdown parsing is needed to tell the two apart.
	const says = (entry: Record<string, unknown>, marker: string) => typeof entry.body === "string" && entry.body.includes(marker);
	const states = (entry: Record<string, unknown>, marker: string) => firstLine(entry) === marker;
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
	if (reasons.length > 0 && escalation >= 0 && !(approved && decision!.index > escalation && states(decision!.entry, resolutionMarker))) {
		errors.push(`escalated to the operator on head ${head.slice(0, 12)}; needs a later approving review from ${agent} that records the operator's decision and opens with "${resolutionMarker}" as its exact first line`);
	} else if (reasons.length > 0 && !approved) errors.push(`needs an approving review from the designated agent reviewer ${agent} on head ${head.slice(0, 12)}`);
	// GitHub authenticates the reviewer and head, but not the substance of the review against constitution, ledger and story.
	const latest = new Map<string, Record<string, unknown>>();
	for (const entry of reviews) if (reviewer(entry) && ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(String(entry.state))) latest.set(reviewer(entry), entry);
	const independent = [...latest.values()].find((entry) => reviewer(entry) !== author && entry.state === "APPROVED" && entry.commit_id === head);
	if (!independent) errors.push(`FND-REV-001: needs an approving review on head ${head.slice(0, 12)} from someone other than ${author}`);
	return { ok: errors.length === 0, errors, reasons, approved_by: errors.length === 0 ? (reasons.length > 0 ? agent : reviewer(independent!)) : undefined };
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
	for (const line of result.advisory ?? []) console.log(`advisory: ${line}`);
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
		if (result.ok && (result.reasons ?? []).length === 0) console.log("independent review approved; no designated-review trigger");
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
