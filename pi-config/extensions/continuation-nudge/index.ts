/**
 * continuation-nudge — bounded advisory continuation nudge for pi.
 *
 * When the agent settles, ask Jev (System One via the OpenRouter Decisions
 * API, pinned `typesafe/jev-1.13`) one bounded Choice question: would a
 * gentle nudge help the agent advance useful work within the user's existing
 * request? A confident `nudge` injects the fixed advisory message as a
 * follow-up turn; everything else finishes normally.
 *
 * Doctrine (ADR-006, skill://system-one): advisory only, fail open. This
 * extension never registers on tool, permission, or approval paths; the
 * classifier answer never authorizes new work; and it never gates commits,
 * merges, or tools. A provider error, timeout, missing key, or unusable
 * answer ends the run exactly like stock pi. Loop protection is
 * deterministic: at most `JEV_NUDGE_MAX` (default 2) nudges per user prompt,
 * and a previous nudge with zero tool results after it is suppressed without
 * calling Jev at all.
 *
 * Resolution order is OpenRouter-only (the operator override for this task;
 * there is no TypeSafe-direct fallback):
 *   1. pi's native registry auth for provider `openrouter`
 *   2. `auth.json` in the agent dir (`openrouter.key`)
 *   3. `OPENROUTER_API_KEY` in the environment
 * Nothing resolved: skip silently, status shows `no-key`.
 *
 * Files (agent dir): `continuation-nudge-status.json` (load evidence) and
 * `continuation-nudge.jsonl` (decision records, rotated at 256 KB to 500
 * lines). No state dumps, no credentials. `/continuation` prints read-only
 * status.
 *
 * Test-only provider override: `JEV_NUDGE_PROVIDER` in
 * `{auto (default), stub-nudge, stub-silence}` bypasses the network and marks
 * its log records `"stub": true`. Guards and bounds still apply.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mkdirSync, readFileSync, statSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	CONTINUATION_QUESTIONS,
	CONTINUATION_VERSION,
	NUDGE_MESSAGE,
} from "./continuation.ts";
import { OpenRouterJevProvider, type Answer, type ChoiceAnswer, type SystemOneProvider } from "./engine.ts";
import {
	MARKER_TYPE,
	STATE_MAX_CHARS,
	analyzeSession,
	buildState,
	decideFromAnswer,
	evaluateGuards,
	serializeState,
	type BranchEntry,
} from "./decide.ts";

const MESSAGE_TYPE = "continuation-nudge";
const STATUS_MESSAGE_TYPE = "continuation-nudge/status";
const STATUS_NAME = "continuation-nudge-status.json";
const LOG_NAME = "continuation-nudge.jsonl";
const LOG_MAX_BYTES = 256 * 1024;
const LOG_KEEP_LINES = 500;
const CALL_TIMEOUT_MS = 8000;
const MAX_DEFAULT = 2;
const MIN_CONFIDENCE_DEFAULT = 0.5;
const JEV_MODEL = "typesafe/jev-1.13";

export type NudgeMode = "on" | "off";
export type ContinuationStatusMode = "on" | "off" | "no-key";

/** Agent directory: `PI_CODING_AGENT_DIR` or pi's default. */
export function resolveAgentDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
	return env.PI_CODING_AGENT_DIR?.trim() || join(home, ".pi", "agent");
}

/** `JEV_NUDGE_MODE`: only the literal `off` disables; anything else is on. */
export function nudgeMode(env: NodeJS.ProcessEnv = process.env): NudgeMode {
	return (env.JEV_NUDGE_MODE ?? "").trim().toLowerCase() === "off" ? "off" : "on";
}

/** `JEV_NUDGE_MAX`: integer 0..3, default 2; invalid values fall back to 2. */
export function maxNudges(env: NodeJS.ProcessEnv = process.env): number {
	const raw = Number.parseInt((env.JEV_NUDGE_MAX ?? "").trim(), 10);
	return Number.isInteger(raw) && raw >= 0 && raw <= 3 ? raw : MAX_DEFAULT;
}

