import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

// The deployed cohort is the copied TypeScript CLI plus the Python admission owner.
// Tests use explicit inert measurements; neither PATH mocks nor fixture environment
// variables can bypass the real omp launcher's live reservation transaction.
let root = "";
let cli = "";
let counter = 0;
let memoryFile = "";

function memoryFixture(available = 128 * 1024 ** 3) {
	const root = "/user.slice/user-1000.slice/user@1000.service";
	const group = (path: string, memory_max: number | null = null, memory_swap_max: number | null = null) =>
		({ path, memory_max, memory_swap_max, memory_high: null, current_bytes: 0, oom_group: 0, populated: false });
	return {
		schema_version: 1, uid: 1000, user_root: root, current_group: `${root}/app.slice/fixture.scope`,
		available_bytes: available, fleet: { ...group(`${root}/omp.slice`, 36 * 1024 ** 3, 0), slice: "-.slice" },
		ancestors: ["/user.slice", "/user.slice/user-1000.slice", root].map((path) => group(path)),
		monitored: [`${root}/app.slice`], scopes: [], processes: [], legacy_groups: [],
		heavy: { path: `${root}/dev.slice/dev-exec.slice`, current_bytes: 0, jobs: [] },
		captured_at: "2026-10-01T00:00:00+00:00",
	};
}

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "omp-roster-test-"));
	mkdirSync(join(root, "deploy"));
	mkdirSync(join(root, "bin"));
	writeFileSync(join(root, "bin", "herdr"), '#!/bin/sh\n[ "$*" = "agent list" ] || exit 2\nif [ -n "$HERDR_TEST_AGENTS" ]; then cat "$HERDR_TEST_AGENTS"; else printf \'%s\\n\' \'{"result":{"agents":[]}}\'; fi\n', { mode: 0o755 });
	cli = join(root, "deploy", "omp-roster");
	copyFileSync(join(import.meta.dir, "omp-roster.ts"), cli);
	const core = join(root, "deploy", "omp-engineer");
	copyFileSync(join(import.meta.dir, "omp-engineer.py"), core);
	chmodSync(core, 0o700);
	memoryFile = join(root, "memory.json");
	writeFileSync(memoryFile, JSON.stringify(memoryFixture()));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

type Entry = { provider: string; model: string; effort: string };
const SOL: Entry = { provider: "openai-codex", model: "gpt-6.1-sol", effort: "high" };
const SONNET: Entry = { provider: "anthropic", model: "claude-sonnet-5-5", effort: "medium" };
const OPUS: Entry = { provider: "anthropic", model: "claude-opus-5-5", effort: "xhigh" };
const GROK: Entry = { provider: "xai-oauth", model: "grok-4.7", effort: "high" };
const GEMINI: Entry = { provider: "google-antigravity", model: "gemini-3.8-flash", effort: "high" };
const CASH: Entry = { provider: "openrouter", model: "deepseek/deepseek-v4.1-flash", effort: "medium" };
const OLD_SOL: Entry = { provider: "openai-codex", model: "gpt-6-sol", effort: "medium" };

// Engineer recovery is roster-only; reviewers never recover onto their author.
const ENGINEER = ["default", "slow", "task", "extreme"];
const PRIMARY: Record<string, string> = {
	advisor: "anthropic/claude-sonnet-5-5",
	plan: "openai-codex/gpt-6.1-sol",
	reviewer: "openai-codex/gpt-6.1-sol",
	"security-reviewer": "openai-codex/gpt-6.1-sol",
	smol: "openai-codex/gpt-6-luna",
	tiny: "openai-codex/gpt-6-luna",
	commit: "openai-codex/gpt-6-luna",
};
const pinnedTo = (selector: string) => Object.fromEntries(ENGINEER.map((role) => [role, selector]));
// Other helpers recover onto the roster without their primary; reviewers stop.
const chainsOf = (engineer: string[], roster: string[]) => ({
	...Object.fromEntries(ENGINEER.map((role) => [role, engineer])),
	...Object.fromEntries(Object.entries(PRIMARY).map(([role, primary]) => [role,
		role === "reviewer" || role === "security-reviewer" ? [] : roster.filter((entry) => !entry.startsWith(`${primary}:`))])),
});

const scratch = (name: string) => {
	const dir = join(root, `${name}-${++counter}`);
	mkdirSync(dir, { recursive: true });
	return dir;
};
const put = (path: string, body: string) => {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, body);
	return path;
};

// The board's answer document for one item, as `board query items --item ID --json` prints it.
const boardAnswer = (roster: Entry[] | null) => ({
	data: { state: "ok", value: { id: "K-test", ticket: roster === null ? null : { nature: "build", roster } } },
});
const row = (provider: string, model: string, verdict: string, next_reset: string | null = null, harness = "omp") =>
	({ harness, provider, model, verdict, reason: `${verdict} in the fixture`, next_reset });
const usageView = (rollup: unknown[], patch: object = {}) => ({ schema_version: 1, ok: true, rollup, coverage: [], routes: [], ...patch });

