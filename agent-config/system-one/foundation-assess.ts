/** Advisory-only, Git-ref-scoped foundation evidence and typed Jev judgments. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { posix } from "node:path";
import { SystemOneProviderError } from "./engine.ts";
import type { Answer, Question, SystemOneProvider } from "./engine.ts";
import { isCredentialPath, PRIVATE_KEY_BLOCK, PRIVATE_KEY_ORPHAN, REDACTED, redactText } from "./review.ts";
import { DEFAULT_EXPECTED_RESOLVED_MODELS } from "./semantic-run.ts";

export const FOUNDATION_SCHEMA = "foundation-assessment-1";
export const FOUNDATION_QUESTIONS_VERSION = "foundation-questions-3";
export const FOUNDATION_MODEL = "typesafe/jev-1.13";
export const FOUNDATION_THRESHOLDS = { noulAbsent: 0.2, noulPresent: 0.8, choiceConfidence: 0.7 } as const;
const MAX_QUESTIONS = 32;
const MAX_REQUEST_CHARS = 48_000;
const MAX_STATE_CHARS = 30_000;
const OPTIONS_PRESENCE = ["release_set", "release_from_build", "environment_set", "prod_capture_on", "server_and_client", "pii_default_off", "scrub_hook", "content_attached"];
const PLUGIN_PRESENCE = ["release_set", "release_from_build", "sourcemaps_uploaded", "sourcemaps_not_public"];
// Whether Sentry actually runs depends on its execution guards; these answers need the guard context in the packet.
const GUARD_QUESTIONS = new Set(["prod_capture_on", "server_and_client"]);
const GUARD_LIMITATION = "Execution guard context was cut before at least one call";
const CODE = /\.(?:[cm]?[jt]sx?|py|go|vue|svelte)$/i;
const PLUGIN = /\b(withSentryConfig|sentryVitePlugin|sentryWebpackPlugin|sentryRollupPlugin|sentryEsbuildPlugin|SentryWebpackPlugin)\s*\(/g;
const INIT = /\b(?:Sentry\.init|sentry_sdk\.init|sentry\.Init)\s*\(/g;
const POSTMORTEM_HEADING = /pokayoke|follow[ -]?up|\bfix\b|prevention|remediation|\baction\b|resolution|recovery|\bchange\b|what (?:was )?done|what shipped/i;

export const SENTRY_QUESTIONS: Record<string, Question> = {
	release_set: { type: "noul", instructions: "Do Sentry events carry a release, explicitly or through build-plugin release injection? A Sentry build plugin with a build-time auth token can inject the release even without an init release field." },
	release_from_build: { type: "noul", instructions: "Is the Sentry release derived from the build/commit or injected by a build-time Sentry plugin, rather than a fixed literal?" },
	environment_set: { type: "noul", instructions: "Does the Sentry initialization set a runtime environment explicitly or via its configuration?" },
	prod_capture_on: { type: "noul", instructions: "Is Sentry error capture enabled in production, accounting for enabled flags, environment guards and sample rates?" },
	server_and_client: { type: "noul", instructions: "Are both server and browser/client Sentry initialization paths present and called? An edge-only path does not by itself prove browser initialization." },
	sourcemaps_uploaded: { type: "noul", instructions: "Does the build upload Sentry source maps (including a configured Sentry bundler plugin when its auth token is present at build time)?" },
	sourcemaps_not_public: { type: "noul", instructions: "Does the build configuration explicitly delete source maps after upload, keep them out of the published output, or restrict access to them? Hidden source maps, which only drop the sourcemap comment, do not count, and no explicit setting is no." },
	pii_default_off: { type: "noul", instructions: "Does the Sentry configuration explicitly set sendDefaultPii to false? A true value, or no setting at all, is no." },
	scrub_hook: { type: "noul", instructions: "Is a Sentry beforeSend or beforeBreadcrumb scrub hook configured to remove sensitive event fields?" },
	content_attached: { type: "noul", instructions: "Does the Sentry integration attach raw user content, request bodies, or similarly sensitive content to captured events? Yes means a potential privacy violation, not a benefit." },
};

export const POSTMORTEM_QUESTIONS: Record<string, Question> = {
	fix_kind: { type: "choice", instructions: "Which implemented or proposed follow-up best describes the primary fix in this incident's selected sections? Classify what is actually evidenced, not what might eventually be done.", criteria: {
		automated_check: "A test, monitoring check, automated enforcement or alert detects a recurrence",
		type_or_shape: "A type, schema, interface, or state shape makes the error unrepresentable",
		removed_affordance: "The faulty operation or unsafe affordance is removed or made impossible",
		ownership_change: "Ownership, workflow, or permission responsibility is changed",
		doc_or_warning: "Only documentation, training, or a warning is changed",
		not_yet_fixed: "The incident is unresolved or its fix remains only an open proposal",
		other: "Another fix, or insufficient evidence to classify one",
	} },
	regression_check_named: { type: "noul", instructions: "Is a concrete automated regression test, script, or monitoring check for this incident explicitly named in the selected sections?" },
	closes_class: { type: "noul", instructions: "Does the actual fix prevent the underlying class of failure, rather than only repair the single occurrence or ask people to be careful?" },
	fix_is_proposal: { type: "noul", instructions: "Is the described fix still only a proposal, planned action, or open follow-up rather than a verified completed change?" },
};

export const LEDGER_QUESTIONS: Record<string, Question> = {
	mechanical: { type: "choice", instructions: "For the rule text in state, could a lint rule, deterministic test, or script decide compliance from available artifacts, without subjective human judgment?", criteria: {
		mechanical: "An automated deterministic check could decide this rule",
		judgement: "The rule fundamentally needs semantic or human judgment",
		unclear: "The rule text is too ambiguous or underspecified to decide",
	} },
};

export type PackName = "sentry" | "postmortems" | "ledger";
export type Outcome = "finding" | "no_finding" | "escalate" | "abstained" | "unavailable";
export type CoverageManifest = {
	patterns_searched: string[];
	files_read: string[];
	hops_followed: { from: string; to: string; symbol: string }[];
	unresolved_symbols: { path: string; symbol: string; questions: string[] }[];
	limitations: string[];
};
export type EvidencePacket = {
	pack: PackName;
	source: string;
	state: string;
	coverage: CoverageManifest;
	facts: string[];
	questions: Record<string, Question>;
	scope?: string;
};
export type QuestionResult = { id: string; outcome: Outcome; raw?: Answer; choice?: string; reason?: string };
export type PacketResult = {
	pack: PackName;
	source: string;
	question_pack_version: string;
	packet_sha256: string;
	coverage: CoverageManifest;
	facts: string[];
	scope?: string;
	requested_model: string;
	resolved_model: string | null;
	latency_ms: number;
	questions: QuestionResult[];
};
export type Unassessed = { pack: PackName; source: string; reason: string };
export type FoundationRecord = {
	schema: typeof FOUNDATION_SCHEMA;
	repo: string;
	ref: string;
	commit: string;
	provider: string;
	requested_model: string;
	resolved_models: string[];
	packets: PacketResult[];
	unassessed: Unassessed[];
};

export type GitSnapshot = { ref: string; commit: string; files: string[] };

function git(repo: string, ...args: string[]): string {
	const run = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
	if (run.error || run.status !== 0) throw new Error(`git ${args[0]} failed: ${run.error?.message ?? run.stderr?.trim() ?? run.status}`);
	return run.stdout;
}

export function openGitSnapshot(repo: string, ref?: string): GitSnapshot {
	let selected = ref ?? "origin/HEAD";
	let commit: string;
	try {
		commit = git(repo, "rev-parse", "--verify", `${selected}^{commit}`).trim();
	} catch (error) {
		if (ref) throw error;
		selected = "HEAD";
		commit = git(repo, "rev-parse", "--verify", "HEAD^{commit}").trim();
	}
	const files = git(repo, "ls-tree", "-r", "-z", "--name-only", commit).split("\0").filter(Boolean).sort();
	return { ref: selected, commit, files };
}

type Snapshot = { repo: string; commit: string; files: string[]; fileSet: Set<string>; cache: Map<string, string>; masked: Set<string> };

function source(snapshot: Snapshot, path: string, coverage: CoverageManifest): string {
	let text = snapshot.cache.get(path);
	if (text === undefined) {
		// Mask key blocks before any excerpt is cut, keeping line numbers, so no cut can separate key material from its markers.
		const keepLines = (block: string) => REDACTED + "\n".repeat(block.split("\n").length - 1);
		const blocks = git(snapshot.repo, "show", `${snapshot.commit}:${path}`).replace(PRIVATE_KEY_BLOCK, keepLines);
		text = blocks.replace(PRIVATE_KEY_ORPHAN, keepLines);
		if (text !== blocks) snapshot.masked.add(path);
		snapshot.cache.set(path, text);
	}
	// An unterminated key block hides everything after it, so the packet's coverage is incomplete.
	const hidden = `${path}: an unterminated private-key block was masked to the end of the file`;
	if (snapshot.masked.has(path) && !coverage.limitations.includes(hidden)) coverage.limitations.push(hidden);
	if (!coverage.files_read.includes(path)) coverage.files_read.push(path);
	return text;
}

function coverage(patterns: string[]): CoverageManifest {
	return { patterns_searched: patterns, files_read: [], hops_followed: [], unresolved_symbols: [], limitations: [] };
}

function searchable(snapshot: Snapshot, pattern: string): string[] {
	const run = spawnSync("git", ["-C", snapshot.repo, "grep", "-z", "-l", "-I", "-i", "-e", pattern, snapshot.commit, "--"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
	if (run.status === 1) return [];
	if (run.error || run.status !== 0) throw new Error(`git grep failed: ${run.error?.message ?? run.stderr?.trim() ?? run.status}`);
	return run.stdout.split("\0").filter(Boolean).map((entry) => entry.slice(snapshot.commit.length + 1));
}

function lineOf(text: string, index: number): number {
	let n = 1;
	for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
	return n;
}

/** Skip strings and comments so nested calls and config objects close at their real delimiter. */
function closing(text: string, open: number): number {
	const matching: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
	const stack: string[] = [matching[text[open]]];
	if (!stack[0]) return -1;
	let quote = "";
	for (let i = open + 1; i < text.length; i++) {
		const ch = text[i];
		if (quote) {
			if (ch === "\\") i++;
			else if (ch === quote) quote = "";
			continue;
		}
		if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
		if (ch === "/" && text[i + 1] === "/") { i = text.indexOf("\n", i + 2); if (i < 0) return -1; continue; }
		if (ch === "/" && text[i + 1] === "*") { i = text.indexOf("*/", i + 2); if (i < 0) return -1; i++; continue; }
		if (matching[ch]) stack.push(matching[ch]);
		else if (ch === stack[stack.length - 1]) { stack.pop(); if (!stack.length) return i; }
	}
	return -1;
}

