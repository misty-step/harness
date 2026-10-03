#!/usr/bin/env bun
// omp-roster (US-046, extending US-014): launch an OMP engineer only on a board ticket's ranked
// model roster, then check that its session stayed on it.
//
// The CLI and sibling experiment owner use only Node/Bun built-ins. `omp-engineer`
// owns memory guidance and containment; `omp-experiments.ts` owns the existing journal
// and blind verdicts. The approved model table remains here for deployed consumers.

import { createHash, randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { experimentCommand, ledgerPath, nextExperimentId, readLedger, withLedgerLock, writeLedger, type Experiment, type Lane, type Ledger, type Nature } from "./omp-experiments.ts";

const LOW_TO_MAX = ["low", "medium", "high", "xhigh", "max"];
// The board's effort vocabulary, used where no approved-model entry narrows it.
const ANY_EFFORT = ["minimal", ...LOW_TO_MAX];

// Pin concrete catalog IDs: accepting a prefix here would let a typo resolve fuzzily.
// `usage` names the model's row in `ai-usage dispatch`; null means ai-usage has none, so the
// model is approved for a roster but never launchable.
export const approvedModels: Record<string, {
	efforts: readonly string[];
	/** Review-only effort exception; rosters and recovery use the ordinary floor above. */
	reviewerEfforts?: readonly string[];
	usage: { provider: string; model: string } | null;
}> = {
	"anthropic/claude-opus-5-5": { efforts: LOW_TO_MAX, usage: { provider: "anthropic", model: "opus" } },
	"anthropic/claude-sonnet-5-5": { efforts: LOW_TO_MAX, usage: { provider: "anthropic", model: "sonnet" } },
	"openai-codex/gpt-6-astra": { efforts: LOW_TO_MAX, usage: { provider: "openai-codex", model: "gpt-6-astra" } },
	"openai-codex/gpt-6.1-sol": { efforts: ["high", "xhigh", "max"], reviewerEfforts: ["medium", "high", "xhigh", "max"], usage: { provider: "openai-codex", model: "gpt-6.1-sol" } },
	"openai-codex/gpt-6-luna": { efforts: LOW_TO_MAX, usage: { provider: "openai-codex", model: "gpt-6-luna" } },
	"xai-oauth/grok-4.7": { efforts: ["minimal", "low", "medium", "high", "xhigh"], usage: { provider: "xai", model: "grok" } },
	"google-antigravity/gemini-3.8-flash": { efforts: ["minimal", "low", "medium", "high"], usage: null },
};

// OpenRouter is metered cash. No per-ticket cash cap exists yet, so it is never launched or used
// as recovery, though a roster may name it.
const CASH_PROVIDER = "openrouter";
const CASH_REASON = "cash route: a per-ticket cash cap is not built yet";
// Roles that resolve an engineer's own work: the only modelRoles the overlay writes.
const PINNED_ROLES = ["default", "slow", "task", "extreme"];
// Helper primaries are outside the engineer roster. Reviewer recovery is
// always empty; the supported subagent hook selects its contrasting family.
// Other helpers recover only onto the roster. Vision and web keep their routes.
const HELPER_PRIMARIES: Record<string, string> = {
	advisor: "anthropic/claude-sonnet-5-5",
	plan: "openai-codex/gpt-6.1-sol",
	reviewer: "openai-codex/gpt-6.1-sol",
	"security-reviewer": "openai-codex/gpt-6.1-sol",
	smol: "openai-codex/gpt-6-luna",
	tiny: "openai-codex/gpt-6-luna",
	commit: "openai-codex/gpt-6-luna",
};
const VERDICTS: Record<string, true> = { usable: true, low: true, exhausted: true, blocked: true, unknown: true };
const ADVISOR_FILE = "__advisor";
const EXHAUSTED = 3;
const OFF_ROSTER = 4;
const FLEET_FULL = 5;
const READ_TIMEOUT_MS = 15_000;

// `check` also excuses the designer (`vision` role) on Opus 5.5, which the subagent-inheritance
// extension forces. The overlay writes no chain for vision, so this is `check`'s table only.
const CHECK_PRIMARIES: Record<string, string> = { ...HELPER_PRIMARIES, vision: "anthropic/claude-opus-5-5" };
// Legacy launch records have no schema_version. Keep their helper primaries for audit only;
// new launches and recovery chains use HELPER_PRIMARIES exclusively.
const HISTORICAL_CHECK_PRIMARIES: Record<string, string> = {
	...CHECK_PRIMARIES,
	plan: "openai-codex/gpt-6-astra",
	reviewer: "openai-codex/gpt-6-sol",
	"security-reviewer": "openai-codex/gpt-6-astra",
};

type Entry = { provider: string; model: string; effort: string };
type UsageRow = { harness?: unknown; provider?: unknown; model?: unknown; verdict: string; reason?: unknown; next_reset?: unknown; degraded?: unknown };
type Skip = { selector: string; verdict: string | null; reason: string; next_reset: string | null };
type Freshness = { degraded: boolean; degraded_reason: string | null; oldest_observation: string | null; stale_after_seconds: number | null };
type LaunchOptions = { harness?: string; json?: boolean; "ticket-json"?: string; "usage-json"?: string; "state-dir"?: string; "memory-json"?: string; cwd?: string; "brief-file"?: string; tiny?: string; "live-data"?: string; "no-experiment"?: string; "use-default"?: boolean };
type CheckOptions = { "ticket-json"?: string; "state-dir"?: string; since?: string };
type AdjudicationSchedule = {
	unit: string; judge: Entry; scheduled: boolean; status: string; error: string | null;
	state: { active: string; sub: string; result: string; exit_code: number } | null;
	logs: string[];
};
type MemorySnapshot = Record<string, unknown> & { schema_version: 1; ok: true; activated: boolean; admitted: boolean; reservation: false; warnings: string[] };
const USAGE = `Usage:
  omp-roster capacity [--json]
  omp-roster launch --item ID [--cwd CHECKOUT] [--brief-file FILE] [--no-experiment REASON|--tiny REASON|--live-data REASON] [--use-default] [--json]
  omp-roster launch --model provider/model --thinking effort [--usage-json FILE] [--memory-json FILE] [--state-dir DIR] [--json]
  omp-roster memory [--json] [--memory-json FILE]
  omp-roster check --item ID --session DIR|FILE... [--ticket-json FILE] [--state-dir DIR] [--since ISO]
  omp-roster defaults [--nature build|design|research] [--model provider/model] [--json]
  omp-roster verdict --experiment E-NNN --artifact-a FILE --artifact-b FILE --judge provider/model --thinking effort [--json]
  omp-roster await-verdict --experiment E-NNN [--json]
  omp-roster abandon --experiment E-NNN --reason TEXT
Capacity is a read-only fleet snapshot, not a reservation; launch rechecks admission and may start both experiment lanes.
Memory fixtures are read-only guidance; the actual engineer launch rechecks live containment under lock.
Exit: 0 done, 1 refused or unreadable input, 2 usage, 3 roster exhausted, 4 turns off the roster or the roster changed, 5 working-engineer limit reached`;

class CliError extends Error {
	constructor(message: string, readonly exitCode = 1) {
		super(message);
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value);
const key = (entry: { provider: string; model: string }) => `${entry.provider}/${entry.model}`;
const selector = (entry: Entry) => `${key(entry)}:${entry.effort}`;
const isCash = (entry: Entry) => entry.provider === CASH_PROVIDER;
// Board and ai-usage text is free-form; keep every message on one printable line and let the
// message supply its own final full stop.
const plain = (value: string) => value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 160).replace(/[.\s]+$/, "");
const plainOrNull = (value: unknown) => (typeof value === "string" ? plain(value) : "") || null;

function readJson(path: string, what: string): unknown {
	let raw: string;
	try { raw = readFileSync(path, "utf8"); }
	catch { throw new CliError(`Cannot read the ${what} at ${path}.`); }
	try { return JSON.parse(raw) as unknown; }
	catch { throw new CliError(`The ${what} at ${path} is not valid JSON.`); }
}

// Run a host CLI the way Kaylee's dispatch_routes.py finds ai-usage: PATH first, then ~/.local/bin.
// The parsed stdout is null when it is not JSON.
function locate(name: string): string | null {
	if (name.includes("/")) return existsSync(name) ? name : null;
	const fallback = join(homedir(), ".local", "bin", name);
	return Bun.which(name) ?? (existsSync(fallback) ? fallback : null);
}

// The board program is named Glass after its one-time cutover (ADR 0004 of the board repository) and
// `board` before it, with no alias in between. Take `glass` when it is installed, else `board`, so the
// launcher needs no change at the moment of the cutover; OMP_ROSTER_BOARD_BIN overrides both.
export function boardProgram(env: Record<string, string | undefined> = process.env): string {
	const chosen = env.OMP_ROSTER_BOARD_BIN?.trim();
	if (chosen) return chosen;
	return locate("glass") ? "glass" : "board";
}

function capture(name: string, args: string[], timeout: number | null = READ_TIMEOUT_MS): { json: unknown; stderr: string; exitCode: number } {
	const binary = locate(name);
	if (!binary) throw new CliError(`${name} is not on PATH or in ~/.local/bin.`);
	const result = Bun.spawnSync({ cmd: [binary, ...args], stdout: "pipe", stderr: "pipe", ...(timeout === null ? {} : { timeout }) });
	if (result.exitedDueToTimeout) throw new CliError(`${name} did not answer within ${timeout! / 1000} seconds; inspect its state before retrying.\nStderr:\n${result.stderr.toString() || "(empty)"}`);
	let json: unknown = null;
	try { json = JSON.parse(result.stdout.toString()); }
	catch { /* not JSON: the caller reports stderr */ }
	return { json, stderr: result.stderr.toString(), exitCode: result.exitCode ?? -1 };
}

function memorySnapshot(file?: string): MemorySnapshot {
	const core = join(dirname(resolve(process.argv[1] ?? import.meta.path)), "omp-engineer");
	const answer = capture(core, ["memory", "--json", ...(file ? ["--fixture", resolve(file)] : [])]);
	const doc = answer.json;
	if (answer.exitCode !== 0 || !isRecord(doc) || doc.schema_version !== 1 || doc.ok !== true
		|| typeof doc.activated !== "boolean"
		|| typeof doc.admitted !== "boolean" || doc.reservation !== false
		|| !Array.isArray(doc.warnings) || !doc.warnings.every((warning) => typeof warning === "string")) {
		throw new CliError(`Cannot inspect launch memory: ${(isRecord(doc) && plainOrNull(doc.error)) || answer.stderr || "unrecognised memory snapshot"}.`);
	}
	return doc as MemorySnapshot;
}

function enforceDisplayBoundary(): void {
	const bin = join(homedir(), ".local", "bin");
	try {
		const entry = join(bin, "omp");
		if (!lstatSync(entry).isSymbolicLink() || readlinkSync(entry) !== "omp-engineer") throw new Error("inactive");
		for (const name of ["omp-engineer", "omp-display", "omp-gui"]) {
			const info = lstatSync(join(bin, name));
			if (!info.isFile() || !(info.mode & 0o100)) throw new Error("incomplete");
		}
	} catch {
		throw new CliError("Engineer display isolation is not activated; install the engineer-cage before planning a launch.");
	}
}

function memoryCommand(options: { json?: boolean; "memory-json"?: string }): number {
	const snapshot = memorySnapshot(options["memory-json"]);
	if (options.json) console.log(JSON.stringify(snapshot, null, 2));
	else {
		console.log(`memory guidance: ${snapshot.activated ? snapshot.warnings.length ? "warning; launches continue" : "within guidelines" : "inactive"} (preflight only, no reservation)`);
		for (const warning of snapshot.warnings) console.log(`  ${plain(warning)}`);
		if (typeof snapshot.coverage === "string") console.log(snapshot.coverage);
	}
	return 0;
}
// Session-wide: no workspace filter, no exclusion for the calling engineer.
function readEngineerCapacity(): { working: number; limit: number; agents: Record<string, unknown>[]; names: string[] } {
	const configured = process.env.OMP_ROSTER_ENGINEER_LIMIT ?? "24";
	if (!/^[1-9][0-9]*$/.test(configured) || !Number.isSafeInteger(Number(configured))) {
		throw new CliError("OMP_ROSTER_ENGINEER_LIMIT must be a positive safe integer.");
	}
	const limit = Number(configured);
	const answer = capture("herdr", ["agent", "list"]);
	const result = isRecord(answer.json) ? answer.json.result : undefined;
	if (answer.exitCode !== 0 || !isRecord(result) || !Array.isArray(result.agents)) {
		throw new CliError(`Cannot read the Herdr agents: ${answer.stderr || "unrecognised agent list"}.`);
	}
	const working: string[] = [];
	for (const agent of result.agents) {
		if (!isRecord(agent) || !["working", "idle", "done", "blocked", "unknown"].includes(agent.agent_status as string)) {
			throw new CliError("Cannot read the Herdr agents: unrecognised agent status.");
		}
		if (agent.agent !== "omp" || agent.agent_status !== "working") continue;
		const name = plainOrNull(agent.name) ?? plainOrNull(agent.pane_id);
		if (!name) throw new CliError("Cannot read the Herdr agents: a working agent has no name or pane id.");
		working.push(name);
	}
	return { working: working.length, limit, agents: result.agents as Record<string, unknown>[], names: working };
}

function capacityCommand(options: { json?: boolean }): number {
	const { working, limit } = readEngineerCapacity();
	if (options.json) console.log(JSON.stringify({ engineer_capacity: { working, limit } }, null, 2));
	else console.log(`working engineers: ${working}/${limit} (snapshot only, no reservation)`);
	return 0;
}

function enforceEngineerLimit(): { working: number; limit: number; agents: Record<string, unknown>[] } {
	const { names, ...snapshot } = readEngineerCapacity();
	if (snapshot.working >= snapshot.limit) {
		throw new CliError(`working-engineer limit reached (${snapshot.working}/${snapshot.limit}); working: ${names.join(", ")}; queue work on the board.`, FLEET_FULL);
	}
	return snapshot;
}


// The board's answer document. With --ticket-json a file may hold that document or, for fixtures,
// just the ticket. Returns the ticket, or null when the item has none.
function ticketOf(item: string, file: string | undefined): unknown {
	let doc: unknown;
	if (file) {
		doc = readJson(file, "ticket file");
		if (!isRecord(doc) || !("data" in doc)) return doc;
	} else {
		const answer = capture(boardProgram(), ["query", "items", "--item", item, "--json"]);
		doc = answer.json;
		if (answer.exitCode !== 0 || !isRecord(doc)) {
			throw new CliError(`The board could not read ${item}: ${(isRecord(doc) && plainOrNull(doc.error)) || answer.stderr || "no answer"}.`);
		}
	}
	const data = isRecord(doc) ? doc.data : undefined;
	if (!isRecord(data) || data.state !== "ok" || !isRecord(data.value)) {
		throw new CliError(`The board's answer for ${item} is not ready.`);
	}
	const ticket = data.value.ticket;
	return isRecord(ticket) ? { ...ticket, title: data.value.title, description: data.value.description, why: data.value.why, brief: data.value.brief } : ticket ?? null;
}

function rosterOf(ticket: unknown, item: string, historical = false): Entry[] {
	if (!isRecord(ticket)) throw new CliError(`${item} has no ticket, so it has no model roster.`);
	if (!Array.isArray(ticket.roster) || ticket.roster.length === 0) {
		throw new CliError(`The ticket on ${item} has an empty roster.`);
	}
	const roster: Entry[] = [];
	for (const [index, value] of ticket.roster.entries()) {
		const at = `Roster entry ${index + 1}`;
		if (!isRecord(value) || ![value.provider, value.model, value.effort].every((part) => typeof part === "string" && part)) {
			throw new CliError(`${at} needs a provider, a model and an effort.`);
		}
		const entry = { provider: value.provider as string, model: value.model as string, effort: value.effort as string };
		const approved = approvedModels[key(entry)] ?? (historical && key(entry) === "openai-codex/gpt-6-sol" ? { efforts: LOW_TO_MAX } : undefined);
		if (!approved && !isCash(entry)) throw new CliError(`${at} (${plain(key(entry))}) is not on the approved model list.`);
		if (!(approved?.efforts ?? ANY_EFFORT).includes(entry.effort)) {
			throw new CliError(`${at} asks for effort ${plain(entry.effort)}, which ${plain(key(entry))} does not support.`);
		}
		const twin = roster.findIndex((other) => selector(other) === selector(entry));
		if (twin >= 0) throw new CliError(`Roster entries ${twin + 1} and ${index + 1} are the same model and effort.`);
		roster.push(entry);
	}
	return roster;
}

// SHA-256 of the roster as compact JSON: entries in rank order, keys provider, model, effort.
const rosterSha = (roster: Entry[]) => createHash("sha256").update(JSON.stringify(roster)).digest("hex");

// The rules of Kaylee's dispatch_routes.py: not ok, or any row without a known verdict, is an
// error, never a usable route.
function usageView(file: string | undefined): { rows: UsageRow[]; freshness: Freshness } {
	let view: unknown;
	if (file) {
		view = readJson(file, "usage file");
	} else {
		const answer = capture("ai-usage", ["dispatch", "--json"]);
		view = answer.json;
		if (!isRecord(view)) throw new CliError(`ai-usage dispatch failed (exit ${answer.exitCode}): ${answer.stderr || "no output"}.`);
		if (answer.exitCode !== 0 && view.ok === true) throw new CliError(`ai-usage dispatch exited ${answer.exitCode}.`);
	}
	if (!isRecord(view)) throw new CliError("The ai-usage view is not a JSON object.");
	if (view.ok !== true) throw new CliError(`The ai-usage view is not ok${plainOrNull(view.error) ? `: ${plainOrNull(view.error)}` : ""}.`);
	const known = (rows: unknown): rows is UsageRow[] =>
		Array.isArray(rows) && rows.every((row) => isRecord(row) && typeof row.verdict === "string" && Object.hasOwn(VERDICTS, row.verdict));
	const { rollup, coverage, routes } = view;
	if (!known(rollup) || rollup.length === 0 || !Array.isArray(coverage) || !known(routes)) {
		throw new CliError("The ai-usage view has an unrecognised shape, so every route is unknown.");
	}
	const degraded = plainOrNull(view.degraded);
	return {
		rows: rollup,
		freshness: {
			degraded: degraded !== null,
			degraded_reason: degraded,
			oldest_observation: plainOrNull(view.oldest_observation),
			stale_after_seconds: typeof view.stale_after_seconds === "number" ? view.stale_after_seconds : null,
		},
	};
}

// Whether an entry can launch now: `skip` says why not, otherwise the route's verdict. Rows for
// harness `omp` win over `any`, and when several rows name the route every one must be launchable.
function routeState(entry: Entry, rows: UsageRow[]): { skip: Skip } | { verdict: "usable" | "low"; degraded: string | null } {
	const skip = (verdict: string | null, reason: string, next_reset: string | null = null) =>
		({ skip: { selector: plain(selector(entry)), verdict, reason, next_reset } });
	if (isCash(entry)) return skip(null, CASH_REASON);
	const usage = approvedModels[key(entry)]?.usage;
	if (!usage) return skip("unknown", `ai-usage has no row for ${key(entry)}`);
	const named = rows.filter((row) => row.provider === usage.provider && row.model === usage.model);
	const omp = named.filter((candidate) => candidate.harness === "omp");
	const matching = omp.length ? omp : named.filter((candidate) => candidate.harness === "any");
	if (matching.length === 0) return skip("unknown", `ai-usage has no omp row for ${usage.provider}/${usage.model}`);
	const blocked = matching.find((row) => row.verdict !== "usable" && row.verdict !== "low");
	if (blocked) return skip(blocked.verdict, plainOrNull(blocked.reason) ?? blocked.verdict, plainOrNull(blocked.next_reset));
	return {
		verdict: matching.some((row) => row.verdict === "low") ? "low" : "usable",
		degraded: matching.map((row) => plainOrNull(row.degraded)).find((reason) => reason !== null) ?? null,
	};
}

// Cached quota is advisory: require one response on the exact route before committing a launch.
function probeRoute(entry: Entry): Skip | null {
	const refused = (reason: string): Skip => ({
		selector: plain(selector(entry)), verdict: "unknown",
		reason: `live provider check: ${reason.replace(/[\u0000-\u001f\u007f]+/g, " ").trim()}`, next_reset: null,
	});
	const binary = locate("omp");
	if (!binary) return refused("omp is not on PATH or in ~/.local/bin");
	// The display fence replaces ~/.cache/tmp; use the judge's visible overlay storage.
	const scratch = stateDir(undefined);
	mkdirSync(scratch, { recursive: true, mode: 0o700 });
	const cwd = mkdtempSync(join(scratch, ".probe-"));
	try {
		const overlay = join(cwd, "probe.json");
		writeFileSync(overlay, JSON.stringify({
			modelRoles: { default: selector(entry) },
			retry: { enabled: false, modelFallback: false }, advisor: { enabled: false },
		}), { mode: 0o600 });
		const env = { ...process.env };
		for (const name of ["PI_CONFIG_FILES", "PI_SMOL_MODEL", "PI_SLOW_MODEL", "PI_PLAN_MODEL"]) delete env[name];
		const result = Bun.spawnSync({
			cmd: [binary, "--mode", "json", "--print", "--model", key(entry), "--thinking", entry.effort,
				"--config", overlay, "--max-time", "25s", "--no-session", "--no-tools", "--no-extensions",
				"--no-skills", "--no-rules", "--no-lsp", "--no-title",
				"--system-prompt", "Reply only OK.", "Reply exactly OK."],
			cwd, env, stdout: "pipe", stderr: "pipe", timeout: 35_000,
		});
		if (result.exitedDueToTimeout) return refused("timed out after 35 seconds");
		const diagnostic = result.stderr.toString().trim();
		let assistants = 0, terminal = false;
		for (const line of result.stdout.toString().split("\n")) {
			if (!line.trim()) continue;
			let event: unknown;
			try { event = JSON.parse(line); }
			catch { return refused(diagnostic || `invalid OMP JSON: ${line}`); }
			if (!isRecord(event)) return refused("unrecognised OMP event");
			if (event.type === "retry_fallback_applied" || event.resolvedModelIsFallback === true
				|| (event.type === "model_change" && event.model !== key(entry))) return refused("OMP changed route");
			if (event.type === "agent_end") terminal = event.isTerminal === true;
			if (event.type !== "message_end") continue;
			const message = event.message;
			if (!isRecord(message)) return refused("unrecognised OMP message");
			if (message.role !== "assistant") continue;
			assistants++; terminal = false;
			if (message.provider !== entry.provider || message.model !== entry.model) return refused("OMP answered on a different route");
			if (message.stopReason !== "stop") return refused(
				typeof message.errorMessage === "string" && message.errorMessage.trim()
					? message.errorMessage : `OMP stopped with ${String(message.stopReason)}`);
		}
		if (result.exitCode !== 0) return refused(diagnostic || `OMP exited ${result.exitCode}`);
		return assistants === 1 && terminal ? null : refused("OMP did not finish one response");
	} catch (error) {
		return refused((error as Error).message);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}

function skipLine(skip: Skip): string {
	const reset = skip.next_reset ? `; resets ${skip.next_reset}` : skip.verdict === "exhausted" ? "; reset time unknown" : "";
	return `${skip.selector}: ${skip.verdict ? `${skip.verdict}, ` : ""}${skip.reason}${reset}`;
}

// Engineer recovery stays on the roster. Reviewers stop on failure; their
// child-only runtime pin also removes model-key chains inherited from this overlay.
function overlayText(item: string, sha: string, roster: Entry[], launch: Entry): string {
	const chainable = roster.filter((entry) => !isCash(entry));
	const others = (model: string) => chainable.filter((entry) => key(entry) !== model).map(selector);
	const scalar = (value: string) => {
		if (!/^[A-Za-z0-9][A-Za-z0-9./:_-]*$/.test(value)) throw new CliError(`Cannot write ${plain(value)} into an overlay.`);
		return value;
	};
	const lines = [
		`# omp-roster overlay for ${item} (US-046); regenerated by \`omp-roster launch\`.`,
		"# launch record schema_version: 2",
		`# roster_sha256: ${sha}`,
		"modelRoles:",
		...PINNED_ROLES.map((role) => `  ${role}: ${scalar(selector(launch))}`),
		"retry:",
		"  fallbackChains:",
	];
	const chain = (name: string, models: string[]) =>
		lines.push(models.length ? `    ${scalar(name)}:` : `    ${scalar(name)}: []`, ...models.map((model) => `      - ${scalar(model)}`));
	for (const model of new Set(chainable.map(key))) chain(model, others(model));
	for (const role of PINNED_ROLES) chain(role, others(key(launch)));
	for (const [role, primary] of Object.entries(HELPER_PRIMARIES)) {
		chain(role, role === "reviewer" || role === "security-reviewer" ? [] : others(primary));
	}
	return `${lines.join("\n")}\n`;
}

// Atomic and private. A running session reads its overlay, so a launch never rewrites one that
// may be in use: overlay names carry a digest of their own content.
function writeStateFile(dir: string, name: string, body: string): string {
	const path = join(dir, name);
	const temp = join(dir, `.${name}.${randomBytes(4).toString("hex")}.tmp`);
	try {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		writeFileSync(temp, body, { mode: 0o600, flag: "wx" });
		renameSync(temp, path);
	} catch (error) {
		rmSync(temp, { force: true });
		throw new CliError(`Cannot write ${path}: ${plain((error as Error).message)}.`);
	}
	return path;
}

function stateDir(explicit: string | undefined): string {
	if (explicit) return resolve(explicit);
	const configured = process.env.XDG_STATE_HOME;
	return join(configured && isAbsolute(configured) ? configured : join(homedir(), ".local", "state"), "omp-roster");
}

// Paste-ready: quote only what the shell would split or expand.
const shellWord = (value: string) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`);

const LEGACY_PAIR_FILE = process.env.OMP_ROSTER_PAIR_FILE ? resolve(process.env.OMP_ROSTER_PAIR_FILE) : join(stateDir(undefined), "pair.json");

function liveLane(lane: Lane, agents: Record<string, unknown>[]): boolean {
	return agents.some((agent) => agent.pane_id === lane.pane_id && agent.agent === "omp"
		&& ["working", "blocked", "unknown"].includes(agent.agent_status as string)
		&& isRecord(agent.agent_session) && agent.agent_session.value === lane.session);
}

// One-time cutover: preserve the existing live reservation, not a second ledger.
function importLegacyPair(ledger: Ledger, agents: Record<string, unknown>[]): void {
	const path = LEGACY_PAIR_FILE;
	if (!existsSync(path)) return;
	const doc = readJson(path, "legacy pair marker");
	if (!isRecord(doc) || doc.schema_version !== 1 || typeof doc.item !== "string" || !Array.isArray(doc.lanes) || doc.lanes.length !== 2) {
		throw new CliError(`Cannot migrate ${path}; repair the existing pair marker before launching.`);
	}
	if (!ledger.experiments.some((experiment) => experiment.item === doc.item && experiment.legacy)) {
		const lanes: Lane[] = doc.lanes.map((binding) => {
			if (!isRecord(binding) || typeof binding.pane_id !== "string" || typeof binding.session !== "string") throw new CliError(`Cannot migrate ${path}: invalid lane.`);
			const session = readFileSync(binding.session, "utf8").split("\n", 5).filter(Boolean).map((line) => JSON.parse(line));
			const model = session.find((record) => record.type === "model_change")?.model;
			const effort = session.find((record) => record.type === "thinking_level_change")?.thinkingLevel;
			const cwd = session.find((record) => record.type === "session")?.cwd;
			if (typeof model !== "string" || typeof effort !== "string" || typeof cwd !== "string") throw new CliError(`Cannot migrate ${path}: missing lane identity.`);
			const slash = model.indexOf("/");
			return { pane_id: binding.pane_id, session: binding.session, cwd, workspace_id: binding.pane_id.split(":")[0]!, entry: { provider: model.slice(0, slash), model: model.slice(slash + 1), effort } };
		});
		const sections = readFileSync(ledgerPath(), "utf8").split(/(?=^## E-[0-9]+)/m);
		const itemPattern = new RegExp(`(?<![A-Za-z0-9._-])${(doc.item as string).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9._-])`);
		const historical = sections.findLast((section) => itemPattern.test(section));
		const id = historical?.match(/^## (E-[0-9]+)/)?.[1] ?? nextExperimentId(ledger);
		ledger.experiments.push({
			id, item: doc.item, nature: "design", question: "Legacy pair; see the preserved journal entry. No default was preregistered.",
			default_key: "", variable: doc.variable === "effort" ? "effort" : "model", baseline: lanes[0]!.entry, candidate: lanes[1]!.entry,
			done: [], brief_sha256: "", base_commit: "", lanes, legacy: true,
			status: lanes.some((lane) => liveLane(lane, agents)) ? "running" : "awaiting-verdict",
			started_at: typeof doc.recorded_at === "string" ? doc.recorded_at : new Date().toISOString(),
		});
	}
	writeLedger(ledger);
	rmSync(path);
}

function currentPair(ledger: Ledger, agents: Record<string, unknown>[]): { status: "live" | "none" | "starting"; file: string; experiment?: Experiment } {
	for (const experiment of ledger.experiments) {
		if (experiment.status === "starting") return { status: "starting", file: ledgerPath(), experiment };
		if (experiment.status !== "running") continue;
		if (experiment.lanes.some((lane) => liveLane(lane, agents))) return { status: "live", file: ledgerPath(), experiment };
		experiment.status = "awaiting-verdict";
		writeLedger(ledger);
	}
	return { status: "none", file: ledgerPath() };
}

function gitFact(cwd: string, args: string[]): string {
	const result = Bun.spawnSync({ cmd: ["git", "-C", cwd, ...args], stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) throw new CliError(`Cannot resolve experiment checkout ${cwd}: ${plain(result.stderr.toString())}.`);
	return result.stdout.toString().trim();
}

function experimentBrief(item: string, ticket: Record<string, unknown>, file?: string): string {
	if (file) {
		const brief = readFileSync(resolve(file), "utf8");
		if (!brief.trim()) throw new CliError("--brief-file must contain the same full task brief for both lanes.");
		return brief;
	}
	return `Contract ${item}\n${JSON.stringify(ticket, null, 2)}\nComplete this ticket against every done check.`;
}

function startPair(ledger: Ledger, item: string, ticket: Record<string, unknown>, launch: Entry, options: LaunchOptions, working: number, limit: number): Experiment {
	if (process.env.HERDR_ENV !== "1") throw new CliError("Automatic experiments require a Herdr-managed dispatch pane.");
	if (working + 2 > limit) throw new CliError(`A pair needs two engineer slots (${working}/${limit}); queue work or record an opt-out reason.`, FLEET_FULL);
	const nature = ticket.nature as Nature;
	const efforts = approvedModels[key(launch)]!.efforts;
	const index = efforts.indexOf(launch.effort);
	const candidateEffort = launch.effort === "xhigh" ? "high" : efforts[index + 1] ?? efforts[index - 1];
	if (!candidateEffort || candidateEffort === launch.effort) throw new CliError("This model has no default-changing effort comparison; record an opt-out reason.");
	const candidate = { ...launch, effort: candidateEffort };
	const checks = ticket.done;
	if (!Array.isArray(checks) || !checks.length || !checks.every((check) => isRecord(check) && typeof check.check === "string" && check.check.trim() && typeof check.proof === "string" && check.proof.trim())) {
		throw new CliError("A useful pair requires the ticket's done checks and their proof contracts.");
	}
	const cwd = resolve(options.cwd ?? process.cwd());
	const base = gitFact(cwd, ["rev-parse", "HEAD"]);
	if (gitFact(cwd, ["status", "--porcelain"])) throw new CliError("Experiment lanes need a committed starting snapshot; commit the checkout or select a clean --cwd.");
	const inventory = capture("herdr", ["worktree", "list", "--cwd", cwd]);
	const source = isRecord(inventory.json) && isRecord(inventory.json.result) ? inventory.json.result.source : undefined;
	if (inventory.exitCode !== 0 || !isRecord(source) || typeof source.repo_root !== "string") throw new CliError(`Cannot resolve the Herdr repository parent for experiment worktrees (exit ${inventory.exitCode}).\nStderr:\n${inventory.stderr || "(empty or unrecognised parent response)"}`);
	const parent = typeof source.source_workspace_id === "string" ? ["--workspace", source.source_workspace_id] : ["--cwd", source.repo_root];
	const brief = experimentBrief(item, ticket, options["brief-file"]);
	const experiment: Experiment = {
		id: nextExperimentId(ledger), item, nature, variable: "effort", baseline: launch, candidate,
		question: `Does ${candidate.effort} effort meet ${nature} done checks as well as ${launch.effort} on ${key(launch)}?`,
		default_key: `${nature}:${key(launch)}`, done: checks as Experiment["done"],
		brief_sha256: createHash("sha256").update(brief).digest("hex"), base_commit: base, lanes: [], status: "starting", started_at: new Date().toISOString(),
	};
	ledger.experiments.push(experiment);
	writeLedger(ledger); // Reserve before any process side effect; ambiguous failure cannot create a second pair.
	const appendix = `\n\nExperiment contract: ${experiment.question}\nRouting default tested: ${experiment.default_key}. Only effort differs. Both lanes use the same starting commit and brief. Stop after delivering evidence against each done check; do not merge, install, publish, or change live data. A blind cross-family judge chooses afterwards. On equal complete scores, lower effort wins. Write your final deliverable to experiment-result.md in this worktree.`;
	for (const [index, entry] of [launch, candidate].entries()) {
		const label = `${experiment.id}-${index === 0 ? "a" : "b"}`;
		const created = capture("herdr", ["worktree", "create", ...parent, "--branch", `phaedrus/experiment-${label.toLowerCase()}-${randomBytes(3).toString("hex")}`, "--base", base, "--label", `${basename(cwd)} ${label}`, "--no-focus"], 60_000);
		const result = isRecord(created.json) ? created.json.result : undefined;
		if (created.exitCode !== 0 || !isRecord(result) || !isRecord(result.root_pane) || !isRecord(result.workspace) || !isRecord(result.worktree)
			|| typeof result.root_pane.pane_id !== "string" || typeof result.workspace.workspace_id !== "string" || typeof result.worktree.path !== "string") {
			throw new CliError(`Experiment ${experiment.id} remains starting: cannot create ${label}: ${created.stderr}. Inspect before abandoning.`);
		}
		const lane: Lane = { pane_id: result.root_pane.pane_id, workspace_id: result.workspace.workspace_id, cwd: result.worktree.path, session: "", entry };
		experiment.lanes.push(lane);
		writeLedger(ledger);
		const overlay = writePlan(`${item}.${label}`, [entry], entry, options["state-dir"]);
		const exported = capture("herdr", ["pane", "run", lane.pane_id, `export PI_CONFIG_FILES=${shellWord(overlay.overlay)}`]);
		if (exported.exitCode !== 0) throw new CliError(`Experiment ${experiment.id} remains starting: cannot pin ${label}'s inherited roster: ${exported.stderr}.`);
		const name = `exp-${label.toLowerCase()}-${randomBytes(2).toString("hex")}`;
		const started = capture("herdr", ["agent", "start", name, "--kind", "omp", "--pane", lane.pane_id, "--", "--model", key(entry), "--thinking", entry.effort, "--config", overlay.overlay], 60_000);
		const startedResult = isRecord(started.json) ? started.json.result : undefined;
		const agent = isRecord(startedResult) ? startedResult.agent : undefined;
		if (started.exitCode !== 0 || !isRecord(agent) || !isRecord(agent.agent_session) || typeof agent.agent_session.value !== "string") {
			throw new CliError(`Experiment ${experiment.id} remains starting: cannot bind ${label}: ${started.stderr}. Inspect before abandoning.`);
		}
		lane.session = agent.agent_session.value;
		writeLedger(ledger);
	}
	for (const lane of experiment.lanes) {
		const prompted = capture("herdr", ["agent", "prompt", lane.pane_id, brief + appendix, "--wait", "--until", "working", "--timeout", "10000"], 15_000);
		if (prompted.exitCode !== 0) throw new CliError(`Experiment ${experiment.id} remains starting: ambiguous brief delivery for ${lane.pane_id}: ${prompted.stderr}. Do not resend without readback.`);
	}
	experiment.status = "running";
	writeLedger(ledger);
	return experiment;
}

