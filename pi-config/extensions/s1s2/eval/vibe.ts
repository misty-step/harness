#!/usr/bin/env bun
/**
 * Vibe-check runner for the System 1 / System 2 experiment (US-029, US-030).
 *
 * Replays curated merged pull requests, one run at a time, in these arms:
 *   omp   OMP as deployed, every generative role pinned to one model/setting, no fallback
 *   s1s2  raw Pi plus the s1s2 System 1 extension
 *   pi    raw Pi (control)
 * Every arm gets the same prompt, model, reasoning effort, parity shim, scrubbed
 * environment, and fresh history-truncated checkout at the task's base commit.
 *
 * Isolation: agents run as a separate Unix user (`--agent-user`, via passwordless
 * sudo) whose home holds only that run's checkout. The hidden tests, the full-history
 * source clone, and every other run's output stay in the runner's own home, which
 * the agent user cannot read. After each run the runner copies the work directory
 * back, deletes it from the agent's home, and grades the copy with the pull
 * request's own tests ("hidden tests").
 *
 * Egress: every model call, Jev included, goes through a credential-injecting proxy
 * (`--openrouter-base`, an exe.dev http-proxy integration), so no key is on the VM.
 * The runner locks the agent user's network (an iptables owner match) to loopback,
 * DNS, and that proxy, re-applies the lock at every start, and refuses to run while
 * the agent can reach GitHub or cannot reach the proxy. In the pilot, both arms of
 * one task fetched its merged fix from GitHub.
 *
 * Usage (on the evaluation VM):
 *   bun eval/vibe.ts --manifest m.json --hidden dir --out dir --agent-user evalagent \
 *     --code-root /opt/s1s2-src --arms omp,s1s2 --model openrouter/deepseek/deepseek-v4.1-flash \
 *     --thinking high --max-output 384000 --upstream deepseek \
 *     --openrouter-base https://proxy --spend-limit 20
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";

type Command = { cwd: string; cmd: string };
type Task = { id: string; pr: number; size: string; base: string; merge: string; hidden: string[]; grade: Command[]; regress: Command[]; statement: string };
type Manifest = { repo: string; tasks: Task[] };
type Arm = "omp" | "s1s2" | "pi";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1] ?? "");
const fail = (message: string): never => (console.error(message), process.exit(2));
const need = (name: string) => args.get(name) || fail(`missing --${name}`);
const manifestPath = resolve(need("manifest"));
const hiddenDir = resolve(need("hidden"));
const out = resolve(need("out"));
const agentUser = need("agent-user");
const codeRoot = resolve(need("code-root"));
const only = args.get("only")?.split(",").filter(Boolean);
const arms = (args.get("arms") ?? "omp,s1s2,pi").split(",") as Arm[];
const seed = Number(args.get("seed") ?? 26);
const timeoutMs = Number(args.get("timeout-min") ?? 25) * 60_000;
const modelSpec = need("model");
const provider = modelSpec.slice(0, modelSpec.indexOf("/"));
const modelId = modelSpec.slice(modelSpec.indexOf("/") + 1);
if (provider !== "openrouter") fail("--model must be openrouter/<id>: the egress lock admits only the OpenRouter proxy");
const openrouterBase = need("openrouter-base").replace(/\/$/, "");
const thinking = args.get("thinking") ?? "max";
const verbosity = args.get("verbosity") ?? "";
const maxOutput = args.get("max-output") ?? "";
const spendLimit = Number(args.get("spend-limit") ?? 0);
const PROXY_PLACEHOLDER = "injected-by-exe-proxy";
// One OpenRouter upstream for every arm, fallbacks off (PARITY_UPSTREAM in parity.ts).
const upstream = args.get("upstream") ?? "";

const runner = userInfo().username;
const agentHome = `/home/${agentUser}`;
const piAgentDir = join(agentHome, ".local/state/s1s2-eval/pi-agent");
const s1s2Extension = join(codeRoot, "pi-config/extensions/s1s2/index.ts");
const parityExtension = join(codeRoot, "pi-config/extensions/s1s2/eval/parity.ts");

function sudo(argv: string[]): string {
	// Run from "/" so the agent user never needs access to the runner's working directory.
	const result = spawnSync("sudo", ["-n", ...argv], { cwd: "/", encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
	if (result.status !== 0) throw new Error(`sudo ${argv.join(" ")} failed: ${result.stderr}`);
	return result.stdout;
}
const asAgent = (argv: string[]) => sudo(["-u", agentUser, "-H", ...argv]);
const agentCan = (test: string, path: string) => spawnSync("sudo", ["-n", "-u", agentUser, "test", test, path], { cwd: "/" }).status === 0;

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
const tasks = manifest.tasks.filter((task) => !only || only.includes(task.id));
// Pokayoke: refuse to start unless the agent user demonstrably cannot read the hidden tests.
if (agentCan("-r", join(hiddenDir, manifest.tasks[0].id, manifest.tasks[0].hidden[0]))) fail(`agent user ${agentUser} can read ${hiddenDir}; isolation is not real`);
if (agentCan("-r", manifestPath)) fail(`agent user ${agentUser} can read the manifest; isolation is not real`);
for (const forbidden of ["settings.json", "AGENTS.md", "extensions", "skills", "prompts"]) {
	if (agentCan("-e", join(piAgentDir, forbidden))) fail(`raw Pi agent dir must not contain ${forbidden}`);
}
mkdirSync(join(out, "runs"), { recursive: true });
if (agentCan("-r", out)) fail(`agent user ${agentUser} can read ${out}; isolation is not real`);

function ipv4(host: string): string[] {
	const lines = spawnSync("getent", ["ahostsv4", host], { encoding: "utf8" }).stdout.split("\n");
	const ips = [...new Set(lines.map((line) => line.split(/\s+/)[0]).filter(Boolean))];
	return ips.length > 0 ? ips : fail(`cannot resolve ${host}`);
}

/**
 * Limit the agent user's egress; see "Egress" above. One `iptables-restore` transaction
 * per table replaces the whole chain, so it is never empty or partial, even while
 * another runner's agent is mid-run, and a failed replacement keeps the previous rules.
 */