/** `JEV_NUDGE_MIN_CONF`: fraction 0..1, default 0.5; invalid falls back. */
export function minConfidence(env: NodeJS.ProcessEnv = process.env): number {
	const raw = Number.parseFloat((env.JEV_NUDGE_MIN_CONF ?? "").trim());
	return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : MIN_CONFIDENCE_DEFAULT;
}

export type ProviderKind = "auto" | "stub-nudge" | "stub-silence";

/** Test-only deterministic provider selection. */
export function providerKind(env: NodeJS.ProcessEnv = process.env): ProviderKind {
	const raw = (env.JEV_NUDGE_PROVIDER ?? "auto").trim().toLowerCase();
	return raw === "stub-nudge" || raw === "stub-silence" ? raw : "auto";
}

export interface KeyResolution {
	key: string;
	source: string;
}

/**
 * Resolve the OpenRouter key. Order: native registry, agent-dir auth.json,
 * environment. The key value is returned for the provider only; callers log
 * the source name, never the key.
 */
export async function resolveOpenRouterKey(
	ctx: ExtensionContext,
	env: NodeJS.ProcessEnv = process.env,
): Promise<KeyResolution | null> {
	try {
		const auth = await ctx.modelRegistry?.getProviderAuth?.("openrouter");
		const key = (auth as { auth?: { apiKey?: unknown } } | undefined)?.auth?.apiKey;
		if (typeof key === "string" && key.trim()) return { key, source: "modelRegistry" };
	} catch {
		// fail open to the next source
	}

	try {
		const authPath = join(resolveAgentDir(env), "auth.json");
		if (existsSync(authPath)) {
			const parsed = JSON.parse(readFileSync(authPath, "utf8")) as { openrouter?: { key?: unknown } };
			const key = parsed?.openrouter?.key;
			if (typeof key === "string" && key.trim()) return { key, source: "auth.json" };
		}
	} catch {
		// fail open to the environment
	}

	const envKey = (env.OPENROUTER_API_KEY ?? "").trim();
	if (envKey) return { key: envKey, source: "OPENROUTER_API_KEY" };
	return null;
}

export interface ResolvedProvider {
	provider: SystemOneProvider;
	source: string;
	keyResolved: boolean;
	stub: boolean;
}

function stubProvider(kind: "stub-nudge" | "stub-silence"): SystemOneProvider {
	const answer: ChoiceAnswer = {
		type: "choice",
		choice: kind === "stub-nudge" ? "nudge" : "no_nudge",
		probabilities: { [kind === "stub-nudge" ? "nudge" : "no_nudge"]: 1 },
		confidence: 1,
	};
	return {
		name: "heuristic",
		async evaluate(): Promise<Record<string, Answer>> {
			return { continuation: answer };
		},
	};
}

