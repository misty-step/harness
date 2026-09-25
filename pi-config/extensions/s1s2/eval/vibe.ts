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
 * Egress: the agent user may connect only to a model boundary on loopback and to
 * ephemeral loopback ports for its own test servers (an iptables owner match,
 * replaced atomically at every start). The boundary admits only the model under
 * test, with the pinned upstream forced on every request, the pinned Jev model,
 * and the model catalog, and forwards them to a credential-injecting proxy
 * (`--openrouter-base`, an exe.dev http-proxy integration). No key is on the VM,
 * and no other model, integration, local service, or host is reachable. The
 * boundary also enforces `--spend-limit` strictly: it admits a call only if the
 * settled cost of earlier calls plus the worst case of every unsettled one fits,
 * and settles each call from OpenRouter's own cost for it (`boundary.jsonl`).
 * The runner refuses to start unless the agent reaches the boundary but not the
 * repository host, GitHub, the exe.dev gateway, an arbitrary address, or any
 * other listening service on the VM, and unless the boundary refuses a foreign
 * model. In the pilot, open egress let both arms of one task fetch its merged
 * fix from GitHub.
 *
 * Usage (on the evaluation VM):
 *   bun eval/vibe.ts --manifest m.json --hidden dir --out dir --agent-user evalagent \
 *     --code-root /opt/s1s2-src --arms pi,s1s2 --model openrouter/deepseek/deepseek-v4.1-flash \
 *     --thinking high --max-output 384000 --upstream deepseek \
 *     --openrouter-base https://proxy --spend-limit 2
 */
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
// One OpenRouter upstream for every arm, fallbacks off (PARITY_UPSTREAM in parity.ts). Required:
// unpinned, OpenRouter sent the pilot's arms to different upstreams at different prices.
const upstream = need("upstream");
const JEV_MODEL = "typesafe/jev-1.13"; // pinned in pi-config/extensions/s1s2/index.ts
const boundary = `http://127.0.0.1:${Number(args.get("boundary-port") ?? 18181)}`;

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

// The model boundary. Harness and Jev calls from the agent arrive here; nothing else leaves the VM.
// It also keeps the spend cap strict: a call is admitted only if the settled cost of earlier calls
// plus the worst case of every unsettled one still fits under --spend-limit, and a call settles
// when OpenRouter reports its cost. A worst case that never settles stays counted.
const MODEL_PATHS = new Set(["/api/v1/chat/completions", "/api/v1/responses"]);
const JEV_PATH = "/api/alpha/decisions";
/** OpenRouter refusals issued before a request is routed to a provider; every other failure keeps its worst case. */
const PRE_GENERATION = new Set([400, 401, 402, 403, 404, 413, 422, 429]);
type Rates = Record<string, unknown>;
type Endpoint = { tag?: string; max_completion_tokens?: number | null; context_length?: number; pricing?: Rates & { overrides?: Rates[] } };

/**
 * Worst-case USD of a call carrying `bytes`: every byte an uncached input token, plus the full
 * completion ceiling, at the dearest of the endpoint's base and time-window prices (DeepSeek
 * doubles its rates in some UTC windows).
 */
async function worstCase(model: string, tag?: string): Promise<(bytes: number) => number> {
	const response = await fetch(`${openrouterBase}/api/v1/models/${model}/endpoints`, { signal: AbortSignal.timeout(30_000) });
	const all = ((await response.json()) as { data?: { endpoints?: Endpoint[] } }).data?.endpoints ?? [];
	const matched = all.filter((endpoint) => !tag || endpoint.tag === tag || endpoint.tag?.startsWith(`${tag}/`));
	const rates = matched.flatMap((endpoint) => [endpoint.pricing ?? {}, ...(endpoint.pricing?.overrides ?? [])]);
	const price = (key: string) => Math.max(0, ...rates.map((rate) => Number(rate[key] ?? 0) || 0));
	const ceiling = Math.max(0, ...matched.map((endpoint) => endpoint.max_completion_tokens ?? endpoint.context_length ?? 0));
	const input = price("prompt");
	const output = Math.max(price("completion"), price("internal_reasoning"));
	if (matched.length === 0 || !(input > 0) || !(ceiling > 0)) fail(`cannot bound the cost of ${model}${tag ? ` on ${tag}` : ""}`);
	return (bytes) => bytes * input + ceiling * output + price("request");
}
const worst = { model: await worstCase(modelId, upstream), jev: await worstCase(JEV_MODEL) };