function automaticJudge(experiment: Experiment): Entry {
	return experiment.lanes.some((lane) => lane.entry.provider === "anthropic")
		? { provider: "openai-codex", model: "gpt-6.1-sol", effort: "high" }
		: { provider: "anthropic", model: "claude-sonnet-5-5", effort: "high" };
}

function scheduleVerdict(experiment: Experiment): AdjudicationSchedule {
	const unit = `omp-verdict-${experiment.id.toLowerCase()}-${createHash("sha256").update(ledgerPath()).digest("hex").slice(0, 16)}.service`;
	const scheduled: AdjudicationSchedule = {
		unit, judge: automaticJudge(experiment), scheduled: false, status: "schedule-failed", error: null,
		state: null, logs: ["journalctl", "--user", "--unit", unit, "--no-pager"],
	};
	try {
		const binary = locate("systemd-run");
		if (!binary) throw new CliError("systemd-run is not on PATH or in ~/.local/bin.");
		const env: Record<string, string | undefined> = { ...process.env, HOME: process.env.HOME ?? homedir(), OMP_ROSTER_EXPERIMENTS_FILE: ledgerPath() };
		// Copy only native path/profile context. Passing names, not values, keeps secrets out of argv.
		const context = ["HOME", "PATH", "XDG_STATE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR",
			"PI_CODING_AGENT_DIR", "OMP_PROFILE", "HERDR_CONFIG_PATH", "HERDR_SOCKET_PATH", "DBUS_SESSION_BUS_ADDRESS"];
		const args = ["--no-ask-password", "--user", "--unit", unit, "--service-type=exec", "--expand-environment=no",
			"--remain-after-exit", "--working-directory=/", "--property=Restart=no",
			"--property=TimeoutStopSec=15s", "--property=KillMode=control-group", "--property=UMask=0077",
			"--property=StandardOutput=journal", "--property=StandardError=journal",
			...context.filter((name) => env[name] !== undefined).map((name) => `--setenv=${name}`),
			"--setenv=OMP_ROSTER_EXPERIMENTS_FILE", process.execPath, import.meta.path, "await-verdict", "--experiment", experiment.id, "--json"];
		// Wait only for service exec/start admission, never for the watcher or its engineers.
		const result = Bun.spawnSync({ cmd: [binary, ...args], env, stdout: "pipe", stderr: "pipe", timeout: READ_TIMEOUT_MS });
		if (result.exitedDueToTimeout || result.exitCode !== 0) {
			if (result.exitedDueToTimeout) scheduled.status = "schedule-unknown";
			throw new CliError(`systemd-run ${result.exitedDueToTimeout ? "start admission timed out" : `exited ${result.exitCode}`}.\nCommand: ${[binary, ...args].map(shellWord).join(" ")}\nStderr:\n${result.stderr.toString().trim() || "(empty)"}`);
		}
		scheduled.scheduled = true;
		scheduled.status = "status-unavailable";
		const control = locate("systemctl");
		if (!control) throw new CliError("The service was scheduled, but systemctl is unavailable to inspect it.");
		const shown = Bun.spawnSync({
			cmd: [control, "--user", "show", unit, "--no-pager", "--property=ActiveState", "--property=SubState", "--property=Result", "--property=ExecMainStatus"],
			env, stdout: "pipe", stderr: "pipe", timeout: READ_TIMEOUT_MS,
		});
		if (shown.exitedDueToTimeout || shown.exitCode !== 0) throw new CliError(`The service was scheduled, but its status could not be read: ${shown.stderr.toString().trim() || `systemctl exit ${shown.exitCode}`}.`);
		const properties = Object.fromEntries(shown.stdout.toString().trim().split("\n").map((line) => {
			const equals = line.indexOf("=");
			return [line.slice(0, equals), line.slice(equals + 1)];
		}));
		if (!properties.ActiveState || !properties.SubState || !properties.Result || !/^[0-9]+$/.test(properties.ExecMainStatus ?? "")) throw new CliError("The service was scheduled, but systemctl returned an unrecognised unit status.");
		scheduled.state = { active: properties.ActiveState, sub: properties.SubState, result: properties.Result, exit_code: Number(properties.ExecMainStatus) };
		scheduled.status = properties.ActiveState;
		if (properties.ActiveState === "failed" || properties.Result !== "success") scheduled.error = `Watcher ${properties.ActiveState}/${properties.SubState}: ${properties.Result}, exit ${properties.ExecMainStatus}.`;
	} catch (error) {
		scheduled.error = (error as Error).message;
	}
	return scheduled;
}

