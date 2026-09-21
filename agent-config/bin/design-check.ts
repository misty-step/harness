#!/usr/bin/env bun
/**
 * design-check — deterministic player-surface checks (design-toolkit trial, t_2a376f19).
 *
 * Ports the exercised trial findings into a dependency-free, gate-able tool:
 *   dash        — no em dash or en dash in player-facing copy (taste-skill 9.G).
 *   vocabulary  — no leaked engineering vocabulary on player surfaces (copy contract).
 *   placeholder — no lorem ipsum / TODO / FIXME / TBD left in player-facing strings.
 *
 * Scope: .html .htm .md .txt .tsx .ts .jsx .js files. For code files only string
 * literals and JSX text are scanned, so imports and identifiers do not trip the
 * vocabulary list. Fenced code in Markdown and <script>/<style> blocks in HTML are
 * skipped. Suppress one line with a `design-check: ignore` comment on that line.
 *
 * Exit 1 when findings exist; --advisory always exits 0. --json prints machine
 * output. This tool never edits files and never calls a model. It is advisory
 * in substance, deterministic in mechanism.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

export type Rule = "dash" | "vocabulary" | "placeholder";

export type Finding = {
	file: string;
	line: number;
	rule: Rule;
	match: string;
	excerpt: string;
};

/**
 * Default leak vocabulary. Deliberately conservative: each term must be an
 * unambiguous internal leak when it appears in player copy. Repos extend it
 * with `--terms`, and each allowed occurrence gets a suppression comment.
 */
export const DEFAULT_TERMS = [
	"token",
	"cookie",
	"backend",
	"frontend",
	"operator",
	"rubric",
	"equivalence",
	"webhook",
	"endpoint",
	"schema",
	"localStorage",
	"Convex",
	"Supabase",
] as const;

