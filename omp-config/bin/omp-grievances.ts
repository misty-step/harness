#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { createHmac, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

const SCHEMA_VERSION = "1";
const OUTCOMES = ["ticketed", "no-action", "historic"] as const;

type Outcome = (typeof OUTCOMES)[number];
type Grievance = { id: number; model: string; version: string; tool: string; report: string; created_at: string; pushed: number };
type Ack = { grievance_id: number; outcome: Outcome; reference: string | null; note: string | null; acknowledged_at: string };
type Options = {
	command: string;
	positionals: string[];
	json: boolean;
	source: string;
	state: string;
	limit: number;
	outcome?: Outcome;
	reference?: string;
	note?: string;
	through?: number;
	help: boolean;
};

export class CliError extends Error {
	constructor(readonly code: string, message: string, readonly exitCode = 1) {
		super(message);
	}
}

function valueAfter(args: string[], index: number, flag: string): string {
	const value = args[index + 1];
	if (!value || value.startsWith("--")) throw new CliError("USAGE", `${flag} requires a value`, 2);
	return value;
}

function positiveInteger(value: string, flag: string, allowZero = false): number {
	if (!/^\d+$/.test(value)) throw new CliError("USAGE", `${flag} requires an integer`, 2);
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || (allowZero ? parsed < 0 : parsed < 1)) {
		throw new CliError("USAGE", `${flag} is out of range`, 2);
	}
	return parsed;
}

function defaultStatePath(): string {
	const configured = process.env.XDG_STATE_HOME;
	const root = configured && isAbsolute(configured) ? configured : join(homedir(), ".local", "state");
	return join(root, "omp-config", "grievances.sqlite3");
}

export function parseArgs(argv: string[]): Options {
	const args = [...argv];
	const command = args[0] && !args[0].startsWith("-") ? args.shift()! : "inbox";
	const options: Options = {
		command,
		positionals: [],
		json: false,
		source: join(homedir(), ".omp", "autoqa.db"),
		state: defaultStatePath(),
		limit: 50,
		help: false,
	};
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		switch (arg) {
			case "--json": options.json = true; break;
			case "--help":
			case "-h": options.help = true; break;
			case "--source": options.source = resolve(valueAfter(args, index, arg)); index += 1; break;
			case "--state": options.state = resolve(valueAfter(args, index, arg)); index += 1; break;
			case "--limit": options.limit = positiveInteger(valueAfter(args, index, arg), arg, true); index += 1; break;
			case "--outcome": {
				const outcome = valueAfter(args, index, arg);
				if (!OUTCOMES.includes(outcome as Outcome)) throw new CliError("USAGE", `--outcome must be one of: ${OUTCOMES.join(", ")}`, 2);
				options.outcome = outcome as Outcome;
				index += 1;
				break;
			}
			case "--ref": options.reference = valueAfter(args, index, arg); index += 1; break;
			case "--note": options.note = valueAfter(args, index, arg); index += 1; break;
			case "--through": options.through = positiveInteger(valueAfter(args, index, arg), arg); index += 1; break;
			default:
				if (arg.startsWith("--")) throw new CliError("USAGE", `unknown option: ${arg}`, 2);
				options.positionals.push(arg);
		}
	}
	return options;
}

function usage(): string {
	return `Usage:
  omp-grievances inbox [--limit N] [--json]
  omp-grievances status [--json]
  omp-grievances show ID [--json]
  omp-grievances ack ID... --outcome ticketed|no-action|historic [--ref REF] [--note TEXT]
  omp-grievances ack --through ID --outcome historic [--note TEXT]
  omp-grievances unack ID...

Global options:
  --source PATH   OMP grievance database (default: ~/.omp/autoqa.db)
  --state PATH    Private acknowledgement ledger
  --json          Stable machine-readable output

The source database is always opened read-only. Ticketed acknowledgements require --ref.`;
}

function openSource(path: string): Database {
	if (!existsSync(path)) throw new CliError("SOURCE_NOT_FOUND", `grievance database not found: ${path}`);
	let db: Database;
	try {
		db = new Database(path, { readonly: true, strict: true });
	} catch (error) {
		throw new CliError("SOURCE_OPEN_FAILED", `cannot open grievance database: ${String(error)}`);
	}
	const columns = db.query("PRAGMA table_info(grievances)").all() as Array<{ name: string }>;
	const names = new Set(columns.map((column) => column.name));
	for (const required of ["id", "model", "version", "tool", "report", "created_at", "pushed"]) {
		if (!names.has(required)) {
			db.close(true);
			throw new CliError("SOURCE_SCHEMA_MISMATCH", `grievances table is missing required column: ${required}`);
		}
	}
	return db;
}