function boundLaneStatuses(experiment: Experiment): string[] {
	const snapshot = capture("herdr", ["agent", "list"]);
	const result = isRecord(snapshot.json) ? snapshot.json.result : undefined;
	if (snapshot.exitCode !== 0 || !isRecord(result) || !Array.isArray(result.agents)) throw new CliError(`Cannot inspect ${experiment.id}'s bound native agents: ${snapshot.stderr || "unrecognised agent list"}; no verdict or default was written.`);
	const agents = result.agents;
	return experiment.lanes.map((lane) => {
		const matches = agents.filter((agent) => isRecord(agent) && agent.pane_id === lane.pane_id);
		const agent = matches[0];
		if (matches.length !== 1 || !isRecord(agent) || agent.agent !== "omp" || agent.workspace_id !== lane.workspace_id
			|| typeof agent.cwd !== "string" || !isAbsolute(agent.cwd) || resolve(agent.cwd) !== resolve(lane.cwd)
			|| !isRecord(agent.agent_session) || agent.agent_session.kind !== "path" || agent.agent_session.value !== lane.session) {
			throw new CliError(`${experiment.id}: bound lane ${lane.pane_id} is missing or its workspace/cwd/session identity changed; inspect the recorded lane, do not relaunch it. No verdict or default was written.`);
		}
		const status = agent.agent_status;
		if (status !== "working" && status !== "idle" && status !== "done") throw new CliError(`${experiment.id}: bound lane ${lane.pane_id} is ${plainOrNull(status) ?? "unrecognised"}, not a settled lane; inspect it. No verdict or default was written.`);
		return status;
	});
}