function lockAgentEgress(): void {
	const uid = spawnSync("id", ["-u", agentUser], { encoding: "utf8" }).stdout.trim() || fail(`no user ${agentUser}`);
	const allow = ipv4(new URL(openrouterBase).hostname).map((ip) => `-d ${ip}/32 -j ACCEPT`);
	const reject = ["-p tcp -j REJECT --reject-with tcp-reset", "-j REJECT"];
	const tables: [string, string[]][] = [
		["iptables", ["-o lo -j ACCEPT", "-p udp --dport 53 -j ACCEPT", "-p tcp --dport 53 -j ACCEPT", ...allow, ...reject]],
		["ip6tables", ["-o lo -j ACCEPT", ...reject]],
	];
	for (const [tool, rules] of tables) {
		const input = `*filter\n:S1S2-AGENT - [0:0]\n${rules.map((rule) => `-A S1S2-AGENT ${rule}\n`).join("")}COMMIT\n`;
		const restore = spawnSync("sudo", ["-n", `${tool}-restore`, "--noflush"], { cwd: "/", input, encoding: "utf8" });
		if (restore.status !== 0) fail(`${tool}-restore failed: ${restore.stderr}`);
		const match = ["-m", "owner", "--uid-owner", uid, "-j", "S1S2-AGENT"];
		if (spawnSync("sudo", ["-n", tool, "-C", "OUTPUT", ...match], { cwd: "/", stdio: "ignore" }).status !== 0) sudo([tool, "-I", "OUTPUT", "1", ...match]);
	}
}

const agentReaches = (url: string) =>
	spawnSync("sudo", ["-n", "-u", agentUser, "curl", "-sS", "-m", "10", "-o", "/dev/null", url], { cwd: "/", stdio: "ignore" }).status === 0;