type Result = { exitCode: number; stdout: string; stderr: string };
// umask 0: a file that ends up 0600 got that mode from the CLI, not from the ambient umask.
function invoke(args: string[], env: Record<string, string> = {}): Result {
	const inherited = { ...process.env };
	delete inherited.OMP_ROSTER_ENGINEER_LIMIT;
	const actualArgs = args[0] === "launch" && !args.includes("--memory-json") ? [...args, "--memory-json", memoryFile] : args;
	const result = Bun.spawnSync({
		cmd: ["sh", "-c", 'umask 0; exec "$@"', "sh", process.execPath, cli, ...actualArgs],
		env: { ...inherited, HOME: root, XDG_STATE_HOME: join(root, "xdg"), ...env, PATH: `${join(root, "bin")}:${env.PATH ?? process.env.PATH}` },
		stdout: "pipe",
		stderr: "pipe",
	});
	return { exitCode: result.exitCode ?? -1, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

// A launch from fixtures; `state` is a directory that must not exist until an overlay is written.
function launch(ticket: unknown, usage: unknown, ...extra: string[]) {
	const dir = scratch("launch");
	const state = join(dir, "state");
	const result = invoke([
		"launch", "--item", "K-test", "--ticket-json", put(join(dir, "ticket.json"), JSON.stringify(ticket)),
		"--usage-json", put(join(dir, "usage.json"), JSON.stringify(usage)), "--state-dir", state, ...extra,
	]);
	return { ...result, state };
}
const launched = (result: Result & { state: string }) => {
	expect(result.stderr).toBe("");
	expect(result.exitCode).toBe(0);
	return JSON.parse(result.stdout) as Record<string, any>;
};

describe("omp-roster memory admission", () => {
	test("below-floor guidance warns in launch JSON while preserving overlay and record creation", () => {
		const dir = scratch("memory-refusal");
		const state = join(dir, "state");
		const file = put(join(dir, "memory.json"), JSON.stringify(memoryFixture(20 * 1024 ** 3 - 1)));
		const snapshot = invoke(["memory", "--json", "--memory-json", file]);
		expect(snapshot.exitCode).toBe(0);
		const value = JSON.parse(snapshot.stdout);
		expect([value.admitted, value.reservation, value.capacity.available_bytes, value.capacity.required_available_bytes])
			.toEqual([true, false, 20 * 1024 ** 3 - 1, 20 * 1024 ** 3]);
		const ticket = put(join(dir, "ticket.json"), JSON.stringify(boardAnswer([SONNET])));
		const usage = put(join(dir, "usage.json"), JSON.stringify(usageView([row("anthropic", "sonnet", "usable")])));
		const args = ["launch", "--item", "K-test", "--ticket-json", ticket, "--usage-json", usage,
			"--memory-json", file, "--state-dir", state, "--json"];
		const warned = invoke(args);
		expect(warned.exitCode).toBe(0);
		const warnedLaunch = JSON.parse(warned.stdout);
		expect([warnedLaunch.memory.admitted, warnedLaunch.memory.capacity.available_bytes]).toEqual([true, 20 * 1024 ** 3 - 1]);
		expect(warnedLaunch.memory.warnings.join(" ")).toContain(String(20 * 1024 ** 3 - 1));
		expect(warned.stderr).toContain(String(20 * 1024 ** 3 - 1));
		expect(JSON.parse(readFileSync(warnedLaunch.record, "utf8")).launch).toBe("anthropic/claude-sonnet-5-5:medium");
		put(file, JSON.stringify(memoryFixture(20 * 1024 ** 3)));
		const admitted = invoke(args);
		expect(admitted.exitCode).toBe(0);
		const launch = JSON.parse(admitted.stdout);
		expect([launch.memory.admitted, launch.memory.reservation]).toEqual([true, false]);
		expect(JSON.parse(readFileSync(launch.record, "utf8")).launch).toBe("anthropic/claude-sonnet-5-5:medium");
	});

	test("uninspectable ancestor measurements cannot produce a usable overlay", () => {
		const dir = scratch("memory-uninspectable");
		const state = join(dir, "state");
		const malformed = { ...memoryFixture(), ancestors: [] };
		const file = put(join(dir, "memory.json"), JSON.stringify(malformed));
		const usage = put(join(dir, "usage.json"), JSON.stringify(usageView([row("anthropic", "sonnet", "usable")])));
		const refused = invoke(["launch", "--model", "anthropic/claude-sonnet-5-5", "--thinking", "medium",
			"--usage-json", usage, "--memory-json", file, "--state-dir", state, "--json"]);
		expect([refused.exitCode, refused.stdout, existsSync(state)]).toEqual([1, "", false]);
	});
});

describe("omp-roster launch (US-046)", () => {
	test("US-047 refuses at or above the working-engineer limit before writing, and admits one below", () => {
		const dir = scratch("fleet");
		const agentsFile = join(dir, "agents.json");
		const ticket = put(join(dir, "ticket.json"), JSON.stringify(boardAnswer([SONNET])));
		const usage = put(join(dir, "usage.json"), JSON.stringify(usageView([row("anthropic", "sonnet", "usable")])));
		const working = Array.from({ length: 9 }, (_, index) => ({
			name: index === 0 ? null : `engineer-${index + 1}`,
			pane_id: `w${index + 1}:p1`, workspace_id: `w${index + 1}`, agent: "omp", agent_status: "working",
		}));
		const settled = ["idle", "done", "blocked", "unknown"].map((agent_status) => ({ agent: "omp", name: agent_status, pane_id: "w0:p1", agent_status }));
		const nonEngineers = [
			{ agent: "hermes", name: null, pane_id: "w54:p1", cwd: "/home/phaedrus", agent_status: "working" },
			{ agent: "claude", name: "named-non-engineer", pane_id: "w55:p1", agent_status: "working" },
		];
		const args = ["launch", "--item", "K-test", "--ticket-json", ticket, "--usage-json", usage, "--json"];
		const env = { HERDR_TEST_AGENTS: agentsFile };
		for (const [limit, count] of [[8, 8], [8, 9], [2, 2]]) {
			put(agentsFile, JSON.stringify({ result: { agents: [...working.slice(0, count), ...settled, ...nonEngineers] } }));
			const state = join(dir, `refused-${limit}-${count}`);
			const refused = invoke([...args, "--state-dir", state], { ...env, ...(limit === 8 ? {} : { OMP_ROSTER_ENGINEER_LIMIT: String(limit) }) });
			expect([refused.exitCode, refused.stdout]).toEqual([5, ""]);
			expect(refused.stderr).toContain(`(${count}/${limit})`);
			for (const agent of working.slice(0, count)) expect(refused.stderr).toContain(agent.name ?? agent.pane_id);
			expect(existsSync(state)).toBe(false);
		}
		put(agentsFile, JSON.stringify({ result: { agents: [...working.slice(0, 7), ...settled, ...nonEngineers] } }));
		const state = join(dir, "admitted");
		const admitted = invoke([...args, "--state-dir", state], env);
		expect([admitted.exitCode, admitted.stderr]).toEqual([0, ""]);
		expect(existsSync(JSON.parse(admitted.stdout).overlay)).toBe(true);
	});
	test("US-047 fails closed on invalid limits or unreadable Herdr state for ticketless launches", () => {
		const dir = scratch("fleet-unreadable");
		const state = join(dir, "state");
		const agents = join(dir, "agents.json");
		const args = ["launch", "--model", "anthropic/claude-sonnet-5-5", "--thinking", "medium", "--state-dir", state];
		for (const limit of ["0", "-1", "1.5", "", "9007199254740992"]) {
			const refused = invoke(args, { OMP_ROSTER_ENGINEER_LIMIT: limit });
			expect([refused.exitCode, refused.stdout]).toEqual([1, ""]);
			expect(refused.stderr).toContain("OMP_ROSTER_ENGINEER_LIMIT must be a positive safe integer.");
		}
		for (const doc of ["not JSON", "{}", '{"result":{"agents":[{"agent":"omp","agent_status":"new-status"}]}}', '{"result":{"agents":[{"agent":"omp","agent_status":"working"}]}}']) {
			put(agents, doc);
			const refused = invoke(args, { HERDR_TEST_AGENTS: agents });
			expect([refused.exitCode, refused.stdout]).toEqual([1, ""]);
			expect(refused.stderr).toContain("Cannot read the Herdr agents:");
			expect(refused.stderr.trim().split("\n")).toHaveLength(1);
		}
		put(agents, JSON.stringify({ result: { agents: Array.from({ length: 8 }, (_, i) => ({ agent: "omp", name: `engineer-${i + 1}`, agent_status: "working" })) } }));
		const full = invoke(args, { HERDR_TEST_AGENTS: agents });
		expect([full.exitCode, full.stdout]).toEqual([5, ""]);
		expect(existsSync(state)).toBe(false);
	});


	test("US-046 launches the first usable entry, reports what it skipped, and writes a roster-only overlay", () => {
		const usage = usageView([
			row("anthropic", "sonnet", "blocked", null, "pi"),
			row("openai-codex", "gpt-6.1-sol", "exhausted", "2026-09-29T19:42:20Z"),
			row("openrouter", "metered", "usable", null, "any"),
			row("xai", "grok", "unknown", null, "any"),
			row("anthropic", "sonnet", "usable"),
			row("anthropic", "opus", "usable"),
		]);
		const run = launch(boardAnswer([SOL, CASH, GROK, SONNET, OPUS]), usage, "--json");
		const out = launched(run);
		const overlay: string = out.overlay;

		expect(out.item).toBe("K-test");
		expect(out.launch).toEqual({ provider: "anthropic", model: "claude-sonnet-5-5", effort: "medium", selector: "anthropic/claude-sonnet-5-5:medium", verdict: "usable" });
		// One overlay per launch, named for a digest of its content; the record beside it says which is current.
		expect(overlay).toMatch(new RegExp(`^${run.state}/K-test\\.[0-9a-f]{8}\\.yml$`));
		expect(out.record).toBe(join(run.state, `K-test.${basename(overlay).slice("K-test.".length, -".yml".length)}.launch.json`));
		expect(out.env).toEqual({ PI_CONFIG_FILES: overlay });
		expect(out.args).toEqual(["--model", "anthropic/claude-sonnet-5-5", "--thinking", "medium", "--config", overlay]);
		expect(out.skipped).toEqual([
			{ selector: "openai-codex/gpt-6.1-sol:high", verdict: "exhausted", reason: "exhausted in the fixture", next_reset: "2026-09-29T19:42:20Z" },
			{ selector: "openrouter/deepseek/deepseek-v4.1-flash:medium", verdict: null, reason: "cash route: a per-ticket cash cap is not built yet", next_reset: null },
			{ selector: "xai-oauth/grok-4.7:high", verdict: "unknown", reason: "unknown in the fixture", next_reset: null },
		]);
		expect(out.roster_sha256).toMatch(/^[0-9a-f]{64}$/);

		const sonnet = "anthropic/claude-sonnet-5-5:medium";
		const sol = "openai-codex/gpt-6.1-sol:high";
		const grok = "xai-oauth/grok-4.7:high";
		const opus = "anthropic/claude-opus-5-5:xhigh";
		const notSonnet = [sol, grok, opus];
		expect(Bun.YAML.parse(readFileSync(overlay, "utf8"))).toEqual({
			modelRoles: pinnedTo(sonnet),
			retry: {
				fallbackChains: {
					"openai-codex/gpt-6.1-sol": [grok, sonnet, opus],
					"xai-oauth/grok-4.7": [sol, sonnet, opus],
					"anthropic/claude-sonnet-5-5": [sol, grok, opus],
					"anthropic/claude-opus-5-5": [sol, grok, sonnet],
					...chainsOf(notSonnet, [sol, grok, sonnet, opus]),
				},
			},
		});
		expect(statSync(overlay).mode & 0o777).toBe(0o600);
		expect(readdirSync(run.state).sort()).toEqual([basename(overlay), basename(out.record), "K-test.launch.json"].sort());
	});

	test("US-046 only usable and low routes launch; blocked, exhausted, unknown and unlisted routes are skipped", () => {
		const solUsable = row("openai-codex", "gpt-6.1-sol", "usable");
		const cases: [string, Entry[], unknown[], string][] = [
			["usable", [SONNET, SOL], [row("anthropic", "sonnet", "usable"), solUsable], "claude-sonnet-5-5"],
			["low", [SONNET, SOL], [row("anthropic", "sonnet", "low"), solUsable], "claude-sonnet-5-5"],
			["exhausted", [SONNET, SOL], [row("anthropic", "sonnet", "exhausted"), solUsable], "gpt-6.1-sol"],
			["blocked", [SONNET, SOL], [row("anthropic", "sonnet", "blocked"), solUsable], "gpt-6.1-sol"],
			["unknown", [SONNET, SOL], [row("anthropic", "sonnet", "unknown"), solUsable], "gpt-6.1-sol"],
			["only a Pi row", [SONNET, SOL], [row("anthropic", "sonnet", "usable", null, "pi"), solUsable], "gpt-6.1-sol"],
			["an any-harness row", [GROK, SOL], [row("xai", "grok", "usable", null, "any"), solUsable], "grok-4.7"],
			["an omp row over a usable any row", [SONNET, SOL], [row("anthropic", "sonnet", "exhausted"), row("anthropic", "sonnet", "usable", null, "any"), solUsable], "gpt-6.1-sol"],
			["an omp row over an exhausted any row", [SONNET, SOL], [row("anthropic", "sonnet", "usable"), row("anthropic", "sonnet", "exhausted", null, "any"), solUsable], "claude-sonnet-5-5"],
			["two omp rows, the blocked one first", [SONNET, SOL], [row("anthropic", "sonnet", "blocked"), row("anthropic", "sonnet", "usable"), solUsable], "gpt-6.1-sol"],
			["two omp rows, the blocked one last", [SONNET, SOL], [row("anthropic", "sonnet", "usable"), row("anthropic", "sonnet", "blocked"), solUsable], "gpt-6.1-sol"],
			["no ai-usage row for Gemini", [GEMINI, SOL], [solUsable], "gpt-6.1-sol"],
		];
		for (const [name, roster, rollup, model] of cases) {
			const run = launch(boardAnswer(roster), usageView(rollup), "--json");
			expect([name, run.exitCode, JSON.parse(run.stdout).launch.model]).toEqual([name, 0, model]);
		}
	});

	test("US-046 launch says what it launched on: a low verdict and a degraded reading are warnings, and the JSON carries both and the view's freshness", () => {
		const view = usageView([{ ...row("anthropic", "sonnet", "low"), degraded: "data is 5m old (limit 5m)" }], {
			oldest_observation: "2026-09-29T18:04:42Z", stale_after_seconds: 300,
		});
		const run = launch(boardAnswer([SONNET, SOL]), view, "--json");
		expect(run.exitCode).toBe(0);
		const out = JSON.parse(run.stdout);
		expect(out.launch.verdict).toBe("low");
		expect(out.usage).toEqual({ degraded: true, degraded_reason: "data is 5m old (limit 5m)", oldest_observation: "2026-09-29T18:04:42Z", stale_after_seconds: 300 });
		expect(run.stderr.trim().split("\n")).toEqual([
			"warning: anthropic/claude-sonnet-5-5:medium is low on capacity and may run out soon",
			"warning: the ai-usage reading is degraded: data is 5m old (limit 5m)",
		]);

		const fresh = launched(launch(boardAnswer([SONNET]), usageView([row("anthropic", "sonnet", "usable")]), "--json"));
		expect(fresh.usage).toEqual({ degraded: false, degraded_reason: null, oldest_observation: null, stale_after_seconds: null });
	});

	test("US-046 the plain launch output is an export line then paste-ready arguments, quoted only where the shell needs it", () => {
		const dir = scratch("plain");
		const state = join(dir, "state dir's");
		const run = invoke([
			"launch", "--item", "K-test", "--ticket-json", put(join(dir, "t.json"), JSON.stringify(boardAnswer([SOL, SONNET]))),
			"--usage-json", put(join(dir, "u.json"), JSON.stringify(usageView([row("openai-codex", "gpt-6.1-sol", "exhausted"), row("anthropic", "sonnet", "usable")]))),
			"--state-dir", state,
		]);
		expect(run.exitCode).toBe(0);
		const overlay = readdirSync(state).find((name) => name.endsWith(".yml"));
		const quoted = `'${join(state, overlay ?? "").replaceAll("'", "'\\''")}'`;
		expect(run.stdout.split("\n")).toEqual([
			`export PI_CONFIG_FILES=${quoted}`,
			`--model anthropic/claude-sonnet-5-5 --thinking medium --config ${quoted}`,
			"",
		]);
		expect(run.stderr).toBe("skipped openai-codex/gpt-6.1-sol:high: exhausted, exhausted in the fixture; reset time unknown\n");
	});

	test("US-046 an exhausted roster prints no JSON without --json, and a relative XDG_STATE_HOME is ignored", () => {
		const dir = scratch("exhausted");
		const ticket = put(join(dir, "t.json"), JSON.stringify(boardAnswer([SOL])));
		const exhausted = put(join(dir, "u.json"), JSON.stringify(usageView([row("openai-codex", "gpt-6.1-sol", "exhausted")])));
		const usable = put(join(dir, "u2.json"), JSON.stringify(usageView([row("openai-codex", "gpt-6.1-sol", "usable")])));
		const none = invoke(["launch", "--item", "K-test", "--ticket-json", ticket, "--usage-json", exhausted]);
		expect([none.exitCode, none.stdout]).toEqual([3, ""]);

		const relative = invoke(["launch", "--item", "K-test", "--ticket-json", ticket, "--usage-json", usable, "--json"], { XDG_STATE_HOME: "relative/state" });
		expect(relative.exitCode).toBe(0);
		expect(JSON.parse(relative.stdout).overlay.startsWith(join(root, ".local", "state", "omp-roster", "K-test."))).toBe(true);
		expect(existsSync(join(dir, "relative"))).toBe(false);

		// PI_CONFIG_FILES is a colon-separated list, so an overlay path holding a colon cannot be exported.
		const colon = invoke(["launch", "--item", "K-test", "--ticket-json", ticket, "--usage-json", usable, "--state-dir", join(dir, "a:b")]);
		expect(colon.exitCode).toBe(1);
		expect(colon.stderr).toMatch(/contains ":", which PI_CONFIG_FILES cannot carry/);
		expect(existsSync(join(dir, "a:b"))).toBe(false);
	});

	test("US-046 launch writes one overlay and one record per launch, keeps a copy of the latest, and a relaunch leaves earlier files alone", () => {
		const dir = scratch("record");
		const state = join(dir, "state");
		const usage = put(join(dir, "u.json"), JSON.stringify(usageView([row("openai-codex", "gpt-6.1-sol", "usable"), row("anthropic", "sonnet", "usable")])));
		const go = (roster: Entry[]) => {
			const run = invoke(["launch", "--item", "K-test", "--ticket-json", put(join(dir, "t.json"), JSON.stringify(boardAnswer(roster))), "--usage-json", usage, "--state-dir", state, "--json"]);
			expect(run.exitCode).toBe(0);
			return JSON.parse(run.stdout);
		};
		const digestOf = (overlay: string) => basename(overlay).slice("K-test.".length, -".yml".length);
		const latest = join(state, "K-test.launch.json");
		const before = Date.now();
		const first = go([SOL, SONNET]);
		const kept = readFileSync(first.overlay, "utf8");
		const record = JSON.parse(readFileSync(first.record, "utf8"));
		expect(first.record).toBe(join(state, `K-test.${digestOf(first.overlay)}.launch.json`));
		expect(record).toMatchObject({ item: "K-test", roster: [SOL, SONNET], roster_sha256: first.roster_sha256, launch: "openai-codex/gpt-6.1-sol:high", overlay: first.overlay });
		expect(Date.parse(record.launched_at)).toBeGreaterThanOrEqual(before);
		expect(statSync(first.record).mode & 0o777).toBe(0o600);
		expect(readFileSync(latest, "utf8")).toBe(readFileSync(first.record, "utf8"));
		expect(statSync(latest).mode & 0o777).toBe(0o600);

		// Age the first record, so a rewrite would show.
		const aged = `${JSON.stringify({ ...record, launched_at: "2026-01-01T00:00:00.000Z" }, null, 2)}\n`;
		writeFileSync(first.record, aged);
		const second = go([SONNET, SOL]);
		expect(second.overlay).not.toBe(first.overlay);
		expect(second.record).not.toBe(first.record);
		expect(readFileSync(first.overlay, "utf8")).toBe(kept);
		expect(readFileSync(first.record, "utf8")).toBe(aged);
		expect(JSON.parse(readFileSync(second.record, "utf8")).overlay).toBe(second.overlay);
		expect(readFileSync(latest, "utf8")).toBe(readFileSync(second.record, "utf8"));

		// The same roster and entry again: the first record's earlier launch time still judges it.
		const again = go([SOL, SONNET]);
		expect([again.overlay, again.record]).toEqual([first.overlay, first.record]);
		expect(readFileSync(first.record, "utf8")).toBe(aged);
		expect(readFileSync(latest, "utf8")).toBe(aged);
		expect(readdirSync(state).sort()).toEqual([
			basename(first.overlay), basename(second.overlay), basename(first.record), basename(second.record), "K-test.launch.json",
		].sort());
	});

	test("US-046 an exhausted roster exits 3 with every reason and reset, and writes nothing", () => {
		const usage = usageView([row("openai-codex", "gpt-6.1-sol", "exhausted", "2026-09-29T19:42:20Z")]);
		const run = launch(boardAnswer([SOL, CASH]), usage, "--json");

		expect(run.exitCode).toBe(3);
		expect(run.stderr).toContain("roster exhausted for K-test");
		expect(run.stderr).toContain("openai-codex/gpt-6.1-sol:high: exhausted, exhausted in the fixture; resets 2026-09-29T19:42:20Z");
		expect(run.stderr).toContain("openrouter/deepseek/deepseek-v4.1-flash:medium: cash route: a per-ticket cash cap is not built yet");
		expect(JSON.parse(run.stdout)).toMatchObject({ item: "K-test", launch: null, skipped: [{ verdict: "exhausted" }, { verdict: null }] });
		expect(existsSync(run.state)).toBe(false);
	});

	test("US-046 a single-entry roster gets empty engineer chains, and one model at two efforts never chains to itself", () => {
		const usage = usageView([row("anthropic", "sonnet", "usable"), row("anthropic", "opus", "usable")]);
		const sonnet = "anthropic/claude-sonnet-5-5:medium";
		const single = launch(boardAnswer([SONNET]), usage, "--json");
		expect(launched(single).launch.selector).toBe(sonnet);
		// A helper's primary can fail even on a one-model roster, so its recovery is that model.
		expect(Bun.YAML.parse(readFileSync(launched(single).overlay, "utf8"))).toEqual({
			modelRoles: pinnedTo(sonnet),
			retry: { fallbackChains: { "anthropic/claude-sonnet-5-5": [], ...chainsOf([], [sonnet]) } },
		});

		const opus = "anthropic/claude-opus-5-5";
		const twice = launch(boardAnswer([OPUS, { ...OPUS, effort: "max" }]), usage, "--json");
		expect(launched(twice).launch.selector).toBe(`${opus}:xhigh`);
		const chains = Bun.YAML.parse(readFileSync(launched(twice).overlay, "utf8")).retry.fallbackChains;
		expect(chains).toEqual({ [opus]: [], ...chainsOf([], [`${opus}:xhigh`, `${opus}:max`]) });
	});

	const healthy = usageView([row("openai-codex", "gpt-6.1-sol", "usable"), row("anthropic", "sonnet", "usable")]);
	const refusals: [string, unknown, unknown, string[], RegExp][] = [
		["a null ticket", null, healthy, [], /no ticket/],
		["an item without a ticket", boardAnswer(null), healthy, [], /K-test has no ticket/],
		["an empty roster", boardAnswer([]), healthy, [], /empty roster/],
		["a board answer that is not ready", { data: { state: "stale", value: {} } }, healthy, [], /not ready/],
		["an entry without an effort", boardAnswer([{ provider: "anthropic", model: "claude-sonnet-5-5" } as Entry]), healthy, [], /needs a provider, a model and an effort/],
		["an unapproved model", boardAnswer([SOL, { provider: "anthropic", model: "claude-haiku-4", effort: "low" }]), healthy, [], /entry 2 \(anthropic\/claude-haiku-4\) is not on the approved model list/],
		["an effort the model lacks", boardAnswer([{ ...GEMINI, effort: "xhigh" }]), healthy, [], /effort xhigh, which google-antigravity\/gemini-3.8-flash does not support/],
		["Sol below the engineer effort floor", boardAnswer([{ ...SOL, effort: "medium" }]), healthy, [], /effort medium, which openai-codex\/gpt-6\.1-sol does not support/],
		["a duplicate entry", boardAnswer([SOL, SONNET, SOL]), healthy, [], /entries 1 and 3 are the same model and effort/],
		["another harness", boardAnswer([SOL]), healthy, ["--harness", "pi"], /Pi enforcement is a later slice/],
		["a usage view that is not ok", boardAnswer([SOL]), usageView([], { ok: false, error: "status is stale" }), [], /not ok: status is stale/],
		["a usage view with an unknown verdict", boardAnswer([SOL]), usageView([row("openai-codex", "gpt-6.1-sol", "great")]), [], /unrecognised shape/],
		["a usage view without routes", boardAnswer([SOL]), { ok: true, rollup: [row("openai-codex", "gpt-6.1-sol", "usable")], coverage: [] }, [], /unrecognised shape/],
	];
	test("US-046 refuses bad tickets, harnesses and usage views with one plain sentence and no overlay", () => {
		for (const [name, ticket, usage, extra, sentence] of refusals) {
			const run = launch(ticket, usage, ...extra);
			expect([name, run.exitCode, run.stdout]).toEqual([name, 1, ""]);
			expect([name, run.stderr.trim().split("\n").length]).toEqual([name, 1]);
			expect([name, run.stderr]).toEqual([name, expect.stringMatching(sentence)]);
			expect([name, existsSync(run.state)]).toEqual([name, false]);
		}
	});

	test("US-046 an item id cannot carry a path into the overlay location", () => {
		const dir = scratch("item");
		const run = invoke(["launch", "--item", "../escape", "--ticket-json", put(join(dir, "t.json"), JSON.stringify(boardAnswer([SOL]))), "--state-dir", join(dir, "state")]);
		expect(run.exitCode).toBe(2);
		expect(existsSync(join(dir, "escape.yml"))).toBe(false);
		expect(existsSync(join(dir, "state"))).toBe(false);
	});

	test("US-046 reads the board and ai-usage by their real commands and defaults the overlay under the state home", () => {
		const bin = scratch("bin");
		put(join(bin, "answer.json"), JSON.stringify(boardAnswer([SOL, SONNET])));
		put(join(bin, "usage.json"), JSON.stringify(usageView([row("openai-codex", "gpt-6.1-sol", "exhausted"), row("anthropic", "sonnet", "usable")])));
		const fake = (name: string, expected: string, body: string) =>
			writeFileSync(join(bin, name), `#!/bin/sh\n[ "$*" = "${expected}" ] || { echo "unexpected arguments: $*" >&2; exit 2; }\n${body}\n`, { mode: 0o755 });
		fake("board", "query items --item K-test --json", `cat "${bin}/answer.json"`);
		fake("ai-usage", "dispatch --json", `cat "${bin}/usage.json"`);
		const xdg = join(bin, "state-home");
		const env = { PATH: `${bin}:${process.env.PATH}`, XDG_STATE_HOME: xdg, OMP_ROSTER_BOARD_BIN: "board" };

		const out = JSON.parse(invoke(["launch", "--item", "K-test", "--json"], env).stdout);
		expect(out.launch.selector).toBe("anthropic/claude-sonnet-5-5:medium");
		expect(out.overlay.startsWith(join(xdg, "omp-roster", "K-test."))).toBe(true);

		fake("board", "query items --item K-test --json", `echo '{"error":"No read answer was found."}'; echo 'board query: No read answer was found.' >&2; exit 1`);
		const missing = invoke(["launch", "--item", "K-test"], env);
		expect([missing.exitCode, missing.stderr.trim().split("\n").length]).toEqual([1, 1]);
		expect(missing.stderr).toContain("The board could not read K-test: No read answer was found.");

		// A live answer must be the board's document; a bare ticket shape is only for fixtures.
		fake("board", "query items --item K-test --json", `echo '{"roster":[{"provider":"openai-codex","model":"gpt-6.1-sol","effort":"high"}]}'`);
		const bare = invoke(["launch", "--item", "K-test"], env);
		expect([bare.exitCode, bare.stderr.trim()]).toEqual([1, "omp-roster: The board's answer for K-test is not ready."]);

		fake("board", "query items --item K-test --json", `cat "${bin}/answer.json"`);
		fake("ai-usage", "dispatch --json", `echo '{"ok":false,"error":"status is stale"}'; exit 1`);
		const stale = invoke(["launch", "--item", "K-test"], env);
		expect([stale.exitCode, stale.stderr.trim()]).toEqual([1, "omp-roster: The ai-usage view is not ok: status is stale."]);
	});

	test("US-046 reads the roster from glass once it is installed, from board before, and from OMP_ROSTER_BOARD_BIN over both", () => {
		const bin = scratch("bin");
		const usage = usageView([row("anthropic", "sonnet", "usable"), row("anthropic", "opus", "usable")]);
		put(join(bin, "usage.json"), JSON.stringify(usage));
		put(join(bin, "ai-usage"), `#!/bin/sh\ncat "${bin}/usage.json"\n`);
		chmodSync(join(bin, "ai-usage"), 0o755);
		const program = (name: string, model: string) => {
			put(join(bin, name), `#!/bin/sh\ncat <<'EOF'\n${JSON.stringify(boardAnswer([{ provider: "anthropic", model, effort: "medium" }]))}\nEOF\n`);
			chmodSync(join(bin, name), 0o755);
		};
		// A closed PATH, so a real glass or board on the host cannot decide the outcome.
		const env: Record<string, string> = { PATH: `${bin}:/usr/bin:/bin`, XDG_STATE_HOME: join(bin, "state-home"), HOME: join(bin, "home") };
		const launched = () => JSON.parse(invoke(["launch", "--item", "K-test", "--json"], env).stdout).launch.model;
		program("board", "claude-sonnet-5-5");
		expect(launched()).toBe("claude-sonnet-5-5");
		program("glass", "claude-opus-5-5");
		expect(launched()).toBe("claude-opus-5-5");
		program("other-board", "claude-sonnet-5-5");
		env.OMP_ROSTER_BOARD_BIN = "other-board";
		expect(launched()).toBe("claude-sonnet-5-5");
	});

	test("US-046 every role of the real config.yml with a chat-model chain is recovered only onto the roster, so no helper can reach Gemini or Grok", () => {
		const config = Bun.YAML.parse(readFileSync(join(import.meta.dir, "..", "config.yml"), "utf8")) as {
			modelRoles: Record<string, string>;
			retry: { fallbackChains: Record<string, string[]> };
			task: { agentModelOverrides: Record<string, string> };
		};
		const run = launch(boardAnswer([SOL, SONNET]), usageView([row("openai-codex", "gpt-6.1-sol", "exhausted"), row("anthropic", "sonnet", "usable")]), "--json");
		launched(run);
		const overlay = Bun.YAML.parse(readFileSync(JSON.parse(run.stdout).overlay, "utf8")) as { modelRoles: Record<string, string>; retry: { fallbackChains: Record<string, string[]> } };
		const sol = "openai-codex/gpt-6.1-sol:high";
		const sonnet = "anthropic/claude-sonnet-5-5:medium";
		const expected = chainsOf([sol], [sol, sonnet]) as Record<string, string[]>;

		// Roles are chain keys without a slash; web's chain holds search providers, not chat models.
		const roles = Object.entries(config.retry.fallbackChains)
			.filter(([name, chain]) => !name.includes("/") && chain.some((entry) => !entry.startsWith("web/")))
			.map(([name]) => name);
		expect(roles.length).toBeGreaterThan(0);
		expect(roles.some((role) => config.retry.fallbackChains[role].some((entry) => entry.startsWith("google-antigravity/")))).toBe(true);
		expect(roles.some((role) => config.retry.fallbackChains[role].some((entry) => entry.startsWith("xai-oauth/")))).toBe(true);
		// Model-keyed chains (`provider/model`, `provider/*`) outrank role chains in OMP, and the overlay
		// only overrides the roster's own model keys. So none in config.yml may recover anywhere: a new
		// one that reaches Gemini or Grok fails here until someone handles it on purpose.
		const modelKeyed = Object.entries(config.retry.fallbackChains).filter(([name]) => name.includes("/"));
		expect(modelKeyed.length).toBeGreaterThan(0);
		for (const [name, chain] of modelKeyed) expect([name, chain]).toEqual([name, []]);
		for (const role of roles) {
			expect([role, Array.isArray(expected[role])]).toEqual([role, true]);
			expect([role, overlay.retry.fallbackChains[role]]).toEqual([role, expected[role]]);
		}

		// The subagents reach helper roles through overrides; each target role must be one of those.
		for (const [agent, route] of Object.entries(config.task.agentModelOverrides)) {
			if (route.startsWith("@")) expect([agent, [...roles, "reviewer", "security-reviewer"]])
				.toEqual([agent, expect.arrayContaining([route.slice(1)])]);
		}
		expect(overlay.retry.fallbackChains.reviewer).toEqual([]);
		expect(overlay.retry.fallbackChains["security-reviewer"]).toEqual([]);
		// Helper primaries stay as US-014 has them; only the four engineer roles are pinned.
		for (const [role, primary] of Object.entries(PRIMARY)) expect([role, config.modelRoles[role].replace(/:[a-z]+$/, "")]).toEqual([role, primary]);
		expect(Object.keys(overlay.modelRoles).sort()).toEqual([...ENGINEER].sort());
		// vision (the designer) and web keep their own routes.
		expect(overlay.retry.fallbackChains.vision).toBeUndefined();
		expect(overlay.retry.fallbackChains.web).toBeUndefined();
	});
});

describe("omp-roster check (US-046)", () => {
	const SECRET = "PROMPT-TEXT-THAT-MUST-NOT-APPEAR";
	let seq = 0;
	const stamp = (second: number) => `2026-09-29T16:00:${String(second).padStart(2, "0")}.000Z`;
	const said = (second: number, provider: string, model: string) => ({
		type: "message", id: `m${++seq}`, parentId: null, timestamp: stamp(second),
		message: { role: "assistant", provider, model, stopReason: "toolUse", content: [{ type: "text", text: SECRET }], errorMessage: SECRET },
	});
	const asked = (second: number) => ({ type: "message", id: `u${++seq}`, parentId: null, timestamp: stamp(second), message: { role: "user", content: [{ type: "text", text: SECRET }] } });
	const switched = (second: number, model: string, fallback: boolean) =>
		({ type: "model_change", id: `c${++seq}`, parentId: null, timestamp: stamp(second), model, resolvedModelIsFallback: fallback });
	const jsonl = (path: string, records: unknown[]) => put(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
	const checkTicket = (dir: string, ticketFile: string, extra: string[], ...sessions: string[]) =>
		invoke(["check", "--item", "K-test", "--ticket-json", ticketFile, "--state-dir", join(dir, "state"), ...extra, ...sessions.flatMap((session) => ["--session", session])]);
	const checkWith = (dir: string, roster: Entry[], extra: string[], ...sessions: string[]) =>
		checkTicket(dir, put(join(dir, "ticket.json"), JSON.stringify(boardAnswer(roster))), extra, ...sessions);
	const check = (dir: string, ...sessions: string[]) => checkWith(dir, [SOL, SONNET], [], ...sessions);

	const init = (agent: string, modelRole: string) => ({ type: "session_init", id: `i${++seq}`, timestamp: stamp(0), agent, modelRole, resolvedModel: "unrecorded", systemPrompt: SECRET });

	// What `launch` writes beside its overlay for one launch, with a fixed time and digest so the tests
	// do not depend on the clock.
	const recorded = (dir: string, roster: Entry[], launchedAt: string, digest: string, schemaVersion = 2) =>
		put(join(dir, "state", `K-test.${digest}.launch.json`), JSON.stringify({ item: "K-test", roster, roster_sha256: "unused", launch: selectorOf(roster[0]), overlay: join(dir, "state", `K-test.${digest}.yml`), launched_at: launchedAt, ...(schemaVersion === 2 ? { schema_version: 2 } : {}) }));
	const selectorOf = (entry: Entry) => `${entry.provider}/${entry.model}:${entry.effort}`;

	test("US-046 checks retired Sol records and launch-era helper primaries without allowing new retired Sol launches", () => {
		const dir = scratch("historical-sol");
		recorded(dir, [OLD_SOL, SONNET], stamp(1), "aaaaaaaa", 1);
		const main = jsonl(join(dir, "S-old.jsonl"), [asked(2), said(3, "openai-codex", "gpt-6-sol")]);
		jsonl(join(dir, "S-old", "Reviewer.jsonl"), [init("reviewer", "reviewer"), said(4, "openai-codex", "gpt-6-sol")]);
		jsonl(join(dir, "S-old", "Plan.jsonl"), [init("plan", "plan"), said(5, "openai-codex", "gpt-6-astra")]);
		const historical = checkWith(dir, [OLD_SOL, SONNET], [], main);
		expect(historical.exitCode).toBe(0);
		expect(historical.stdout).toContain("2 helper turn(s) in 2 file(s)");
		expect(historical.stdout).toContain("turns on the roster: 1");
		expect(historical.stdout).not.toContain("roster changed");
		const attempt = launch(boardAnswer([OLD_SOL]), usageView([row("openai-codex", "gpt-6-sol", "usable")]), "--json");
		expect(attempt.exitCode).toBe(1);
		expect(attempt.stderr).toContain("gpt-6-sol) is not on the approved model list");
	});

	test("US-046 a new record checks current primaries even for a Sonnet-only roster", () => {
		const dir = scratch("current-primary");
		recorded(dir, [SONNET], stamp(1), "bbbbbbbb");
		const main = jsonl(join(dir, "S-new.jsonl"), [asked(2), said(3, "anthropic", "claude-sonnet-5-5")]);
		jsonl(join(dir, "S-new", "Reviewer.jsonl"), [init("reviewer", "reviewer"), said(4, "openai-codex", "gpt-6-sol")]);
		const run = checkWith(dir, [SONNET], [], main);
		expect(run.exitCode).toBe(4);
		expect(run.stdout).toContain("openai-codex/gpt-6-sol off roster: 1 turn(s)");
	});

	test("US-046 a cash route is never on the roster: turns and hops onto OpenRouter are violations even when the ticket names it", () => {
		const dir = scratch("cash");
		const session = jsonl(join(dir, "S6.jsonl"), [
			asked(1), said(2, "openai-codex", "gpt-6.1-sol"),
			switched(3, "openrouter/deepseek/deepseek-v4.1-flash", true), said(4, "openrouter", "deepseek/deepseek-v4.1-flash"), said(5, "openrouter", "deepseek/deepseek-v4.1-flash"),
		]);
		const run = checkWith(dir, [SOL, CASH], [], session);
		expect(run.exitCode).toBe(4);
		expect(run.stdout).toContain("openrouter/deepseek/deepseek-v4.1-flash off roster: 2 turn(s)");
		expect(run.stdout).toContain("switched to openrouter/deepseek/deepseek-v4.1-flash (off roster)");
		expect(run.stdout).toContain("NOT CLEAN: 2 turn(s) and 1 fallback switch(es) off the roster.");
	});

	test("US-046 the designer on Opus 5.5 is not a violation on a roster without Opus, but the designer on any other off-roster model is", () => {
		const dir = scratch("designer");
		const main = jsonl(join(dir, "S7.jsonl"), [asked(1), said(2, "anthropic", "claude-sonnet-5-5")]);
		jsonl(join(dir, "S7", "Designer.jsonl"), [init("designer", "vision"), said(3, "anthropic", "claude-opus-5-5"), said(4, "anthropic", "claude-opus-5-5")]);
		const clean = check(dir, main);
		expect(clean.exitCode).toBe(0);
		expect(clean.stdout).toContain("2 helper turn(s) in 1 file(s) ran on their role's approved primary");

		// The agent name alone is enough, and an engineer's task agent on Opus is still judged.
		const byName = scratch("designer-name");
		jsonl(join(byName, "S8", "Designer.jsonl"), [init("designer", "task"), said(3, "anthropic", "claude-opus-5-5")]);
		const task = jsonl(join(byName, "S8", "Builder.jsonl"), [init("task", "task"), said(4, "anthropic", "claude-opus-5-5")]);
		const named = check(byName, join(byName, "S8"));
		expect(named.exitCode).toBe(4);
		expect(named.stdout).toContain(`${task} anthropic/claude-opus-5-5 off roster: 1 turn(s)`);
		expect(named.stdout).toContain("1 helper turn(s) in 1 file(s)");

		const hop = scratch("designer-hop");
		jsonl(join(hop, "S9", "Designer.jsonl"), [init("designer", "vision"), said(3, "google-antigravity", "gemini-3.8-flash")]);
		jsonl(join(hop, "S9.jsonl"), [asked(1), said(2, "anthropic", "claude-sonnet-5-5")]);
		expect(check(hop, join(hop, "S9.jsonl")).exitCode).toBe(4);
	});

	test("US-046 a fallback switch off the roster fails the check on its own, and a turn with no provider or model is off the roster", () => {
		const dir = scratch("switch-only");
		const session = jsonl(join(dir, "S10.jsonl"), [asked(1), said(2, "openai-codex", "gpt-6.1-sol"), switched(3, "google-antigravity/gemini-3.8-flash", true)]);
		const run = checkWith(dir, [SOL, SONNET], [], session);
		expect(run.exitCode).toBe(4);
		expect(run.stdout).toContain("NOT CLEAN: 0 turn(s) and 1 fallback switch(es) off the roster.");

		const bare = scratch("no-model");
		const anonymous = jsonl(join(bare, "S11.jsonl"), [{ type: "message", id: "m0", parentId: null, timestamp: stamp(2), message: { role: "assistant", model: "gpt-6.1-sol" } }]);
		const failed = check(bare, anonymous);
		expect(failed.exitCode).toBe(4);
		expect(failed.stdout).toContain("(no provider and model recorded) off roster: 1 turn(s)");
	});

	const SONNET_ONLY = [SONNET];
	const modelLine = (model: string, position: number, count: number) => `  ${model} (roster position ${position}): ${count}`;

	test("US-046 with a launch record check judges against the roster as launched and says when the ticket has changed; --since overrides the time", () => {
		const dir = scratch("record");
		const record = recorded(dir, [SOL, SONNET], stamp(5), "aaaaaaaa");
		const session = jsonl(join(dir, "S12.jsonl"), [asked(6), said(7, "openai-codex", "gpt-6.1-sol"), said(8, "anthropic", "claude-sonnet-5-5")]);
		const run = checkWith(dir, [SOL, SONNET], [], session);
		expect(run.exitCode).toBe(0);
		expect(run.stdout).toContain("launch records: 1");
		expect(run.stdout).toContain(`judged against launch record ${record} (launched ${stamp(5)}; roster: 1 openai-codex/gpt-6.1-sol:high, 2 anthropic/claude-sonnet-5-5:medium): 1 file(s)\n  ${session}\n`);
		expect(run.stdout).toContain("turns on the roster: 2");

		// --since replaces the launch time; a bad one is a usage error.
		const mixed = jsonl(join(dir, "S12b.jsonl"), [asked(6), said(7, "google-antigravity", "gemini-3.8-flash"), said(8, "openai-codex", "gpt-6.1-sol")]);
		const late = checkWith(dir, [SOL, SONNET], ["--since", stamp(8)], mixed);
		expect(late.exitCode).toBe(0);
		expect(late.stdout).toContain(`judging records at or after ${stamp(8)}; 1 earlier record(s) not judged`);
		const early = checkWith(dir, [SOL, SONNET], ["--since", stamp(1)], mixed);
		expect(early.exitCode).toBe(4);
		expect(early.stdout).toContain("NOT CLEAN: 1 turn(s) and 0 fallback switch(es) off the roster.");
		const bad = checkWith(dir, [SOL, SONNET], ["--since", "yesterday"], mixed);
		expect([bad.exitCode, bad.stdout]).toEqual([2, ""]);
		expect(bad.stderr).toContain("--since needs an ISO-8601 time");

		// Widening the ticket after launch does not widen what the engineer may run on.
		const grok = jsonl(join(dir, "S13.jsonl"), [asked(6), said(7, "anthropic", "claude-sonnet-5-5"), said(8, "xai-oauth", "grok-4.7")]);
		const changed = checkWith(dir, [SOL, SONNET, GROK], [], grok);
		expect(changed.exitCode).toBe(4);
		expect(changed.stdout).toContain("roster: 1 openai-codex/gpt-6.1-sol:high, 2 anthropic/claude-sonnet-5-5:medium\n");
		expect(changed.stdout).toContain("roster changed since launch: the board now has roster_sha256");
		expect(changed.stdout).toContain("NOT CLEAN: the roster changed since launch; 1 turn(s) and 0 fallback switch(es) off the roster.");

		// A changed ticket fails the check even when every turn stayed on the launch roster.
		const quiet = jsonl(join(dir, "S17.jsonl"), [asked(6), said(7, "anthropic", "claude-sonnet-5-5")]);
		const reordered = checkWith(dir, [SONNET, SOL], [], quiet);
		expect(reordered.exitCode).toBe(4);
		expect(reordered.stdout).toContain("turns off the roster: 0");
		expect(reordered.stdout).toContain("NOT CLEAN: the roster changed since launch; 0 turn(s) and 0 fallback switch(es) off the roster.");

		// The same roster is unchanged, and a run with no record says so.
		const unchanged = checkWith(dir, [SOL, SONNET], [], quiet);
		expect([unchanged.exitCode, unchanged.stdout.includes("roster changed")]).toEqual([0, false]);
		const none = scratch("no-record");
		const all = checkWith(none, [SOL, SONNET], [], jsonl(join(none, "S14.jsonl"), [asked(1), said(2, "google-antigravity", "gemini-3.8-flash")]));
		expect(all.exitCode).toBe(4);
		expect(all.stdout).toContain("no launch record for this item: judged against the ticket's current roster");
		expect(all.stdout).toContain("judging every record");
	});

	test("US-046 a relaunch does not change what an earlier session is judged against: each file gets the newest launch at or before its start, a subagent with its session", () => {
		const dir = scratch("relaunch");
		const first = recorded(dir, [SOL, SONNET], stamp(3), "bbbbbbbb");
		const second = recorded(dir, SONNET_ONLY, stamp(20), "aaaaaaaa");
		const old = jsonl(join(dir, "sessions", "S20.jsonl"), [asked(4), said(5, "openai-codex", "gpt-6.1-sol"), said(6, "google-antigravity", "gemini-3.8-flash")]);
		// Started after the relaunch, but it belongs to the session that started before it.
		const worker = jsonl(join(dir, "sessions", "S20", "Worker.jsonl"), [said(22, "openai-codex", "gpt-6.1-sol")]);
		const fresh = jsonl(join(dir, "sessions", "S21.jsonl"), [asked(21), said(22, "anthropic", "claude-sonnet-5-5")]);

		const run = checkWith(dir, SONNET_ONLY, [], join(dir, "sessions"));
		const lines = run.stdout.split("\n");
		expect(run.exitCode).toBe(4);
		const firstAt = lines.findIndex((line) => line.startsWith(`judged against launch record ${first} `));
		const secondAt = lines.findIndex((line) => line.startsWith(`judged against launch record ${second} `));
		expect(lines.slice(firstAt, firstAt + 3)).toEqual([expect.stringContaining(": 2 file(s)"), `  ${old}`, `  ${worker}`]);
		expect(lines.slice(secondAt, secondAt + 2)).toEqual([expect.stringContaining(": 1 file(s)"), `  ${fresh}`]);
		expect(run.stdout).toContain(`${old} google-antigravity/gemini-3.8-flash off roster: 1 turn(s)`);
		expect(run.stdout).toContain("turns off the roster: 1");
		expect(lines).toContain(modelLine("openai-codex/gpt-6.1-sol", 1, 2));
		expect(lines).toContain(modelLine("anthropic/claude-sonnet-5-5", 1, 1));
		// The board holds the newest session's roster, so nothing changed.
		expect(run.stdout).not.toContain("roster changed");
		expect(run.stdout).toContain("NOT CLEAN: 1 turn(s) and 0 fallback switch(es) off the roster.");
	});

	test("US-046 two launches with two rosters: each session is judged against its own", () => {
		const dir = scratch("two-rosters");
		recorded(dir, [SOL], stamp(2), "bbbbbbbb");
		recorded(dir, SONNET_ONLY, stamp(10), "aaaaaaaa");
		const solSession = jsonl(join(dir, "sessions", "Sa.jsonl"), [asked(3), said(4, "openai-codex", "gpt-6.1-sol")]);
		jsonl(join(dir, "sessions", "Sb.jsonl"), [asked(11), said(12, "anthropic", "claude-sonnet-5-5")]);
		const clean = checkWith(dir, SONNET_ONLY, [], join(dir, "sessions"));
		expect(clean.exitCode).toBe(0);
		expect(clean.stdout).toContain("turns on the roster: 2");

		// The same Sonnet turn is off the first launch's roster.
		const crossed = jsonl(join(dir, "sessions", "Sc.jsonl"), [asked(4), said(5, "anthropic", "claude-sonnet-5-5")]);
		const wrong = checkWith(dir, SONNET_ONLY, [], join(dir, "sessions"));
		expect(wrong.exitCode).toBe(4);
		expect(wrong.stdout).toContain(`${crossed} anthropic/claude-sonnet-5-5 off roster: 1 turn(s)`);
		expect(wrong.stdout).not.toContain(`${solSession} openai-codex`);
	});

	test("US-046 a file that started before every launch record is judged against the ticket's current roster, and the report says so", () => {
		const dir = scratch("before-records");
		recorded(dir, [SOL, SONNET], stamp(5), "aaaaaaaa");
		const session = jsonl(join(dir, "S22.jsonl"), [asked(1), said(2, "google-antigravity", "gemini-3.8-flash")]);
		const run = checkWith(dir, [SOL, SONNET], [], session);
		expect(run.exitCode).toBe(4);
		expect(run.stdout).toContain(`judged against the ticket's current roster (no launch record at or before these files started): 1 file(s)\n  ${session}\n`);
		expect(run.stdout).toContain("NOT CLEAN: 1 turn(s) and 0 fallback switch(es) off the roster.");
	});

	test("US-046 a launched file with assistant turns and none judged is not clean", () => {
		const dir = scratch("nothing-judged");
		recorded(dir, [SOL, SONNET], stamp(2), "aaaaaaaa");
		const session = jsonl(join(dir, "S23.jsonl"), [asked(3), said(4, "openai-codex", "gpt-6.1-sol"), said(5, "anthropic", "claude-sonnet-5-5")]);
		jsonl(join(dir, "S24.jsonl"), [asked(3)]);
		const run = checkWith(dir, [SOL, SONNET], ["--since", stamp(30)], join(dir, "S23.jsonl"), join(dir, "S24.jsonl"));
		expect(run.exitCode).toBe(4);
		expect(run.stdout.split("\n").filter((line) => line.startsWith("nothing was judged"))).toEqual([
			`nothing was judged in ${session}: it has 2 assistant turn(s) and none is at or after ${new Date(Date.parse(stamp(30))).toISOString()}`,
		]);
		expect(run.stdout).toContain("NOT CLEAN: 1 file(s) with turns but nothing judged; 0 turn(s) and 0 fallback switch(es) off the roster.");
	});

	test("US-046 with a launch record a board that cannot give the roster is a finding and every turn is still judged; without one it stops", () => {
		const dir = scratch("board-down");
		recorded(dir, [SOL, SONNET], stamp(2), "aaaaaaaa");
		const session = jsonl(join(dir, "S30.jsonl"), [asked(3), said(4, "openai-codex", "gpt-6.1-sol"), said(5, "google-antigravity", "gemini-3.8-flash")]);
		const before = jsonl(join(dir, "S31.jsonl"), [asked(1), said(2, "anthropic", "claude-sonnet-5-5")]);
		const cases: [string, string, string][] = [
			["a ticket that cannot be read", join(dir, "missing.json"), "Cannot read the ticket file"],
			["an empty roster", put(join(dir, "empty.json"), JSON.stringify(boardAnswer([]))), "has an empty roster"],
			["an item without a ticket", put(join(dir, "none.json"), JSON.stringify(boardAnswer(null))), "has no ticket"],
		];
		for (const [name, ticketFile, reason] of cases) {
			const run = checkTicket(dir, ticketFile, [], session, before);
			expect([name, run.exitCode]).toEqual([name, 4]);
			expect([name, run.stdout]).toEqual([name, expect.stringContaining(`roster changed since launch: the board's roster could not be read (`)]);
			expect([name, run.stdout]).toEqual([name, expect.stringContaining(reason)]);
			expect([name, run.stdout]).toEqual([name, expect.stringContaining(`${session} google-antigravity/gemini-3.8-flash off roster: 1 turn(s)`)]);
			// A file from before every launch falls back to the earliest record, not to nothing.
			expect([name, run.stdout]).toEqual([name, expect.stringContaining("judged against the earliest launch record")]);
			expect([name, run.stdout]).toEqual([name, expect.stringContaining("turns on the roster: 2")]);
			expect([name, run.stdout]).toEqual([name, expect.stringContaining("NOT CLEAN: the roster changed since launch; 1 turn(s) and 0 fallback switch(es) off the roster.")]);
		}

		const bare = scratch("board-down-bare");
		const alone = checkTicket(bare, join(bare, "missing.json"), [], jsonl(join(bare, "S32.jsonl"), [asked(1), said(2, "anthropic", "claude-sonnet-5-5")]));
		expect([alone.exitCode, alone.stdout]).toEqual([1, ""]);
		expect(alone.stderr).toContain("Cannot read the ticket file");
	});

	test("US-046 a session being written may end in half a line; a corrupt line in the middle still stops the check", () => {
		const dir = scratch("live");
		const complete = JSON.stringify(said(2, "anthropic", "claude-sonnet-5-5"));
		const live = put(join(dir, "S15.jsonl"), `${JSON.stringify(asked(1))}\n${complete}\n{"type":"message","message":{"role":"assis`);
		const run = check(dir, live);
		expect(run.exitCode).toBe(0);
		expect(run.stdout).toContain("turns on the roster: 1");
		expect(check(dir, put(join(dir, "S16.jsonl"), `{"type":"mess\n${complete}\n`)).exitCode).toBe(1);
	});

	test("US-046 reports off-roster turns and fallbacks in subagent files, counts advisor turns as helpers, and never prints prompts", () => {
		const dir = scratch("check");
		const main = jsonl(join(dir, "S1.jsonl"), [
			asked(1), switched(1, "openai-codex/gpt-6.1-sol", false), said(2, "openai-codex", "gpt-6.1-sol"),
			switched(3, "anthropic/claude-sonnet-5-5", true), said(4, "anthropic", "claude-sonnet-5-5"), said(5, "anthropic", "claude-sonnet-5-5"),
		]);
		const worker = jsonl(join(dir, "S1", "Worker.jsonl"), [
			switched(6, "google-antigravity/gemini-3.8-flash", true), said(7, "google-antigravity", "gemini-3.8-flash"), said(8, "google-antigravity", "gemini-3.8-flash"),
		]);
		jsonl(join(dir, "S1", "__advisor.steward.jsonl"), [said(9, "anthropic", "claude-sonnet-5-5")]);

		// Passing only the main file still reaches its subagent directory.
		const run = check(dir, main);
		const lines = run.stdout.split("\n");
		expect(run.exitCode).toBe(4);
		expect(run.stderr).toBe("");
		expect(lines).toContainEqual(expect.stringContaining(`${worker} google-antigravity/gemini-3.8-flash off roster: 2 turn(s), first ${stamp(7)}, last ${stamp(8)}`));
		expect(lines).toContainEqual(expect.stringContaining(`${main} ${stamp(3)} switched to anthropic/claude-sonnet-5-5 (roster position 2)`));
		expect(lines).toContainEqual(expect.stringContaining(`${worker} ${stamp(6)} switched to google-antigravity/gemini-3.8-flash (off roster)`));
		expect(run.stdout).toContain("1 helper turn(s) in 1 file(s) ran on their role's approved primary");
		expect(run.stdout).toContain("NOT CLEAN: 2 turn(s) and 1 fallback switch(es) off the roster.");
		expect(run.stdout).not.toContain("grok");
		expect(run.stdout).not.toContain(SECRET);
	});

	test("US-046 a helper turn on its role's US-014 primary is a helper turn, not a violation; the same model in a task agent is", () => {
		const dir = scratch("primaries");
		const main = jsonl(join(dir, "S3.jsonl"), [asked(1), said(2, "anthropic", "claude-sonnet-5-5")]);
		jsonl(join(dir, "S3", "Scout.jsonl"), [init("scout", "smol"), said(3, "openai-codex", "gpt-6-luna"), said(4, "openai-codex", "gpt-6-luna")]);
		jsonl(join(dir, "S3", "Sonic.jsonl"), [init("sonic", "smol"), said(5, "openai-codex", "gpt-6-luna")]);
		jsonl(join(dir, "S3", "Reviewer.jsonl"), [init("reviewer", "reviewer"), said(6, "openai-codex", "gpt-6.1-sol"), said(7, "openai-codex", "gpt-6-astra")]);
		jsonl(join(dir, "S3", "__advisor.steward.jsonl"), [said(8, "anthropic", "claude-sonnet-5-5")]);

		// Luna and the advisor's Sonnet are the helpers' primaries; Astra is not the reviewer's.
		const helpers = check(dir, main);
		expect(helpers.exitCode).toBe(4);
		expect(helpers.stdout).toContain("5 helper turn(s) in 4 file(s) ran on their role's approved primary");
		expect(helpers.stdout).toContain("openai-codex/gpt-6-astra off roster: 1 turn(s)");
		expect(helpers.stdout).toContain("turns on the roster: 1");
		expect(helpers.stdout).toContain("NOT CLEAN: 1 turn(s) and 0 fallback switch(es) off the roster.");

		const task = jsonl(join(dir, "S4", "Builder.jsonl"), [init("task", "task"), said(9, "openai-codex", "gpt-6-luna")]);
		jsonl(join(dir, "S4.jsonl"), [asked(1), said(2, "anthropic", "claude-sonnet-5-5")]);
		const judged = check(dir, join(dir, "S4.jsonl"));
		expect(judged.exitCode).toBe(4);
		expect(judged.stdout).toContain(`${task} openai-codex/gpt-6-luna off roster: 1 turn(s)`);
	});

	test("US-046 a helper fallback to a model off the roster is a violation in any file, one onto the roster is not", () => {
		const dir = scratch("helper-hops");
		const main = jsonl(join(dir, "S5.jsonl"), [asked(1), said(2, "anthropic", "claude-sonnet-5-5")]);
		const scout = jsonl(join(dir, "S5", "Scout.jsonl"), [
			init("scout", "smol"), said(3, "openai-codex", "gpt-6-luna"),
			switched(4, "google-antigravity/gemini-3.8-flash", true), said(5, "google-antigravity", "gemini-3.8-flash"),
		]);
		const advisor = jsonl(join(dir, "S5", "__advisor.steward.jsonl"), [said(6, "anthropic", "claude-sonnet-5-5"), switched(7, "xai-oauth/grok-4.7", true)]);
		jsonl(join(dir, "S5", "Reviewer.jsonl"), [init("reviewer", "reviewer"), said(8, "openai-codex", "gpt-6.1-sol"), switched(9, "anthropic/claude-sonnet-5-5", true), said(10, "anthropic", "claude-sonnet-5-5")]);

		const run = check(dir, main);
		expect(run.exitCode).toBe(4);
		expect(run.stdout).toContain(`${scout} ${stamp(4)} switched to google-antigravity/gemini-3.8-flash (off roster)`);
		expect(run.stdout).toContain(`${scout} google-antigravity/gemini-3.8-flash off roster: 1 turn(s)`);
		expect(run.stdout).toContain(`${advisor} ${stamp(7)} switched to xai-oauth/grok-4.7 (off roster)`);
		expect(run.stdout).toContain("switched to anthropic/claude-sonnet-5-5 (roster position 2)");
		expect(run.stdout).toContain("NOT CLEAN: 1 turn(s) and 2 fallback switch(es) off the roster.");
	});

	test("US-046 a session that stayed on the roster, hops included, is clean and names the roster launch used", () => {
		const dir = scratch("clean");
		const session = jsonl(join(dir, "S2.jsonl"), [
			asked(1), said(2, "openai-codex", "gpt-6.1-sol"), switched(3, "anthropic/claude-sonnet-5-5", true), said(4, "anthropic", "claude-sonnet-5-5"),
		]);
		const run = check(dir, session);
		expect(run.exitCode).toBe(0);
		expect(run.stdout).toContain("clean: every checked turn ran on the roster or on a helper's approved primary.");
		expect(run.stdout).toContain("fallback switches: 1");
		// Launch and check must agree on the roster's identity so a later edit to the ticket is visible.
		const usage = usageView([row("openai-codex", "gpt-6.1-sol", "usable"), row("anthropic", "sonnet", "usable")]);
		expect(run.stdout).toContain(`roster_sha256: ${launched(launch(boardAnswer([SOL, SONNET]), usage, "--json")).roster_sha256}`);
		expect(run.stdout).not.toContain(launched(launch(boardAnswer([SONNET, SOL]), usage, "--json")).roster_sha256);
	});

	test("US-046 check cannot pass vacuously: no engineer session, or an unreadable one, is an error", () => {
		const dir = scratch("empty");
		const advisorOnly = jsonl(join(dir, "advisor-only", "__advisor.steward.jsonl"), [said(1, "anthropic", "claude-sonnet-5-5")]);
		const scoutOnly = jsonl(join(dir, "scout-only", "Scout.jsonl"), [init("scout", "smol"), said(1, "openai-codex", "gpt-6-luna")]);
		const broken = put(join(dir, "broken.jsonl"), `${JSON.stringify(said(1, "anthropic", "claude-sonnet-5-5"))}\n{"type":"message","mess\n`);
		mkdirSync(join(dir, "nothing"));
		for (const [session, sentence] of [
			[join(dir, "nothing"), /No engineer session file/],
			[dirname(advisorOnly), /No engineer session file/],
			[dirname(scoutOnly), /No engineer session file/],
			[broken, /Line 2 of .* is not valid JSON/],
			[join(dir, "missing.jsonl"), /Cannot read the session path/],
		] as const) {
			const run = check(dir, session);
			expect([session, run.exitCode, run.stdout]).toEqual([session, 1, ""]);
			expect([session, run.stderr]).toEqual([session, expect.stringMatching(sentence)]);
		}
	});
});

describe("omp-roster without a ticket (US-046)", () => {
	const solUsable = usageView([row("openai-codex", "gpt-6.1-sol", "usable"), row("anthropic", "sonnet", "usable")]);
	const usageFile = (dir: string, view: unknown) => put(join(dir, "usage.json"), JSON.stringify(view));
	// A `board` that fails the test if anything runs it: a launch with --model reads no board.
	const noBoard = (dir: string) => {
		const bin = join(dir, "bin");
		mkdirSync(bin, { recursive: true });
		writeFileSync(join(bin, "board"), `#!/bin/sh\necho "board was run: $*" > "${dir}/board-was-run"\nexit 1\n`, { mode: 0o755 });
		return { PATH: `${bin}:${process.env.PATH}` };
	};
	const adhoc = (dir: string, args: string[], view: unknown = solUsable) =>
		invoke(["launch", ...args, "--usage-json", usageFile(dir, view), "--state-dir", join(dir, "state")], noBoard(dir));

	test("US-046 a launch with --model and --thinking writes a one-route overlay under a synthetic id and reads no board", () => {
		const dir = scratch("adhoc");
		const before = Date.now();
		const run = adhoc(dir, ["--model", "anthropic/claude-sonnet-5-5", "--thinking", "medium", "--json"]);
		expect([run.exitCode, run.stderr]).toEqual([0, ""]);
		const out = JSON.parse(run.stdout);
		expect(out.item).toMatch(/^adhoc-anthropic-claude-sonnet-5-5-\d{8}T\d{6}Z$/);
		expect(out.launch).toEqual({ provider: "anthropic", model: "claude-sonnet-5-5", effort: "medium", selector: "anthropic/claude-sonnet-5-5:medium", verdict: "usable" });
		expect(out.args).toEqual(["--model", "anthropic/claude-sonnet-5-5", "--thinking", "medium", "--config", out.overlay]);
		expect(out.env).toEqual({ PI_CONFIG_FILES: out.overlay });
		expect(out.skipped).toEqual([]);
		expect(out.usage).toEqual({ degraded: false, degraded_reason: null, oldest_observation: null, stale_after_seconds: null });
		expect(out.overlay).toMatch(new RegExp(`^${join(dir, "state", out.item)}\\.[0-9a-f]{8}\\.yml$`));

		// One route: the engineer's chains and the launch model's own are empty, so that model failing stops it. A
		// helper keeps its primary and may recover only onto this one route (empty when the primary is that model).
		const sonnet = "anthropic/claude-sonnet-5-5:medium";
		expect(Bun.YAML.parse(readFileSync(out.overlay, "utf8"))).toEqual({
			modelRoles: pinnedTo(sonnet),
			retry: { fallbackChains: { "anthropic/claude-sonnet-5-5": [], ...chainsOf([], [sonnet]) } },
		});
		const record = JSON.parse(readFileSync(out.record, "utf8"));
		expect(record).toMatchObject({ item: out.item, roster: [{ provider: "anthropic", model: "claude-sonnet-5-5", effort: "medium" }], launch: sonnet, overlay: out.overlay });
		expect(Date.parse(record.launched_at)).toBeGreaterThanOrEqual(before);
		expect(readdirSync(join(dir, "state")).sort()).toEqual([basename(out.overlay), basename(out.record), `${out.item}.launch.json`].sort());
		expect(existsSync(join(dir, "board-was-run"))).toBe(false);
	});

	test("US-046 a launch without --item prints the export line and arguments, and warns on a low route", () => {
		const dir = scratch("adhoc-plain");
		const run = adhoc(dir, ["--model", "openai-codex/gpt-6.1-sol", "--thinking", "xhigh"], usageView([row("openai-codex", "gpt-6.1-sol", "low")]));
		expect(run.exitCode).toBe(0);
		const [exportLine, argsLine] = run.stdout.trim().split("\n");
		const overlay = exportLine.replace("export PI_CONFIG_FILES=", "");
		expect(overlay).toMatch(/\/adhoc-openai-codex-gpt-6\.1-sol-\d{8}T\d{6}Z\.[0-9a-f]{8}\.yml$/);
		expect(argsLine).toBe(`--model openai-codex/gpt-6.1-sol --thinking xhigh --config ${overlay}`);
		expect(run.stderr).toBe("warning: openai-codex/gpt-6.1-sol:xhigh is low on capacity and may run out soon\n");
	});

	test("US-046 a route that cannot launch exits 3 with the reason and writes nothing", () => {
		const cases: [string, string, unknown, RegExp][] = [
			["exhausted", "openai-codex/gpt-6.1-sol", usageView([row("openai-codex", "gpt-6.1-sol", "exhausted", "2026-09-29T19:42:20Z")]), /exhausted, exhausted in the fixture; resets 2026-09-29T19:42:20Z/],
			["blocked", "openai-codex/gpt-6.1-sol", usageView([row("openai-codex", "gpt-6.1-sol", "blocked")]), /blocked, blocked in the fixture/],
			["unknown", "openai-codex/gpt-6.1-sol", usageView([row("openai-codex", "gpt-6.1-sol", "unknown")]), /unknown, unknown in the fixture/],
			["no row", "openai-codex/gpt-6.1-sol", usageView([row("anthropic", "sonnet", "usable")]), /ai-usage has no omp row for openai-codex\/gpt-6\.1-sol/],
			["a model with no ai-usage row at all", "google-antigravity/gemini-3.8-flash", solUsable, /ai-usage has no row for google-antigravity\/gemini-3.8-flash/],
			["a cash route", "openrouter/deepseek/deepseek-v4.1-flash", solUsable, /cash route: a per-ticket cash cap is not built yet/],
		];
		for (const [name, model, view, sentence] of cases) {
			const dir = scratch("adhoc-exhausted");
			const run = adhoc(dir, ["--model", model, "--thinking", model === "openai-codex/gpt-6.1-sol" ? "high" : "medium"], view);
			expect([name, run.exitCode, run.stdout]).toEqual([name, 3, ""]);
			expect([name, run.stderr]).toEqual([name, expect.stringMatching(/roster exhausted for adhoc-/)]);
			expect([name, run.stderr]).toEqual([name, expect.stringMatching(sentence)]);
			expect([name, existsSync(join(dir, "state"))]).toEqual([name, false]);
		}
		const dir = scratch("adhoc-exhausted-json");
		const json = adhoc(dir, ["--model", "openai-codex/gpt-6.1-sol", "--thinking", "high", "--json"], usageView([row("openai-codex", "gpt-6.1-sol", "exhausted")]));
		expect(json.exitCode).toBe(3);
		expect(JSON.parse(json.stdout)).toMatchObject({ launch: null, skipped: [{ selector: "openai-codex/gpt-6.1-sol:high", verdict: "exhausted" }] });
	});

	test("US-046 a launch without a ticket refuses flags that do not fit, an unapproved model and an effort suffix, and writes nothing", () => {
		const dir = scratch("adhoc-refused");
		const ticket = put(join(dir, "t.json"), JSON.stringify(boardAnswer([SOL])));
		const cases: [string, string[], number, RegExp][] = [
			["--item with --model", ["--item", "K-test", "--model", "openai-codex/gpt-6.1-sol", "--thinking", "medium"], 2, /do not give --model or --thinking with it/],
			["--item with --thinking", ["--item", "K-test", "--thinking", "medium"], 2, /do not give --model or --thinking with it/],
			["neither --item nor --model", [], 2, /needs both --model provider\/model and --thinking effort/],
			["--model alone", ["--model", "openai-codex/gpt-6.1-sol"], 2, /needs both --model provider\/model and --thinking effort/],
			["--thinking alone", ["--thinking", "medium"], 2, /needs both --model provider\/model and --thinking effort/],
			["an effort suffix", ["--model", "openai-codex/gpt-6.1-sol:high", "--thinking", "high"], 2, /no effort suffix; give the effort with --thinking, not openai-codex\/gpt-6\.1-sol:high/],
			["a model without a provider", ["--model", "gpt-6.1-sol", "--thinking", "high"], 2, /--model needs provider\/model, not gpt-6\.1-sol/],
			["retired Sol", ["--model", "openai-codex/gpt-6-sol", "--thinking", "high"], 1, /gpt-6-sol\) is not on the approved model list/],
			["an unapproved model", ["--model", "anthropic/claude-haiku-4", "--thinking", "low"], 1, /anthropic\/claude-haiku-4\) is not on the approved model list/],
			["an effort the model lacks", ["--model", "google-antigravity/gemini-3.8-flash", "--thinking", "xhigh"], 1, /effort xhigh, which google-antigravity\/gemini-3.8-flash does not support/],
			["--ticket-json", ["--model", "openai-codex/gpt-6.1-sol", "--thinking", "medium", "--ticket-json", ticket], 2, /--ticket-json goes with --item/],
			["a board item named for a launch without a ticket", ["--item", "adhoc-anything"], 2, /cannot start with "adhoc-"/],
		];
		for (const [name, args, code, sentence] of cases) {
			const run = adhoc(dir, args);
			expect([name, run.exitCode, run.stdout]).toEqual([name, code, ""]);
			expect([name, run.stderr]).toEqual([name, expect.stringMatching(sentence)]);
			expect([name, existsSync(join(dir, "state"))]).toEqual([name, false]);
		}
		expect(existsSync(join(dir, "board-was-run"))).toBe(false);
	});

	describe("check", () => {
		// Sessions are stamped from one base time; launch runs a moment after it, so every post-launch stamp is
		// at least ten seconds later and no test races the clock.
		const base = Date.now();
		const iso = (offsetMs: number) => new Date(base + offsetMs).toISOString();
		let seq = 0;
		const said = (at: string, provider: string, model: string) =>
			({ type: "message", id: `a${++seq}`, parentId: null, timestamp: at, message: { role: "assistant", provider, model, stopReason: "stop", content: [] } });
		const switched = (at: string, model: string) => ({ type: "model_change", id: `c${++seq}`, parentId: null, timestamp: at, model, resolvedModelIsFallback: true });
		const opened = (at: string) => ({ type: "session", id: `s${++seq}`, timestamp: at });
		const jsonl = (path: string, records: unknown[]) => put(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
		const launchedOn = (dir: string, model: string, effort: string) => {
			const run = adhoc(dir, ["--model", model, "--thinking", effort, "--json"]);
			expect(run.exitCode).toBe(0);
			return JSON.parse(run.stdout) as { item: string; record: string };
		};
		const checkAdhoc = (dir: string, item: string, ...args: string[]) =>
			invoke(["check", "--item", item, "--state-dir", join(dir, "state"), ...args], noBoard(dir));

		test("US-046 check on an adhoc id judges against the recorded one-route roster, with no board and no roster-changed finding", () => {
			const dir = scratch("adhoc-check");
			const { item, record } = launchedOn(dir, "anthropic/claude-sonnet-5-5", "medium");
			const clean = jsonl(join(dir, "sessions", "Clean.jsonl"), [opened(iso(10_000)), said(iso(11_000), "anthropic", "claude-sonnet-5-5"), said(iso(12_000), "anthropic", "claude-sonnet-5-5")]);
			const ok = checkAdhoc(dir, item, "--session", clean);
			expect([ok.exitCode, ok.stderr]).toEqual([0, ""]);
			expect(ok.stdout).toContain("launch records: 1");
			expect(ok.stdout).toContain(`judged against launch record ${record} (launched `);
			expect(ok.stdout).toContain("roster: 1 anthropic/claude-sonnet-5-5:medium");
			expect(ok.stdout).toContain("turns on the roster: 2");
			expect(ok.stdout).not.toContain("roster changed");
			expect(ok.stdout).toContain("clean: every checked turn ran on the roster");

			// A hop off the one route is a violation, in the turns and in the switch record.
			const hopped = jsonl(join(dir, "sessions", "Hopped.jsonl"), [
				opened(iso(10_000)), said(iso(11_000), "openai-codex", "gpt-6.1-sol"), switched(iso(11_500), "openai-codex/gpt-6-luna"), said(iso(12_000), "openai-codex", "gpt-6-luna"),
			]);
			const bad = checkAdhoc(dir, item, "--session", hopped);
			expect(bad.exitCode).toBe(4);
			expect(bad.stdout).toContain(`${hopped} openai-codex/gpt-6.1-sol off roster: 1 turn(s)`);
			expect(bad.stdout).toContain("switched to openai-codex/gpt-6-luna (off roster)");
			expect(bad.stdout).toContain("NOT CLEAN: 2 turn(s) and 1 fallback switch(es) off the roster.");
			expect(existsSync(join(dir, "board-was-run"))).toBe(false);
		});

		test("US-046 check on an adhoc id keeps the designer exemption, the cash rule, --since and the earliest-record fallback", () => {
			const dir = scratch("adhoc-check-rules");
			const { item } = launchedOn(dir, "anthropic/claude-sonnet-5-5", "medium");
			const main = jsonl(join(dir, "sessions", "Main.jsonl"), [opened(iso(10_000)), said(iso(11_000), "anthropic", "claude-sonnet-5-5")]);
			jsonl(join(dir, "sessions", "Main", "Designer.jsonl"), [
				{ type: "session_init", id: "i1", timestamp: iso(11_100), agent: "designer", modelRole: "vision" }, said(iso(11_200), "anthropic", "claude-opus-5-5"),
			]);
			jsonl(join(dir, "sessions", "Main", "Scout.jsonl"), [
				{ type: "session_init", id: "i2", timestamp: iso(11_100), agent: "scout", modelRole: "smol" }, said(iso(11_200), "openai-codex", "gpt-6-luna"),
			]);
			const ok = checkAdhoc(dir, item, "--session", main);
			expect(ok.exitCode).toBe(0);
			expect(ok.stdout).toContain("2 helper turn(s) in 2 file(s) ran on their role's approved primary");

			// A session that started before the launch is judged against the earliest record, and the report says why.
			const early = jsonl(join(dir, "sessions", "Early.jsonl"), [opened(iso(-3_600_000)), said(iso(-3_500_000), "anthropic", "claude-sonnet-5-5")]);
			const older = checkAdhoc(dir, item, "--session", early);
			expect(older.exitCode).toBe(0);
			expect(older.stdout).toContain("judged against the earliest launch record");
			expect(older.stdout).toContain("because no record is at or before this file started");

			const cash = jsonl(join(dir, "sessions", "Cash.jsonl"), [
				opened(iso(10_000)), switched(iso(20_000), "openrouter/deepseek/deepseek-v4.1-flash"), said(iso(30_000), "openrouter", "deepseek/deepseek-v4.1-flash"),
			]);
			const spent = checkAdhoc(dir, item, "--session", cash);
			expect(spent.exitCode).toBe(4);
			expect(spent.stdout).toContain("switched to openrouter/deepseek/deepseek-v4.1-flash (off roster)");
			expect(spent.stdout).toContain("NOT CLEAN: 1 turn(s) and 1 fallback switch(es) off the roster.");
			const narrowed = checkAdhoc(dir, item, "--session", cash, "--since", iso(25_000));
			expect(narrowed.exitCode).toBe(4);
			expect(narrowed.stdout).toContain("fallback switches: 0");
			expect(narrowed.stdout).toContain("openrouter/deepseek/deepseek-v4.1-flash off roster: 1 turn(s)");
		});

		test("US-046 check on an adhoc id with no record or with a ticket file is refused with one sentence, and no board is run", () => {
			const dir = scratch("adhoc-check-refused");
			const { item } = launchedOn(dir, "anthropic/claude-sonnet-5-5", "medium");
			const session = jsonl(join(dir, "sessions", "S.jsonl"), [opened(iso(10_000)), said(iso(11_000), "anthropic", "claude-sonnet-5-5")]);
			const other = checkAdhoc(dir, "adhoc-anthropic-claude-sonnet-5-5-20200101T000000Z", "--session", session);
			expect([other.exitCode, other.stdout]).toEqual([1, ""]);
			expect(other.stderr).toMatch(/^omp-roster: No launch record for adhoc-anthropic-claude-sonnet-5-5-20200101T000000Z in /);
			expect(other.stderr.trim().split("\n").length).toBe(1);
			const ticket = checkAdhoc(dir, item, "--session", session, "--ticket-json", put(join(dir, "t.json"), "{}"));
			expect([ticket.exitCode, ticket.stdout]).toEqual([2, ""]);
			expect(ticket.stderr).toContain("an adhoc- launch reads no ticket");
			expect(existsSync(join(dir, "board-was-run"))).toBe(false);
		});
	});
});