function awaitVerdictCommand(args: string[]): number {
	const { values } = parseArgs({ args, options: { experiment: { type: "string" }, json: { type: "boolean" }, help: { type: "boolean", short: "h" } }, strict: true });
	if (values.help) { console.log(USAGE); return 0; }
	if (!values.experiment || !/^E-[0-9]{3,}$/.test(values.experiment)) throw new CliError("await-verdict requires --experiment E-NNN.", 2);
	const experiment = readLedger().experiments.find((record) => record.id === values.experiment);
	if (!experiment) throw new CliError(`Unknown experiment ${values.experiment}; no watcher or judge was started.`);
	const accepted = (record: Experiment): boolean => {
		if (record.status !== "verdict") return false;
		if (values.json) console.log(JSON.stringify({ experiment: record.id, status: "already-accepted", verdict: record.verdict }, null, 2));
		else console.log(`${record.id}: verdict already accepted; no second judge was run.`);
		return true;
	};
	if (accepted(experiment)) return 0;
	const unchanged = (record: Experiment | undefined): Experiment => {
		if (!record || !["running", "awaiting-verdict", "verdict"].includes(record.status)) throw new CliError(`${experiment.id} is ${record?.status ?? "missing"}, not ready for automatic adjudication.`);
		if (JSON.stringify(record.lanes) !== JSON.stringify(experiment.lanes)) throw new CliError(`${experiment.id}'s bound lanes changed while awaiting completion; no verdict or default was written.`);
		return record;
	};
	unchanged(experiment);
	for (const [index, lane] of experiment.lanes.entries()) {
		const current = unchanged(readLedger().experiments.find((record) => record.id === experiment.id));
		if (accepted(current)) return 0;
		boundLaneStatuses(experiment);
		// Native waiting has no journal lock or deadline; the named unit is explicitly stoppable.
		// Wake on invalid states as well, so blocked/unknown cannot be mistaken for success.
		const waitArgs = ["agent", "wait", lane.pane_id, "--until", "idle", "--until", "done", "--until", "blocked", "--until", "unknown"];
		const waited = capture("herdr", waitArgs, null);
		if (waited.exitCode !== 0) throw new CliError(`${experiment.id}: native wait failed for bound lane ${lane.pane_id} (exit ${waited.exitCode}).\nCommand: herdr ${waitArgs.map(shellWord).join(" ")}\nStderr: ${waited.stderr || "(empty)"}\nExperiment remains pending; no verdict or default was written.`);
		if (boundLaneStatuses(experiment)[index] === "working") throw new CliError(`${experiment.id}: native wait returned while ${lane.pane_id} is still working; no verdict or default was written.`);
	}
	const ready = withLedgerLock(() => {
		const ledger = readLedger();
		const current = unchanged(ledger.experiments.find((record) => record.id === experiment.id));
		if (current.status === "verdict") return current;
		if (boundLaneStatuses(experiment).some((status) => status === "working")) throw new CliError(`${experiment.id}: a bound lane resumed work; no verdict or default was written.`);
		if (current.status === "running") { current.status = "awaiting-verdict"; writeLedger(ledger); }
		return current;
	}, true);
	if (accepted(ready)) return 0;
	const judge = automaticJudge(experiment);
	return experimentCommand(["verdict", "--experiment", experiment.id,
		"--artifact-a", join(experiment.lanes[0]!.cwd, "experiment-result.md"), "--artifact-b", join(experiment.lanes[1]!.cwd, "experiment-result.md"),
		"--judge", key(judge), "--thinking", judge.effort, ...(values.json ? ["--json"] : [])], {
		approvedModels,
		waitForLock: true,
		routeUsable: (entry) => {
			// The verdict owner invokes this inside its lock, including its final acceptance check.
			unchanged(readLedger().experiments.find((record) => record.id === experiment.id));
			if (boundLaneStatuses(experiment).some((status) => status === "working")) throw new CliError(`${experiment.id}: a bound lane is working, not ready for a verdict; no default was written.`);
			return !("skip" in routeState(entry, usageView(undefined).rows));
		},
	});
}