type Excerpt = { path: string; line: number; kind: string; text: string; guard?: string };

function redactEvidence(text: string): string {
	const general = redactText(text);
	return general.replace(/(\b(?:SENTRY_DSN|NEXT_PUBLIC_SENTRY_DSN|dsn)\s*[:=]\s*)(?:["'`]https?:\/\/[^"'`\s]+["'`]|https?:\/\/[^\s,}]+)/gi, "$1[REDACTED:sentry-dsn]");
}

const GUARD_CHARS = 1500;
const GUARD_TRUNCATED = "[guard context truncated]";

/** Numbered source lines that decide whether the call at `index` runs: enclosing block headers, earlier statements in its own block, and the call line's prefix. */
function guardContext(text: string, index: number, path: string): string | undefined {
	const lineStart = (at: number) => text.lastIndexOf("\n", at - 1) + 1;
	const lineEnd = (at: number) => { const end = text.indexOf("\n", at); return end < 0 ? text.length : end; };
	const back = (at: number, lines: number) => { let start = lineStart(at); for (let n = 0; n < lines && start > 0; n++) start = lineStart(start - 1); return start; };
	const numbered = (from: number, to: number) => text.slice(from, to).split("\n").map((line, n) => `${lineOf(text, from) + n}: ${line}`).join("\n");
	const blocks: number[] = [];
	if (/\.py$/i.test(path)) {
		// Indentation opens Python blocks: each shallower line above the call is an enclosing header.
		let indent = /^[ \t]*/.exec(text.slice(lineStart(index)))![0].length;
		for (let at = lineStart(index); indent > 0 && at > 0; ) {
			at = lineStart(at - 1);
			const line = text.slice(at, lineEnd(at));
			const own = /^[ \t]*/.exec(line)![0].length;
			if (line.trim() && own < indent) { blocks.unshift(at); indent = own; }
		}
	} else {
		let quote = "";
		for (let i = 0; i < index; i++) {
			const ch = text[i];
			if (quote) { if (ch === "\\") i++; else if (ch === quote) quote = ""; continue; }
			if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
			if (ch === "/" && text[i + 1] === "/") { i = text.indexOf("\n", i); if (i < 0) break; continue; }
			if (ch === "/" && text[i + 1] === "*") { i = text.indexOf("*/", i + 2); if (i < 0) break; i++; continue; }
			if (ch === "{") blocks.push(i);
			else if (ch === "}") blocks.pop();
		}
	}
	// A controlling condition can span lines: widen a header until its parentheses balance, or count the guard as cut.
	let cut = false;
	const header = (at: number) => {
		const end = /\.py$/i.test(path) ? lineEnd(at) : at;
		let start = back(at, 2);
		for (let n = 0; n < 20; n++) {
			const slice = text.slice(start, end);
			if ((slice.match(/\(/g)?.length ?? 0) >= (slice.match(/\)/g)?.length ?? 0)) return start;
			if (start === 0) break;
			start = lineStart(start - 1);
		}
		cut = true;
		return start;
	};
	const inner = blocks.pop();
	const parts = blocks.map((at) => numbered(header(at), lineEnd(at)));
	let from = inner === undefined ? lineStart(index) : header(inner);
	if (index - from > GUARD_CHARS) {
		const tail = lineStart(index - GUARD_CHARS);
		if (inner === undefined) { cut = true; from = tail; }
		else {
			// Keep the whole header; the guard is cut only if statements between it and the kept tail are dropped.
			parts.push(numbered(from, lineEnd(inner)));
			if (tail > lineEnd(inner) + 1) cut = true;
			from = Math.max(tail, lineEnd(inner) + 1);
		}
	}
	if (cut) parts.push(GUARD_TRUNCATED);
	if (!parts.length && !/\S/.test(text.slice(from, index))) return undefined;
	return [...parts, numbered(from, index)].join("\n");
}

function extractCalls(text: string, path: string, pattern: RegExp, kind: string): Excerpt[] {
	const result: Excerpt[] = [];
	for (const match of text.matchAll(pattern)) {
		// A commented-out call is not evidence.
		if (commented(text, match.index, /\.py$/i.test(path))) continue;
		const open = match.index + match[0].lastIndexOf("(");
		const end = closing(text, open);
		if (end < 0) continue;
		const guard = kind === "build_plugin" ? undefined : guardContext(text, match.index, path);
		result.push({ path, line: lineOf(text, match.index), kind, text: text.slice(match.index, end + 1), ...(guard ? { guard } : {}) });
	}
	return result;
}

/** A brace capture is complete only when its statement ends right after it: a later argument, operator or continued line means it was cut off. */
function endsStatement(text: string, end: number): boolean {
	let i = end + 1;
	let newline = false;
	// Comments count as whitespace, keeping their line breaks; scanning runs to the next code or the real end of the file.
	const skip = (): boolean => {
		while (i < text.length) {
			if (text[i] === "\n") { newline = true; i++; }
			else if (/\s/.test(text[i])) i++;
			else if (text.startsWith("//", i)) { const eol = text.indexOf("\n", i); i = eol < 0 ? text.length : eol; }
			else if (text.startsWith("/*", i)) {
				const close = text.indexOf("*/", i + 2);
				if (close < 0) return false;
				if (text.slice(i, close).includes("\n")) newline = true;
				i = close + 2;
			} else break;
		}
		return true;
	};
	if (!skip()) return false;
	const suffix = newline ? null : /^(?:as\s+const\b|satisfies\s+[\w$.<>[\], ]+)/.exec(text.slice(i, i + 200));
	if (suffix) { i += suffix[0].length; if (!skip()) return false; }
	while (text[i] === ")") { i++; if (!skip()) return false; }
	if (i >= text.length || text[i] === ";") return true;
	return newline && !/^(?:[?:.|&+\-,\]{=]|as\s|satisfies\s)/.test(text.slice(i, i + 12));
}

function balanced(text: string): boolean {
	const count = (pattern: RegExp) => text.match(pattern)?.length ?? 0;
	return count(/\(/g) === count(/\)/g) && count(/\[/g) === count(/]/g) && count(/\{/g) === count(/\}/g);
}

/** Whether `index` sits inside a comment, including `#` lines for Python; a string that looks like one only makes the lookup fail closed. */
function commented(text: string, index: number, hash = false): boolean {
	const prefix = text.slice(text.lastIndexOf("\n", index - 1) + 1, index);
	return prefix.includes("//") || hash && prefix.includes("#") || text.lastIndexOf("/*", index) > text.lastIndexOf("*/", index);
}

/** Index of the next code character from `from`, past whitespace and comments; -1 inside an unterminated block comment. */
function nextCode(text: string, from: number): number {
	let i = from;
	while (i < text.length) {
		if (/\s/.test(text[i])) i++;
		else if (text.startsWith("//", i)) { const eol = text.indexOf("\n", i); i = eol < 0 ? text.length : eol; }
		else if (text.startsWith("/*", i)) { const close = text.indexOf("*/", i + 2); if (close < 0) return -1; i = close + 2; }
		else break;
	}
	return i;
}

/**
 * Where a function's body starts, or where an overload signature ends. The body is the first top-level brace group after the
 * parameters that ends the declaration, so object, conditional and generic return types are skipped.
 */
function bodyBrace(text: string, paren: number): { body: number } | { overload: number } | null {
	const paramsEnd = closing(text, paren);
	if (paramsEnd < 0) return null;
	let last = ")";
	for (let i = paramsEnd + 1; i < text.length; i++) {
		const ch = text[i];
		// Comments and string literal types are never the body.
		if (text.startsWith("//", i) || text.startsWith("/*", i)) { const next = nextCode(text, i); if (next < 0) return null; i = next - 1; continue; }
		if (/\s/.test(ch)) continue;
		if (ch === "'" || ch === '"' || ch === "`") {
			let j = i + 1;
			while (j < text.length && text[j] !== ch) j += text[j] === "\\" ? 2 : 1;
			if (j >= text.length) return null;
			i = j;
			last = ch;
			continue;
		}
		// A signature ending in ';' is an overload; an arrow return type is not parsed here and stays unresolved.
		if (ch === ";") return { overload: i };
		if (ch === "=" && text[i + 1] === ">") return null;
		if (ch !== "(" && ch !== "[" && ch !== "{") { last = ch; continue; }
		const end = closing(text, i);
		if (end < 0) return null;
		if (ch === "{" && endsStatement(text, end)) {
			const after = nextCode(text, end + 1);
			// Only a brace in type position followed by ';' is an overload's return type; a body may carry its own ';'.
			const typed = /[:|&?<=,]/.test(last) || /(?:^|[^\w$])(?:extends|is|keyof|typeof|infer|asserts|readonly)\s*$/.test(text.slice(paramsEnd + 1, i));
			return after >= 0 && text[after] === ";" && typed ? { overload: after } : { body: i };
		}
		i = end;
		last = text[end];
	}
	return null;
}

function definition(text: string, symbol: string, python = false): { line: number; text: string; complete: boolean; body?: number } | null {
	const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const patterns = [
		new RegExp(`\\b(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s+${escaped}(?:<[^>]+>)?\\s*\\(`, "g"),
		new RegExp(`\\b(?:export\\s+)?(?:const|let|var)\\s+${escaped}\\s*(?::[^=\\n]+)?=`, "g"),
		new RegExp(`\\b(?:export\\s+)?(?:async\\s+)?def\\s+${escaped}\\s*\\(`, "g"),
	];
	for (const pattern of patterns) {
		let match = pattern.exec(text);
		// A declaration inside a comment is not the live one.
		while (match && commented(text, match.index, python || pattern === patterns[2])) match = pattern.exec(text);
		if (!match) continue;
		const start = match.index;
		if (pattern === patterns[0]) {
			// TypeScript puts an implementation right after its overload signatures; a later same-named function is another binding.
			let candidate: RegExpExecArray | null = match;
			while (candidate) {
				const found = bodyBrace(text, candidate.index + candidate[0].length - 1);
				if (found && "body" in found) {
					const end = closing(text, found.body);
					if (end >= 0) return { line: lineOf(text, candidate.index), text: text.slice(candidate.index, end + 1), complete: true, body: found.body - candidate.index };
				}
				if (!found || !("overload" in found)) break;
				const next = pattern.exec(text);
				candidate = next && next.index === nextCode(text, found.overload + 1) && !commented(text, next.index, python) ? next : null;
			}
			// No recognizable body: keep the first signature as evidence, but it cannot count as resolved.
			const eol = text.indexOf("\n", start);
			return { line: lineOf(text, start), text: text.slice(start, eol < 0 ? text.length : eol), complete: false };
		}
		const after = text.slice(start);
		const brace = after.indexOf("{");
		const semi = after.indexOf(";");
		if (brace >= 0 && (semi < 0 || brace < semi)) {
			const end = closing(text, start + brace);
			// A brace inside a Python function is a literal, not its body.
			if (end >= 0) return { line: lineOf(text, start), text: text.slice(start, end + 1), complete: pattern !== patterns[2] && endsStatement(text, end) };
		}
		if (semi >= 0) {
			const captured = text.slice(start, start + semi + 1);
			return { line: lineOf(text, start), text: captured, complete: balanced(captured) };
		}
		const next = after.search(/\n(?:export\s+)?(?:const|let|var|function|def)\s+/);
		return { line: lineOf(text, start), text: next >= 0 ? after.slice(0, next) : after, complete: true };
	}
	const binding = new RegExp(`\\b${escaped}\\s*=\\s*[A-Za-z_$][\\w$]*\\s*\\(`, "g");
	let defaultBinding = binding.exec(text);
	while (defaultBinding && commented(text, defaultBinding.index, python)) defaultBinding = binding.exec(text);
	if (defaultBinding) {
		const end = closing(text, defaultBinding.index + defaultBinding[0].lastIndexOf("("));
		if (end >= 0) return { line: lineOf(text, defaultBinding.index), text: text.slice(defaultBinding.index, end + 1), complete: true };
	}
	return null;
}

function importOrigin(text: string, symbol: string): { imported: string; path: string } | null {
	for (const match of text.matchAll(/\bimport\s+([^;]+?)\s+from\s+["']([^"']+)["']/g)) {
		const [, bindings, path] = match;
		if (!path.startsWith(".") && !path.startsWith("@/")) continue;
		if (new RegExp(`\\b${symbol}\\b`).test(bindings)) {
			const named = bindings.match(/\{([^}]+)\}/)?.[1].split(",").map((part) => part.trim()).find((part) => part === symbol || part.endsWith(` as ${symbol}`));
			if (named) return { imported: named.split(/\s+as\s+/)[0], path };
			if (bindings.split(/[,\s]/)[0] === symbol) return { imported: "default", path };
		}
	}
	for (const match of text.matchAll(/\b(?:const|let)\s*\{([^}]+)\}\s*=\s*await\s+import\(["']([^"']+)["']\)/g)) {
		const [, bindings, path] = match;
		if ((path.startsWith(".") || path.startsWith("@/")) && bindings.split(",").some((part) => part.trim() === symbol)) return { imported: symbol, path };
	}
	return null;
}

function resolveImport(snapshot: Snapshot, from: string, relative: string): string | null {
	const base = relative.startsWith("@/") ? relative.slice(2) : posix.normalize(posix.join(posix.dirname(from), relative));
	if (base.startsWith("../") || base === "..") return null;
	const bases = relative.startsWith("@/") ? [base, `src/${base}`] : [base];
	for (const prefix of bases) for (const candidate of [prefix, ...[".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", "/index.ts", "/index.tsx", "/index.js"].map((ext) => prefix + ext)]) {
		if (snapshot.fileSet.has(candidate)) return candidate;
	}
	return null;
}

function unresolved(manifest: CoverageManifest, path: string, symbol: string, questions: string[]): void {
	const existing = manifest.unresolved_symbols.find((item) => item.path === path && item.symbol === symbol);
	if (existing) existing.questions = [...new Set([...existing.questions, ...questions])];
	else manifest.unresolved_symbols.push({ path, symbol, questions });
}

const IGNORED_SYMBOLS = /^(?:true|false|null|undefined|Object|String|Number|Boolean|process|console|require|string|number|boolean|unknown|any|never|void|object|bigint|symbol)$/;

/** Identifiers a captured definition depends on, from `from` on and minus its own parameters: spreads, relevant property values, shorthand hooks and a returned identifier. */
function optionReferences(text: string, from = 0): string[] {
	const own = new Set(text.match(/\(([^)]*)\)/)?.[1].match(/[A-Za-z_$][\w$]*/g) ?? []);
	const body = text.slice(from);
	const names = new Set<string>();
	for (const match of body.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
	for (const match of body.matchAll(/\b(?:beforeSend|beforeBreadcrumb|beforeSendTransaction|beforeSendSpan|release|environment|enabled|sendDefaultPii)\s*:\s*([A-Za-z_$][\w$]*)(?=\s*[,}])/g)) names.add(match[1]);
	for (const match of body.matchAll(/\b(beforeSend|beforeBreadcrumb|beforeSendTransaction|beforeSendSpan)\s*(?=[,}])/g)) names.add(match[1]);
	for (const match of body.matchAll(/\breturn\s+([A-Za-z_$][\w$]*)\s*[;(\n}]/g)) names.add(match[1]);
	return [...names].filter((name) => !own.has(name) && !IGNORED_SYMBOLS.test(name));
}

