/**
 * s1s2 — System 1 for raw Pi (US-029; design: docs/system1-system2-harness.md).
 *
 * System 2 is the frontier model running Pi's normal loop. System 1 is this
 * extension: deterministic sensors (sensors.ts) plus batched Jev judgments
 * (questions.ts) at four loop boundaries:
 *
 *   before_agent_start   Brief      name the files the task most likely needs
 *   tool_result (bash)   Triage     elide output chunks System 2 does not need
 *   turn_end             Monitor    one fixed note on loops, drift, or skipped checks
 *   agent_before_settle  Done-gate  run the check System 2 skipped; nudge unfinished work
 *
 * Invariants: Jev only scores or selects code-built candidates; System 1 never
 * blocks or rewrites a tool call; every Jev failure leaves raw Pi behavior; notes
 * and continuations are bounded per prompt; every call is logged with answers,
 * latency, provider usage, and action, never state text or credentials.
 *
 * Environment: `S1S2_MODE=off` registers nothing. `S1S2_RUN_DIR` sets the log and
 * spill directory (default: <agent dir>/s1s2/<session id>). Jev uses Pi's
 * OpenRouter credential, then `OPENROUTER_API_KEY`; with neither, System 1 stays
 * inert and says so in its log.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { redactText } from "../../../agent-config/system-one/continuation.ts";
import { OpenRouterJevProvider, SystemOneProviderError, type Answer, type ProviderUsage, type Question } from "../../../agent-config/system-one/engine.ts";
import * as Q from "./questions.ts";
import * as S from "./sensors.ts";

const JEV_MODEL = "typesafe/jev-1.13";
const SECRET_ENV = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH/i;

type Call = { answers: Record<string, Answer>; latencyMs: number; model?: string; usage?: ProviderUsage };
type Failed = { error: string; latencyMs: number };

function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}

function compact(answers: Record<string, Answer>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [id, answer] of Object.entries(answers)) {
		if (answer.type === "noul") out[id] = round(answer.probability);
		else if (answer.type === "choice") {
			out[id] = { choice: answer.choice, p: round(answer.probabilities[answer.choice] ?? 0), conf: answer.confidence ?? null };
		} else out[id] = { score: round(answer.score), conf: answer.confidence ?? null };
	}
	return out;
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => part?.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n");
}

type CheckResult = { ok: boolean; exit: number; output: string; ms: number };

/** Run a check without the parent's credentials; never throws. */
function runCheck(cwd: string, command: string): Promise<CheckResult> {
	const started = performance.now();
	const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !SECRET_ENV.test(name)));
	const { promise, resolve } = Promise.withResolvers<CheckResult>();
	execFile(
		"bash",
		["-lc", command],
		{ cwd, env, timeout: Q.DONE.checkTimeoutMs, maxBuffer: 32 * 1024 * 1024, encoding: "utf8" },
		(error, stdout, stderr) => {
			const code = (error as { code?: unknown } | null)?.code;
			resolve({
				ok: !error,
				exit: error ? (typeof code === "number" ? code : 124) : 0,
				output: `${stdout ?? ""}${stderr ?? ""}${error && typeof code !== "number" ? `\n${error.message}` : ""}`,
				ms: Math.round(performance.now() - started),
			});
		},
	);
	return promise;
}