const CODE_EXT = new Set([".tsx", ".ts", ".jsx", ".js", ".mjs"]);
const TEXT_EXT = new Set([".html", ".htm", ".md", ".txt"]);
const SKIP_DIR = new Set(["node_modules", ".git", "dist", ".next", "build", "coverage"]);

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Extract the copy (player-facing) regions of one line of code. */
export function codeCopyRegions(line: string): string {
	if (/^\s*(import|export)\b/.test(line) && /\bfrom\b/.test(line)) return "";
	const parts: string[] = [];
	for (const m of line.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`/g)) {
		parts.push(m[1] ?? m[2] ?? m[3] ?? "");
	}
	for (const m of line.matchAll(/(?<=>)[^<>{}]+(?=<)/g)) parts.push(m[0]);
	return parts.join(" \u0000 ");
}

/** Extract the copy regions of one line of html/txt (tags stripped, attrs kept, script/style skipped). */
function htmlCopyRegions(line: string, inRawBlock: boolean): string {
	if (inRawBlock) return "";
	const attrs: string[] = [];
	for (const m of line.matchAll(/(?:alt|placeholder|title|aria-label)\s*=\s*"([^"]*)"|(?:alt|placeholder|title|aria-label)\s*=\s*'([^']*)'/gi)) {
		attrs.push(m[1] ?? m[2] ?? "");
	}
	return `${line.replace(/<[^>]*>/g, " ")}${attrs.length ? ` \u0000 ${attrs.join(" \u0000 ")}` : ""}`;
}

/** Split a file's raw lines into per-line copy regions. Returns one string per input line. */
export function copyRegions(file: string, lines: string[]): string[] {
	const ext = extname(file).toLowerCase();
	if (CODE_EXT.has(ext)) return lines.map(codeCopyRegions);
	if (ext === ".md" || ext === ".markdown") {
		let fence = false;
		return lines.map((line) => {
			if (/^\s*(```|~~~)/.test(line)) {
				fence = !fence;
				return "";
			}
			return fence ? "" : line.replace(/`[^`]*`/g, "");
		});
	}
	if (TEXT_EXT.has(ext) || ext === "") {
		let raw = false;
		return lines.map((line) => {
			const opens = /<script\b|<style\b/i.test(line);
			const closes = /<\/script\s*>|<\/style\s*>/i.test(line);
			if (raw) {
				if (closes && !opens) raw = false;
				return "";
			}
			if (opens) {
				if (!closes) raw = true;
				return "";
			}
			return htmlCopyRegions(line, false);
		});
	}
	return lines.slice();
}

export function scanContent(file: string, raw: string, terms: readonly string[] = DEFAULT_TERMS): Finding[] {
	const lines = raw.split(/\r?\n/);
	const regions = copyRegions(file, lines);
	const termPatterns = terms.map((term) => ({ term, pattern: new RegExp(`\\b${escapeRegExp(term)}\\b`, "i") }));
	const findings: Finding[] = [];
	regions.forEach((region, index) => {
		const lineNumber = index + 1;
		const rawLine = lines[index] ?? "";
		if (!region || rawLine.includes("design-check: ignore")) return;
		const pieces = region.split("\u0000").map((piece) => piece.trim()).filter(Boolean);
		for (const piece of pieces) {
			const excerpt = piece.slice(0, 120);
			const dash = piece.match(/[\u2014\u2013]/);
			if (dash) findings.push({ file, line: lineNumber, rule: "dash", match: dash[0], excerpt });
			const placeholder = piece.match(/lorem ipsum|\bTODO\b|\bFIXME\b|\bTBD\b/i);
			if (placeholder) findings.push({ file, line: lineNumber, rule: "placeholder", match: placeholder[0], excerpt });
			for (const { term, pattern } of termPatterns) {
				const hit = piece.match(pattern);
				if (hit) findings.push({ file, line: lineNumber, rule: "vocabulary", match: hit[0], excerpt });
			}
		}
	});
	return findings;
}

export function scanFile(file: string, terms: readonly string[] = DEFAULT_TERMS): Finding[] {
	return scanContent(file, readFileSync(file, "utf8"), terms);
}

export function collectFiles(paths: string[]): string[] {
	const files: string[] = [];
	const walk = (path: string): void => {
		const stat = statSync(path);
		if (stat.isDirectory()) {
			for (const entry of readdirSync(path, { withFileTypes: true })) {
				if (entry.isDirectory()) {
					if (!SKIP_DIR.has(entry.name)) walk(join(path, entry.name));
				} else walk(join(path, entry.name));
			}
			return;
		}
		const ext = extname(path).toLowerCase();
		if (CODE_EXT.has(ext) || TEXT_EXT.has(ext)) files.push(path);
	};
	for (const path of paths) walk(resolve(path));
	return files;
}

type CliOptions = { paths: string[]; terms: string[]; json: boolean; advisory: boolean };

function parseArgs(argv: string[]): CliOptions {
	const options: CliOptions = { paths: [], terms: [], json: false, advisory: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--json") options.json = true;
		else if (arg === "--advisory") options.advisory = true;
		else if (arg === "--terms" && argv[i + 1]) {
			options.terms.push(...argv[++i].split(",").map((term) => term.trim()).filter(Boolean));
		} else if (!arg.startsWith("--")) options.paths.push(arg);
	}
	return options;
}

function renderLines(findings: Finding[], files: string[]): string[] {
	const lines = findings.map((f) => `${f.file}:${f.line}: [${f.rule}] ${JSON.stringify(f.match)} in ${JSON.stringify(f.excerpt)}`);
	lines.push(`design-check: ${findings.length} finding(s) across ${files.length} file(s).`);
	return lines;
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	if (options.paths.length === 0) {
		console.error("usage: bun agent-config/bin/design-check.ts [--json] [--advisory] [--terms a,b] <paths...>");
		process.exitCode = 2;
		return;
	}
	const files = collectFiles(options.paths);
	const terms = [...DEFAULT_TERMS, ...options.terms];
	const findings = files.flatMap((file) => scanFile(file, terms));
	if (options.json) {
		console.log(JSON.stringify({ files: files.length, findings }, null, 2));
	} else {
		for (const line of renderLines(findings, files)) console.log(line);
	}
	process.exitCode = findings.length > 0 && !options.advisory ? 1 : 0;
}

if (import.meta.main) {
	try {
		await main();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`design-check: internal_error: ${message}`);
		process.exitCode = 2;
	}
}