/** Resolve a provider for one call. `null` means no key: skip silently. */
export async function resolveProvider(
	ctx: ExtensionContext,
	env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedProvider | null> {
	const kind = providerKind(env);
	if (kind === "stub-nudge" || kind === "stub-silence") {
		return { provider: stubProvider(kind), source: kind, keyResolved: false, stub: true };
	}
	const resolved = await resolveOpenRouterKey(ctx, env);
	if (!resolved) return null;
	return {
		provider: new OpenRouterJevProvider(resolved.key, JEV_MODEL),
		source: resolved.source,
		keyResolved: true,
		stub: false,
	};
}

export interface ContinuationDeps {
	resolveProvider: (ctx: ExtensionContext, env: NodeJS.ProcessEnv) => Promise<ResolvedProvider | null>;
}

const defaultDeps: ContinuationDeps = { resolveProvider };

interface DecisionRecord {
	ts: string;
	version: string;
	decision: "nudge" | "no_nudge" | "skip";
	reason: string;
	attempt: number;
	latency_ms: number;
	model: string;
	stub?: true;
}

function statusPath(env: NodeJS.ProcessEnv): string {
	return join(resolveAgentDir(env), STATUS_NAME);
}

function logPath(env: NodeJS.ProcessEnv): string {
	return join(resolveAgentDir(env), LOG_NAME);
}

/** Write the load-evidence file. Never throws. */
export function writeStatusFile(env: NodeJS.ProcessEnv, mode: ContinuationStatusMode, keyResolved: boolean): void {
	try {
		const path = statusPath(env);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(
			path,
			JSON.stringify({
				version: CONTINUATION_VERSION,
				loaded_at: new Date().toISOString(),
				mode,
				key_resolved: keyResolved,
			}) + "\n",
		);
	} catch {
		// status is evidence, never a failure path
	}
}

/** Append one decision record, rotating past 256 KB down to 500 lines. */
export function appendDecision(env: NodeJS.ProcessEnv, record: DecisionRecord): void {
	try {
		const path = logPath(env);
		mkdirSync(dirname(path), { recursive: true });
		if (existsSync(path) && statSync(path).size > LOG_MAX_BYTES) {
			const lines = readFileSync(path, "utf8")
				.split("\n")
				.filter((line) => line.trim().length > 0);
			const kept = lines.slice(-LOG_KEEP_LINES).join("\n");
			writeFileSync(path, kept.length > 0 ? `${kept}\n` : "");
		}
		appendFileSync(path, `${JSON.stringify(record)}\n`);
	} catch {
		// logging must never break a turn
	}
}

/** Last decision record, for `/continuation`. Never throws. */
export function readLastDecision(env: NodeJS.ProcessEnv): DecisionRecord | null {
	try {
		const lines = readFileSync(logPath(env), "utf8")
			.split("\n")
			.filter((line) => line.trim().length > 0);
		const last = lines[lines.length - 1];
		return last ? (JSON.parse(last) as DecisionRecord) : null;
	} catch {
		return null;
	}
}

function statusLabel(mode: ContinuationStatusMode): string {
	return mode === "off" ? "cont: off" : mode === "no-key" ? "cont: no-key" : "cont: on";
}

function record(
	env: NodeJS.ProcessEnv,
	decision: DecisionRecord["decision"],
	reason: string,
	attempt: number,
	latencyMs: number,
	model: string,
	stub = false,
): void {
	appendDecision(env, {
		ts: new Date().toISOString(),
		version: CONTINUATION_VERSION,
		decision,
		reason,
		attempt,
		latency_ms: latencyMs,
		model,
		...(stub ? { stub: true as const } : {}),
	});
}

/**
 * One settle pass. Exported with injectable deps so tests can prove the
 * provider is *not* called on suppressed paths, while the default path uses
 * the stub or the real OpenRouter provider.
 */
export async function handleSettled(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	deps: ContinuationDeps = defaultDeps,
	env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
	const mode = nudgeMode(env);
	const analysis = analyzeSession((ctx.sessionManager?.getBranch?.() ?? []) as BranchEntry[]);

	const guards = evaluateGuards({
		mode,
		isIdle: ctx.isIdle(),
		hasPendingMessages: ctx.hasPendingMessages(),
		analysis,
		maxNudges: maxNudges(env),
	});
	if (!guards.proceed) {
		// Disabled is stock behavior: no call, no record, no noise.
		if (guards.reason !== "mode-off") record(env, "skip", guards.reason, analysis.attempt, 0, "none");
		return;
	}

	let resolved: ResolvedProvider | null = null;
	try {
		resolved = await deps.resolveProvider(ctx, env);
	} catch {
		resolved = null;
	}
	if (!resolved) {
		if (ctx.hasUI) ctx.ui.setStatus("continuation", statusLabel("no-key"));
		writeStatusFile(env, "no-key", false);
		return; // skip silently
	}

	const state = buildState({ version: CONTINUATION_VERSION, attempt: analysis.attempt, analysis });
	const serialized = serializeState(state, STATE_MAX_CHARS);
	if (!serialized) {
		record(env, "skip", "state-oversize", analysis.attempt, 0, resolved.source, resolved.stub);
		return;
	}
	const start = Date.now();
	let answers: Record<string, Answer> | null = null;
	try {
		answers = await resolved.provider.evaluate(serialized, CONTINUATION_QUESTIONS, CALL_TIMEOUT_MS);
	} catch {
		record(env, "no_nudge", "provider-error", analysis.attempt, Date.now() - start, resolved.source, resolved.stub);
		return;
	}

	const decision = decideFromAnswer(answers?.continuation, minConfidence(env));
	const latencyMs = Date.now() - start;
	if (!decision.nudge) {
		record(env, "no_nudge", decision.reason, analysis.attempt, latencyMs, resolved.source, resolved.stub);
		return;
	}

	// Persist the marker BEFORE triggering the follow-up: the marker is the
	// loop bound (the cap and the no-progress guard both read it), so a
	// follow-up that fires without one would re-enter at attempt 1 forever.
	// If persistence fails, skip the nudge — fail toward silence.
	try {
		pi.appendEntry(MARKER_TYPE, {
			attempt: analysis.attempt,
			ts: new Date().toISOString(),
			version: CONTINUATION_VERSION,
		});
	} catch {
		record(env, "no_nudge", "marker-persist-failed", analysis.attempt, latencyMs, resolved.source, resolved.stub);
		return;
	}
	pi.sendMessage(
		{
			customType: MESSAGE_TYPE,
			content: NUDGE_MESSAGE,
			display: true,
			details: { version: CONTINUATION_VERSION, attempt: analysis.attempt },
		},
		{ deliverAs: "followUp", triggerTurn: true },
	);
	if (ctx.hasUI) {
		try {
			ctx.ui.notify(`continuation: nudged (attempt ${analysis.attempt})`, "info");
		} catch {
			// notify is best-effort
		}
	}
	record(env, "nudge", "nudge", analysis.attempt, latencyMs, resolved.source, resolved.stub);
}

export function registerContinuationNudge(pi: ExtensionAPI, deps: ContinuationDeps = defaultDeps): void {
	let inFlight = false;

	pi.on("session_start", async (_event, ctx) => {
		inFlight = false;
		const env = process.env;
		const mode = nudgeMode(env);
		if (mode === "off") {
			writeStatusFile(env, "off", false);
			if (ctx.hasUI) ctx.ui.setStatus("continuation", statusLabel("off"));
			return;
		}
		const kind = providerKind(env);
		let resolved: KeyResolution | null = null;
		if (kind === "auto") {
			try {
				resolved = await resolveOpenRouterKey(ctx, env);
			} catch {
				resolved = null;
			}
		}
		const statusMode: ContinuationStatusMode = kind !== "auto" || resolved ? "on" : "no-key";
		writeStatusFile(env, statusMode, resolved !== null);
		if (ctx.hasUI) ctx.ui.setStatus("continuation", statusLabel(statusMode));
	});

	// The stop moment: pi has finished retries, compaction, and follow-ups.
	pi.on("agent_settled", async (_event, ctx) => {
		if (inFlight) return;
		inFlight = true;
		try {
			await handleSettled(pi, ctx, deps);
		} catch {
			// Advisory extension: a settle-time failure must never surface.
		} finally {
			inFlight = false;
		}
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (!ctx.hasUI) return;
		try {
			ctx.ui.setStatus("continuation", undefined);
		} catch {
			// context may be inactive
		}
	});

	pi.registerCommand("continuation", {
		description: "Continuation nudge status (read-only): mode, key source, bounds, last decision",
		handler: async (_args, ctx) => {
			const env = process.env;
			const mode = nudgeMode(env);
			const analysis = analyzeSession((ctx.sessionManager?.getBranch?.() ?? []) as BranchEntry[]);
			let resolved: ResolvedProvider | null = null;
			if (mode === "on") {
				try {
					resolved = await deps.resolveProvider(ctx, env);
				} catch {
					resolved = null;
				}
			}
			const statusMode: ContinuationStatusMode = mode === "off" ? "off" : resolved ? "on" : "no-key";
			const last = readLastDecision(env);
			const lines = [
				`continuation nudge (${CONTINUATION_VERSION})`,
				`mode: ${statusMode}`,
				`key resolved: ${resolved?.keyResolved ? `yes (${resolved.source})` : resolved?.stub ? `no (${resolved.source}, test stub)` : "no"}`,
				`max nudges per prompt: ${maxNudges(env)}`,
				`nudges this prompt span: ${analysis.markers.length}`,
				`last decision: ${last ? `${last.decision} (${last.reason})` : "none"}`,
			];
			pi.sendMessage({ customType: STATUS_MESSAGE_TYPE, content: lines.join("\n"), display: true });
		},
	});
}

export default function (pi: ExtensionAPI): void {
	registerContinuationNudge(pi);
}