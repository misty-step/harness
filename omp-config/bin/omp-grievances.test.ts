import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = join(import.meta.dir, "omp-grievances.ts");
const roots: string[] = [];

type Fixture = { root: string; source: string; state: string };

type Result = { exitCode: number; stdout: string; stderr: string };

function fixture(): Fixture {
	const root = mkdtempSync(join(tmpdir(), "omp-grievances-test-"));
	roots.push(root);
	const source = join(root, "autoqa.db");
	const state = join(root, "state", "grievances.sqlite3");
	const db = new Database(source, { create: true, strict: true });
	db.run(`
		CREATE TABLE grievances (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			model TEXT NOT NULL,
			version TEXT NOT NULL,
			tool TEXT NOT NULL,
			report TEXT NOT NULL,
			created_at TEXT NOT NULL,
			pushed INTEGER NOT NULL DEFAULT 0
		)
	`);
	const insert = db.query(`
		INSERT INTO grievances (model, version, tool, report, created_at, pushed)
		VALUES ($model, $version, $tool, $report, $createdAt, $pushed)
	`);
	for (const [tool, report, pushed] of [
		["read", "reader returned the wrong range", 1],
		["edit", "patch reported a false syntax error", 1],
		["browser", "named tab disappeared", 0],
	] as const) {
		insert.run({
			model: "test/model",
			version: "1.0.0",
			tool,
			report,
			createdAt: "2026-08-25 12:00:00",
			pushed,
		});
	}
	db.close(true);
	return { root, source, state };
}

function invoke(fixture: Fixture, ...args: string[]): Result {
	const result = Bun.spawnSync({
		cmd: [process.execPath, cli, ...args, "--source", fixture.source, "--state", fixture.state],
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		exitCode: result.exitCode,
		stdout: result.stdout.toString(),
		stderr: result.stderr.toString(),
	};
}

function json(result: Result): Record<string, unknown> {
	expect(result.exitCode).toBe(0);
	const parsed: unknown = JSON.parse(result.stdout);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("expected JSON object");
	return parsed as Record<string, unknown>;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("omp-grievances", () => {
	test("acknowledgements remove grievances from the inbox and survive a new process", () => {
		const files = fixture();
		expect(json(invoke(files, "status", "--json"))).toMatchObject({
			total: 3,
			pending: 3,
			acknowledged: 0,
			reviewed_through: null,
		});

		expect(json(invoke(files, "ack", "1", "2", "--outcome", "ticketed", "--ref", "HAB-123", "--json"))).toEqual({
			acknowledged: [1, 2],
			outcome: "ticketed",
			reference: "HAB-123",
		});

		expect(json(invoke(files, "status", "--json"))).toMatchObject({
			pending: 1,
			acknowledged: 2,
			reviewed_through: 2,
			outcomes: { ticketed: 2 },
		});
		expect(json(invoke(files, "inbox", "--json"))).toMatchObject({
			pending: 1,
			grievances: [{ id: 3 }],
		});
	});

	test("historic bulk acknowledgement clears only pending rows through the boundary", () => {
		const files = fixture();
		json(invoke(files, "ack", "1", "--outcome", "no-action", "--json"));
		expect(json(invoke(files, "ack", "--through", "3", "--outcome", "historic", "--note", "pre-ledger backlog", "--json"))).toMatchObject({
			acknowledged: [2, 3],
			outcome: "historic",
		});
		expect(json(invoke(files, "status", "--json"))).toMatchObject({
			pending: 0,
			acknowledged: 3,
			reviewed_through: 3,
			outcomes: { "no-action": 1, historic: 2 },
		});
	});

	test("historic boundary must name an existing grievance", () => {
		const files = fixture();
		const result = invoke(files, "ack", "--through", "30", "--outcome", "historic", "--json");
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stderr)).toMatchObject({
			error: { code: "GRIEVANCE_NOT_FOUND" },
		});
		expect(json(invoke(files, "status", "--json"))).toMatchObject({
			pending: 3,
			acknowledged: 0,
		});
	});

	test("bulk acknowledgement is reserved for historic cutovers", () => {
		const files = fixture();
		for (const args of [
			["ack", "--through", "3", "--outcome", "no-action", "--json"],
			["ack", "--through", "3", "--outcome", "ticketed", "--ref", "HAB-123", "--json"],
		]) {
			const result = invoke(files, ...args);
			expect(result.exitCode).toBe(2);
			expect(JSON.parse(result.stderr)).toMatchObject({
				error: { code: "USAGE", message: "--through requires --outcome historic" },
			});
		}
		expect(json(invoke(files, "status", "--json"))).toMatchObject({
			pending: 3,
			acknowledged: 0,
		});
	});

	test("ticketed acknowledgement requires an external reference", () => {
		const files = fixture();
		const result = invoke(files, "ack", "1", "--outcome", "ticketed", "--json");
		expect(result.exitCode).toBe(2);
		expect(JSON.parse(result.stderr)).toEqual({
			error: { code: "USAGE", message: "ticketed acknowledgements require --ref" },
		});
	});

	test("immutable source changes fail closed while pushed may change", () => {
		const files = fixture();
		json(invoke(files, "ack", "1", "--outcome", "no-action", "--json"));
		let source = new Database(files.source, { strict: true });
		source.run("UPDATE grievances SET pushed = 1 WHERE id = 3");
		source.close(true);
		expect(json(invoke(files, "status", "--json"))).toMatchObject({ acknowledged: 1 });

		source = new Database(files.source, { strict: true });
		source.run("UPDATE grievances SET report = 'different complaint' WHERE id = 1");
		source.close(true);
		const result = invoke(files, "status", "--json");
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stderr)).toMatchObject({ error: { code: "SOURCE_IDENTITY_MISMATCH" } });
	});

	test("unack returns a grievance to the inbox", () => {
		const files = fixture();
		json(invoke(files, "ack", "1", "--outcome", "no-action", "--json"));
		expect(json(invoke(files, "unack", "1", "--json"))).toEqual({ unacknowledged: [1] });
		expect(json(invoke(files, "status", "--json"))).toMatchObject({ pending: 3, acknowledged: 0 });
	});
});