type Call = { seq: string; ts: string; run: string | null; path: string; worstUsd: number; status?: number; id?: string; costUsd?: number; provider?: string };
const ledger = { settledUsd: 0, pendingUsd: 0, calls: [] as Call[] };
const journal = join(out, "boundary.jsonl");
// A resumed evaluation inherits every earlier call: settled costs, and the worst case of any call
// that was admitted but never settled (for example, in flight when the runner stopped).
if (existsSync(journal)) {
	const bySeq = new Map<string, Partial<Call>>();
	for (const line of readFileSync(journal, "utf8").split("\n").filter(Boolean)) {
		const entry = JSON.parse(line) as Partial<Call>;
		const key = entry.seq ?? `legacy-${bySeq.size}`;
		bySeq.set(key, { ...bySeq.get(key), ...entry });
	}
	for (const entry of bySeq.values()) {
		if (typeof entry.costUsd === "number") ledger.settledUsd += entry.costUsd;
		else ledger.pendingUsd += entry.worstUsd ?? 0;
	}
}
const runnerId = `${process.pid}-${Date.now()}`;
let callCount = 0;
const settling: Promise<void>[] = [];
let currentRun: string | null = null;
let hardStop: string | null = null;

function settle(call: Call, costUsd: number | undefined, provider?: string): void {
	if (costUsd === undefined) return; // unsettled: its worst case stays counted
	ledger.pendingUsd -= call.worstUsd;
	ledger.settledUsd += costUsd;
	Object.assign(call, { costUsd, provider });
}