function abandonCommand(args: string[]): number {
	const { values } = parseArgs({ args, options: { experiment: { type: "string" }, reason: { type: "string" } }, strict: true });
	if (!values.experiment || !values.reason?.trim()) throw new CliError("Abandon requires --experiment and a stated --reason.", 2);
	return withLedgerLock(() => {
		const ledger = readLedger();
		const experiment = ledger.experiments.find((record) => record.id === values.experiment);
		if (!experiment || ["verdict", "abandoned"].includes(experiment.status)) throw new CliError("No unfinished experiment with that id.");
		const snapshot = capture("herdr", ["agent", "list"]);
		const result = isRecord(snapshot.json) ? snapshot.json.result : undefined;
		if (snapshot.exitCode !== 0 || !isRecord(result) || !Array.isArray(result.agents)) throw new CliError("Cannot inspect experiment lanes before abandonment.");
		const agents = result.agents as Record<string, unknown>[];
		if (experiment.lanes.some((lane) => liveLane(lane, agents)
			|| (experiment.status === "starting" && !lane.session && agents.some((agent) => agent.pane_id === lane.pane_id && agent.agent === "omp")))) {
			throw new CliError("Cannot abandon a live or unbound OMP lane; settle the owned experiment agents first.");
		}
		experiment.status = "abandoned";
		ledger.opt_outs.push({ item: experiment.item, reason: `Abandoned ${experiment.id}: ${values.reason.trim()}`, at: new Date().toISOString() });
		writeLedger(ledger);
		console.log(experiment.id);
		return 0;
	});
}

