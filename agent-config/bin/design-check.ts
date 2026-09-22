#!/usr/bin/env bun
// design-check: owned standalone launcher (misty-step/harness).
/**
 * design-check — deterministic player-surface checks (design-toolkit trial, t_2a376f19).
 *
 * Ports the exercised trial findings into a dependency-free, gate-able tool:
 *   dash        — no em dash or en dash (or their HTML entity forms) in
 *                 player-facing copy (taste-skill 9.G).
 *   vocabulary  — no leaked engineering vocabulary on player surfaces (copy contract).
 *   placeholder — no lorem ipsum / TODO / FIXME / TBD left in player-facing strings.
 *
 * Scope: .html .htm .md .markdown .txt .tsx .ts .jsx .js .mjs files. For code
 * files, string literals (including multi-line template literals) and JSX text
 * are scanned — including JSX text that spans lines, sits between tags on its
 * own lines, or surrounds an {...} interpolation — while identifiers, comments,
 * and import/export module specifiers do not trip the vocabulary list. Fenced
 * code in Markdown and <script>/<style> blocks in markup are skipped, and
 * scanning resumes right after a closing raw tag on the same line. Markup
 * files scan text nodes plus
 * the alt, placeholder, title, and aria-label attributes. Copy extraction is a
 * tolerant state machine, not a parser: malformed or unusual code degrades to
 * noisy findings, never to silent misses. Suppress one line with a
 * `design-check: ignore` comment on that line.
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
const TEXT_EXT = new Set([".html", ".htm", ".md", ".markdown", ".txt"]);
const SKIP_DIR = new Set(["node_modules", ".git", "dist", ".next", "build", "coverage"]);
const COPY_ATTRS = new Set(["alt", "placeholder", "title", "aria-label"]);
const JSX_TAG_KEYWORDS = new Set(["return", "yield", "await", "throw", "case", "default"]);
const REGEX_KEYWORDS = new Set([
	"return",
	"typeof",
	"instanceof",
	"in",
	"of",
	"new",
	"delete",
	"void",
	"case",
	"do",
	"else",
	"yield",
	"await",
]);

/** A quoted string is a module specifier (not player copy) when the text
 * before it on its line is an import/export-from clause. */
const MODULE_SPEC_PREFIX =
	/^\s*(?:import|export)\b[^\n]*\bfrom\s*$|^\s*}\s*from\s*$|^\s*import\s*$/;

