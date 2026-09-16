#!/usr/bin/env bun
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";

export interface LanguageStats {
	files: number;
	total: number;
	code: number;
	comment: number;
	blank: number;
}

export interface LocStats {
	files: number;
	total: number;
	code: number;
	comment: number;
	blank: number;
	byLanguage: Record<string, LanguageStats>;
	source: "builtin";
	headHash: string;
}

export interface CommitDelta {
	hash: string;
	subject: string;
	date: string;
	added: number;
	deleted: number;
	net: number;
}

export interface TrendPoint {
	label: string;
	ref: string;
	code: number;
	total: number;
	files: number;
	deltaCode?: number;
}

const EXT_TO_LANG: Record<string, string> = {
	".ts": "TypeScript", ".tsx": "TypeScript", ".mts": "TypeScript", ".cts": "TypeScript",
	".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
	".py": "Python", ".pyw": "Python", ".go": "Go", ".rs": "Rust", ".java": "Java",
	".kt": "Kotlin", ".kts": "Kotlin", ".c": "C", ".h": "C", ".cc": "C++", ".cpp": "C++",
	".cxx": "C++", ".hpp": "C++", ".cs": "C#", ".rb": "Ruby", ".php": "PHP", ".swift": "Swift",
	".scala": "Scala", ".sh": "Shell", ".bash": "Shell", ".zsh": "Shell", ".fish": "Shell",
	".ps1": "PowerShell", ".sql": "SQL", ".md": "Markdown", ".markdown": "Markdown",
	".json": "JSON", ".yaml": "YAML", ".yml": "YAML", ".toml": "TOML", ".xml": "XML",
	".html": "HTML", ".htm": "HTML", ".css": "CSS", ".scss": "SCSS", ".sass": "Sass",
	".less": "Less", ".vue": "Vue", ".svelte": "Svelte", ".lua": "Lua", ".r": "R", ".R": "R",
	".dart": "Dart", ".zig": "Zig", ".ex": "Elixir", ".exs": "Elixir", ".erl": "Erlang",
	".hs": "Haskell", ".ml": "OCaml", ".mli": "OCaml", ".clj": "Clojure", ".cljs": "Clojure",
	".tf": "Terraform", ".hcl": "HCL", ".dockerfile": "Dockerfile",
};

const BINARY_EXTENSIONS: Record<string, true> = {
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true, ".ico": true, ".bmp": true, ".svg": true,
	".woff": true, ".woff2": true, ".ttf": true, ".eot": true, ".otf": true, ".pdf": true, ".zip": true, ".gz": true,
	".bz2": true, ".xz": true, ".7z": true, ".tar": true, ".rar": true, ".exe": true, ".dll": true, ".so": true,
	".dylib": true, ".a": true, ".o": true, ".class": true, ".jar": true, ".wasm": true, ".mp3": true, ".mp4": true,
	".avi": true, ".mov": true, ".webm": true, ".lock": true, ".map": true,
};
const BINARY_SUFFIXES = [".min.js", ".min.css"];

const SKIP_DIR_PARTS: Record<string, true> = {
	node_modules: true, ".git": true, dist: true, build: true, coverage: true, ".next": true, ".nuxt": true,
	vendor: true, __pycache__: true, ".venv": true, venv: true, ".tox": true, target: true,
};
const BLOCK_COMMENT_LANGUAGES: Record<string, true> = {
	C: true, "C++": true, Java: true, JavaScript: true, TypeScript: true, Go: true, Rust: true, CSS: true, SQL: true,
};
const HASH_COMMENT_LANGUAGES: Record<string, true> = {
	Python: true, Shell: true, Ruby: true, YAML: true, TOML: true, Dockerfile: true, R: true, Terraform: true, HCL: true,
};