const recordName = (item: string, digest: string) => `${item}.${digest}.launch.json`;

type LaunchRecord = { roster: Entry[]; ticketSha?: string; launched_at: string; at: number; path: string; primaries: Record<string, string> };

function readLaunchRecord(path: string, item: string): LaunchRecord {
	const doc = readJson(path, "launch record");
	const at = isRecord(doc) && typeof doc.launched_at === "string" ? Date.parse(doc.launched_at) : Number.NaN;
	const refused = new CliError(`The launch record at ${path} is not one omp-roster wrote.`);
	if (!isRecord(doc) || doc.item !== item || Number.isNaN(at) || (doc.schema_version !== undefined && doc.schema_version !== 2)) throw refused;
	let roster: Entry[];
	try { roster = rosterOf({ roster: doc.roster }, item, doc.schema_version === undefined); }
	catch { throw refused; }
	if (doc.ticket_roster_sha256 !== undefined && (typeof doc.ticket_roster_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(doc.ticket_roster_sha256))) throw refused;
	return { roster, ticketSha: doc.ticket_roster_sha256 as string | undefined, launched_at: doc.launched_at as string, at, path, primaries: doc.schema_version === 2 ? CHECK_PRIMARIES : HISTORICAL_CHECK_PRIMARIES };
}

// Every launch record for the item, oldest first. The pattern is exact so an item id that is a
// prefix of another (`K-1` and `K-1.2`) never reads the other's records.
function launchRecords(dir: string, item: string): LaunchRecord[] {
	if (!existsSync(dir)) return [];
	const name = new RegExp(`^${item.replaceAll(".", "\\.")}\\.[0-9a-f]{8}\\.launch\\.json$`);
	return readdirSync(dir).filter((file) => name.test(file)).sort().map((file) => readLaunchRecord(join(dir, file), item)).sort((a, b) => a.at - b.at);
}

// A launch without a ticket has no board roster, so its synthetic id says so and `check` reads no board.
const ADHOC_PREFIX = "adhoc-";

function adhocRoster(model: string | undefined, thinking: string | undefined): { item: string; roster: Entry[] } {
	if (model === undefined || thinking === undefined) {
		throw new CliError(`A launch without --item needs both --model provider/model and --thinking effort.\n${USAGE}`, 2);
	}
	if (model.includes(":")) throw new CliError(`--model takes provider/model with no effort suffix; give the effort with --thinking, not ${plain(model)}.`, 2);
	const slash = model.indexOf("/");
	if (slash <= 0 || slash === model.length - 1) throw new CliError(`--model needs provider/model, not ${plain(model)}.`, 2);
	const entry = { provider: model.slice(0, slash), model: model.slice(slash + 1), effort: thinking };
	const roster = rosterOf({ roster: [entry] }, "the --model launch");
	const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
	const item = `${ADHOC_PREFIX}${entry.provider}-${entry.model.replaceAll("/", "-")}-${stamp}`;
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(item)) throw new CliError(`Cannot name a launch for ${plain(model)}.`);
	return { item, roster };
}

function writePlan(item: string, roster: Entry[], launch: Entry, explicit?: string, ticketSha?: string) {
	const sha = rosterSha(roster);
	const dir = stateDir(explicit);
	const body = overlayText(item, sha, roster, launch) + (ticketSha ? `# ticket_roster_sha256: ${ticketSha}\n` : "");
	const digest = createHash("sha256").update(body).digest("hex").slice(0, 8);
	const overlay = join(dir, `${item}.${digest}.yml`);
	if (overlay.includes(delimiter)) throw new CliError(`The overlay path ${plain(overlay)} contains "${delimiter}", which PI_CONFIG_FILES cannot carry.`);
	writeStateFile(dir, basename(overlay), body);
	const record = join(dir, recordName(item, digest));
	let text: string | null = null;
	try { readLaunchRecord(record, item); text = readFileSync(record, "utf8"); }
	catch { /* new snapshot */ }
	if (text === null) {
		text = `${JSON.stringify({ schema_version: 2, item, roster, roster_sha256: sha, ticket_roster_sha256: ticketSha, launch: plain(selector(launch)), overlay, launched_at: new Date().toISOString() }, null, 2)}\n`;
		writeStateFile(dir, basename(record), text);
	}
	writeStateFile(dir, `${item}.launch.json`, text);
	return { overlay, record, env: { PI_CONFIG_FILES: overlay }, args: ["--model", key(launch), "--thinking", launch.effort, "--config", overlay] };
}

function launchCommand(options: LaunchOptions & { item?: string; model?: string; thinking?: string }): number {
	if ((options.harness ?? "omp") !== "omp") {
		throw new CliError("Only --harness omp enforces a ticket roster; Pi enforcement is a later slice.");
	}
	let item: string;
	let roster: Entry[];
	let ticket: unknown = null;
	let defaultEvidence: string | null = null;
	const reasons = [options.tiny, options["live-data"], options["no-experiment"]].filter((reason) => reason !== undefined);
	if (reasons.length > 1 || reasons.some((reason) => !reason?.trim())) throw new CliError("Give one nonempty experiment opt-out reason.", 2);
	if (options.item !== undefined) {
		if (options.model !== undefined || options.thinking !== undefined) {
			throw new CliError("--item takes its model from the ticket's roster; do not give --model or --thinking with it.", 2);
		}
		item = itemOf(options.item);
		if (item.startsWith(ADHOC_PREFIX)) throw new CliError(`Board item ids cannot start with "${ADHOC_PREFIX}": that prefix names a launch without a ticket.`, 2);
		ticket = ticketOf(item, options["ticket-json"]);
		roster = rosterOf(ticket, item);
		if (options["use-default"]) {
			if (!isRecord(ticket) || !["build", "design", "research"].includes(ticket.nature as string)) throw new CliError("--use-default requires a qualifying ticket nature.");
			const defaults = readLedger().defaults;
			roster = roster.map((entry, index) => {
				if (index !== 0) return entry;
				const learned = defaults[`${ticket.nature}:${key(entry)}`];
				if (!learned) throw new CliError(`No verdict-backed default for ${ticket.nature}:${key(entry)}.`);
				defaultEvidence = learned.evidence;
				return learned.entry;
			});
			roster = rosterOf({ roster }, item);
		}
	} else {
		if (options["ticket-json"] !== undefined) throw new CliError("--ticket-json goes with --item; a launch with --model reads no ticket.", 2);
		({ item, roster } = adhocRoster(options.model, options.thinking));
	}
	const { working, limit } = enforceEngineerLimit();
	const engineerCapacity = { working, limit };
	enforceDisplayBoundary();
	const memory = memorySnapshot(options["memory-json"]);
	for (const warning of memory.warnings) console.error(`warning: ${plain(warning)}`);
	const { rows, freshness } = usageView(options["usage-json"]);
	const sha = rosterSha(roster);
	const skipped: Skip[] = [];
	let launch: Entry | undefined;
	let route: { verdict: "usable" | "low"; degraded: string | null } | undefined;
	for (const entry of roster) {
		const state = routeState(entry, rows);
		if ("skip" in state) { skipped.push(state.skip); continue; }
		const refusal = probeRoute(entry);
		if (refusal) { skipped.push(refusal); continue; }
		launch = entry;
		route = state;
		break;
	}
	if (!launch || !route) {
		if (options.json) console.log(JSON.stringify({ item, launch: null, skipped, roster_sha256: sha, engineer_capacity: engineerCapacity }, null, 2));
		console.error(`omp-roster: roster exhausted for ${item}; nothing was launched.\n${skipped.map((skip) => `  ${skipLine(skip)}`).join("\n")}`);
		return EXHAUSTED;
	}
	const overlayDirectory = stateDir(options["state-dir"]);
	if (overlayDirectory.includes(delimiter)) throw new CliError(`The overlay path ${plain(overlayDirectory)} contains "${delimiter}", which PI_CONFIG_FILES cannot carry.`);
	const qualifies = isRecord(ticket) && ["build", "design", "research"].includes(ticket.nature as string);
	const ticketSha = options["use-default"] ? rosterSha(rosterOf(ticket, item)) : undefined;
	const outcome: { started: boolean; pair: { status: string; file: string; experiment?: Experiment }; overlay: string | null; record: string | null; env: { PI_CONFIG_FILES?: string }; args: string[] } = qualifies || reasons.length ? withLedgerLock(() => {
		const ledger = readLedger();
		// Route probing happens before this lock; its earlier agent snapshot cannot settle a new reservation.
		const fresh = readEngineerCapacity();
		engineerCapacity.working = fresh.working;
		engineerCapacity.limit = fresh.limit;
		importLegacyPair(ledger, fresh.agents);
		let pair = currentPair(ledger, fresh.agents);
		if (reasons.length) {
			ledger.opt_outs.push({ item, reason: reasons[0]!.trim(), at: new Date().toISOString() });
			writeLedger(ledger);
		}
		if (qualifies && !reasons.length && pair.status === "starting") throw new CliError(`Experiment ${pair.experiment!.id} has an unresolved start; inspect its lanes before abandoning.`);
		if (qualifies && !reasons.length && pair.status === "none") {
			const experiment = startPair(ledger, item, ticket as Record<string, unknown>, launch!, options, engineerCapacity.working, engineerCapacity.limit);
			pair = { status: "live", file: ledgerPath(), experiment };
			return { started: true, pair, overlay: null, record: null, env: {}, args: [] as string[] };
		}
		return { started: false, pair, ...writePlan(item, roster, launch!, options["state-dir"], ticketSha) };
	}) : { started: false, pair: { status: "not-applicable", file: ledgerPath() }, ...writePlan(item, roster, launch, options["state-dir"]) };
	const adjudication = outcome.started ? scheduleVerdict(outcome.pair.experiment!) : null;
	if (adjudication?.error) console.error(`omp-roster: ${outcome.pair.experiment!.id}'s pair is already started; automatic adjudication ${adjudication.status}: ${adjudication.error}\nInspect ${adjudication.logs.map(shellWord).join(" ")}. Do not roll back, relaunch, or dispatch another engineer.`);
	const degraded = route.degraded ?? freshness.degraded_reason;
	if (route.verdict === "low") console.error(`warning: ${plain(selector(launch))} is low on capacity and may run out soon`);
	if (degraded) console.error(`warning: the ai-usage reading is degraded: ${degraded}`);
	if (options.json) {
		const usage = { ...freshness, degraded: freshness.degraded || route.degraded !== null, degraded_reason: degraded };
		console.log(JSON.stringify({
			item, launch: { ...launch, selector: plain(selector(launch)), verdict: route.verdict }, ...outcome, adjudication, skipped, roster_sha256: sha, usage, memory, engineer_capacity: engineerCapacity,
			default_evidence: options["use-default"] && launch === roster[0] ? defaultEvidence : null,
		}, null, 2));
	} else {
		for (const skip of skipped) console.error(`skipped ${skipLine(skip)}`);
		if (outcome.started) {
			console.log(`Started ${outcome.pair.experiment!.id}: ${outcome.pair.experiment!.lanes.map((lane) => lane.pane_id).join(", ")}`);
			console.log(`Automatic adjudication: ${adjudication!.unit} (${adjudication!.status}); ${adjudication!.logs.map(shellWord).join(" ")}`);
		}
		else {
			console.log(`export PI_CONFIG_FILES=${shellWord(outcome.env.PI_CONFIG_FILES!)}`);
			console.log(outcome.args.map(shellWord).join(" "));
		}
	}
	return adjudication?.error ? 1 : 0;
}