/** Em and en dashes, plus their HTML entity forms. */
const DASH_PATTERN = /[\u2014\u2013]|&(?:mdash|ndash|#8212|#x2014|#8211|#x2013);/i;

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type Frame =
	| { kind: "code"; depth: number }
	| { kind: "text"; buffer: string; startLine: number }
	| {
			kind: "string";
			quote: string;
			buffer: string;
			startLine: number;
			copy: boolean;
			moduleSpec: boolean;
			escaped: boolean;
	  }
	| { kind: "template"; buffer: string; startLine: number; escaped: boolean }
	| { kind: "tag"; closing: boolean; name: string | null; start: number }
	| { kind: "raw"; close: RegExp }
	| { kind: "lineComment" }
	| { kind: "blockComment" }
	| { kind: "regex"; escaped: boolean; inClass: boolean };

/**
 * Extract copy regions with a tolerant context stack, so JSX text that spans
 * lines, surrounds an interpolation, or follows a same-line `</script>` close
 * is still scanned. Returns one region string per input line, with pieces
 * separated by NUL.
 */
function scanSource(lines: string[], markup: boolean): string[] {
	const source = lines.join("\n");
	const regions: string[][] = Array.from({ length: lines.length }, () => []);
	const stack: Frame[] = [
		markup
			? { kind: "text", buffer: "", startLine: 0 }
			: { kind: "code", depth: 0 },
	];

	let index = 0;
	let line = 0;
	let lineStart = 0;

	const advance = (count: number): void => {
		for (let step = 0; step < count && index < source.length; step++, index++) {
			if (source[index] === "\n") {
				line++;
				lineStart = index + 1;
			}
		}
	};
	const advanceTo = (target: number): void => {
		while (index < target && index < source.length) {
			if (source[index] === "\n") {
				line++;
				lineStart = index + 1;
			}
			index++;
		}
	};

	/** Emit a copy buffer, attributing each of its lines correctly. */
	const emit = (buffer: string, startLine: number): void => {
		if (!buffer.trim()) return;
		buffer.split("\n").forEach((segment, offset) => {
			if (segment.trim() && startLine + offset < regions.length) {
				regions[startLine + offset].push(segment);
			}
		});
	};

	/** Flush a live text frame at a piece boundary (child tag or expression). */
	const flushText = (frame: Extract<Frame, { kind: "text" }>): void => {
		emit(frame.buffer, frame.startLine);
		frame.buffer = "";
	};

	/** Append one char to a live text buffer, refreshing its start line. */
	const appendText = (frame: Extract<Frame, { kind: "text" }>, ch: string): void => {
		if (frame.buffer === "") frame.startLine = line;
		frame.buffer += ch;
	};

	/** The attribute name whose value starts at the quote at `index`. */
	const attrNameBefore = (start: number): string | null => {
		const match = /([A-Za-z][A-Za-z0-9_-]*)\s*=\s*$/.exec(source.slice(start, index));
		return match ? match[1] : null;
	};

	/** Candidate tag at `index`: a named element or a `<>`/`</>` fragment. */
	const tagCandidate = (): { closing: boolean; name: string | null; length: number } | null => {
		const rest = source.slice(index, index + 128);
		let length = 1;
		let closing = false;
		if (rest[1] === "/") {
			closing = true;
			length = 2;
		}
		const name = /^[A-Za-z][A-Za-z0-9:._-]*/.exec(rest.slice(length));
		if (name) return { closing, name: name[0], length: length + name[0].length };
		if (rest[length] === ">") return { closing, name: null, length: length + 1 };
		return null;
	};

	/** Skip back over whitespace to the previous significant char or word. */
	const previousSignificant = (): { char: string; word: string } | null => {
		let j = index - 1;
		while (j >= 0 && /\s/.test(source[j])) j--;
		if (j < 0) return null;
		const char = source[j];
		if (/[A-Za-z0-9_$]/.test(char)) {
			let k = j;
			while (k >= 0 && /[A-Za-z0-9_$]/.test(source[k])) k--;
			return { char, word: source.slice(k + 1, j + 1) };
		}
		return { char, word: char };
	};

	/** In code, `<` opens a JSX element only in expression positions, so
	 * comparisons (`a < b`) and generics (`Array<string>`) stay plain code. */
	const prevAllowsTag = (): boolean => {
		const previous = previousSignificant();
		if (previous === null) return true;
		if (previous.char === ">") return source[index - 2] === "="; // =>
		if ("=(,:?&|[;{}".includes(previous.char)) return true;
		return JSX_TAG_KEYWORDS.has(previous.word);
	};

	/** In code, `/` starts a regex literal only in expression positions. */
	const prevAllowsRegex = (): boolean => {
		const previous = previousSignificant();
		if (previous === null) return true;
		if (previous.char === ">") return source[index - 2] === "="; // =>
		if ("=(,[:?!;&|".includes(previous.char)) return true;
		return REGEX_KEYWORDS.has(previous.word);
	};

	while (index < source.length) {
		const frame = stack[stack.length - 1];
		if (frame === undefined) break;
		const ch = source[index];

		switch (frame.kind) {
			case "code": {
				if (ch === '"' || ch === "'") {
					const moduleSpec = MODULE_SPEC_PREFIX.test(source.slice(lineStart, index));
					stack.push({
						kind: "string",
						quote: ch,
						buffer: "",
						startLine: line,
						copy: true,
						moduleSpec,
						escaped: false,
					});
					advance(1);
				} else if (ch === "`") {
					stack.push({ kind: "template", buffer: "", startLine: line, escaped: false });
					advance(1);
				} else if (ch === "/" && source[index + 1] === "/") {
					stack.push({ kind: "lineComment" });
					advance(2);
				} else if (ch === "/" && source[index + 1] === "*") {
					stack.push({ kind: "blockComment" });
					advance(2);
				} else if (ch === "/" && prevAllowsRegex()) {
					stack.push({ kind: "regex", escaped: false, inClass: false });
					advance(1);
				} else if (ch === "{") {
					frame.depth++;
					advance(1);
				} else if (ch === "}") {
					frame.depth--;
					if (frame.depth < 0) stack.pop();
					advance(1);
				} else if (ch === "<") {
					if (source.startsWith("!--", index + 1)) {
						const end = source.indexOf("-->", index + 4);
						advanceTo(end < 0 ? source.length : end + 3);
					} else if (source[index + 1] === "!") {
						const end = source.indexOf(">", index + 2);
						advanceTo(end < 0 ? source.length : end + 1);
					} else {
						const candidate = tagCandidate();
						const genericList =
							candidate !== null &&
							candidate.name !== null &&
							candidate.name.length === 1 &&
							source[index + candidate.length] === ",";
						if (candidate !== null && !genericList && prevAllowsTag()) {
							stack.push({
								kind: "tag",
								closing: candidate.closing,
								name: candidate.name,
								start: index,
							});
							advance(candidate.length);
						} else {
							advance(1);
						}
					}
				} else {
					advance(1);
				}
				break;
			}

			case "text": {
				if (ch === "<") {
					if (source.startsWith("!--", index + 1)) {
						const end = source.indexOf("-->", index + 4);
						advanceTo(end < 0 ? source.length : end + 3);
					} else if (source[index + 1] === "!") {
						const end = source.indexOf(">", index + 2);
						advanceTo(end < 0 ? source.length : end + 1);
					} else {
						const candidate = tagCandidate();
						if (candidate !== null) {
							flushText(frame);
							stack.push({
								kind: "tag",
								closing: candidate.closing,
								name: candidate.name,
								start: index,
							});
							advance(candidate.length);
						} else {
							appendText(frame, ch);
							advance(1);
						}
					}
				} else if (ch === "{" && !markup) {
					// JSX expression: the copy on either side stays a separate piece.
					flushText(frame);
					stack.push({ kind: "code", depth: 0 });
					advance(1);
				} else {
					appendText(frame, ch);
					advance(1);
				}
				break;
			}

			case "tag": {
				if (ch === '"' || ch === "'") {
					const attr = attrNameBefore(frame.start);
					const copy = !markup || (attr !== null && COPY_ATTRS.has(attr.toLowerCase()));
					stack.push({
						kind: "string",
						quote: ch,
						buffer: "",
						startLine: line,
						copy,
						moduleSpec: false,
						escaped: false,
					});
					advance(1);
				} else if (ch === "{") {
					stack.push({ kind: "code", depth: 0 });
					advance(1);
				} else if (ch === ">") {
					stack.pop();
					const selfClose = source[index - 1] === "/";
					if (frame.closing) {
						const parent = stack[stack.length - 1];
						if (parent !== undefined && parent.kind === "text") {
							emit(parent.buffer, parent.startLine);
							stack.pop();
						}
					} else if (!selfClose) {
						const name = frame.name !== null ? frame.name.toLowerCase() : "";
						if (name === "script" || name === "style") {
							stack.push({
								kind: "raw",
								close: new RegExp(`</\\s*${escapeRegExp(frame.name ?? "")}\\b[^>]*>`, "i"),
							});
						} else {
							stack.push({ kind: "text", buffer: "", startLine: line });
						}
					}
					advance(1);
				} else {
					advance(1);
				}
				break;
			}

			case "raw": {
				const match = frame.close.exec(source.slice(index));
				if (match !== null) {
					advanceTo(index + match.index + match[0].length);
				} else {
					advanceTo(source.length);
				}
				stack.pop();
				break;
			}

			case "string": {
				if (frame.escaped) {
					frame.escaped = false;
					frame.buffer += ch;
					advance(1);
				} else if (ch === "\\") {
					frame.escaped = true;
					frame.buffer += ch;
					advance(1);
				} else if (ch === frame.quote) {
					if (frame.copy && !frame.moduleSpec) emit(frame.buffer, frame.startLine);
					stack.pop();
					advance(1);
				} else {
					frame.buffer += ch;
					advance(1);
				}
				break;
			}

			case "template": {
				if (frame.escaped) {
					frame.escaped = false;
					frame.buffer += ch;
					advance(1);
				} else if (ch === "\\") {
					frame.escaped = true;
					frame.buffer += ch;
					advance(1);
				} else if (ch === "$" && source[index + 1] === "{") {
					stack.push({ kind: "code", depth: 0 });
					advance(2);
				} else if (ch === "`") {
					emit(frame.buffer, frame.startLine);
					stack.pop();
					advance(1);
				} else {
					frame.buffer += ch;
					advance(1);
				}
				break;
			}

			case "lineComment": {
				if (ch === "\n") stack.pop();
				advance(1);
				break;
			}

			case "blockComment": {
				if (ch === "*" && source[index + 1] === "/") {
					stack.pop();
					advance(2);
				} else {
					advance(1);
				}
				break;
			}

			case "regex": {
				if (frame.escaped) {
					frame.escaped = false;
				} else if (ch === "\\") {
					frame.escaped = true;
				} else if (ch === "[") {
					frame.inClass = true;
				} else if (ch === "]") {
					frame.inClass = false;
				} else if (ch === "/" && !frame.inClass) {
					stack.pop();
				} else if (ch === "\n") {
					stack.pop();
				}
				advance(1);
				break;
			}
		}
	}

	// Drain still-open copy buffers (unterminated strings, unclosed elements).
	for (let depth = stack.length - 1; depth >= 0; depth--) {
		const frame = stack[depth];
		if (frame.kind === "text" || frame.kind === "template") emit(frame.buffer, frame.startLine);
		else if (frame.kind === "string" && frame.copy && !frame.moduleSpec) {
			emit(frame.buffer, frame.startLine);
		}
	}

	return regions.map((pieces) => pieces.join("\u0000"));
}

/** Split a file's raw lines into per-line copy regions. Returns one string per input line. */
export function copyRegions(file: string, lines: string[]): string[] {
	const ext = extname(file).toLowerCase();
	if (CODE_EXT.has(ext)) return scanSource(lines, false);
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
	if (TEXT_EXT.has(ext) || ext === "") return scanSource(lines, true);
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
			const dash = piece.match(DASH_PATTERN);
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