function run(cmd: string, args: string[], cwd: string) {
	const result = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
	return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export function gitRoot(cwd: string): string | null {
	const result = run("git", ["rev-parse", "--show-toplevel"], cwd);
	return result.ok ? result.stdout.trim() || null : null;
}

export function getHeadHash(cwd: string): string | null {
	const root = gitRoot(cwd);
	if (!root) return null;
	const resolved = run("git", ["rev-parse", "HEAD^{commit}"], root);
	return resolved.ok ? resolved.stdout.trim() || null : null;
}

export function resolveLocCachePath(cwd: string): string | null {
	const root = gitRoot(cwd);
	if (!root) return null;
	const res = run("git", ["rev-parse", "--git-path", "loc_cache"], root);
	if (!res.ok || !res.stdout.trim()) return null;
	const path = res.stdout.trim();
	return isAbsolute(path) ? path : resolve(root, path);
}

interface TrackedObject {
	oid: string;
	file: string;
}

function trackedObjects(cwd: string, ref = "HEAD"): TrackedObject[] {
	const result = run("git", ["ls-tree", "-r", "-z", "--long", ref], cwd);
	if (!result.ok) return [];
	const objects: TrackedObject[] = [];
	for (const entry of result.stdout.split("\0")) {
		if (!entry) continue;
		const separator = entry.indexOf("\t");
		if (separator < 0) continue;
		const [, type, oid] = entry.slice(0, separator).trim().split(/\s+/);
		const file = entry.slice(separator + 1);
		if (type === "blob" && oid && !shouldSkipPath(file)) objects.push({ oid, file });
	}
	return objects;
}

function shouldSkipPath(file: string): boolean {
	for (const part of file.split(/[/\\]/)) if (SKIP_DIR_PARTS[part]) return true;
	const lower = file.toLowerCase();
	return BINARY_EXTENSIONS[extname(lower)] || BINARY_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

function languageForFile(file: string): string {
	const base = basename(file).toLowerCase();
	if (base === "dockerfile") return "Dockerfile";
	if (base === "makefile") return "Makefile";
	const ext = extname(file).toLowerCase();
	return EXT_TO_LANG[ext] ?? (ext ? ext.slice(1).toUpperCase() : "Other");
}

function addLanguage(stats: LocStats, language: string, fileStats: Omit<LanguageStats, "files"> & { files?: number }) {
	const bucket = stats.byLanguage[language] ?? { files: 0, total: 0, code: 0, comment: 0, blank: 0 };
	bucket.files += fileStats.files ?? 1;
	bucket.total += fileStats.total;
	bucket.code += fileStats.code;
	bucket.comment += fileStats.comment;
	bucket.blank += fileStats.blank;
	stats.byLanguage[language] = bucket;
	stats.files += fileStats.files ?? 1;
	stats.total += fileStats.total;
	stats.code += fileStats.code;
	stats.comment += fileStats.comment;
	stats.blank += fileStats.blank;
}

function countFileLines(content: string, language: string): Omit<LanguageStats, "files"> {
	const lines = content.split(/\r?\n/);
	let code = 0, comment = 0, blank = 0;
	const blockComments = BLOCK_COMMENT_LANGUAGES[language];
	const hashComments = HASH_COMMENT_LANGUAGES[language];
	let inBlock = false;
	for (const raw of lines) {
		const line = raw.trim();
		if (!line) { blank += 1; continue; }
		if (blockComments && inBlock) { comment += 1; if (line.includes("*/")) inBlock = false; continue; }
		if (blockComments && line.startsWith("/*")) { comment += 1; if (!line.endsWith("*/")) inBlock = true; continue; }
		if (blockComments && (line.startsWith("//") || line.startsWith("///"))) { comment += 1; continue; }
		if (hashComments && line.startsWith("#")) { comment += 1; continue; }
		if (language === "HTML" && line.startsWith("<!--")) { comment += 1; continue; }
		if (language === "SQL" && line.startsWith("--")) { comment += 1; continue; }
		code += 1;
	}
	return { total: code + comment + blank, code, comment, blank };
}

async function readTrackedObjects(
	root: string,
	objects: TrackedObject[],
	consume: (file: string, content: string) => void,
): Promise<void> {
	if (objects.length === 0) return;
	const child = spawn("git", ["cat-file", "--batch"], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
	const stderr: Buffer[] = [];
	child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
	const closed = new Promise<number>((resolve, reject) => {
		child.once("error", reject);
		child.once("close", (code) => resolve(code ?? 1));
	});
	child.stdin.end(`${objects.map(({ oid }) => oid).join("\n")}\n`);

	let phase: "header" | "content" | "separator" = "header";
	let objectIndex = 0;
	let remaining = 0;
	let headerParts: Buffer[] = [];
	let contentParts: Buffer[] = [];

	const finishContent = () => {
		const content =
			contentParts.length === 0
				? ""
				: contentParts.length === 1
					? contentParts[0].toString("utf8")
					: Buffer.concat(contentParts).toString("utf8");
		consume(objects[objectIndex].file, content);
		objectIndex += 1;
		contentParts = [];
		phase = "separator";
	};

	for await (const rawChunk of child.stdout) {
		const chunk = Buffer.isBuffer(rawChunk)
			? rawChunk
			: Buffer.from(rawChunk.buffer, rawChunk.byteOffset, rawChunk.byteLength);
		let offset = 0;
		while (offset < chunk.length) {
			if (phase === "header") {
				const newline = chunk.indexOf(10, offset);
				if (newline < 0) {
					headerParts.push(chunk.subarray(offset));
					break;
				}
				headerParts.push(chunk.subarray(offset, newline));
				const [oid, type, rawSize] = Buffer.concat(headerParts).toString("utf8").split(" ");
				headerParts = [];
				const expected = objects[objectIndex];
				remaining = Number(rawSize);
				if (!expected || oid !== expected.oid || type !== "blob" || !Number.isSafeInteger(remaining) || remaining < 0) {
					throw new Error(`Unexpected git cat-file response for ${expected?.file ?? "end of batch"}`);
				}
				offset = newline + 1;
				phase = "content";
				if (remaining === 0) finishContent();
				continue;
			}
			if (phase === "content") {
				const size = Math.min(remaining, chunk.length - offset);
				contentParts.push(chunk.subarray(offset, offset + size));
				offset += size;
				remaining -= size;
				if (remaining === 0) finishContent();
				continue;
			}
			if (chunk[offset] !== 10) throw new Error("Malformed git cat-file record separator");
			offset += 1;
			phase = "header";
		}
	}

	const exitCode = await closed;
	if (exitCode !== 0) throw new Error(Buffer.concat(stderr).toString("utf8").trim() || `git cat-file exited ${exitCode}`);
	if (objectIndex !== objects.length || phase !== "header" || headerParts.length > 0) {
		throw new Error(`Incomplete git cat-file batch: read ${objectIndex} of ${objects.length} objects`);
	}
}

export async function analyzeBuiltin(cwd: string, ref = "HEAD"): Promise<LocStats> {
	const root = gitRoot(cwd) ?? cwd;
	const resolved = run("git", ["rev-parse", `${ref}^{commit}`], root);
	const headHash = resolved.ok ? resolved.stdout.trim() : "";
	const stats: LocStats = {
		files: 0,
		total: 0,
		code: 0,
		comment: 0,
		blank: 0,
		byLanguage: {},
		source: "builtin",
		headHash,
	};
	if (!headHash) return stats;
	const objects = trackedObjects(root, headHash);
	await readTrackedObjects(root, objects, (file, content) => {
		const language = languageForFile(file);
		addLanguage(stats, language, countFileLines(content, language));
	});
	return stats;
}

export function analyzeRepo(cwd: string): Promise<LocStats> {
	return analyzeBuiltin(cwd);
}

export function getCommitDeltas(cwd: string, count = 8): CommitDelta[] {
	const root = gitRoot(cwd) ?? cwd;
	const result = run("git", ["log", `-n${count}`, "--pretty=format:@@@%H%x09%ad%x09%s", "--date=short", "--numstat"], root);
	if (!result.ok) return [];
	const deltas: CommitDelta[] = [];
	let current: CommitDelta | null = null;
	for (const line of result.stdout.split("\n")) {
		if (line.startsWith("@@@")) {
			if (current) deltas.push(current);
			const [hash, date, ...subjectParts] = line.slice(3).split("\t");
			current = { hash: hash.slice(0, 8), date: date ?? "", subject: subjectParts.join("\t"), added: 0, deleted: 0, net: 0 };
			continue;
		}
		if (!current || !line.trim()) continue;
		const [added, deleted] = line.split("\t");
		if (added === "-" || deleted === "-") continue;
		current.added += Number(added) || 0;
		current.deleted += Number(deleted) || 0;
		current.net = current.added - current.deleted;
	}
	if (current) deltas.push(current);
	return deltas;
}

function listTrendRefs(root: string, count: number) {
	const tags = run("git", ["tag", "--sort=-creatordate"], root);
	const tagList = tags.ok ? tags.stdout.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, count) : [];
	if (tagList.length >= Math.min(3, count)) return tagList.map((tag) => ({ label: tag, ref: tag }));
	const commits = run("git", ["log", "--pretty=format:%h %s", `-n${count}`], root);
	if (!commits.ok) return [];
	return commits.stdout.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
		const space = line.indexOf(" ");
		const hash = space === -1 ? line : line.slice(0, space);
		const subject = space === -1 ? hash : line.slice(space + 1);
		return { label: `${hash} ${subject}`.slice(0, 48), ref: hash };
	});
}