// A session file plus the sibling directory OMP keeps its subagent files in, or a whole directory.
function sessionFiles(paths: string[]): string[] {
	const files = new Set<string>();
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const child = join(dir, entry.name);
			if (entry.isDirectory()) walk(child);
			else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.add(child);
		}
	};
	for (const path of paths.map((given) => resolve(given))) {
		let stat;
		try { stat = statSync(path); }
		catch { throw new CliError(`Cannot read the session path ${path}.`); }
		if (stat.isDirectory()) { walk(path); continue; }
		files.add(path);
		const subagents = path.replace(/\.jsonl$/, "");
		if (subagents !== path && existsSync(subagents) && statSync(subagents).isDirectory()) walk(subagents);
	}
	return [...files].sort();
}

// OMP appends to a live session, so a last line with no newline may be half written: skip it. A
// bad line that ends in a newline is corruption and stops the check.
function* records(file: string): Generator<Record<string, unknown>> {
	let body: string;
	try { body = readFileSync(file, "utf8"); }
	catch { throw new CliError(`Cannot read the session file ${file}.`); }
	let number = 0;
	for (let start = 0; start < body.length; ) {
		let end = body.indexOf("\n", start);
		const unterminated = end < 0;
		if (unterminated) end = body.length;
		const line = body.slice(start, end).trim();
		start = end + 1;
		number++;
		if (!line) continue;
		let record: unknown;
		try { record = JSON.parse(line); }
		catch {
			if (unterminated) return;
			throw new CliError(`Line ${number} of ${file} is not valid JSON, so the session cannot be checked.`);
		}
		if (isRecord(record)) yield record;
	}
}

// A subagent file belongs to the session whose sibling directory holds it: `S.jsonl` owns `S/`.
// The outermost such session file is the one that was launched.
function rootSession(file: string): string {
	let current = file;
	for (;;) {
		const parent = `${dirname(current)}.jsonl`;
		if (dirname(current) === current || !existsSync(parent)) return current;
		current = parent;
	}
}

const rosterText = (roster: Entry[]) => roster.map((entry, index) => `${index + 1} ${plain(selector(entry))}`).join(", ");

// What a file was judged against: a launch record, the ticket's current roster, or (when the board
// cannot be read) the earliest launch record.
type Basis = { heading: string; roster: Entry[]; position: Map<string, number>; record: LaunchRecord | null; primaries: Record<string, string>; files: string[] };

