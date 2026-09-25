#!/usr/bin/env bun
/**
 * Vibe-check runner for the System 1 / System 2 experiment (US-029).
 *
 * Replays curated merged pull requests in three arms, one run at a time:
 *   omp   OMP as deployed, every generative role pinned to one model/setting, no fallback
 *   s1s2  raw Pi plus the s1s2 System 1 extension
 *   pi    raw Pi (control)
 * Every arm gets the same prompt, model, reasoning effort, parity shim, scrubbed
 * environment, and fresh history-truncated checkout at the task's base commit.
 * After each run the pull request's own tests ("hidden tests") are applied and run.
 *
 * Usage (from the repository root; OPENROUTER_API_KEY is only for Jev):
 *   pass-env run -f .env.pass -- bun pi-config/extensions/s1s2/eval/vibe.ts \
 *     --manifest m.json --hidden dir --out dir [--only h21,h26] [--seed 26]
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

type Command = { cwd: string; cmd: string };
type Task = { id: string; pr: number; size: string; base: string; merge: string; hidden: string[]; grade: Command[]; regress: Command[]; statement: string };
type Manifest = { repo: string; tasks: Task[] };
type Arm = "omp" | "s1s2" | "pi";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1] ?? "");
const need = (name: string) => args.get(name) || (console.error(`missing --${name}`), process.exit(2));
const manifestPath = resolve(need("manifest"));
const hiddenDir = resolve(need("hidden"));
const out = resolve(need("out"));
const only = args.get("only")?.split(",").filter(Boolean);
const arms = (args.get("arms") ?? "omp,s1s2,pi").split(",") as Arm[];
const seed = Number(args.get("seed") ?? 26);
const timeoutMs = Number(args.get("timeout-min") ?? 25) * 60_000;
const [provider, modelId] = (args.get("model") ?? "openai-codex/gpt-6-luna").split("/", 2);
const thinking = args.get("thinking") ?? "max";
const quotaEmail = args.get("quota-email") ?? "";
const quotaMax = Number(args.get("quota-max") ?? 0.95);

const here = dirname(new URL(import.meta.url).pathname);
const s1s2Extension = resolve(here, "..", "index.ts");
const parityExtension = resolve(here, "parity.ts");
const piAgentDir = args.get("pi-agent-dir") ?? join(homedir(), ".local/state/s1s2-eval/pi-agent");
const jevKey = process.env.OPENROUTER_API_KEY ?? "";
if (arms.includes("s1s2") && !jevKey) (console.error("OPENROUTER_API_KEY is required for the s1s2 arm (Jev)"), process.exit(2));
for (const forbidden of ["settings.json", "AGENTS.md", "extensions", "skills", "prompts"]) {
	if (existsSync(join(piAgentDir, forbidden))) (console.error(`raw Pi agent dir must not contain ${forbidden}`), process.exit(2));
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
const tasks = manifest.tasks.filter((task) => !only || only.includes(task.id));
mkdirSync(join(out, "runs"), { recursive: true });

function git(cwd: string, ...argv: string[]): string {
	const result = spawnSync("git", argv, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
	if (result.status !== 0) throw new Error(`git ${argv.join(" ")} failed in ${cwd}: ${result.stderr}`);
	return result.stdout;
}

// Tools that reach other systems are disabled identically in every arm.
const shims = join(out, "shims");
mkdirSync(shims, { recursive: true });
for (const tool of ["ssh", "scp", "sftp", "gh", "pass", "pass-env", "linear", "wrangler"]) {
	writeFileSync(join(shims, tool), `#!/bin/sh\necho "${tool} is disabled in this evaluation" >&2\nexit 126\n`, { mode: 0o755 });
}
const nodeBin = dirname(spawnSync("sh", ["-c", "command -v node"], { encoding: "utf8" }).stdout.trim());
const PATH = [shims, join(homedir(), ".local/bin"), nodeBin, "/usr/local/bin", "/usr/bin", "/bin"].join(":");

// OMP overlay: every generative role on the model under test; provider fallback off.
const ompOverlay = join(out, "omp-pinned.yml");
const pinned = `${provider}/${modelId}:${thinking}`;
const roles = ["default", "slow", "extreme", "plan", "advisor", "task", "reviewer", "security-reviewer", "vision", "smol", "tiny", "commit"];
const chains = ["advisor", "default", "vision", "smol", "tiny", "commit"];
writeFileSync(
	ompOverlay,
	`modelRoles:\n${roles.map((role) => `  ${role}: ${pinned}`).join("\n")}\nretry:\n  fallbackChains:\n${chains.map((chain) => `    ${chain}: []`).join("\n")}\n`,
);

// Source clone with no remote; each run clones only the history up to its base.
const src = join(out, "src");
if (!existsSync(src)) {
	git(out, "clone", "-q", manifest.repo, src);
	git(src, "remote", "remove", "origin");
}

function mulberry32(value: number): () => number {
	let state = value >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const random = mulberry32(seed);
function shuffled<T>(items: readonly T[]): T[] {
	const copy = [...items];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
}

function quotaUsed(): number | null {
	if (!quotaEmail) return null;
	const result = spawnSync("omp", ["usage", "--json", "-p", provider], { encoding: "utf8", cwd: out, timeout: 60_000 });
	try {
		const reports = (JSON.parse(result.stdout) as { reports: { metadata?: { email?: string }; limits: { label: string; amount: { usedFraction: number } }[] }[] }).reports;
		const report = reports.find((entry) => entry.metadata?.email === quotaEmail);
		return report?.limits.find((limit) => limit.label === "7 days")?.amount.usedFraction ?? null;
	} catch {
		return null;
	}
}

function runProcess(cmd: string, argv: string[], cwd: string, env: Record<string, string>, stdoutPath: string, stderrPath: string) {
	const started = performance.now();
	const { promise, resolve: done } = Promise.withResolvers<{ exit: number | null; signal: string | null; timedOut: boolean; ms: number }>();
	const child = spawn(cmd, argv, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
	const stdout: Buffer[] = [];
	const stderr: Buffer[] = [];
	child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
	child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		child.kill("SIGTERM");
		setTimeout(() => child.kill("SIGKILL"), 10_000);
	}, timeoutMs);
	child.on("close", (exit, signal) => {
		clearTimeout(timer);
		writeFileSync(stdoutPath, Buffer.concat(stdout));
		writeFileSync(stderrPath, Buffer.concat(stderr));
		done({ exit, signal, timedOut, ms: Math.round(performance.now() - started) });
	});
	return promise;
}

function finalDiff(tree: string, runDir: string): { diff: string; files: number; added: number; deleted: number } {
	const env = { ...process.env, GIT_INDEX_FILE: join(runDir, "git-index") };
	const gitIndexed = (...argv: string[]) => spawnSync("git", argv, { cwd: tree, env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).stdout;
	gitIndexed("read-tree", "HEAD");
	gitIndexed("add", "-A");
	const diff = gitIndexed("diff", "--cached", "--binary", "HEAD");
	let files = 0;
	let added = 0;
	let deleted = 0;
	for (const line of gitIndexed("diff", "--cached", "--numstat", "HEAD").split("\n").filter(Boolean)) {
		const [a, d] = line.split("\t");
		files++;
		added += Number(a) || 0;
		deleted += Number(d) || 0;
	}
	rmSync(join(runDir, "git-index"), { force: true });
	return { diff, files, added, deleted };
}

type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };
function sessionUsage(dir: string): { usage: Usage; modelCalls: number; parentTurns: number; models: string[] } {
	const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	const models = new Set<string>();
	let modelCalls = 0;
	let parentTurns = 0;
	const walk = (path: string, depth: number) => {
		for (const name of readdirSync(path)) {
			const full = join(path, name);
			if (statSync(full).isDirectory()) walk(full, depth + 1);
			else if (name.endsWith(".jsonl")) {
				const parent = depth <= 1 && !name.startsWith("__");
				for (const line of readFileSync(full, "utf8").split("\n")) {
					if (!line.trim()) continue;
					let entry: Record<string, any>;
					try {
						entry = JSON.parse(line);
					} catch {
						continue;
					}
					const message = entry.type === "message" ? entry.message : null;
					const record = message?.role === "assistant" && message.usage ? message : entry.type === "model_usage" ? entry : null;
					if (!record?.usage) continue;
					modelCalls++;
					if (message && parent) parentTurns++;
					if (record.model) models.add(`${record.provider ?? "?"}/${record.model}`);
					for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) usage[key] += Number(record.usage[key]) || 0;
				}
			}
		}
	};
	if (existsSync(dir)) walk(dir, 0);
	return { usage, modelCalls, parentTurns, models: [...models].sort() };
}

function testCounts(output: string): { pass: number; fail: number } {
	const pass = [...output.matchAll(/^\s*(\d+) pass$/gm)].reduce((sum, match) => sum + Number(match[1]), 0);
	const fail = [...output.matchAll(/^\s*(\d+) fail$/gm)].reduce((sum, match) => sum + Number(match[1]), 0);
	return { pass, fail };
}

function grade(tree: string, task: Task, env: Record<string, string>) {
	for (const file of task.hidden) {
		mkdirSync(dirname(join(tree, file)), { recursive: true });
		cpSync(join(hiddenDir, task.id, file), join(tree, file));
	}
	const runAll = (commands: Command[]) =>
		commands.map((command) => {
			const result = spawnSync("bash", ["-c", command.cmd], { cwd: join(tree, command.cwd), env, encoding: "utf8", timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
			const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
			return { ...command, exit: result.status, ...testCounts(output) };
		});
	const hidden = runAll(task.grade);
	const regress = runAll(task.regress);
	return { hidden, regress, hiddenPass: hidden.every((entry) => entry.exit === 0), regressPass: regress.every((entry) => entry.exit === 0) };
}

const wrapper =
	"You are working in a Git repository (the current directory). Complete the task below without asking questions. " +
	"Leave your changes in the working tree; do not commit, push, or open pull requests. When you finish, reply with a short summary of what you changed and how you verified it.\n\nTask:\n";

const quotaStart = quotaUsed();
const results: Record<string, unknown>[] = [];
let stopped: string | null = null;

outer: for (const task of tasks) {
	const branch = `vibe-base-${task.id}`;
	git(src, "branch", "-f", branch, task.base);
	for (const arm of shuffled(arms)) {
		const used = quotaUsed();
		if (used !== null && used >= quotaMax) {
			stopped = `quota guard: ${quotaEmail} 7-day usage ${used} >= ${quotaMax}`;
			break outer;
		}
		const runDir = join(out, "runs", task.id, arm);
		if (existsSync(join(runDir, "run.json"))) continue; // resumable
		rmSync(runDir, { recursive: true, force: true });
		const tree = join(runDir, "tree");
		mkdirSync(join(runDir, "tmp"), { recursive: true });
		git(out, "clone", "-q", "--no-local", "--single-branch", "--branch", branch, src, tree);
		git(tree, "remote", "remove", "origin");
		const env: Record<string, string> = {
			HOME: homedir(),
			USER: process.env.USER ?? "",
			LOGNAME: process.env.USER ?? "",
			LANG: "C.UTF-8",
			TERM: "dumb",
			SHELL: "/bin/bash",
			PATH,
			TMPDIR: join(runDir, "tmp"),
			PARITY_OUT: join(runDir, "parity.jsonl"),
		};
		const prompt = wrapper + task.statement;
		const sessions = join(runDir, "sessions");
		let cmd: string;
		let argv: string[];
		if (arm === "omp") {
			cmd = "omp";
			argv = ["-p", "--mode", "json", "--cwd", tree, "--session-dir", sessions, "--no-title", "--approval-mode", "yolo", "--config", ompOverlay, "-e", parityExtension, "--model", `${provider}/${modelId}`, "--thinking", thinking, prompt];
		} else {
			cmd = "pi";
			env.PI_CODING_AGENT_DIR = piAgentDir;
			const extensions = arm === "s1s2" ? ["-e", s1s2Extension, "-e", parityExtension] : ["-e", parityExtension];
			if (arm === "s1s2") {
				env.OPENROUTER_API_KEY = jevKey;
				env.S1S2_RUN_DIR = join(runDir, "s1");
			}
			argv = ["--mode", "json", "--no-extensions", ...extensions, "--no-skills", "--no-prompt-templates", "--provider", provider, "--model", modelId, "--thinking", thinking, "--session-dir", sessions, "-p", prompt];
		}
		console.log(`${new Date().toISOString()} ${task.id} ${arm} start`);
		const run = await runProcess(cmd, argv, tree, env, join(runDir, "events.jsonl"), join(runDir, "stderr.log"));
		const deliverable = finalDiff(tree, runDir);
		writeFileSync(join(runDir, "final.diff"), deliverable.diff);
		const accounting = sessionUsage(sessions);
		// Grade in the same environment the curator validated the hidden tests in: no shims, no keys.
		const graded = grade(tree, task, { ...env, PATH: PATH.slice(shims.length + 1), OPENROUTER_API_KEY: "", PARITY_OUT: "" });
		let s1: unknown = null;
		try {
			s1 = JSON.parse(readFileSync(join(runDir, "s1", "s1s2-summary.json"), "utf8"));
		} catch {
			// not the s1s2 arm, or the run died before shutdown
		}
		let parity: unknown = null;
		try {
			parity = JSON.parse(readFileSync(join(runDir, "parity.jsonl"), "utf8").split("\n")[0]);
		} catch {
			// no provider request was made
		}
		const record = {
			task: task.id,
			size: task.size,
			arm,
			exit: run.exit,
			signal: run.signal,
			timedOut: run.timedOut,
			wallMs: run.ms,
			...accounting,
			s1,
			parity,
			deliverable: { files: deliverable.files, added: deliverable.added, deleted: deliverable.deleted },
			...graded,
		};
		writeFileSync(join(runDir, "run.json"), `${JSON.stringify(record, null, 2)}\n`);
		results.push(record);
		console.log(`${new Date().toISOString()} ${task.id} ${arm} exit=${run.exit} wall=${Math.round(run.ms / 1000)}s hidden=${graded.hiddenPass} turns=${accounting.parentTurns}`);
	}
}

const quotaEnd = quotaUsed();
writeFileSync(
	join(out, "vibe.json"),
	`${JSON.stringify({ version: 1, model: `${provider}/${modelId}`, thinking, seed, quotaEmail, quotaStart, quotaEnd, stopped, results }, null, 2)}\n`,
);
console.log(stopped ?? "complete");