lockAgentEgress();
for (const url of ["https://github.com", "https://raw.githubusercontent.com"]) {
	if (agentReaches(url)) fail(`agent user ${agentUser} can reach ${url}; the egress lock is not real`);
}
if (!agentReaches(`${openrouterBase}/api/v1/models`)) fail(`agent user ${agentUser} cannot reach ${openrouterBase} under the egress lock`);
// exe.dev integrations share the gateway address the proxy needs, so the lock cannot block a
// GitHub integration attached to this VM; refuse to start if one serves the task repository.
const viaIntegration = manifest.repo.replace(/^https:\/\/github\.com\//, "https://github.int.exe.xyz/");
if (viaIntegration !== manifest.repo && spawnSync("sudo", ["-n", "-u", agentUser, "-H", "git", "ls-remote", viaIntegration], { cwd: "/", stdio: "ignore", timeout: 30_000 }).status === 0) {
	fail(`agent user ${agentUser} can fetch ${manifest.repo} through an exe.dev GitHub integration; detach it from this VM`);
}

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

// OMP overlay: every generative role on the model under test; provider fallback off.
const ompOverlay = join(out, "omp-pinned.yml");
const pinned = `${provider}/${modelId}:${thinking}`;
const roles = ["default", "slow", "extreme", "plan", "advisor", "task", "reviewer", "security-reviewer", "vision", "smol", "tiny", "commit"];
const chains = ["advisor", "default", "vision", "smol", "tiny", "commit"];
writeFileSync(
	ompOverlay,
	`modelRoles:\n${roles.map((role) => `  ${role}: ${pinned}`).join("\n")}\nretry:\n  fallbackChains:\n${chains.map((chain) => `    ${chain}: []`).join("\n")}\n`,
);

// Full-history source clone, readable only by the runner; runs get base-only bundles.
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

/** USD the OpenRouter key has spent so far, read through the proxy; null when unreadable. */
async function keySpend(): Promise<number | null> {
	try {
		const response = await fetch(`${openrouterBase}/api/v1/key`, { signal: AbortSignal.timeout(30_000) });
		const usage = ((await response.json()) as { data?: { usage?: unknown } }).data?.usage;
		return typeof usage === "number" ? usage : null;
	} catch {
		return null;
	}
}

function runAgent(cmd: string, argv: string[], cwd: string, env: Record<string, string>, stdoutPath: string, stderrPath: string) {
	const started = performance.now();
	const { promise, resolve: done } = Promise.withResolvers<{ exit: number | null; signal: string | null; timedOut: boolean; ms: number }>();
	const envPairs = Object.entries(env).map(([key, value]) => `${key}=${value}`);
	const child = spawn("sudo", ["-n", "-u", agentUser, "-H", "env", "-i", ...envPairs, cmd, ...argv], { cwd, stdio: ["ignore", "pipe", "pipe"] });
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
	const failed = [...output.matchAll(/^\s*(\d+) fail$/gm)].reduce((sum, match) => sum + Number(match[1]), 0);
	return { pass, fail: failed };
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

const spendStart = await keySpend();
if (spendLimit > 0 && spendStart === null) fail("cannot read the key's spend through the proxy");
const results: Record<string, unknown>[] = [];
let stopped: string | null = null;
let tasksDone = 0;

outer: for (const task of tasks) {
	const branch = `vibe-base-${task.id}`;
	git(src, "branch", "-f", branch, task.base);
	for (const arm of shuffled(arms)) {
		const spent = spendLimit > 0 ? ((await keySpend()) ?? Number.POSITIVE_INFINITY) - (spendStart ?? 0) : 0;
		if (spendLimit > 0 && spent >= spendLimit) {
			stopped = `spend guard: $${spent.toFixed(4)} spent >= $${spendLimit}`;
			break outer;
		}
		const runDir = join(out, "runs", task.id, arm);
		if (existsSync(join(runDir, "run.json"))) continue; // resumable
		rmSync(runDir, { recursive: true, force: true });
		mkdirSync(join(runDir, "tmp"), { recursive: true });

		// The agent's world: one base-only checkout, shims, and scratch in its own home.
		const work = join(agentHome, "work", `${task.id}-${arm}`);
		asAgent(["rm", "-rf", work]);
		asAgent(["mkdir", "-p", "-m", "750", join(work, "tmp"), join(work, "sessions"), join(work, "s1")]);
		git(src, "bundle", "create", "-q", join(runDir, "base.bundle"), branch);
		for (const [from, to] of [[join(runDir, "base.bundle"), join(work, "base.bundle")], [shims, join(work, "shims")], [ompOverlay, join(work, "omp-pinned.yml")]]) {
			sudo(["cp", "-a", from, to]);
			sudo(["chown", "-R", `${agentUser}:${agentUser}`, to]);
		}
		rmSync(join(runDir, "base.bundle"));
		const tree = join(work, "tree");
		asAgent(["git", "clone", "-q", "-b", branch, join(work, "base.bundle"), tree]);
		asAgent(["git", "-C", tree, "remote", "remove", "origin"]);
		asAgent(["rm", join(work, "base.bundle")]);

		const env: Record<string, string> = {
			HOME: agentHome,
			USER: agentUser,
			LOGNAME: agentUser,
			LANG: "C.UTF-8",
			TERM: "dumb",
			SHELL: "/bin/bash",
			PATH: [join(work, "shims"), "/usr/local/bin", "/usr/bin", "/bin"].join(":"),
			TMPDIR: join(work, "tmp"),
			PARITY_OUT: join(work, "parity.jsonl"),
			...(verbosity ? { PARITY_VERBOSITY: verbosity } : {}),
			...(maxOutput ? { PARITY_MAX_OUTPUT: maxOutput } : {}),
			...(upstream ? { PARITY_UPSTREAM: upstream } : {}),
			// The proxy injects the real key; the harnesses only need a non-empty credential to call it.
			OPENROUTER_API_KEY: PROXY_PLACEHOLDER,
		};
		const prompt = wrapper + task.statement;
		const sessions = join(work, "sessions");
		let cmd: string;
		let argv: string[];
		if (arm === "omp") {
			cmd = "omp";
			argv = ["-p", "--mode", "json", "--cwd", tree, "--session-dir", sessions, "--no-title", "--approval-mode", "yolo", "--config", join(work, "omp-pinned.yml"), "-e", parityExtension, "--model", `${provider}/${modelId}`, "--thinking", thinking, prompt];
		} else {
			cmd = "pi";
			env.PI_CODING_AGENT_DIR = piAgentDir;
			const extensions = arm === "s1s2" ? ["-e", s1s2Extension, "-e", parityExtension] : ["-e", parityExtension];
			if (arm === "s1s2") {
				// The proxy injects the real key; System 1 needs only a non-empty credential and the proxy endpoint.
				env.S1S2_JEV_KEY = PROXY_PLACEHOLDER;
				env.S1S2_RUN_DIR = join(work, "s1");
				env.S1S2_JEV_ENDPOINT = `${openrouterBase}/api/alpha/decisions`;
			}
			argv = ["--mode", "json", "--no-extensions", ...extensions, "--no-skills", "--no-prompt-templates", "--provider", provider, "--model", modelId, "--thinking", thinking, "--session-dir", sessions, "-p", prompt];
		}
		console.log(`${new Date().toISOString()} ${task.id} ${arm} start`);
		const run = await runAgent(cmd, argv, tree, env, join(runDir, "events.jsonl"), join(runDir, "stderr.log"));

		// Bring the work back into the runner's home, then erase it from the agent's.
		const copy = join(runDir, "work");
		sudo(["cp", "-a", work, copy]);
		sudo(["chown", "-R", `${runner}:${runner}`, copy]);
		asAgent(["rm", "-rf", work]);
		const deliverable = finalDiff(join(copy, "tree"), runDir);
		writeFileSync(join(runDir, "final.diff"), deliverable.diff);
		const accounting = sessionUsage(join(copy, "sessions"));
		const graded = grade(join(copy, "tree"), task, { HOME: process.env.HOME ?? "", PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8", TMPDIR: join(runDir, "tmp") });
		let s1: unknown = null;
		try {
			s1 = JSON.parse(readFileSync(join(copy, "s1", "s1s2-summary.json"), "utf8"));
		} catch {
			// not the s1s2 arm, or the run died before shutdown
		}
		let parity: unknown = null;
		try {
			parity = JSON.parse(readFileSync(join(copy, "parity.jsonl"), "utf8").split("\n")[0]);
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
	tasksDone++;
	if (spendLimit > 0 && tasksDone < tasks.length) {
		const spent = ((await keySpend()) ?? Number.POSITIVE_INFINITY) - (spendStart ?? 0);
		const projected = (spent / tasksDone) * tasks.length;
		console.log(`${new Date().toISOString()} spend so far $${spent.toFixed(4)}, projected $${projected.toFixed(2)}`);
		if (projected > spendLimit) {
			stopped = `spend projection: $${projected.toFixed(2)} for ${tasks.length} tasks exceeds $${spendLimit}`;
			break;
		}
	}
}

const spendEnd = await keySpend();
writeFileSync(
	join(out, "vibe.json"),
	`${JSON.stringify({ version: 1, model: `${provider}/${modelId}`, thinking, upstream, seed, arms, agentUser, spendStart, spendEnd, stopped, results }, null, 2)}\n`,
);
console.log(stopped ?? "complete");