function checkCommand(item: string, paths: string[], options: CheckOptions): number {
	if (paths.length === 0) throw new CliError("check needs at least one --session path.", 2);
	const since = options.since ?? null;
	if (since !== null && Number.isNaN(Date.parse(since))) throw new CliError(`--since needs an ISO-8601 time, not ${plain(since)}.`, 2);
	const sinceMs = since === null ? null : Date.parse(since);
	const adhoc = item.startsWith(ADHOC_PREFIX);
	if (adhoc && options["ticket-json"] !== undefined) throw new CliError("--ticket-json goes with a board item; an adhoc- launch reads no ticket.", 2);
	const launches = launchRecords(stateDir(options["state-dir"]), item);
	if (adhoc && launches.length === 0) {
		throw new CliError(`No launch record for ${item} in ${stateDir(options["state-dir"])}: a launch without a ticket is checked only against what \`omp-roster launch --model\` recorded.`);
	}
	let current: Entry[] | null = null;
	let unreadable = "";
	try { if (!adhoc) current = rosterOf(ticketOf(item, options["ticket-json"]), item, true); }
	catch (error) {
		// With a launch record the engineer's roster is known, so a board that cannot answer is a
		// finding, not a reason to stop. Without one there is nothing to judge against.
		if (!(error instanceof CliError) || error.exitCode !== 1 || launches.length === 0) throw error;
		unreadable = error.message.replace(/[.\s]+$/, "");
	}

	const files = sessionFiles(paths);
	const started = new Map<string, number | null>();
	const startOf = (file: string) => {
		if (!started.has(file)) {
			let first: number | null = null;
			for (const record of records(file)) {
				const at = typeof record.timestamp === "string" ? Date.parse(record.timestamp) : Number.NaN;
				if (!Number.isNaN(at)) { first = at; break; }
			}
			started.set(file, first);
		}
		return started.get(file) ?? null;
	};
	const bases = new Map<string, Basis>();
	const basisFor = (record: LaunchRecord | null): Basis => {
		const used = record ?? (current === null ? launches[0] : null);
		const id = record ? record.path : used ? `earliest ${used.path}` : "current";
		let basis = bases.get(id);
		if (!basis) {
			const roster = used?.roster ?? (current as Entry[]);
			// A cash route is never launched or chained, so a turn on one is never on the roster.
			const position = new Map<string, number>();
			for (const [index, entry] of roster.entries()) if (!isCash(entry) && !position.has(key(entry))) position.set(key(entry), index + 1);
			const heading = record
				? `judged against launch record ${record.path} (launched ${record.launched_at}; roster: ${rosterText(roster)})`
				: used
					? `judged against the earliest launch record ${used.path} because ${adhoc ? "no record is at or before this file started" : "the board's roster could not be read"} (roster: ${rosterText(roster)})`
					: "judged against the ticket's current roster (no launch record at or before these files started)";
			basis = { heading, roster, position, record, primaries: used?.primaries ?? CHECK_PRIMARIES, files: [] };
			bases.set(id, basis);
		}
		return basis;
	};
	// Each session file is judged against the newest launch that started at or before it did. Subagent
	// files take their session's start; a file whose start cannot be read has no launch to speak of.
	const plan = files.map((file) => {
		const start = startOf(rootSession(file)) ?? startOf(file);
		let chosen: LaunchRecord | null = null;
		if (start !== null) for (const launch of launches) if (launch.at <= start) chosen = launch;
		const basis = basisFor(chosen);
		basis.files.push(file);
		return { file, start, basis };
	});
	let newest: (typeof plan)[number] | null = null;
	for (const entry of plan) if (entry.start !== null && (newest === null || entry.start >= (newest.start as number))) newest = entry;
	const reference = newest?.basis ?? basisFor(null);

	// A launch without a ticket has no board roster to have changed.
	let changedLine: string | null = null;
	if (launches.length > 0 && !adhoc) {
		if (current === null) changedLine = `roster changed since launch: the board's roster could not be read (${unreadable})`;
		else if (newest?.basis.record && (newest.basis.record.ticketSha ?? rosterSha(newest.basis.record.roster)) !== rosterSha(current)) {
			changedLine = `roster changed since launch: the board now has roster_sha256 ${rosterSha(current)}`;
		}
	}

	const onRoster = new Map<string, { model: string; position: number; count: number }>();
	const offRoster = new Map<string, { file: string; model: string; count: number; first: string; last: string }>();
	const switches: { file: string; at: string; model: string; position: number | undefined }[] = [];
	const nothingJudged: { file: string; turns: number; floor: number }[] = [];
	let engineerFiles = 0;
	let helperFiles = 0;
	let helperTurns = 0;
	let earlier = 0;
	for (const { file, basis } of plan) {
		const floor = sinceMs ?? basis.record?.at ?? null;
		let turns = 0;
		let judgedTurns = 0;
		// The advisor sidecar is named for its role; a subagent file says which role it ran as in its
		// `session_init` record (a scout or sonic reports `smol`, an engineer's task agent `task`, the
		// designer `vision`).
		let helperRole: string | null = basename(file).startsWith(ADVISOR_FILE) ? "advisor" : null;
		for (const record of records(file)) {
			const at = typeof record.timestamp === "string" ? record.timestamp : "unknown time";
			const message = record.message;
			if (record.type === "session_init") {
				if (record.agent === "designer") helperRole = "vision";
				else if (typeof record.modelRole === "string" && Object.hasOwn(CHECK_PRIMARIES, record.modelRole)) helperRole = record.modelRole;
				continue;
			}
			const assistant = record.type === "message" && isRecord(message) && message.role === "assistant";
			if (assistant) turns++;
			if (!assistant && !(record.type === "model_change" && record.resolvedModelIsFallback === true)) continue;
			// A timestamp that cannot be read is judged rather than skipped.
			if (floor !== null && Date.parse(at) < floor) { earlier++; continue; }
			if (assistant) judgedTurns++;
			if (!assistant) {
				const model = typeof record.model === "string" ? plain(record.model) : "(no model recorded)";
				switches.push({ file, at, model, position: basis.position.get(model) });
				continue;
			}
			const { provider, model: id } = message as Record<string, unknown>;
			const model = typeof provider === "string" && provider && typeof id === "string" && id
				? plain(`${provider}/${id}`)
				: "(no provider and model recorded)";
			if (helperRole && model === basis.primaries[helperRole]) { helperTurns++; continue; }
			if ((helperRole === "reviewer" || helperRole === "security-reviewer")
				&& model === "anthropic/claude-sonnet-5-5") { helperTurns++; continue; }
			const position = basis.position.get(model);
			if (position !== undefined) {
				const seen = onRoster.get(`${model}\0${position}`) ?? { model, position, count: 0 };
				seen.count++;
				onRoster.set(`${model}\0${position}`, seen);
				continue;
			}
			const group = offRoster.get(`${file}\0${model}`) ?? { file, model, count: 0, first: at, last: at };
			group.count++;
			group.last = at;
			offRoster.set(`${file}\0${model}`, group);
		}
		// A launch's file that has turns but had none of them judged would pass for nothing.
		if (basis.record && turns > 0 && judgedTurns === 0) nothingJudged.push({ file, turns, floor: floor as number });
		if (helperRole) helperFiles++;
		else engineerFiles++;
	}
	if (engineerFiles === 0) throw new CliError(`No engineer session file was found under ${paths.join(", ")}.`);

	const offSwitches = switches.filter((change) => change.position === undefined).length;
	const offTurns = [...offRoster.values()].reduce((sum, group) => sum + group.count, 0);
	const clean = offTurns + offSwitches + nothingJudged.length === 0 && changedLine === null;
	console.log([
		`omp-roster check for ${item}`,
		launches.length > 0
			? `launch records: ${launches.length}`
			: "no launch record for this item: judged against the ticket's current roster",
		...(launches.length > 0 ? [...bases.values()].flatMap((basis) => basis.files.length ? [`${basis.heading}: ${basis.files.length} file(s)`, ...basis.files.map((file) => `  ${file}`)] : []) : []),
		`roster: ${rosterText(reference.roster)}`,
		`roster_sha256: ${rosterSha(reference.roster)}`,
		...(changedLine ? [changedLine] : []),
		sinceMs !== null
			? `judging records at or after ${since}; ${earlier} earlier record(s) not judged`
			: launches.length > 0
				? `judging each file from its launch record's time on; ${earlier} earlier record(s) not judged`
				: "judging every record",
		...nothingJudged.map(({ file, turns, floor }) => `nothing was judged in ${file}: it has ${turns} assistant turn(s) and none is at or after ${new Date(floor).toISOString()}`),
		`read ${files.length} session file(s); ${helperTurns} helper turn(s) in ${helperFiles} file(s) ran on their role's approved primary and were not judged`,
		`turns on the roster: ${[...onRoster.values()].reduce((sum, seen) => sum + seen.count, 0)}`,
		...[...onRoster.values()].map((seen) => `  ${seen.model} (roster position ${seen.position}): ${seen.count}`),
		`turns off the roster: ${offTurns}`,
		...[...offRoster.values()].map((group) => `  ${group.file} ${group.model} off roster: ${group.count} turn(s), first ${group.first}, last ${group.last}`),
		`fallback switches: ${switches.length}`,
		...switches.map((change) => `  ${change.file} ${change.at} switched to ${change.model} (${change.position === undefined ? "off roster" : `roster position ${change.position}`})`),
		clean
			? "clean: every checked turn ran on the roster or on a helper's approved primary."
			: `NOT CLEAN: ${changedLine ? "the roster changed since launch; " : ""}${nothingJudged.length ? `${nothingJudged.length} file(s) with turns but nothing judged; ` : ""}${offTurns} turn(s) and ${offSwitches} fallback switch(es) off the roster.`,
	].join("\n"));
	return clean ? 0 : OFF_ROSTER;
}

function itemOf(value: string | undefined): string {
	// The id becomes a file name, so it must not carry a path.
	if (value === undefined || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
		throw new CliError(`--item needs a board item id.\n${USAGE}`, 2);
	}
	return value;
}

function run(argv: string[]): number {
	const [command, ...args] = argv;
	if (command === "capacity") {
		const { values } = parseArgs({
			args,
			options: { json: { type: "boolean" }, help: { type: "boolean", short: "h" } },
			strict: true,
		});
		if (values.help) { console.log(USAGE); return 0; }
		return capacityCommand(values);
	}
	if (command === "launch") {
		const { values } = parseArgs({
			args,
			options: {
				item: { type: "string" }, "ticket-json": { type: "string" }, "usage-json": { type: "string" }, "memory-json": { type: "string" },
				"state-dir": { type: "string" }, harness: { type: "string" }, json: { type: "boolean" }, help: { type: "boolean", short: "h" },
				model: { type: "string" }, thinking: { type: "string" },
				cwd: { type: "string" }, "brief-file": { type: "string" }, tiny: { type: "string" }, "live-data": { type: "string" }, "no-experiment": { type: "string" }, "use-default": { type: "boolean" },
			},
			strict: true,
		});
		if (values.help) { console.log(USAGE); return 0; }
		return launchCommand(values);
	}
	if (command === "abandon") return abandonCommand(args);
	if (command === "await-verdict") return awaitVerdictCommand(args);
	if (command === "defaults" || command === "verdict") {
		return experimentCommand([command, ...args], {
			approvedModels,
			routeUsable: (entry) => !("skip" in routeState(entry, usageView(undefined).rows)),
		});
	}
	if (command === "memory") {
		const { values } = parseArgs({
			args,
			options: { json: { type: "boolean" }, "memory-json": { type: "string" }, help: { type: "boolean", short: "h" } },
			strict: true,
		});
		if (values.help) { console.log(USAGE); return 0; }
		return memoryCommand(values);
	}
	if (command === "check") {
		const { values, positionals } = parseArgs({
			args,
			options: {
				item: { type: "string" }, "ticket-json": { type: "string" }, "state-dir": { type: "string" }, since: { type: "string" },
				session: { type: "string", multiple: true }, help: { type: "boolean", short: "h" },
			},
			allowPositionals: true,
			strict: true,
		});
		if (values.help) { console.log(USAGE); return 0; }
		return checkCommand(itemOf(values.item), [...(values.session ?? []), ...positionals], values);
	}
	if (command === "-h" || command === "--help") { console.log(USAGE); return 0; }
	throw new CliError(`Unknown or missing command.\n${USAGE}`, 2);
}

if (import.meta.main) {
	try {
		process.exitCode = run(process.argv.slice(2));
	} catch (error) {
		const cause = error as Error & { code?: string };
		// parseArgs failures are the caller's usage mistakes.
		const usage = cause.code?.startsWith("ERR_PARSE_ARGS") === true;
		console.error(`omp-roster: ${usage ? `${cause.message}\n${USAGE}` : error instanceof CliError ? cause.message : plain(cause.message)}`);
		process.exitCode = usage ? 2 : error instanceof CliError ? error.exitCode : 1;
	}
}