function allGrievances(source: Database, maxId?: number): Grievance[] {
	const columns = "id, model, version, tool, report, created_at, pushed";
	if (maxId === undefined) return source.query(`SELECT ${columns} FROM grievances ORDER BY id`).all() as Grievance[];
	return source.query(`SELECT ${columns} FROM grievances WHERE id <= $maxId ORDER BY id`).all({ maxId }) as Grievance[];
}

function canonicalRows(rows: Grievance[]): string {
	return JSON.stringify(rows.map((row) => [row.id, row.model, row.version, row.tool, row.report, row.created_at]));
}

function fingerprint(rows: Grievance[], saltHex: string): string {
	return createHmac("sha256", Buffer.from(saltHex, "hex")).update(canonicalRows(rows)).digest("hex");
}

function initializeLedger(db: Database): void {
	db.run("PRAGMA journal_mode = DELETE");
	db.run("PRAGMA synchronous = FULL");
	db.run(`
		CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
		CREATE TABLE IF NOT EXISTS acknowledgements (
			grievance_id INTEGER PRIMARY KEY,
			outcome TEXT NOT NULL CHECK (outcome IN ('ticketed', 'no-action', 'historic')),
			reference TEXT,
			note TEXT,
			acknowledged_at TEXT NOT NULL,
			CHECK (outcome != 'ticketed' OR (reference IS NOT NULL AND length(reference) > 0))
		);
	`);
	const schema = db.query("SELECT value FROM metadata WHERE key = 'schema_version'").get() as { value: string } | null;
	if (schema && schema.value !== SCHEMA_VERSION) throw new CliError("LEDGER_SCHEMA_MISMATCH", `unsupported ledger schema: ${schema.value}`);
	if (!schema) db.query("INSERT INTO metadata (key, value) VALUES ('schema_version', $value)").run({ value: SCHEMA_VERSION });
}

function openLedger(path: string, writable: boolean): Database | null {
	if (!existsSync(path) && !writable) return null;
	if (writable) mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const db = new Database(path, { readonly: !writable, create: writable, strict: true });
	if (writable) {
		initializeLedger(db);
		chmodSync(path, 0o600);
	} else {
		const schema = db.query("SELECT value FROM metadata WHERE key = 'schema_version'").get() as { value: string } | null;
		if (!schema || schema.value !== SCHEMA_VERSION) {
			db.close(true);
			throw new CliError("LEDGER_SCHEMA_MISMATCH", "acknowledgement ledger has an unsupported schema");
		}
	}
	return db;
}

function metadata(db: Database, key: string): string | null {
	const row = db.query("SELECT value FROM metadata WHERE key = $key").get({ key }) as { value: string } | null;
	return row?.value ?? null;
}

