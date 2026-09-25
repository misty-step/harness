/**
 * Deterministic System 1 sensors: everything System 1 knows before Jev judges.
 * Code builds candidates here (files, output chunks, checks, ledger facts);
 * Jev only scores or selects among them (questions.ts).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

const MAX_BUFFER = 32 * 1024 * 1024;

/** stdout of a successful command, or null. `git grep` exits 1 for "no match", which is an empty result. */
function run(cwd: string, cmd: string, args: string[], timeoutMs = 10_000): string | null {
	const result = spawnSync(cmd, args, {
		cwd,
		encoding: "utf8",
		timeout: timeoutMs,
		maxBuffer: MAX_BUFFER,
		stdio: ["ignore", "pipe", "ignore"],
	});
	if (result.status === 0) return result.stdout;
	if (result.status === 1 && cmd === "git" && args[0] === "grep") return "";
	return null;
}

function readJson(path: string): Record<string, unknown> | null {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	} catch {
		return null;
	}
}

const STOPWORDS: Record<string, true> = Object.fromEntries(
	"should would could about after before where which while there their these those other without within between because instead already exactly behavior behaviour change changes changed ensure against during through keeps making remain return returns"
		.split(" ")
		.map((word) => [word, true]),
);

/** Specific search terms from a task statement: code spans, paths, identifiers, flags; plain words only as a last resort. */
export function extractTerms(prompt: string, max = 12): string[] {
	const found: string[] = [];
	const add = (raw: string) => {
		const term = raw.trim().replace(/^[\s"'(]+|[\s"'),.;:!?]+$/g, "");
		if (term.length < 3 || term.length > 80 || /\s/.test(term)) return;
		if (!found.some((seen) => seen.toLowerCase() === term.toLowerCase())) found.push(term);
	};
	for (const match of prompt.matchAll(/`([^`\n]{2,120})`/g)) {
		add(match[1]);
		for (const token of match[1].split(/\s+/)) add(token);
	}
	for (const match of prompt.matchAll(
		/(?:[\w.-]+\/)+[\w.-]+|\b[\w-]+\.(?:ts|tsx|js|mjs|cjs|jsx|rs|go|py|rb|json|ya?ml|toml|md|sh|sql|css|html)\b/g,
	)) {
		add(match[0]);
	}
	for (const match of prompt.matchAll(
		/--[a-z][\w-]+|\b[a-z]+(?:[A-Z][a-z0-9]*)+\b|\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+\b|\b[a-z0-9]+(?:_[a-z0-9]+)+\b|\b[a-z0-9]+(?:-[a-z0-9]+)+\b/g,
	)) {
		add(match[0]);
	}
	if (found.length < 4) {
		for (const match of prompt.matchAll(/\b[a-zA-Z]{6,}\b/g)) {
			if (!STOPWORDS[match[0].toLowerCase()]) add(match[0]);
		}
	}
	return found.slice(0, max);
}

const NOISE =
	/(^|\/)(node_modules|dist|build|vendor|target|coverage|\.next)\/|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum|CHANGELOG\.md)$|\.min\.(js|css)$|\.(png|jpe?g|gif|svg|ico|pdf|woff2?|ttf|lock|snap)$/;

export type Candidate = { path: string; terms: string[]; hits: string[]; prior: number };

/**
 * Tracked files that mention the task's terms, ranked by a deterministic prior
 * (distinct terms, filename matches, hit count). Terms matching a large share of
 * the repository carry no signal and are ignored.
 */
export function findCandidates(cwd: string, terms: string[], max = 30): Candidate[] {
	const listed = run(cwd, "git", ["ls-files", "-z"]);
	if (listed === null) return [];
	const files = listed.split("\0").filter((file) => file && !NOISE.test(file));
	if (files.length === 0) return [];
	const tracked = new Set(files);
	const generic = Math.max(25, Math.floor(files.length * 0.15));
	const stats = new Map<string, { terms: Set<string>; count: number; nameHits: number }>();
	const entry = (file: string) => {
		let found = stats.get(file);
		if (!found) stats.set(file, (found = { terms: new Set(), count: 0, nameHits: 0 }));
		return found;
	};
	for (const term of terms) {
		const lower = term.toLowerCase();
		const named = files.filter((file) => file.toLowerCase().includes(lower));
		if (named.length <= generic) {
			for (const file of named) {
				const found = entry(file);
				found.nameHits++;
				found.terms.add(term);
			}
		}
		const counts = run(cwd, "git", ["grep", "-c", "-I", "-i", "-F", "-e", term]);
		if (!counts) continue;
		const rows = counts
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				const at = line.lastIndexOf(":");
				return { file: line.slice(0, at), count: Number(line.slice(at + 1)) };
			})
			.filter((row) => tracked.has(row.file));
		if (rows.length > generic) continue;
		for (const row of rows) {
			const found = entry(row.file);
			found.terms.add(term);
			found.count += row.count;
		}
	}
	const ranked: Candidate[] = [...stats]
		.map(([path, found]) => ({
			path,
			terms: [...found.terms],
			hits: [],
			prior: found.terms.size * 3 + found.nameHits * 4 + Math.log1p(found.count),
		}))
		.sort((a, b) => b.prior - a.prior || a.path.localeCompare(b.path))
		.slice(0, max);
	for (const candidate of ranked) {
		const args = ["grep", "-n", "-I", "-i", "-F"];
		for (const term of candidate.terms) args.push("-e", term);
		const out = run(cwd, "git", [...args, "--", candidate.path]) ?? "";
		candidate.hits = out
			.split("\n")
			.filter(Boolean)
			.slice(0, 3)
			.map((line) => `L${line.slice(candidate.path.length + 1).replace(/^(\d+):\s*/, "$1: ").slice(0, 160)}`);
	}
	return ranked;
}

// --------------------------------------------------------------- checks --

export type CheckCandidate = { command: string; why: string };

const CHECK_SCRIPT = /^(test|tests|check|checks|typecheck|type-check|lint|verify|ci)(:[\w:.-]+)?$/;
const UNSAFE_SCRIPT = /--fix\b|--write\b|\bdeploy|\bpublish|\brelease\b|\bmigrat|\bseed\b|\bwatch\b|\bdev\b|\bserve\b|\bstart\b|\bpush\b/i;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

function packageManager(dir: string): string {
	if (existsSync(join(dir, "bun.lock")) || existsSync(join(dir, "bun.lockb"))) return "bun";
	if (existsSync(join(dir, "pnpm-lock.yaml"))) return "pnpm";
	if (existsSync(join(dir, "yarn.lock"))) return "yarn";
	return "npm";
}

function siblingTests(cwd: string, file: string): string[] {
	if (TEST_FILE.test(file)) return existsSync(join(cwd, file)) ? [file] : [];
	const ext = extname(file);
	if (!/^\.[cm]?[jt]sx?$/.test(ext)) return [];
	const dir = dirname(file);
	const name = basename(file, ext);
	return [
		`${dir}/${name}.test${ext}`,
		`${dir}/${name}.spec${ext}`,
		`${dir}/__tests__/${name}.test${ext}`,
		`${dir}/tests/${name}.test${ext}`,
	]
		.map((path) => path.replace(/^\.\//, ""))
		.filter((path) => existsSync(join(cwd, path)));
}

function testCommand(cwd: string, testFile: string, pm: string, pkg: Record<string, unknown> | null): string | null {
	let head = "";
	try {
		head = readFileSync(join(cwd, testFile), "utf8").slice(0, 4000);
	} catch {
		return null;
	}
	const deps = { ...(pkg?.dependencies as object), ...(pkg?.devDependencies as object) } as Record<string, unknown>;
	const exec = pm === "npm" ? "npx" : pm === "yarn" ? "yarn" : `${pm} exec`;
	if (head.includes('"bun:test"') || head.includes("'bun:test'")) return `bun test ./${testFile}`;
	if (head.includes("vitest") || "vitest" in deps) return `${exec} vitest run ${testFile}`;
	if ("jest" in deps) return `${exec} jest ${testFile}`;
	return null;
}

/**
 * Side-effect-free verification commands this repository declares, most specific
 * first: tests beside changed files, then declared check scripts, then repo-wide
 * suites. Scripts that fix, write, deploy, publish, migrate, or serve are excluded.
 */
export function discoverChecks(cwd: string, changed: string[], max = 8): CheckCandidate[] {
	const found: CheckCandidate[] = [];
	const add = (command: string, why: string) => {
		if (found.length < max && !found.some((check) => check.command === command)) found.push({ command, why });
	};
	const rootPkg = readJson(join(cwd, "package.json"));
	const rootPm = packageManager(cwd);
	for (const file of changed) {
		for (const test of siblingTests(cwd, file)) {
			const command = testCommand(cwd, test, rootPm, rootPkg);
			if (command) add(command, `tests for ${file}`);
		}
	}
	const pkgDirs = new Set<string>(["."]);
	for (const file of changed) {
		for (let dir = dirname(file); dir !== "." && dir !== "/"; dir = dirname(dir)) {
			if (existsSync(join(cwd, dir, "package.json"))) {
				pkgDirs.add(dir);
				break;
			}
		}
	}
	for (const dir of pkgDirs) {
		const pkg = dir === "." ? rootPkg : readJson(join(cwd, dir, "package.json"));
		const scripts = (pkg?.scripts ?? {}) as Record<string, unknown>;
		const pm = packageManager(join(cwd, dir));
		for (const [name, body] of Object.entries(scripts)) {
			if (!CHECK_SCRIPT.test(name) || typeof body !== "string" || UNSAFE_SCRIPT.test(body)) continue;
			add(dir === "." ? `${pm} run ${name}` : `cd ${dir} && ${pm} run ${name}`, `declared script "${name}"`);
		}
	}
	if (existsSync(join(cwd, "Cargo.toml"))) add("cargo test", "Rust tests");
	if (existsSync(join(cwd, "go.mod"))) {
		for (const dir of new Set(changed.filter((file) => file.endsWith(".go")).map(dirname))) {
			add(`go test ./${dir === "." ? "" : `${dir}/`}...`, `Go tests for ${dir}`);
		}
		add("go test ./...", "Go tests");
	}
	if (["pyproject.toml", "pytest.ini", "setup.cfg"].some((file) => existsSync(join(cwd, file)))) {
		add("python -m pytest -q", "Python tests");
	}
	for (const script of ["scripts/verify", "scripts/check", "scripts/test", "bin/gate", "bin/check"]) {
		try {
			if (statSync(join(cwd, script)).mode & 0o111) add(`./${script}`, "repository check script");
		} catch {
			// absent
		}
	}
	try {
		const makefile = readFileSync(join(cwd, "Makefile"), "utf8");
		for (const target of ["test", "check"]) if (new RegExp(`^${target}:`, "m").test(makefile)) add(`make ${target}`, "Makefile target");
	} catch {
		// no Makefile
	}
	return found;
}

// ------------------------------------------------------------ worktree --

/** Paths with Git-visible changes, including untracked files. */
export function changedFiles(cwd: string): string[] {
	const out = run(cwd, "git", ["status", "--porcelain=v1", "-z", "-uall"]);
	if (!out) return [];
	const fields = out.split("\0");
	const files: string[] = [];
	for (let i = 0; i < fields.length; i++) {
		const record = fields[i];
		if (record.length < 4) continue;
		files.push(record.slice(3));
		if (record[0] === "R" || record[0] === "C") i++; // skip the rename source
	}
	return files;
}

/** Hash of every Git-visible change, so "a check passed on these exact changes" is decidable. */
export function diffFingerprint(cwd: string): string | null {
	const diff = run(cwd, "git", ["diff", "HEAD", "--binary"]);
	const untracked = run(cwd, "git", ["ls-files", "--others", "--exclude-standard", "-z"]);
	if (diff === null || untracked === null) return null;
	const hash = createHash("sha1").update(diff);
	for (const file of untracked.split("\0").filter(Boolean).sort()) {
		hash.update(`\0${file}\0`);
		try {
			if (statSync(join(cwd, file)).size <= 2_000_000) hash.update(readFileSync(join(cwd, file)));
		} catch {
			// vanished between listing and hashing
		}
	}
	return hash.digest("hex");
}

export function diffStat(cwd: string): string {
	const stat = run(cwd, "git", ["diff", "HEAD", "--stat=120"]) ?? "";
	const untracked = (run(cwd, "git", ["ls-files", "--others", "--exclude-standard"]) ?? "").trim();
	return `${stat.trim()}${untracked ? `\nuntracked:\n${untracked}` : ""}`.slice(0, 2000);
}

// --------------------------------------------------------------- triage --

/** Lines that must never be elided: they carry failures, errors, or assertion details. */
export const SIGNAL_LINE =
	/\b(error|errors|fail|failed|failing|failure|failures|panic|panicked|exception|traceback|assert\w*|expected|received|fatal|denied|not ok|cannot|unable|mismatch|exited with code)\b|✗|✘|FAIL|ERR!/i;

export type Chunk = { id: string; start: number; end: number; text: string };
export type TriagePlan = { lines: string[]; forced: boolean[]; chunks: Chunk[] };

export const TRIAGE_LIMITS = { minChars: 8000, minLines: 120, head: 8, tail: 30, context: 2, chunkLines: 25, chunkChars: 1500 };

/**
 * Split long output into lines that are always kept (head, tail, signal lines
 * with context) and chunks Jev may judge. Returns null when output is too short
 * to be worth triaging or nothing is left to judge.
 */
export function planTriage(text: string, limits = TRIAGE_LIMITS): TriagePlan | null {
	const lines = text.split("\n");
	if (text.length < limits.minChars || lines.length < limits.minLines) return null;
	const forced = lines.map((_, i) => i < limits.head || i >= lines.length - limits.tail);
	lines.forEach((line, i) => {
		if (!SIGNAL_LINE.test(line)) return;
		for (let j = Math.max(0, i - limits.context); j <= Math.min(lines.length - 1, i + limits.context); j++) forced[j] = true;
	});
	const chunks: Chunk[] = [];
	for (let i = 0; i < lines.length; ) {
		if (forced[i]) {
			i++;
			continue;
		}
		const start = i;
		while (i < lines.length && !forced[i] && i - start < limits.chunkLines) i++;
		chunks.push({ id: `k${chunks.length}`, start, end: i, text: lines.slice(start, i).join("\n").slice(0, limits.chunkChars) });
	}
	return chunks.length > 0 ? { lines, forced, chunks } : null;
}

/** Render kept lines in order; every elided run is marked with its line range and the full-output path. */
export function renderTriage(plan: TriagePlan, keep: ReadonlySet<string>, fullOutputPath: string): { text: string; shown: number } {
	const show = [...plan.forced];
	for (const chunk of plan.chunks) {
		if (keep.has(chunk.id)) for (let j = chunk.start; j < chunk.end; j++) show[j] = true;
	}
	const out: string[] = [];
	let shown = 0;
	let gapStart = -1;
	for (let j = 0; j <= plan.lines.length; j++) {
		if (j < plan.lines.length && !show[j]) {
			if (gapStart < 0) gapStart = j;
			continue;
		}
		if (gapStart >= 0) {
			out.push(`[… S1 elided lines ${gapStart + 1}–${j} (${j - gapStart} lines); full output: ${fullOutputPath}]`);
			gapStart = -1;
		}
		if (j < plan.lines.length) {
			out.push(plan.lines[j]);
			shown++;
		}
	}
	out.push(`[S1 triage: showing ${shown} of ${plan.lines.length} lines; the full output is saved at ${fullOutputPath}]`);
	return { text: out.join("\n"), shown };
}

// --------------------------------------------------------------- ledger --

export type ActionKind = "edit" | "check" | "explore" | "other";
export type Action = { turn: number; sig: string; summary: string; ok: boolean; kind: ActionKind };

/** A segment that invokes a known test or check runner as its command, not one that merely mentions a word. */
const CHECK_RUNNER =
	/^(?:(?:npx|bunx|pnpm exec|pnpm dlx|yarn dlx)\s+)?(?:bun test|vitest|jest|mocha|pytest|python3? -m pytest|tsc|eslint|oxlint|ruff|mypy|cargo (?:test|check|clippy|nextest)|go (?:test|vet)|deno test|make (?:test|check)|(?:\.\/)?scripts\/(?:verify|check|test)|(?:\.\/)?bin\/(?:gate|check)|(?:npm|pnpm|yarn|bun) (?:run )?(?:test|tests|check|checks|typecheck|type-check|lint|verify|ci)(?::[\w:.-]+)?)(?:\s|$)/;
const EXPLORE_COMMAND = /^\s*(rg|grep|git (grep|log|show|diff|status|blame)|find|ls|cat|head|tail|sed -n|wc|tree|fd)\b/;

/**
 * True only when the command's exit status is the verdict of a check: every
 * `&&` segment is a `cd`, or a discovered check or known runner (after env
 * assignments and `timeout`). Pipes, `;`, `||`, and backgrounding make the
 * status belong to something else, so they never count.
 */
function isVerifyingCommand(command: string, checks: readonly CheckCandidate[]): boolean {
	const unredirected = command.replace(/\d?>&\d/g, "");
	if (/[|;&\n]/.test(unredirected.replaceAll("&&", ""))) return false;
	let verifies = false;
	for (const raw of unredirected.split("&&")) {
		const segment = raw.trim().replace(/^(?:\w+=\S*\s+)*(?:timeout\s+\d+[smh]?\s+)?/, "");
		if (/^cd\s+\S+$/.test(segment)) continue;
		if (!checks.some((check) => segment === check.command) && !CHECK_RUNNER.test(segment)) return false;
		verifies = true;
	}
	return verifies;
}

/** Normalized identity, readable summary, and kind of one tool call. */
export function describeAction(tool: string, input: unknown, checks: readonly CheckCandidate[]): Omit<Action, "turn" | "ok"> {
	const fields = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
	const field = (key: string) => (typeof fields[key] === "string" ? (fields[key] as string) : "");
	const sig = createHash("sha1").update(tool).update(JSON.stringify(fields)).digest("hex").slice(0, 12);
	if (tool === "bash") {
		const command = field("command").replace(/\s+/g, " ").trim();
		const kind = isVerifyingCommand(command, checks) ? "check" : EXPLORE_COMMAND.test(command) ? "explore" : "other";
		return { sig, summary: `bash: ${command.slice(0, 160)}`, kind };
	}
	if (tool === "edit" || tool === "write") return { sig, summary: `${tool}: ${field("path")}`, kind: "edit" };
	if (["read", "grep", "find", "ls"].includes(tool)) {
		const offset = typeof fields.offset === "number" ? ` @${fields.offset}` : "";
		return { sig, summary: `${tool}: ${field("path") || field("pattern")}${offset}`, kind: "explore" };
	}
	return { sig, summary: tool, kind: "other" };
}

export type MonitorFacts = { repeatedFailures: number; errorStreak: number; turnsSinceEdit: number };

export function monitorFacts(actions: readonly Action[], turn: number): MonitorFacts {
	const failures = new Map<string, number>();
	for (const action of actions.slice(-8)) if (!action.ok) failures.set(action.sig, (failures.get(action.sig) ?? 0) + 1);
	let errorStreak = 0;
	for (let i = actions.length - 1; i >= 0 && !actions[i].ok; i--) errorStreak++;
	const lastEdit = actions.findLast((action) => action.kind === "edit");
	return { repeatedFailures: Math.max(0, ...failures.values()), errorStreak, turnsSinceEdit: turn - (lastEdit?.turn ?? 0) };
}