export async function getTrendPoints(cwd: string, count = 6): Promise<TrendPoint[]> {
	const root = gitRoot(cwd) ?? cwd;
	const points: TrendPoint[] = [];
	let previousCode: number | undefined;
	for (const entry of listTrendRefs(root, count).reverse()) {
		const stats = await analyzeBuiltin(root, entry.ref);
		const point: TrendPoint = { label: entry.label, ref: entry.ref, code: stats.code, total: stats.total, files: stats.files };
		if (previousCode !== undefined) point.deltaCode = point.code - previousCode;
		previousCode = point.code;
		points.push(point);
	}
	return points;
}

export function writeLocCache(cwd: string, stats: LocStats): void {
	const cachePath = resolveLocCachePath(cwd);
	if (!cachePath) return;
	const payload = JSON.stringify({ ...stats, updatedAt: Math.floor(Date.now() / 1000) });
	const tmpPath = `${cachePath}.tmp.${process.pid}`;
	try {
		mkdirSync(dirname(cachePath), { recursive: true });
		writeFileSync(tmpPath, payload);
		renameSync(tmpPath, cachePath);
	} catch {
		try { rmSync(tmpPath, { force: true }); } catch {}
	}
}

export function readLocCache(cwd: string): (LocStats & { updatedAt?: number }) | null {
	const root = gitRoot(cwd);
	if (!root) return null;
	const headHash = getHeadHash(root);
	if (!headHash) return null;
	const cachePath = resolveLocCachePath(cwd);
	if (!cachePath || !existsSync(cachePath)) return null;
	try {
		const parsed = JSON.parse(readFileSync(cachePath, "utf8")) as LocStats & { updatedAt?: number };
		return typeof parsed.code === "number" && parsed.headHash === headHash ? parsed : null;
	} catch { return null; }
}