export default function s1s2(pi: ExtensionAPI): void {
	if ((process.env.S1S2_MODE ?? "").trim().toLowerCase() === "off") return;

	let runDir = "";
	let jev: OpenRouterJevProvider | null | undefined;
	let task = "";
	let turn = 0;
	let actions: S.Action[] = [];
	let checks: S.CheckCandidate[] = [];
	let lastAssistantText = "";
	let verifiedFingerprint: string | null = null;
	let worktreeFingerprint: string | null = null;
	let lastFailedCheck = "";
	let notes = 0;
	let lastNoteTurn = Number.NEGATIVE_INFINITY;
	let lastMonitorTurn = Number.NEGATIVE_INFINITY;
	let continuations = 0;
	let nudgedUnfinished = false;
	let remindedUnverified = false;
	const totals = {
		calls: 0,
		failedCalls: 0,
		latencyMs: 0,
		inputTokens: 0,
		outputTokens: 0,
		costUsd: 0,
		callsWithoutCost: 0,
		actions: {} as Record<string, number>,
	};

	function record(entry: Record<string, unknown>): void {
		if (typeof entry.action === "string") totals.actions[entry.action] = (totals.actions[entry.action] ?? 0) + 1;
		if (!runDir) return;
		try {
			appendFileSync(join(runDir, "s1s2.jsonl"), `${JSON.stringify({ ts: new Date().toISOString(), turn, ...entry })}\n`);
		} catch {
			// logging never breaks the run
		}
	}

	function callFields(call: Call): Record<string, unknown> {
		return { latency_ms: call.latencyMs, model: call.model, usage: call.usage ?? null, answers: compact(call.answers) };
	}

	async function provider(ctx: ExtensionContext): Promise<OpenRouterJevProvider | null> {
		if (jev !== undefined) return jev;
		// A dedicated S1S2_JEV_KEY wins and is never needed by anything else.
		let key = (process.env.S1S2_JEV_KEY ?? "").trim();
		delete process.env.S1S2_JEV_KEY;
		if (!key) {
			try {
				const auth = await ctx.modelRegistry.getProviderAuth("openrouter");
				const value = (auth as { auth?: { apiKey?: unknown } } | undefined)?.auth?.apiKey;
				if (typeof value === "string") key = value.trim();
			} catch {
				// fall through to the environment
			}
		}
		key ||= (process.env.OPENROUTER_API_KEY ?? "").trim();
		// System 1's credential must not reach tool subprocesses unless System 2 itself runs on OpenRouter.
		if (ctx.model?.provider !== "openrouter") delete process.env.OPENROUTER_API_KEY;
		jev = key ? new OpenRouterJevProvider(key, JEV_MODEL) : null;
		return jev;
	}

	async function ask(ctx: ExtensionContext, questions: Record<string, Question>, state: unknown): Promise<Call | Failed> {
		const client = await provider(ctx);
		if (!client) return { error: "no_key", latencyMs: 0 };
		const serialized = JSON.stringify(state);
		if (serialized.length > Q.STATE_MAX_CHARS) return { error: "state_too_large", latencyMs: 0 };
		const started = performance.now();
		try {
			const evaluation = await client.evaluateWithMetadata(serialized, questions, Q.CALL_TIMEOUT_MS);
			const call: Call = {
				answers: evaluation.answers,
				latencyMs: Math.round(performance.now() - started),
				model: evaluation.resolvedModel,
				usage: evaluation.usage,
			};
			totals.calls++;
			totals.latencyMs += call.latencyMs;
			if (call.usage) {
				totals.inputTokens += call.usage.inputTokens;
				totals.outputTokens += call.usage.outputTokens;
				if (call.usage.costUsd !== undefined) totals.costUsd += call.usage.costUsd;
				else totals.callsWithoutCost++;
			} else totals.callsWithoutCost++;
			return call;
		} catch (error) {
			const latencyMs = Math.round(performance.now() - started);
			totals.failedCalls++;
			totals.latencyMs += latencyMs;
			return { error: error instanceof SystemOneProviderError ? error.kind : "exception", latencyMs };
		}
	}

	function continueWith(content: string, note: string) {
		continuations++;
		return {
			entries: [{ type: "custom_message" as const, customType: "s1s2/done", content, display: true, details: { note } }],
			continue: true,
		};
	}

	pi.on("session_start", (_event, ctx) => {
		const agentDir = process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
		runDir = process.env.S1S2_RUN_DIR?.trim() || join(agentDir, "s1s2", ctx.sessionManager.getSessionId());
		try {
			mkdirSync(join(runDir, "spill"), { recursive: true });
		} catch {
			runDir = "";
		}
		record({ event: "load", version: 1, jev_model: JEV_MODEL });
	});

	pi.on("session_shutdown", () => {
		if (!runDir) return;
		try {
			writeFileSync(join(runDir, "s1s2-summary.json"), `${JSON.stringify({ version: 1, jevModel: JEV_MODEL, ...totals }, null, 2)}\n`);
		} catch {
			// best effort
		}
	});

	pi.on("turn_start", () => {
		turn++;
	});

	pi.on("message_end", (event) => {
		const message = event.message as { role?: string; content?: unknown };
		if (message.role === "assistant") lastAssistantText = textOf(message.content).slice(-2000);
	});

	// Brief: rank repository candidates for the task and name the likely files once.
	pi.on("before_agent_start", async (event, ctx) => {
		task = event.prompt;
		turn = 0;
		actions = [];
		notes = 0;
		lastNoteTurn = Number.NEGATIVE_INFINITY;
		lastMonitorTurn = Number.NEGATIVE_INFINITY;
		continuations = 0;
		nudgedUnfinished = false;
		remindedUnverified = false;
		lastFailedCheck = "";
		verifiedFingerprint = null;
		worktreeFingerprint = S.diffFingerprint(ctx.cwd);
		if (!(await provider(ctx))) {
			record({ battery: "brief", action: "disabled", reason: "no_key" });
			return;
		}
		event.systemPromptOptions.sections.system1 = Q.S2_CONTRACT;
		const started = performance.now();
		const terms = S.extractTerms(task);
		const candidates = S.findCandidates(ctx.cwd, terms);
		checks = S.discoverChecks(ctx.cwd, []);
		const sensorMs = Math.round(performance.now() - started);
		if (candidates.length === 0) {
			record({ battery: "brief", action: "none", reason: "no_candidates", terms: terms.length, sensor_ms: sensorMs });
			return;
		}
		const call = await ask(ctx, Q.briefQuestions(candidates), Q.briefState(task, candidates));
		if ("error" in call) {
			record({ battery: "brief", action: "fail_open", error: call.error, latency_ms: call.latencyMs, sensor_ms: sensorMs });
			return;
		}
		const picks = Q.pickBriefFiles(candidates, call.answers);
		record({
			battery: "brief",
			...callFields(call),
			sensor_ms: sensorMs,
			terms: terms.length,
			candidates: candidates.map((candidate) => candidate.path),
			picked: picks.map((pick) => pick.path),
			action: picks.length > 0 ? "briefed" : "none",
		});
		if (picks.length === 0) return;
		return {
			message: {
				customType: "s1s2/brief",
				content: Q.renderBrief(picks, checks),
				display: true,
				details: { files: picks.map((pick) => pick.path) },
			},
		};
	});

	// Ledger for every result; triage for long bash output.
	pi.on("tool_result", async (event, ctx) => {
		const described = S.describeAction(event.toolName, event.input, checks);
		let kind = described.kind;
		if (event.toolName === "bash" || kind === "edit") {
			// Any tool can edit (models often patch files through bash), so the worktree decides what an edit is.
			const fingerprint = S.diffFingerprint(ctx.cwd);
			if (fingerprint !== null && fingerprint !== worktreeFingerprint) {
				kind = "edit";
				worktreeFingerprint = fingerprint;
			}
			if (described.kind === "check" && !event.isError) verifiedFingerprint = fingerprint;
		}
		actions.push({ ...described, kind, turn, ok: !event.isError });
		// Without a run directory there is nowhere outside the repository to save full output: fail open.
		if (event.toolName !== "bash" || !jev || !runDir) return;
		const text = textOf(event.content);
		const plan = S.planTriage(text);
		if (!plan) return;
		// Data boundary: output carrying credential-shaped text is never sent to Jev, even masked.
		if (redactText(text, text.length) !== text) {
			record({ battery: "triage", action: "unchanged", reason: "credential_shaped_output", lines: plan.lines.length });
			return;
		}
		const batches = Q.triageBatches(plan.chunks);
		if (!batches) {
			record({ battery: "triage", action: "unchanged", reason: "too_large", lines: plan.lines.length });
			return;
		}
		const input = event.input as { command?: unknown };
		const command = typeof input.command === "string" ? input.command : "";
		const calls = await Promise.all(
			batches.map((batch) => ask(ctx, Q.triageQuestions(batch), Q.triageState(task, command, lastAssistantText, batch))),
		);
		const failed = calls.find((call): call is Failed => "error" in call);
		if (failed) {
			record({ battery: "triage", action: "fail_open", error: failed.error, latency_ms: failed.latencyMs });
			return;
		}
		const answered = calls as Call[];
		const keep = Q.pickTriageChunks(batches, answered.map((call) => call.answers));
		const compacted = answered.map((call) => compact(call.answers));
		const spill = join(runDir, "spill", `${event.toolCallId.replace(/[^\w.-]/g, "_")}.txt`);
		try {
			writeFileSync(spill, text);
		} catch {
			record({ battery: "triage", action: "unchanged", reason: "spill_failed" });
			return;
		}
		const rendered = S.renderTriage(plan, keep, spill);
		const worth = rendered.shown <= plan.lines.length * Q.TRIAGE.maxShownFraction;
		record({
			battery: "triage",
			calls: answered.length,
			latency_ms: Math.max(...answered.map((call) => call.latencyMs)),
			usage: answered.map((call) => call.usage ?? null),
			lines: plan.lines.length,
			shown: rendered.shown,
			chunks: plan.chunks.length,
			kept_chunks: keep.size,
			answers: Object.fromEntries(batches.flatMap((batch, b) => batch.map((chunk, i) => [chunk.id, compacted[b][`k${i}`] ?? null]))),
			action: worth ? "elided" : "unchanged",
		});
		if (!worth) return;
		return { content: [{ type: "text" as const, text: rendered.text }] };
	});

	// Monitor: ask only when the ledger shows trouble or periodically; speak rarely.
	pi.on("turn_end", async (event, ctx) => {
		if (!jev || event.toolResults.length === 0) return;
		const facts = S.monitorFacts(actions, turn);
		const triggered = Q.monitorTriggered(facts);
		if (!triggered && turn % Q.MONITOR.everyTurns !== 0) return;
		if (notes >= Q.MONITOR.maxNotes || turn - lastNoteTurn < Q.MONITOR.cooldownTurns || turn - lastMonitorTurn < 2) return;
		lastMonitorTurn = turn;
		const call = await ask(ctx, Q.MONITOR_QUESTIONS, Q.monitorState(task, turn, actions, facts));
		if ("error" in call) {
			record({ battery: "monitor", action: "fail_open", error: call.error, latency_ms: call.latencyMs });
			return;
		}
		const note = Q.pickNote(call.answers, triggered);
		record({ battery: "monitor", ...callFields(call), trigger: triggered ? "facts" : "periodic", facts, action: note ? `note_${note}` : "none" });
		if (!note) return;
		notes++;
		lastNoteTurn = turn;
		return { entries: [{ type: "custom_message" as const, customType: "s1s2/note", content: Q.NOTES[note], display: true, details: { note } }] };
	});

	// Done-gate: verify unverified changes with the check Jev selects; nudge unfinished work.
	pi.on("agent_before_settle", async (event, ctx) => {
		// The event's context preview ends on System 2's final answer, so it never "can continue" before
		// our drafted note is added; Pi validates the continuation after committing the drafts.
		if (!jev || event.outcome !== "completed" || continuations >= Q.DONE.maxContinuations) return;
		const changed = S.changedFiles(ctx.cwd);
		const fingerprint = changed.length > 0 ? S.diffFingerprint(ctx.cwd) : null;
		const checkPassed = fingerprint !== null && fingerprint === verifiedFingerprint;
		const candidates = changed.length > 0 && !checkPassed ? S.discoverChecks(ctx.cwd, changed) : [];
		const call = await ask(
			ctx,
			Q.doneQuestions(candidates),
			Q.doneState(task, lastAssistantText, changed, changed.length > 0 ? S.diffStat(ctx.cwd) : "", checkPassed, candidates),
		);
		if ("error" in call) {
			record({ battery: "done", action: "fail_open", error: call.error, latency_ms: call.latencyMs });
			return;
		}
		const completion = Q.readCompletion(call.answers);
		const base = { battery: "done", ...callFields(call), changed: changed.length, check_passed: checkPassed, candidates: candidates.map((check) => check.command) };
		if (completion.state === "unfinished" && completion.p >= Q.DONE.unfinishedMin && !nudgedUnfinished) {
			nudgedUnfinished = true;
			record({ ...base, action: "nudge_unfinished" });
			return continueWith(Q.NOTES.unfinished, "unfinished");
		}
		if (completion.state === "blocked" || changed.length === 0 || checkPassed) {
			record({ ...base, action: "none" });
			return;
		}
		const pick = Q.pickCheck(call.answers, candidates);
		if (!pick) {
			if (remindedUnverified) {
				record({ ...base, action: "none" });
				return;
			}
			remindedUnverified = true;
			record({ ...base, action: "remind_unverified" });
			return continueWith(Q.NOTES.unverified, "unverified");
		}
		const attempt = `${pick.check.command}\0${fingerprint}`;
		if (attempt === lastFailedCheck) {
			record({ ...base, action: "none", reason: "unchanged_since_failed_check" });
			return;
		}
		const result = await runCheck(ctx.cwd, pick.check.command);
		record({ ...base, check: pick.check.command, check_p: round(pick.p), check_exit: result.exit, check_ms: result.ms, action: result.ok ? "verified" : "check_failed" });
		if (result.ok) {
			verifiedFingerprint = fingerprint;
			return;
		}
		lastFailedCheck = attempt;
		let evidence = result.output.slice(-Q.DONE.evidenceChars);
		if (runDir) {
			const spill = join(runDir, "spill", `done-check-${continuations + 1}.txt`);
			try {
				writeFileSync(spill, result.output);
				const plan = S.planTriage(result.output);
				if (plan) evidence = S.renderTriage(plan, new Set(), spill).text.slice(-Q.DONE.evidenceChars);
			} catch {
				// evidence stays the output tail
			}
		}
		return continueWith(
			`S1: I ran \`${pick.check.command}\` after your last change and it failed (exit ${result.exit}).\n\n${evidence}\n\nFix the failure. If it predates your change or is unrelated to the task, say so and stop.`,
			"check_failed",
		);
	});
}