function captureSymbol(snapshot: Snapshot, manifest: CoverageManifest, from: string, symbol: string, relevant: string[], excerpts: Excerpt[], remaining = 1): void {
	if (IGNORED_SYMBOLS.test(symbol)) return;
	const contents = source(snapshot, from, manifest);
	const origin = importOrigin(contents, symbol);
	const destination = origin ? resolveImport(snapshot, from, origin.path) : from;
	if (!destination) { unresolved(manifest, from, symbol, relevant); return; }
	const target = source(snapshot, destination, manifest);
	const exported = /\bexport\s+default\s+([\s\S]*?);/g;
	let found = origin?.imported === "default" ? exported.exec(target) : null;
	while (found && commented(target, found.index)) found = exported.exec(target);
	const python = /\.py$/i.test(destination);
	const result = found ? { line: lineOf(target, found.index ?? 0), text: found[0], complete: balanced(found[0]), body: 0 } : definition(target, origin?.imported ?? symbol, python);
	if (!result) { unresolved(manifest, from, symbol, relevant); return; }
	// A second visit adds its questions to what the first recorded, without duplicating the excerpt.
	if (!excerpts.some((item) => item.path === destination && item.line === result.line && item.kind === `definition:${symbol}`)) {
		manifest.hops_followed.push({ from, to: destination, symbol });
		excerpts.push({ path: destination, line: result.line, kind: `definition:${symbol}`, text: result.text });
	}
	// A partial capture, or a reference past the hop budget, is recorded rather than dropped, so an absent answer abstains.
	if (!result.complete) { unresolved(manifest, destination, symbol, relevant); return; }
	const factory = result.text.match(/(?:\b(?:const|let|var)\s+)?\b\w+\s*=\s*([A-Za-z_$][\w$]*)\s*\(/)?.[1];
	if (factory && remaining > 0) captureSymbol(snapshot, manifest, destination, factory, relevant, excerpts, remaining - 1);
	const pending = new Set(optionReferences(result.text, result.body ?? 0));
	if (factory && remaining === 0) pending.add(factory);
	else if (factory) pending.delete(factory);
	for (const name of pending) if (!IGNORED_SYMBOLS.test(name) && !definition(result.text, name, python)) unresolved(manifest, destination, name, relevant);
}

function wrapperNames(text: string, aliases: string[]): string[] {
	const names: string[] = [];
	const pattern = new RegExp(`\\b(?:${["Sentry", "sentry_sdk", "sentry", ...aliases].join("|")})\\.(?:init|Init)\\s*\\(`);
	for (const match of text.matchAll(/\b(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(|\b(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>/g)) {
		if (commented(text, match.index)) continue;
		const name = match[1] ?? match[2];
		const body = definition(text.slice(match.index), name)?.text;
		if (body && pattern.test(body)) names.push(name);
	}
	return names;
}

function sentryPackets(snapshot: Snapshot): EvidencePacket[] {
	const manifest = coverage(["Sentry.init(", "sentry_sdk.init(", "sentry.Init(", "Sentry bundler plugins", "Sentry CI steps", "SENTRY_* environment names", "wrapper call sites"]);
	const excerpts: Excerpt[] = [];
	const names = new Set<string>();
	const candidates = new Set(searchable(snapshot, "sentry"));
	for (const file of snapshot.files) if (/^(?:instrumentation(?:\.[^/]+)?|sentry\.(?:server|edge|client)\.config)\.[^/]+$|(?:^|\/)(?:next|vite|webpack)\.config\./i.test(file)) candidates.add(file);
	for (const path of [...candidates].sort()) {
		if (isCredentialPath(path) || /\.(?:lock|map|snap|json)$/i.test(path)) continue;
		if (!CODE.test(path) && !/\.ya?ml$/i.test(path)) continue;
		const text = source(snapshot, path, manifest);
		for (const match of text.matchAll(/\b(?:SENTRY|NEXT_PUBLIC_SENTRY|VITE_SENTRY|REACT_APP_SENTRY)_[A-Z0-9_]+\b/g)) names.add(match[0]);
		if (CODE.test(path)) {
			const aliases = [...text.matchAll(/\b([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*Sentry\b/g)].map((match) => match[1]);
			const aliasCalls = aliases.flatMap((alias) => extractCalls(text, path, new RegExp(`\\b${alias}\\.init\\s*\\(`, "g"), "init"));
			const inits = [...extractCalls(text, path, INIT, "init"), ...aliasCalls];
			const plugins = extractCalls(text, path, PLUGIN, "build_plugin");
			excerpts.push(...inits, ...plugins);
			for (const init of inits) {
				for (const spread of init.text.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)/g)) captureSymbol(snapshot, manifest, path, spread[1], OPTIONS_PRESENCE, excerpts);
				const arg = init.text.slice(init.text.indexOf("(") + 1).trim();
				const factory = arg.match(/^([A-Za-z_$][\w$]*)\s*\(/);
				if (factory) captureSymbol(snapshot, manifest, path, factory[1], OPTIONS_PRESENCE, excerpts);
				const variable = arg.match(/^([A-Za-z_$][\w$]*)\s*\)/);
				if (variable) captureSymbol(snapshot, manifest, path, variable[1], OPTIONS_PRESENCE, excerpts);
				for (const property of init.text.matchAll(/\b(?:beforeSend|beforeBreadcrumb|release|environment|enabled|sendDefaultPii)\s*:\s*([A-Za-z_$][\w$]*)(?=\s*[,}])/g)) {
					captureSymbol(snapshot, manifest, path, property[1], OPTIONS_PRESENCE, excerpts);
				}
				for (const shorthand of init.text.matchAll(/\b(beforeSend|beforeBreadcrumb|beforeSendTransaction|beforeSendSpan)\s*(?=[,}])/g)) {
					captureSymbol(snapshot, manifest, path, shorthand[1], OPTIONS_PRESENCE, excerpts);
				}
			}
			for (const plugin of plugins) {
				for (const spread of plugin.text.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)/g)) captureSymbol(snapshot, manifest, path, spread[1], PLUGIN_PRESENCE, excerpts);
				const args = plugin.text.slice(plugin.text.indexOf("(") + 1, -1);
				const optionsSymbol = args.match(/(?:^|,)\s*([A-Za-z_$][\w$]*)(?:\(\s*\))?\s*$/);
				if (optionsSymbol) captureSymbol(snapshot, manifest, path, optionsSymbol[1], PLUGIN_PRESENCE, excerpts);
			}
			for (const wrapper of wrapperNames(text, aliases)) {
				for (const caller of searchable(snapshot, `${wrapper}(`)) {
					if (caller === path || !CODE.test(caller) || isCredentialPath(caller)) continue;
					const callingText = source(snapshot, caller, manifest);
					for (const call of extractCalls(callingText, caller, new RegExp(`\\b${wrapper}\\s*\\(`, "g"), `wrapper_call:${wrapper}`)) {
						excerpts.push(call);
						manifest.hops_followed.push({ from: path, to: caller, symbol: wrapper });
					}
				}
			}
		} else if (/(?:^|\/)\.github\/workflows\/|(?:^|\/)\.gitlab-ci\.|(?:^|\/)\.circleci\//.test(path)) {
			const lines = text.split("\n");
			for (let i = 0; i < lines.length; i++) {
				if (!/^\s*-\s*(?:name|uses|run):/.test(lines[i])) continue;
				const start = i;
				const indent = lines[i].match(/^\s*/)?.[0].length ?? 0;
				let end = i + 1;
				while (end < lines.length && !new RegExp(`^\\s{0,${indent}}(?:-|[A-Za-z_][\\w-]*:)`).test(lines[end])) end++;
				if (/sentry/i.test(lines.slice(start, end).join("\n"))) {
					const step = lines.slice(start, end).map((line) => line.replace(/^(\s*(?:SENTRY|NEXT_PUBLIC_SENTRY|VITE_SENTRY|REACT_APP_SENTRY)_[A-Z0-9_]+:\s*).*$/i, "$1[env value omitted]")).join("\n");
					excerpts.push({ path, line: start + 1, kind: "ci_step", text: step });
				}
				i = end - 1;
			}
		}
	}
	const facts: string[] = [];
	if (excerpts.some((item) => item.kind === "build_plugin" && /\b(?:authToken|SENTRY_AUTH_TOKEN)\b/.test(item.text))) facts.push("A configured Sentry build plugin with an auth token injects its release and uploads source maps when the token is present at build time; repository evidence cannot prove token availability in CI.");
	if (excerpts.some((item) => item.guard?.includes(GUARD_TRUNCATED))) manifest.limitations.push(GUARD_LIMITATION);
	const pieces = [...excerpts.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line).map((part) => ({ ...part, text: redactEvidence(part.text), ...(part.guard ? { guard: redactEvidence(part.guard) } : {}) }))];
	const stateBase = { env_var_names: [...names].sort(), facts };
	const all = JSON.stringify({ ...stateBase, excerpts: pieces });
	const make = (text: string, sourceName: string, shard: boolean): EvidencePacket => ({
		pack: "sentry", source: sourceName, state: text,
		coverage: { ...manifest, limitations: [...manifest.limitations, ...(shard ? ["Packet split across requests; absence cannot be inferred from a single shard"] : [])] },
		facts, questions: SENTRY_QUESTIONS, scope: "Sentry API and alert routing are out of scope: alert routing lives in Sentry, not in this repository.",
	});
	if (all.length <= MAX_STATE_CHARS) return [make(all, "repository", false)];
	// Every byte of an oversized config remains represented. Shards cannot establish absence.
	const chunks: Excerpt[][] = [];
	let current: Excerpt[] = [];
	for (const part of pieces) {
		let text = part.text;
		while (text.length) {
			const segment = text.slice(0, MAX_STATE_CHARS - 4000);
			text = text.slice(segment.length);
			const candidate = { ...part, text: segment };
			if (JSON.stringify({ ...stateBase, excerpts: [...current, candidate] }).length > MAX_STATE_CHARS && current.length) { chunks.push(current); current = []; }
			current.push(candidate);
		}
	}
	if (current.length || !chunks.length) chunks.push(current);
	return chunks.map((items, index) => make(JSON.stringify({ ...stateBase, excerpts: items }), `repository#${index + 1}/${chunks.length}`, true));
}