export function topLanguages(stats: LocStats, limit = 8) {
	return Object.entries(stats.byLanguage).sort((a, b) => b[1].code - a[1].code || b[1].files - a[1].files).slice(0, limit);
}

function pad(value: string, width: number) { return value.length >= width ? value.slice(0, width) : value.padEnd(width); }
function formatNumber(value: number) { return value.toLocaleString("en-US"); }

export function formatLocReport(stats: LocStats, deltas: CommitDelta[]): string {
	const lines = [
		"Lines of code", `Source: ${stats.source}`, "",
		`Files     ${formatNumber(stats.files)}`, `Total     ${formatNumber(stats.total)}`,
		`Code      ${formatNumber(stats.code)}`, `Comment   ${formatNumber(stats.comment)}`,
		`Blank     ${formatNumber(stats.blank)}`, "", "Top languages (files / code lines)",
	];
	for (const [language, bucket] of topLanguages(stats)) {
		lines.push(`  ${pad(language, 14)} ${pad(formatNumber(bucket.files), 6)}  ${formatNumber(bucket.code)}`);
	}
	if (deltas.length) {
		lines.push("", "Recent commit deltas (added / deleted / net)");
		for (const delta of deltas) {
			const sign = delta.net >= 0 ? "+" : "";
			lines.push(`  ${delta.hash}  ${pad(delta.date, 10)}  +${formatNumber(delta.added)} / -${formatNumber(delta.deleted)} / ${sign}${formatNumber(delta.net)}  ${delta.subject}`);
		}
	}
	return lines.join("\n");
}

export function formatTrendReport(points: TrendPoint[]): string {
	if (!points.length) return "No git tags or commits available for trend analysis.";
	const maxCode = Math.max(...points.map((p) => p.code), 1);
	const lines = ["LOC trend (code lines)", "", `${pad("ref", 20)} ${pad("code", 8)} ${pad("Δ code", 8)} chart`, `${"-".repeat(20)} ${"-".repeat(8)} ${"-".repeat(8)} ${"-".repeat(24)}`];
	for (const point of points) {
		const bar = "█".repeat(Math.max(1, Math.round((point.code / maxCode) * 20)));
		const delta = point.deltaCode == null ? "—" : `${point.deltaCode >= 0 ? "+" : ""}${formatNumber(point.deltaCode)}`;
		lines.push(`${pad(point.label, 20)} ${pad(formatNumber(point.code), 8)} ${pad(delta, 8)} ${bar}`);
	}
	return lines.join("\n");
}


function parseCliArgs(argv: string[]) {
	let command: "loc" | "trend" | "json" = "loc";
	let cwd = process.cwd();
	let count = 8;
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "trend" || arg === "--trend") command = "trend";
		else if (arg === "--json") command = "json";
		else if (arg === "--cwd" && argv[i + 1]) { cwd = argv[++i]; }
		else if (arg === "--count" && argv[i + 1]) count = Number(argv[++i]) || count;
	}
	return { command, cwd, count };
}

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
	const { command, cwd, count } = parseCliArgs(argv);
	try {
		if (command === "trend") { console.log(formatTrendReport(await getTrendPoints(cwd, count))); return 0; }
		const stats = await analyzeRepo(cwd);
		if (command === "json") { console.log(JSON.stringify({ ...stats, updatedAt: Math.floor(Date.now() / 1000) })); return 0; }
		console.log(formatLocReport(stats, getCommitDeltas(cwd, count)));
		return 0;
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

if (import.meta.main) process.exit(await runCli());