async function generationCost(id: string): Promise<{ cost?: number; provider?: string }> {
	for (let attempt = 0; attempt < 45; attempt++) {
		try {
			const response = await fetch(`${openrouterBase}/api/v1/generation?id=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(15_000) });
			const data = response.ok ? ((await response.json()) as { data?: { total_cost?: unknown; provider_name?: string } }).data : undefined;
			if (typeof data?.total_cost === "number") return { cost: data.total_cost, provider: data.provider_name };
		} catch {
			// not recorded yet
		}
		await new Promise((resolve) => setTimeout(resolve, 2_000));
	}
	return {};
}

/**
 * Read the ledger's copy of a response to its end, then settle the call from OpenRouter's own
 * figure: the `usage.cost` it appends to every response (the last chunk of a stream), or else
 * a lookup of the generation. Looking every call up let reservations pile up while OpenRouter's
 * generation records lagged, and the cap stopped the first control run at $0.24 spent.
 */
async function account(call: Call, stream: ReadableStream<Uint8Array> | null): Promise<void> {
	let head = "";
	let tail = "";
	if (stream) {
		const decoder = new TextDecoder();
		for await (const chunk of stream) {
			const text = decoder.decode(chunk, { stream: true });
			if (head.length < 65_536) head += text;
			tail = (tail + text).slice(-16_384);
		}
	}
	call.id = /"id"\s*:\s*"(gen-[^"]+)"/.exec(head)?.[1];
	call.provider = /"provider"\s*:\s*"([^"]+)"/.exec(head)?.[1];
	// Content is JSON-escaped inside the response, so only OpenRouter's own usage field matches.
	const inline = Number([...tail.matchAll(/"cost"\s*:\s*([0-9.eE+-]+)/g)].at(-1)?.[1] ?? Number.NaN);
	if (Number.isFinite(inline)) {
		settle(call, inline, call.provider);
	} else if (call.id) {
		const found = await generationCost(call.id);
		settle(call, found.cost, found.provider);
	} else if (call.status !== undefined && PRE_GENERATION.has(call.status)) {
		settle(call, 0); // OpenRouter refused it before routing: no generation, no charge
	}
	appendFileSync(journal, `${JSON.stringify(call)}\n`);
}

const boundaryServer = Bun.serve({
	hostname: "127.0.0.1",
	port: Number(new URL(boundary).port),
	idleTimeout: 0, // model streams can pause longer than the default 10 s
	async fetch(request) {
		if (hardStop) return new Response(hardStop, { status: 402 });
		const { pathname, search } = new URL(request.url);
		let body: string | undefined;
		let call: Call | undefined;
		if (request.method === "POST" && (MODEL_PATHS.has(pathname) || pathname === JEV_PATH)) {
			const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
			const expected = MODEL_PATHS.has(pathname) ? modelId : JEV_MODEL;
			if (payload?.model !== expected) return new Response(`the evaluation boundary admits only ${expected} here`, { status: 403 });
			if (MODEL_PATHS.has(pathname)) payload.provider = { order: [upstream], allow_fallbacks: false };
			body = JSON.stringify(payload);
			const worstUsd = (MODEL_PATHS.has(pathname) ? worst.model : worst.jev)(Buffer.byteLength(body));
			if (spendLimit > 0 && ledger.settledUsd + ledger.pendingUsd + worstUsd > spendLimit) {
				hardStop = `spend cap: $${(ledger.settledUsd + ledger.pendingUsd).toFixed(4)} committed, and the next call could cost $${worstUsd.toFixed(4)}; the cap is $${spendLimit}`;
				return new Response(hardStop, { status: 402 });
			}
			call = { seq: `${runnerId}.${++callCount}`, ts: new Date().toISOString(), run: currentRun, path: pathname, worstUsd };
			ledger.pendingUsd += worstUsd;
			ledger.calls.push(call);
			appendFileSync(journal, `${JSON.stringify(call)}\n`); // admitted; the settled record follows
		} else if (!(request.method === "GET" && pathname === "/api/v1/models")) {
			return new Response("outside the evaluation boundary", { status: 403 });
		}
		const headers = new Headers(request.headers);
		for (const name of ["host", "content-length", "accept-encoding", "connection"]) headers.delete(name);
		const answer = await fetch(`${openrouterBase}${pathname}${search}`, { method: request.method, headers, body }).catch(() => null);
		if (!answer) {
			if (call) settling.push(account(call, null)); // may have reached OpenRouter: its worst case stays counted
			return new Response("the model proxy is unreachable", { status: 502 });
		}
		const answerHeaders = new Headers(answer.headers);
		for (const name of ["content-encoding", "content-length", "transfer-encoding", "connection"]) answerHeaders.delete(name);
		let toClient = answer.body;
		if (call && answer.body) {
			call.status = answer.status;
			const [forClient, forLedger] = answer.body.tee();
			toClient = forClient;
			settling.push(account(call, forLedger));
		} else if (call) {
			call.status = answer.status;
			settling.push(account(call, null));
		}
		return new Response(toClient, { status: answer.status, headers: answerHeaders });
	},
});

/**
 * Limit the agent user to the boundary and to ephemeral loopback ports (its own test
 * servers); see "Egress" above. Fixed local services, such as sshd and exe.dev's Shelley
 * agent on 127.0.0.1:9999, stay closed. One `iptables-restore` transaction per table
 * replaces the whole chain, so it is never empty or partial, even while another runner's
 * agent is mid-run, and a failed replacement keeps the previous rules.
 */
function lockAgentEgress(): void {
	const uid = spawnSync("id", ["-u", agentUser], { encoding: "utf8" }).stdout.trim() || fail(`no user ${agentUser}`);
	const rules = [
		`-o lo -p tcp --dport ${new URL(boundary).port} -j ACCEPT`,
		"-o lo -p tcp --dport 32768:60999 -j ACCEPT",
		"-p tcp -j REJECT --reject-with tcp-reset",
		"-j REJECT",
	];
	for (const tool of ["iptables", "ip6tables"]) {
		const input = `*filter\n:S1S2-AGENT - [0:0]\n${rules.map((rule) => `-A S1S2-AGENT ${rule}\n`).join("")}COMMIT\n`;
		const restore = spawnSync("sudo", ["-n", `${tool}-restore`, "--noflush"], { cwd: "/", input, encoding: "utf8" });
		if (restore.status !== 0) fail(`${tool}-restore failed: ${restore.stderr}`);
		const match = ["-m", "owner", "--uid-owner", uid, "-j", "S1S2-AGENT"];
		if (spawnSync("sudo", ["-n", tool, "-C", "OUTPUT", ...match], { cwd: "/", stdio: "ignore" }).status !== 0) sudo([tool, "-I", "OUTPUT", "1", ...match]);
	}
}

// Both harnesses reach OpenRouter only through the boundary.
const piModels = join(out, "pi-models.json");
writeFileSync(piModels, `${JSON.stringify({ providers: { openrouter: { baseUrl: `${boundary}/api/v1` } } })}\n`);
asAgent(["mkdir", "-p", piAgentDir]);
sudo(["install", "-o", agentUser, "-g", agentUser, "-m", "600", piModels, join(piAgentDir, "models.json")]);
if (arms.includes("omp") && !asAgent(["cat", join(agentHome, ".omp/agent/models.yml")]).includes(`${boundary}/api/v1`)) {
	fail(`the agent's OMP models.yml must set providers.openrouter.baseUrl to ${boundary}/api/v1`);
}

/** Run a command as the agent without blocking the event loop, which serves the boundary. */
function asAgentAsync(argv: string[]): Promise<{ status: number | null; stdout: string }> {
	return new Promise((done) => {
		const child = spawn("sudo", ["-n", "-u", agentUser, ...argv], { cwd: "/", stdio: ["ignore", "pipe", "ignore"] });
		let stdout = "";
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.on("close", (status) => done({ status, stdout }));
	});
}
const agentReaches = async (url: string) => (await asAgentAsync(["curl", "-sS", "-m", "10", "-o", "/dev/null", url])).status === 0;
lockAgentEgress();
const gateway = ipv4(new URL(openrouterBase).hostname).map((ip) => `http://${ip}/`);
const localServices = spawnSync("ss", ["-Hltn"], { encoding: "utf8" })
	.stdout.split("\n")
	.map((line) => line.trim().split(/\s+/)[3]?.split(":").pop())
	.filter((port): port is string => !!port && port !== new URL(boundary).port)
	.map((port) => `http://127.0.0.1:${port}/`);
for (const url of new Set([new URL(manifest.repo).origin, "https://github.com", "https://raw.githubusercontent.com", ...gateway, "https://1.1.1.1/", ...localServices])) {
	if (await agentReaches(url)) fail(`agent user ${agentUser} can reach ${url}; the egress lock is not real`);
}
if (!(await agentReaches(`${boundary}/api/v1/models`))) fail(`agent user ${agentUser} cannot reach the model boundary at ${boundary}`);
const foreign = await asAgentAsync(["curl", "-s", "-m", "10", "-o", "/dev/null", "-w", "%{http_code}", "-H", "content-type: application/json", "-d", '{"model":"openai/gpt-4o-mini","messages":[]}', `${boundary}/api/v1/chat/completions`]);
if (foreign.stdout !== "403") fail(`the model boundary answered ${foreign.stdout || "nothing"} to a foreign model instead of refusing it`);

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

/** USD the OpenRouter key has spent so far, read through the proxy; null when unreadable. Reported, not enforced. */
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
const committed = () => ledger.settledUsd + ledger.pendingUsd;
const results: Record<string, unknown>[] = [];
let stopped: string | null = null;

outer: for (const task of tasks) {
	const branch = `vibe-base-${task.id}`;
	git(src, "branch", "-f", branch, task.base);
	for (const arm of shuffled(arms)) {
		if (hardStop) {
			stopped = hardStop;
			break outer;
		}
		if (spendLimit > 0 && committed() + worst.model(0) > spendLimit) {
			stopped = `spend cap: $${committed().toFixed(4)} committed leaves too little under $${spendLimit} for one more call`;
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
			PARITY_UPSTREAM: upstream,
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
				// The boundary forwards to the proxy, which injects the real key; System 1 needs only a non-empty credential.
				env.S1S2_JEV_KEY = PROXY_PLACEHOLDER;
				env.S1S2_RUN_DIR = join(work, "s1");
				env.S1S2_JEV_ENDPOINT = `${boundary}/api/alpha/decisions`;
			}
			argv = ["--mode", "json", "--no-extensions", ...extensions, "--no-skills", "--no-prompt-templates", "--provider", provider, "--model", modelId, "--thinking", thinking, "--session-dir", sessions, "-p", prompt];
		}
		console.log(`${new Date().toISOString()} ${task.id} ${arm} start`);
		currentRun = `${task.id}/${arm}`;
		const run = await runAgent(cmd, argv, tree, env, join(runDir, "events.jsonl"), join(runDir, "stderr.log"));
		currentRun = null;

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
		await Promise.allSettled(settling.splice(0));
		const calls = ledger.calls.filter((entry) => entry.run === `${task.id}/${arm}`);
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
			boundary: {
				calls: calls.length,
				settledUsd: calls.reduce((sum, entry) => sum + (entry.costUsd ?? 0), 0),
				unsettled: calls.filter((entry) => entry.costUsd === undefined).length,
				modelUpstreams: calls
					.filter((entry) => MODEL_PATHS.has(entry.path))
					.reduce<Record<string, number>>((counts, entry) => ((counts[entry.provider ?? "unknown"] = (counts[entry.provider ?? "unknown"] ?? 0) + 1), counts), {}),
			},
			spendCap: hardStop,
			deliverable: { files: deliverable.files, added: deliverable.added, deleted: deliverable.deleted },
			...graded,
		};
		writeFileSync(join(runDir, "run.json"), `${JSON.stringify(record, null, 2)}\n`);
		results.push(record);
		console.log(`${new Date().toISOString()} ${task.id} ${arm} exit=${run.exit} wall=${Math.round(run.ms / 1000)}s hidden=${graded.hiddenPass} turns=${accounting.parentTurns}`);
		if (hardStop) {
			stopped = hardStop; // the cap cut this run short
			break outer;
		}
	}
	// Count every finished task, resumed ones included, since committed spend includes theirs.
	const finished = tasks.filter((entry) => arms.every((arm) => existsSync(join(out, "runs", entry.id, arm, "run.json")))).length;
	if (spendLimit > 0 && finished > 0 && finished < tasks.length) {
		const projected = (committed() / finished) * tasks.length;
		console.log(`${new Date().toISOString()} committed $${committed().toFixed(4)}, projected $${projected.toFixed(2)}`);
		if (projected > spendLimit) {
			stopped = `spend projection: $${projected.toFixed(2)} for ${tasks.length} tasks exceeds $${spendLimit}`;
			break;
		}
	}
}

await Promise.allSettled(settling.splice(0));
boundaryServer.stop(true);
const spendEnd = await keySpend();
const ledgerSummary = { settledUsd: ledger.settledUsd, pendingUsd: ledger.pendingUsd, calls: ledger.calls.length, unsettled: ledger.calls.filter((entry) => entry.costUsd === undefined).length };
writeFileSync(
	join(out, "vibe.json"),
	`${JSON.stringify({ version: 1, model: `${provider}/${modelId}`, thinking, upstream, seed, arms, agentUser, spendLimit, ledger: ledgerSummary, spendStart, spendEnd, stopped, results }, null, 2)}\n`,
);
console.log(stopped ?? "complete");
