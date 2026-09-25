import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OpenRouterJevProvider, resolveProvider, type ReviewVerdict, type SystemOneProvider } from "./engine.ts";

/** Names only: the key stays in pass and is read through pass-env into this process's memory. */
export const JEV_ENV_PASS = join(dirname(fileURLToPath(import.meta.url)), "jev.env.pass");
const RETRY_AFTER_FAILURE_MS = 5 * 60_000;

export type JevResolution = { provider: SystemOneProvider | null; source: "env" | "pass-env" | "none"; reason?: string };
type Options = { launcher?: string; file?: string; endpoint?: string; timeoutMs?: number };
type Cached = { at: number; failed: boolean; resolution: Promise<JevResolution> };

let cached: Cached | undefined;

function launcherPath(explicit?: string): string {
	const local = join(homedir(), ".local/bin/pass-env");
	return explicit ?? process.env.PASS_ENV_BIN ?? (existsSync(local) ? local : "pass-env");
}

/** Read OPENROUTER_API_KEY via pass-env; the value is never exported to process.env or written anywhere. */
export function readKeyViaPassEnv(options: Options = {}): Promise<string> {
	const { promise, resolve, reject } = Promise.withResolvers<string>();
	const env = { ...process.env };
	delete env.OPENROUTER_API_KEY;
	const child = spawn(launcherPath(options.launcher), ["run", "-f", options.file ?? JEV_ENV_PASS, "--", "printenv", "OPENROUTER_API_KEY"], {
		env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let out = "";
	let err = "";
	const timer = setTimeout(() => child.kill(), options.timeoutMs ?? 15_000);
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

/** Environment keys win; otherwise resolve once per session from pass, retrying a failure after a cooldown. */
export function jevProvider(options: Options = {}): Promise<JevResolution> {
	const fromEnv = resolveProvider();
	if (fromEnv) return Promise.resolve({ provider: fromEnv, source: "env" });
	if (cached && !(cached.failed && Date.now() - cached.at >= RETRY_AFTER_FAILURE_MS)) return cached.resolution;
	const entry: Cached = { at: Date.now(), failed: false, resolution: Promise.resolve({ provider: null, source: "none" }) };
	entry.resolution = readKeyViaPassEnv(options).then(
		(key): JevResolution => ({
			provider: new OpenRouterJevProvider(key, process.env.OPENROUTER_JEV_MODEL || "typesafe/jev-1.13", options.endpoint),
			source: "pass-env",
		}),
		(error: unknown): JevResolution => {
			entry.failed = true;
			return { provider: null, source: "none", reason: error instanceof Error ? error.message : String(error) };
		},
	);
	cached = entry;
	return entry.resolution;
}

export function resetJevProviderForTests(): void {
	cached = undefined;
}

/** Append one content-free line per review so live Jev calls are observable. */
export function logReview(verdict: ReviewVerdict, resolution: JevResolution): void {
	try {
		const dir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".omp/agent");
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		const provider = resolution.provider as (SystemOneProvider & { requestedModel?: string; resolvedModels?: Set<string> }) | null;
		appendFileSync(
			join(dir, "diff-review.jsonl"),
			`${JSON.stringify({
				ts: new Date().toISOString(),
				key_source: resolution.source,
				provider: verdict.provider,
				requested_model: provider?.requestedModel ?? null,
				resolved_models: provider?.resolvedModels ? [...provider.resolvedModels] : [],
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
