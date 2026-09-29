#!/usr/bin/env bun
// omp-roster (US-046, extending US-014): launch an OMP engineer only on a board ticket's ranked
// model roster, then check that its session stayed on it.
//
// `omp-config/install` copies this one file to ~/.local/bin, so it imports only Node and Bun
// built-ins. omp-model-policy.ts imports the approved-model table below for that reason: one
// table, and the deployed launcher stays a single file.

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const LOW_TO_MAX = ["low", "medium", "high", "xhigh", "max"];
// The board's effort vocabulary, used where no approved-model entry narrows it.
const ANY_EFFORT = ["minimal", ...LOW_TO_MAX];

// Pin concrete catalog IDs: accepting a prefix here would let a typo resolve fuzzily.
// `usage` names the model's row in `ai-usage dispatch`; null means ai-usage has none, so the
// model is approved for a roster but never launchable.
export const approvedModels: Record<string, {
	efforts: readonly string[];
	usage: { provider: string; model: string } | null;
}> = {
	"anthropic/claude-opus-5-5": { efforts: LOW_TO_MAX, usage: { provider: "anthropic", model: "opus" } },
	"anthropic/claude-sonnet-5-5": { efforts: LOW_TO_MAX, usage: { provider: "anthropic", model: "sonnet" } },
	"openai-codex/gpt-6-astra": { efforts: LOW_TO_MAX, usage: { provider: "openai-codex", model: "gpt-6-astra" } },
	"openai-codex/gpt-6-sol": { efforts: LOW_TO_MAX, usage: { provider: "openai-codex", model: "gpt-6-sol" } },
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
// Helper roles keep the US-014 primary model config.yml gives them (the reviewer stays a different
// family from the author). Only their recovery is restricted: the overlay chains each to roster
// models. `check` reads a helper's turn on this primary as a helper turn, not a violation. The
// omp-roster test holds this table to config.yml. `vision` (the designer) and `web` are not here:
// vision has no fallback and web search is not a chat model.
const HELPER_PRIMARIES: Record<string, string> = {
	advisor: "anthropic/claude-sonnet-5-5",
	plan: "openai-codex/gpt-6-astra",
	reviewer: "openai-codex/gpt-6-sol",
	"security-reviewer": "openai-codex/gpt-6-astra",
	smol: "openai-codex/gpt-6-luna",
	tiny: "openai-codex/gpt-6-luna",
	commit: "openai-codex/gpt-6-luna",
};
const VERDICTS: Record<string, true> = { usable: true, low: true, exhausted: true, blocked: true, unknown: true };
const ADVISOR_FILE = "__advisor";
const EXHAUSTED = 3;
const OFF_ROSTER = 4;
const READ_TIMEOUT_MS = 15_000;

// `check` also excuses the designer (`vision` role) on Opus 5.5, which the subagent-inheritance
// extension forces. The overlay writes no chain for vision, so this is `check`'s table only.
const CHECK_PRIMARIES: Record<string, string> = { ...HELPER_PRIMARIES, vision: "anthropic/claude-opus-5-5" };

type Entry = { provider: string; model: string; effort: string };
type UsageRow = { harness?: unknown; provider?: unknown; model?: unknown; verdict: string; reason?: unknown; next_reset?: unknown; degraded?: unknown };
type Skip = { selector: string; verdict: string | null; reason: string; next_reset: string | null };
type Freshness = { degraded: boolean; degraded_reason: string | null; oldest_observation: string | null; stale_after_seconds: number | null };
type LaunchOptions = { harness?: string; json?: boolean; "ticket-json"?: string; "usage-json"?: string; "state-dir"?: string };
type CheckOptions = { "ticket-json"?: string; "state-dir"?: string; since?: string };

const USAGE = `Usage:
  omp-roster launch --item ID [--ticket-json FILE] [--usage-json FILE] [--state-dir DIR] [--harness omp] [--json]
  omp-roster check --item ID --session DIR|FILE... [--ticket-json FILE] [--state-dir DIR] [--since ISO]
Exit: 0 done, 1 refused or unreadable input, 2 usage, 3 roster exhausted, 4 turns off the roster or the roster changed`;

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
function capture(name: string, args: string[]): { json: unknown; stderr: string; exitCode: number } {
	const fallback = join(homedir(), ".local", "bin", name);
	const binary = Bun.which(name) ?? (existsSync(fallback) ? fallback : null);
	if (!binary) throw new CliError(`${name} is not on PATH or in ~/.local/bin.`);
	const result = Bun.spawnSync({ cmd: [binary, ...args], stdout: "pipe", stderr: "pipe", timeout: READ_TIMEOUT_MS });
	if (result.exitedDueToTimeout) throw new CliError(`${name} did not answer within ${READ_TIMEOUT_MS / 1000} seconds.`);
	let json: unknown = null;
	try { json = JSON.parse(result.stdout.toString()); }
	catch { /* not JSON: the caller reports stderr */ }
	return { json, stderr: plain(result.stderr.toString().trim().split("\n").at(-1) ?? ""), exitCode: result.exitCode ?? -1 };
}

// The board's answer document. With --ticket-json a file may hold that document or, for fixtures,
// just the ticket. Returns the ticket, or null when the item has none.
function ticketOf(item: string, file: string | undefined): unknown {
	let doc: unknown;
	if (file) {
		doc = readJson(file, "ticket file");
		if (!isRecord(doc) || !("data" in doc)) return doc;
	} else {
		const answer = capture("board", ["query", "items", "--item", item, "--json"]);
		doc = answer.json;
		if (answer.exitCode !== 0 || !isRecord(doc)) {
			throw new CliError(`The board could not read ${item}: ${(isRecord(doc) && plainOrNull(doc.error)) || answer.stderr || "no answer"}.`);
		}
	}
	const data = isRecord(doc) ? doc.data : undefined;
	if (!isRecord(data) || data.state !== "ok" || !isRecord(data.value)) {
		throw new CliError(`The board's answer for ${item} is not ready.`);
	}
	return data.value.ticket ?? null;
}

function rosterOf(ticket: unknown, item: string): Entry[] {
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
		const approved = approvedModels[key(entry)];
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

function skipLine(skip: Skip): string {
	const reset = skip.next_reset ? `; resets ${skip.next_reset}` : skip.verdict === "exhausted" ? "; reset time unknown" : "";
	return `${skip.selector}: ${skip.verdict ? `${skip.verdict}, ` : ""}${skip.reason}${reset}`;
}

// Fallback chains name only roster models, so a hop can never leave the roster; an empty chain
// stops the session at the provider's error. Cash routes are excluded from every chain. An
// engineer role never chains to the launch model. A helper role keeps its own primary and chains
// to the whole roster in rank order, minus that primary's model.
function overlayText(item: string, sha: string, roster: Entry[], launch: Entry): string {
	const chainable = roster.filter((entry) => !isCash(entry));
	const others = (model: string) => chainable.filter((entry) => key(entry) !== model).map(selector);
	const scalar = (value: string) => {
		if (!/^[A-Za-z0-9][A-Za-z0-9./:_-]*$/.test(value)) throw new CliError(`Cannot write ${plain(value)} into an overlay.`);
		return value;
	};
	const lines = [
		`# omp-roster overlay for ${item} (US-046); regenerated by \`omp-roster launch\`.`,
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
	for (const [role, primary] of Object.entries(HELPER_PRIMARIES)) chain(role, others(primary));
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

const recordName = (item: string, digest: string) => `${item}.${digest}.launch.json`;

type LaunchRecord = { roster: Entry[]; launched_at: string; at: number; path: string };

function readLaunchRecord(path: string, item: string): LaunchRecord {
	const doc = readJson(path, "launch record");
	const at = isRecord(doc) && typeof doc.launched_at === "string" ? Date.parse(doc.launched_at) : Number.NaN;
	const refused = new CliError(`The launch record at ${path} is not one omp-roster wrote.`);
	if (!isRecord(doc) || doc.item !== item || Number.isNaN(at)) throw refused;
	let roster: Entry[];
	try { roster = rosterOf({ roster: doc.roster }, item); }
	catch { throw refused; }
	return { roster, launched_at: doc.launched_at as string, at, path };
}

// Every launch record for the item, oldest first. The pattern is exact so an item id that is a
// prefix of another (`K-1` and `K-1.2`) never reads the other's records.
function launchRecords(dir: string, item: string): LaunchRecord[] {
	if (!existsSync(dir)) return [];
	const name = new RegExp(`^${item.replaceAll(".", "\\.")}\\.[0-9a-f]{8}\\.launch\\.json$`);
	return readdirSync(dir).filter((file) => name.test(file)).sort().map((file) => readLaunchRecord(join(dir, file), item)).sort((a, b) => a.at - b.at);
}

function launchCommand(item: string, options: LaunchOptions): number {
	if ((options.harness ?? "omp") !== "omp") {
		throw new CliError("Only --harness omp enforces a ticket roster; Pi enforcement is a later slice.");
	}
	const roster = rosterOf(ticketOf(item, options["ticket-json"]), item);
	const { rows, freshness } = usageView(options["usage-json"]);
	const sha = rosterSha(roster);
	const skipped: Skip[] = [];
	let launch: Entry | undefined;
	let route: { verdict: "usable" | "low"; degraded: string | null } | undefined;
	for (const entry of roster) {
		const state = routeState(entry, rows);
		if ("skip" in state) { skipped.push(state.skip); continue; }
		launch = entry;
		route = state;
		break;
	}
	if (!launch || !route) {
		if (options.json) console.log(JSON.stringify({ item, launch: null, skipped, roster_sha256: sha }, null, 2));
		console.error(`omp-roster: roster exhausted for ${item}; nothing was launched.\n${skipped.map((skip) => `  ${skipLine(skip)}`).join("\n")}`);
		return EXHAUSTED;
	}
	const dir = stateDir(options["state-dir"]);
	const body = overlayText(item, sha, roster, launch);
	const digest = createHash("sha256").update(body).digest("hex").slice(0, 8);
	const overlay = join(dir, `${item}.${digest}.yml`);
	// PI_CONFIG_FILES is a path-delimited list, so a colon in the path would split it in two.
	if (overlay.includes(delimiter)) throw new CliError(`The overlay path ${plain(overlay)} contains "${delimiter}", which PI_CONFIG_FILES cannot carry.`);
	writeStateFile(dir, basename(overlay), body);
	// One record per launch, named like its overlay, so `check` can judge each session against the
	// launch that started it. The same digest means the same roster and launch entry, so an earlier
	// record for it stays: its older launch time judges the same roster.
	const record = join(dir, recordName(item, digest));
	let text: string | null = null;
	try { readLaunchRecord(record, item); text = readFileSync(record, "utf8"); }
	catch { /* none yet, or not one omp-roster wrote: write it */ }
	if (text === null) {
		text = `${JSON.stringify({ item, roster, roster_sha256: sha, launch: plain(selector(launch)), overlay, launched_at: new Date().toISOString() }, null, 2)}\n`;
		writeStateFile(dir, basename(record), text);
	}
	// The newest launch's record again under a name that needs no digest, for people.
	writeStateFile(dir, `${item}.launch.json`, text);
	// Nested `omp` runs the engineer starts inherit the roster only through the environment.
	const env = { PI_CONFIG_FILES: overlay };
	const args = ["--model", key(launch), "--thinking", launch.effort, "--config", overlay];
	const degraded = route.degraded ?? freshness.degraded_reason;
	if (route.verdict === "low") console.error(`warning: ${plain(selector(launch))} is low on capacity and may run out soon`);
	if (degraded) console.error(`warning: the ai-usage reading is degraded: ${degraded}`);
	if (options.json) {
		const usage = { ...freshness, degraded: freshness.degraded || route.degraded !== null, degraded_reason: degraded };
		console.log(JSON.stringify({
			item, launch: { ...launch, selector: plain(selector(launch)), verdict: route.verdict }, overlay, record, env, args, skipped, roster_sha256: sha, usage,
		}, null, 2));
	} else {
		for (const skip of skipped) console.error(`skipped ${skipLine(skip)}`);
		console.log(`export PI_CONFIG_FILES=${shellWord(env.PI_CONFIG_FILES)}`);
		console.log(args.map(shellWord).join(" "));
	}
	return 0;
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
type Basis = { heading: string; roster: Entry[]; position: Map<string, number>; record: LaunchRecord | null; files: string[] };

function checkCommand(item: string, paths: string[], options: CheckOptions): number {
	if (paths.length === 0) throw new CliError("check needs at least one --session path.", 2);
	const since = options.since ?? null;
	if (since !== null && Number.isNaN(Date.parse(since))) throw new CliError(`--since needs an ISO-8601 time, not ${plain(since)}.`, 2);
	const sinceMs = since === null ? null : Date.parse(since);
	const launches = launchRecords(stateDir(options["state-dir"]), item);
	let current: Entry[] | null = null;
	let unreadable = "";
	try { current = rosterOf(ticketOf(item, options["ticket-json"]), item); }
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
					? `judged against the earliest launch record ${used.path} because the board's roster could not be read (roster: ${rosterText(roster)})`
					: "judged against the ticket's current roster (no launch record at or before these files started)";
			basis = { heading, roster, position, record, files: [] };
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

	let changedLine: string | null = null;
	if (launches.length > 0) {
		if (current === null) changedLine = `roster changed since launch: the board's roster could not be read (${unreadable})`;
		else if (newest?.basis.record && rosterSha(newest.basis.record.roster) !== rosterSha(current)) {
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
			if (helperRole && model === CHECK_PRIMARIES[helperRole]) { helperTurns++; continue; }
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
	if (command === "launch") {
		const { values } = parseArgs({
			args,
			options: {
				item: { type: "string" }, "ticket-json": { type: "string" }, "usage-json": { type: "string" },
				"state-dir": { type: "string" }, harness: { type: "string" }, json: { type: "boolean" }, help: { type: "boolean", short: "h" },
			},
			strict: true,
		});
		if (values.help) { console.log(USAGE); return 0; }
		return launchCommand(itemOf(values.item), values);
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