function setMetadata(db: Database, key: string, value: string): void {
	db.query("INSERT INTO metadata (key, value) VALUES ($key, $value) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run({ key, value });
}

function verifySourceIdentity(source: Database, ledger: Database): void {
	const salt = metadata(ledger, "source_salt");
	const maxIdValue = metadata(ledger, "source_max_id");
	const expected = metadata(ledger, "source_fingerprint");
	const ackCount = (ledger.query("SELECT count(*) AS count FROM acknowledgements").get() as { count: number }).count;
	if (!salt && !maxIdValue && !expected && ackCount === 0) return;
	if (!salt || !maxIdValue || !expected) throw new CliError("LEDGER_IDENTITY_MISSING", "ledger source identity is incomplete");
	const maxId = Number(maxIdValue);
	if (!Number.isSafeInteger(maxId) || maxId < 0) throw new CliError("LEDGER_IDENTITY_INVALID", "ledger source identity is invalid");
	if (fingerprint(allGrievances(source, maxId), salt) !== expected) {
		throw new CliError("SOURCE_IDENTITY_MISMATCH", "autoqa.db no longer matches the grievance source bound to this ledger");
	}
}

function updateSourceIdentity(source: Database, ledger: Database): void {
	const rows = allGrievances(source);
	const salt = metadata(ledger, "source_salt") ?? randomBytes(32).toString("hex");
	setMetadata(ledger, "source_salt", salt);
	setMetadata(ledger, "source_max_id", String(rows.at(-1)?.id ?? 0));
	setMetadata(ledger, "source_fingerprint", fingerprint(rows, salt));
}

function allAcks(ledger: Database | null): Ack[] {
	if (!ledger) return [];
	return ledger.query("SELECT grievance_id, outcome, reference, note, acknowledged_at FROM acknowledgements ORDER BY grievance_id").all() as Ack[];
}

function statusPayload(rows: Grievance[], acks: Ack[]) {
	const acknowledged = new Set(acks.map((ack) => ack.grievance_id));
	let reviewedThrough: number | null = null;
	for (const row of rows) {
		if (!acknowledged.has(row.id)) break;
		reviewedThrough = row.id;
	}
	const outcomes = Object.fromEntries(OUTCOMES.map((outcome) => [outcome, 0])) as Record<Outcome, number>;
	for (const ack of acks) outcomes[ack.outcome] += 1;
	return { total: rows.length, pending: rows.length - acks.length, acknowledged: acks.length, reviewed_through: reviewedThrough, outcomes };
}

function printJson(value: unknown): void { console.log(JSON.stringify(value, null, 2)); }

function printStatus(rows: Grievance[], acks: Ack[], json: boolean): void {
	const payload = statusPayload(rows, acks);
	if (json) return printJson(payload);
	console.log(`Total: ${payload.total}`);
	console.log(`Pending: ${payload.pending}`);
	console.log(`Acknowledged: ${payload.acknowledged}`);
	console.log(`Reviewed through: ${payload.reviewed_through ?? "none"}`);
	console.log(`Outcomes: ticketed=${payload.outcomes.ticketed} no-action=${payload.outcomes["no-action"]} historic=${payload.outcomes.historic}`);
}

function printInbox(rows: Grievance[], acks: Ack[], limit: number, json: boolean): void {
	const acknowledged = new Set(acks.map((ack) => ack.grievance_id));
	const pending = rows.filter((row) => !acknowledged.has(row.id));
	const shown = limit === 0 ? pending : pending.slice(0, limit);
	if (json) return printJson({ pending: pending.length, grievances: shown });
	for (const row of shown) {
		console.log(`#${row.id} ${row.tool} (${row.model} v${row.version})`);
		console.log(`  ${row.report.replaceAll("\n", "\n  ")}`);
		console.log();
	}
	console.log(`Showing ${shown.length} of ${pending.length} pending`);
}

function parseIds(values: string[]): number[] {
	if (values.length === 0) throw new CliError("USAGE", "at least one grievance ID is required", 2);
	return [...new Set(values.map((value) => positiveInteger(value, "grievance ID")))].sort((a, b) => a - b);
}

function acknowledgementsById(ledger: Database): Map<number, Ack> {
	return new Map(allAcks(ledger).map((ack) => [ack.grievance_id, ack]));
}

function recordAcknowledgements(source: Database, ledger: Database, options: Options): number[] {
	if (!options.outcome) throw new CliError("USAGE", "ack requires --outcome", 2);
	if (options.outcome === "ticketed" && !options.reference) throw new CliError("USAGE", "ticketed acknowledgements require --ref", 2);
	if (options.through !== undefined && options.positionals.length > 0) throw new CliError("USAGE", "ack accepts IDs or --through, not both", 2);
	if (options.through !== undefined && options.outcome !== "historic") {
		throw new CliError("USAGE", "--through requires --outcome historic", 2);
	}
	const sourceRows = allGrievances(source);
	const sourceIds = new Set(sourceRows.map((row) => row.id));
	if (options.through !== undefined && !sourceIds.has(options.through)) {
		throw new CliError("GRIEVANCE_NOT_FOUND", `grievance #${options.through} does not exist`);
	}
	const existing = acknowledgementsById(ledger);
	const ids = options.through !== undefined
		? sourceRows.filter((row) => row.id <= options.through! && !existing.has(row.id)).map((row) => row.id)
		: parseIds(options.positionals);
	for (const id of ids) {
		if (!sourceIds.has(id)) throw new CliError("GRIEVANCE_NOT_FOUND", `grievance #${id} does not exist`);
		const prior = existing.get(id);
		if (prior && (prior.outcome !== options.outcome || (prior.reference ?? undefined) !== options.reference || (prior.note ?? undefined) !== options.note)) {
			throw new CliError("ACK_CONFLICT", `grievance #${id} already has a different acknowledgement`);
		}
	}
	const write = ledger.transaction(() => {
		const acknowledgedAt = new Date().toISOString();
		for (const id of ids) {
			ledger.query(`INSERT INTO acknowledgements (grievance_id, outcome, reference, note, acknowledged_at)
				VALUES ($id, $outcome, $reference, $note, $acknowledgedAt) ON CONFLICT(grievance_id) DO NOTHING`).run({
				id, outcome: options.outcome!, reference: options.reference ?? null, note: options.note ?? null, acknowledgedAt,
			});
		}
		updateSourceIdentity(source, ledger);
	});
	write.immediate();
	return ids;
}

function removeAcknowledgements(source: Database, ledger: Database, ids: number[]): number[] {
	const existing = acknowledgementsById(ledger);
	for (const id of ids) if (!existing.has(id)) throw new CliError("ACK_NOT_FOUND", `grievance #${id} is not acknowledged`);
	const remove = ledger.transaction(() => {
		const statement = ledger.query("DELETE FROM acknowledgements WHERE grievance_id = $id");
		for (const id of ids) statement.run({ id });
		updateSourceIdentity(source, ledger);
	});
	remove.immediate();
	return ids;
}

function showGrievance(rows: Grievance[], acks: Ack[], id: number, json: boolean): void {
	const grievance = rows.find((row) => row.id === id);
	if (!grievance) throw new CliError("GRIEVANCE_NOT_FOUND", `grievance #${id} does not exist`);
	const acknowledgement = acks.find((ack) => ack.grievance_id === id) ?? null;
	if (json) return printJson({ grievance, acknowledgement });
	console.log(`#${grievance.id} ${grievance.tool} (${grievance.model} v${grievance.version})`);
	console.log(grievance.report);
	console.log(`Created: ${grievance.created_at}`);
	if (!acknowledgement) return void console.log("Acknowledgement: pending");
	console.log(`Acknowledgement: ${acknowledgement.outcome}`);
	if (acknowledgement.reference) console.log(`Reference: ${acknowledgement.reference}`);
	if (acknowledgement.note) console.log(`Note: ${acknowledgement.note}`);
	console.log(`Acknowledged at: ${acknowledgement.acknowledged_at}`);
}

export function run(argv: string[]): void {
	const options = parseArgs(argv);
	if (options.help) return void console.log(usage());
	if (!["inbox", "status", "show", "ack", "unack"].includes(options.command)) throw new CliError("USAGE", `unknown command: ${options.command}`, 2);
	using source = openSource(options.source);
	const writable = options.command === "ack" || options.command === "unack";
	using ledger = openLedger(options.state, writable);
	if (ledger) verifySourceIdentity(source, ledger);
	const rows = allGrievances(source);
	const acks = allAcks(ledger);
	switch (options.command) {
		case "inbox": printInbox(rows, acks, options.limit, options.json); return;
		case "status": printStatus(rows, acks, options.json); return;
		case "show": {
			if (options.positionals.length !== 1) throw new CliError("USAGE", "show accepts exactly one ID", 2);
			showGrievance(rows, acks, parseIds(options.positionals)[0], options.json); return;
		}
		case "ack": {
			if (!ledger) throw new CliError("LEDGER_OPEN_FAILED", "acknowledgement ledger is unavailable");
			const ids = recordAcknowledgements(source, ledger, options);
			if (options.json) return printJson({ acknowledged: ids, outcome: options.outcome, reference: options.reference ?? null });
			console.log(`Acknowledged ${ids.length} grievance${ids.length === 1 ? "" : "s"} as ${options.outcome}.`); return;
		}
		case "unack": {
			if (!ledger) throw new CliError("LEDGER_OPEN_FAILED", "acknowledgement ledger is unavailable");
			const ids = removeAcknowledgements(source, ledger, parseIds(options.positionals));
			if (options.json) return printJson({ unacknowledged: ids });
			console.log(`Returned ${ids.length} grievance${ids.length === 1 ? "" : "s"} to the inbox.`);
		}
	}
}

if (import.meta.main) {
	const json = process.argv.includes("--json");
	try {
		run(process.argv.slice(2));
	} catch (error) {
		const failure = error instanceof CliError ? error : new CliError("INTERNAL_ERROR", String(error));
		if (json) console.error(JSON.stringify({ error: { code: failure.code, message: failure.message } }));
		else console.error(`${failure.code}: ${failure.message}`);
		process.exit(failure.exitCode);
	}
}