function postmortemPackets(snapshot: Snapshot): EvidencePacket[] {
	// README and TEMPLATE files are scaffolding under every incident path, not incidents.
	const paths = snapshot.files.filter((path) => !/(?:^|[-_])(?:README|TEMPLATE)\.md$/i.test(path.split("/").at(-1) ?? "") && (/(?:^|\/)docs\/postmortems\/[^/]+\.md$/i.test(path) || /(?:^|\/)[^/]*postmortem[^/]*\.md$/i.test(path) || /(?:^|\/)INCIDENT-[^/]+\.md$/i.test(path) || /(?:^|\/)operations\/incidents\/[^/]+\.md$/i.test(path)));
	return paths.map((path): EvidencePacket => {
		const manifest = coverage(["docs/postmortems/*.md excluding README and TEMPLATE", "**/*postmortem*.md", "INCIDENT-*.md", "operations/incidents/*.md", "selected remediation headings"]);
		const lines = source(snapshot, path, manifest).split("\n");
		const selected: { line: number; text: string }[] = [];
		let active = false;
		let depth = 0;
		for (let i = 0; i < lines.length; i++) {
			const heading = lines[i].match(/^(#{1,6})\s+(.+)/);
			if (heading && active && heading[1].length <= depth) active = false;
			if (heading && POSTMORTEM_HEADING.test(heading[2])) { active = true; depth = heading[1].length; }
			if (active) selected.push({ line: i + 1, text: lines[i] });
		}
		// Redact the whole selection at once so a multi-line key matches as one block; each line keeps its own anchor.
		const text = redactEvidence(selected.map((item) => `${path}:${item.line}: ${item.text}`).join("\n"));
		const marker = "\n[truncated: selected sections]";
		const kept = 8000 - marker.length;
		if (text.length > 8000) manifest.limitations.push(`Selected sections exceed 8000 characters; omitted ${text.length - kept} characters`);
		return { pack: "postmortems", source: path, state: text.length > 8000 ? text.slice(0, kept) + marker : text, coverage: manifest, facts: [], questions: POSTMORTEM_QUESTIONS };
	});
}

function ranges(lines: number[]): string {
	const parts: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		let j = i;
		while (j + 1 < lines.length && lines[j + 1] === lines[j] + 1) j++;
		parts.push(j > i ? `${lines[i]}-${lines[j]}` : `${lines[i]}`);
		i = j;
	}
	return parts.join(",");
}

function ledgerPackets(snapshot: Snapshot, unassessed: Unassessed[]): EvidencePacket[] {
	const packets: EvidencePacket[] = [];
	for (const path of ["DOMAIN.md", "WATCHDOG.md"]) {
		if (!snapshot.fileSet.has(path)) continue;
		const manifest = coverage([path === "DOMAIN.md" ? "bullet or numbered rules under headings containing Invariant" : "numbered priorities in repo-root WATCHDOG.md"]);
		const lines = source(snapshot, path, manifest).split("\n");
		const prose: number[] = [];
		let depth = 0;
		let active = false;
		let fenced = false;
		for (let i = 0; i < lines.length; i++) {
			if (/^\s*```/.test(lines[i])) { fenced = !fenced; continue; }
			if (fenced) continue;
			const heading = lines[i].match(/^(#{1,6})\s+(.+)/);
			if (path === "DOMAIN.md") {
				if (heading && active && heading[1].length <= depth) active = false;
				if (heading && /invariant/i.test(heading[2])) { active = true; depth = heading[1].length; }
			} else active = true;
			if (!active) continue;
			const bullet = path === "DOMAIN.md" ? lines[i].match(/^\s*(?:[-*+]\s+|\d+[.)]\s+)(.*\S)/) : lines[i].match(/^\s*(?:\d+[.)]\s+|#{1,6}\s+\d+[.)]?\s+)(.*\S)/);
			if (!bullet) {
				// Line breaks in prose do not mark rule boundaries, so prose is reported rather than guessed at.
				if (path === "DOMAIN.md" && !heading && lines[i].trim() && !/^\s*(?:>|\|)/.test(lines[i])) prose.push(i + 1);
				continue;
			}
			const ruleLine = i + 1;
			let rule = bullet[1];
			while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !/^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[i + 1])) rule += ` ${lines[++i].trim()}`;
			packets.push({ pack: "ledger", source: `${path}:${ruleLine}`, state: redactEvidence(rule), coverage: { ...manifest, files_read: [path] }, facts: [], questions: LEDGER_QUESTIONS });
		}
		if (prose.length) unassessed.push({ pack: "ledger", source: `${path}:${ranges(prose)}`, reason: "prose under an invariants heading has no single-rule boundaries; ADR-004 writes one rule per bullet" });
	}
	return packets;
}

export function distillFoundationPackets(repo: string, snapshot: GitSnapshot, pack: PackName | "all"): { packets: EvidencePacket[]; unassessed: Unassessed[] } {
	const state: Snapshot = { repo, commit: snapshot.commit, files: snapshot.files, fileSet: new Set(snapshot.files), cache: new Map(), masked: new Set() };
	const unassessed: Unassessed[] = [];
	const packets = [
		...(pack === "all" || pack === "sentry" ? sentryPackets(state) : []),
		...(pack === "all" || pack === "postmortems" ? postmortemPackets(state) : []),
		...(pack === "all" || pack === "ledger" ? ledgerPackets(state, unassessed) : []),
	];
	return { packets, unassessed };
}

function classify(id: string, question: Question, answer: Answer | undefined, packet: EvidencePacket): QuestionResult {
	if (!answer || answer.type !== question.type) return { id, outcome: "unavailable", reason: "Missing or invalid typed answer" };
	if (answer.type === "noul") {
		if (!Number.isFinite(answer.probability) || answer.probability < 0 || answer.probability > 1) return { id, outcome: "unavailable", reason: "Invalid probability" };
		// Without its guard context, an answer about whether Sentry runs cannot be confident either way.
		if (packet.pack === "sentry" && GUARD_QUESTIONS.has(id) && packet.coverage.limitations.includes(GUARD_LIMITATION)) return { id, outcome: "abstained", raw: answer, reason: "Execution guard context is incomplete" };
		if (answer.probability >= FOUNDATION_THRESHOLDS.noulPresent) return { id, outcome: "finding", raw: answer };
		if (answer.probability > FOUNDATION_THRESHOLDS.noulAbsent) return { id, outcome: "escalate", raw: answer };
		// Code excerpts can show that something is configured, never that it is not, however much the distiller captured.
		if (packet.pack === "sentry") return { id, outcome: "abstained", raw: answer, reason: "Code excerpts cannot prove an absence" };
		if (packet.coverage.limitations.length) return { id, outcome: "abstained", raw: answer, reason: "Presence cannot be ruled out: incomplete coverage" };
		return { id, outcome: "no_finding", raw: answer };
	}
	if (answer.type === "choice" && question.type === "choice") {
		if (!Object.hasOwn(question.criteria, answer.choice) || !Number.isFinite(answer.confidence) || answer.confidence! < 0 || answer.confidence! > 1) return { id, outcome: "unavailable", raw: answer, reason: "Invalid choice or confidence" };
		if (answer.confidence! < FOUNDATION_THRESHOLDS.choiceConfidence) return { id, outcome: "escalate", raw: answer };
		if (answer.choice === "unclear" || answer.choice === "other") return { id, outcome: "abstained", raw: answer, choice: answer.choice };
		return { id, outcome: answer.choice === "judgement" ? "no_finding" : "finding", raw: answer, choice: answer.choice };
	}
	return { id, outcome: "unavailable", reason: "Unsupported answer type" };
}

export async function assessFoundations(options: { repo: string; snapshot: GitSnapshot; pack: PackName | "all"; provider: SystemOneProvider | null; timeoutMs?: number }): Promise<FoundationRecord> {
	const { packets, unassessed } = distillFoundationPackets(options.repo, options.snapshot, options.pack);
	const provider = options.provider;
	const requested = provider?.requestedModel ?? FOUNDATION_MODEL;
	const results: PacketResult[] = [];
	for (const packet of packets) {
		const state = packet.state;
		const ids = Object.keys(packet.questions);
		const result: PacketResult = { pack: packet.pack, source: packet.source, question_pack_version: FOUNDATION_QUESTIONS_VERSION,
			packet_sha256: createHash("sha256").update(state).digest("hex"), coverage: packet.coverage, facts: packet.facts,
			...(packet.scope ? { scope: packet.scope } : {}), requested_model: requested, resolved_model: null, latency_ms: 0, questions: [] };
		const serialized = JSON.stringify({ model: requested, state, questions: packet.questions });
		if (ids.length > MAX_QUESTIONS || serialized.length > MAX_REQUEST_CHARS || state.length > MAX_STATE_CHARS) {
			result.questions = ids.map((id) => ({ id, outcome: "abstained", reason: `Packet exceeds Jev request budget (${serialized.length} characters); evidence must not be truncated silently` }));
		} else if (!provider) {
			result.questions = ids.map((id) => ({ id, outcome: "unavailable", reason: "No OpenRouter provider configured" }));
		} else if (provider.name === "openrouter" && requested !== FOUNDATION_MODEL) {
			// Evidence never goes to a model other than the pinned one, such as an OPENROUTER_JEV_MODEL override.
			result.questions = ids.map((id) => ({ id, outcome: "abstained", reason: `Requested model ${requested} is not ${FOUNDATION_MODEL}; packet not sent` }));
		} else {
			const started = performance.now();
			try {
				const call = provider.evaluateWithMetadata ? await provider.evaluateWithMetadata(state, packet.questions, options.timeoutMs ?? 15_000) : { answers: await provider.evaluate(state, packet.questions, options.timeoutMs ?? 15_000), requestedModel: requested, resolvedModel: undefined };
				result.latency_ms = Math.round(performance.now() - started);
				result.resolved_model = call.resolvedModel ?? null;
				result.questions = ids.map((id) => classify(id, packet.questions[id], call.answers[id], packet));
				const approved = (DEFAULT_EXPECTED_RESOLVED_MODELS as readonly string[]).includes(call.resolvedModel ?? "");
				if (provider.name === "heuristic" || provider.name === "openrouter" && (!approved || call.requestedModel !== FOUNDATION_MODEL)) {
					result.questions = result.questions.map((question) => question.outcome === "unavailable" ? question : { ...question, outcome: "abstained", reason: provider.name === "heuristic" ? "Heuristic answers are not calibrated for foundation questions" : "Unexpected or missing resolved/requested model" });
				}
			} catch (error) {
				result.latency_ms = Math.round(performance.now() - started);
				const reason = error instanceof SystemOneProviderError ? `Provider ${error.kind}` : "Provider failed";
				result.questions = ids.map((id) => ({ id, outcome: "unavailable", reason }));
			}
		}
		results.push(result);
	}
	return { schema: FOUNDATION_SCHEMA, repo: options.repo, ref: options.snapshot.ref, commit: options.snapshot.commit,
		provider: provider?.name ?? "none", requested_model: requested, resolved_models: [...new Set(results.map((item) => item.resolved_model).filter((model): model is string => model !== null))], packets: results, unassessed };
}
