import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { OpenRouterJevProvider, resolveProvider, type ReviewVerdict, type SystemOneProvider } from "./engine.ts";

const passFileName = ["jev", "env", "pass"].join(".");
const JEV_ENV_PASS = new URL(passFileName, import.meta.url).pathname;
const RETRY_AFTER_FAILURE_MS = 5 * 60_000;

type JevResolution = { provider: SystemOneProvider | null; source: "pass-env" | "mock" | "none"; reason?: string };
type Cached = { at: number; failed: boolean; resolution: Promise<JevResolution> };
let cached: Cached | undefined;

function readKeyViaPassEnv(): Promise<string> {
	const { promise, resolve, reject } = Promise.withResolvers<string>();
	const localLauncher = join(homedir(), ".local/bin/pass-env");
	const launcher = process.env.PASS_ENV_BIN ?? (existsSync(localLauncher) ? localLauncher : "pass-env");
	const env = { ...process.env };
	delete env.OPENROUTER_API_KEY;
	delete env.TYPESAFE_API_KEY;
	const child = spawn(launcher, ["run", "-f", JEV_ENV_PASS, "--", "printenv", "OPENROUTER_API_KEY"], {
		env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let out = "";
	let err = "";
	const timer = setTimeout(() => child.kill(), 15_000);
	child.stdout.on("data", (chunk) => { out += chunk; });
	child.stderr.on("data", (chunk) => { err += chunk; });
	child.on("error", (error) => { clearTimeout(timer); reject(error); });
	child.on("close", (code) => {
		clearTimeout(timer);
		const key = out.trimEnd();
		if (code === 0 && key) resolve(key);
		else reject(new Error(err.trim().split("\n")[0] || `pass-env exited ${code}`));
	});
	return promise;
}

// The dedicated review key wins over ambient model credentials. Explicit offline mock remains available.
export function jevProvider(): Promise<JevResolution> {
	if (process.env.MOCK_SYSTEM_ONE === "1") return Promise.resolve({ provider: resolveProvider("heuristic"), source: "mock" });
	if (cached && !(cached.failed && Date.now() - cached.at >= RETRY_AFTER_FAILURE_MS)) return cached.resolution;
	const entry: Cached = { at: Date.now(), failed: false, resolution: Promise.resolve({ provider: null, source: "none" }) };
	entry.resolution = readKeyViaPassEnv().then(
		(key): JevResolution => ({ provider: new OpenRouterJevProvider(key, "typesafe/jev-1.13"), source: "pass-env" }),
		(error: unknown): JevResolution => {
			entry.failed = true;
			return { provider: null, source: "none", reason: error instanceof Error ? error.message : String(error) };
		},
	);
	cached = entry;
	return entry.resolution;
}

// Content-free review record; PID and deployed agent directory identify a caller for future investigation.
export function logReview(verdict: ReviewVerdict, resolution: JevResolution): void {
	try {
		const dir = process.env.PI_CODING_AGENT_DIR ?? new URL("../..", import.meta.url).pathname;
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		const provider = resolution.provider as (SystemOneProvider & {
			requestedModel?: string;
			resolvedModels?: Set<string>;
			requestsAttempted?: number;
			responses2xx?: number;
		}) | null;
		appendFileSync(
			join(dir, "diff-review.jsonl"),
			`${JSON.stringify({
				ts: new Date().toISOString(),
				pid: process.pid,
				key_source: resolution.source,
				provider: verdict.provider,
				requested_model: provider?.requestedModel ?? null,
				resolved_models: provider?.resolvedModels ? [...provider.resolvedModels] : [],
				requests_attempted_total: provider?.requestsAttempted ?? null,
				responses_2xx_total: provider?.responses2xx ?? null,
				latency_ms: verdict.latencyMs,
				enabled: verdict.enabled,
				blocks: verdict.blocks.length,
				warnings: verdict.warnings.length,
				...(resolution.reason ? { reason: resolution.reason } : {}),
			})}\n`,
			{ mode: 0o600 },
		);
	} catch {
		// Logging never blocks review.
	}
}
