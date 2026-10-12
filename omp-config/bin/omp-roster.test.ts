import { afterEach, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ID = "K-20261012-powder-and-its-sibling-tools-get-simpler";
const MODEL = "openai-codex/gpt-6.1-sol";
const entry = { provider: "openai-codex", model: "gpt-6.1-sol", effort: "high" };
const accessArgs = ["run", "-e", "CF_ACCESS_CLIENT_ID=workstation/POWDER_ACCESS_CLIENT_ID",
	"-e", ["CF_ACCESS_CLIENT_SECRET", "workstation/POWDER_ACCESS_CLIENT_SECRET"].join("="), "--"];
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function nativeWork(state: object = { kind: "open" }) {
	return {
		id: ID, revision: "7", scope: "misty-step/harness", title: "Powder and its sibling tools get simpler",
		body: "The sole approved initiative", rank: 10, references: [], why: "Readiness is independent of discussion",
		work: { scope_in: ["Retained native consumers"], scope_out: ["Other companies and live launches"],
			done_when: [{ claim: "Use exact current native work", proof: "Offline consumer evidence" }], victory: "No inferred authority" },
		state, owner: null, readiness: "ready", waiting: null,
		created_at: 1791763200, updated_at: 1791763260, actions: ["amend", "later", "claim", "wait", "drop", "note"],
	};
}

function fixture(): Fixture {
	const root = mkdtempSync(join(tmpdir(), "omp-roster-consumer-")); roots.push(root);
	const home = join(root, "home"), bin = join(root, "bin"), stage = join(root, "stage"), state = join(root, "state");
	for (const dir of [bin, stage, state, join(home, ".local/bin")]) mkdirSync(dir, { recursive: true });
	const source = join(stage, "omp-roster.ts");
	copyFileSync(resolve(import.meta.dir, "omp-roster.ts"), source);
	// The native plan and historical compliance must not invoke the retired
	// experiment controller. A fail-on-use peer makes that boundary independent
	// of the operator's installed journal/module and keeps CI hermetic.
	writeFileSync(join(stage, "omp-experiments.ts"),
		["experimentCommand", "ledgerPath", "nextExperimentId", "readLedger", "withLedgerLock", "writeLedger"]
			.map((name) => `export function ${name}() { throw new Error("experiment owner must not be invoked"); }`)
			.join("\n"));
	const work = join(root, "native-work.json"), usage = join(root, "usage.json"), agents = join(root, "agents.json"), memory = join(root, "memory.json");
	const commands = join(root, "commands.jsonl"), journal = join(root, "accepted-journal"), pair = join(state, "pair.json");
	writeFileSync(work, JSON.stringify(nativeWork()));
	writeFileSync(usage, JSON.stringify({ ok: true, rollup: [{ harness: "omp", provider: "openai-codex", model: "gpt-6.1-sol", verdict: "usable" }], coverage: [], routes: [] }));
	writeFileSync(agents, JSON.stringify({ result: { agents: [] } }));
	writeFileSync(memory, JSON.stringify({ schema_version: 1, ok: true, activated: true, admitted: true, reservation: false, warnings: [] }));
	writeFileSync(journal, "Accepted journal custody must not be interpreted or rewritten by a Powder plan.\n");
	writeFileSync(pair, "Original pair marker custody.\n");
	const script = (name: string, body: string) => writeFileSync(name, `#!${process.execPath}\nimport {appendFileSync,readFileSync} from 'node:fs';\nconst args=process.argv.slice(2);\nappendFileSync(process.env.FIXTURE_COMMANDS,JSON.stringify({command:${JSON.stringify(name.split("/").at(-1))},args})+'\\n');\n${body}\n`, { mode: 0o700 });
	script(join(bin, "work-tracker"), `if(args.length!==4||args[0]!=='--url'||args[1]!=='https://powder.mistystep.io'||args[2]!=='get'||args[3]!==${JSON.stringify(ID)}) process.exit(98);\nif(process.env.FIXTURE_WORK_FAILURE){console.error('native read unavailable');process.exit(1)}\nconsole.log(readFileSync(process.env.FIXTURE_WORK,'utf8'));`);
	script(join(bin, "pass-env"), `const expected=${JSON.stringify(accessArgs)};\nif(JSON.stringify(args.slice(0,6))!==JSON.stringify(expected)||args[6]!==${JSON.stringify(join(bin, "work-tracker"))})process.exit(98);\nconst result=Bun.spawnSync({cmd:args.slice(6),stdout:'inherit',stderr:'inherit'});process.exit(result.exitCode??99);`);
	script(join(bin, "herdr"), "if(JSON.stringify(args)!=='[\"agent\",\"list\"]')process.exit(98);console.log(readFileSync(process.env.FIXTURE_AGENTS,'utf8'));");
	script(join(bin, "ai-usage"), "if(JSON.stringify(args)!=='[\"dispatch\",\"--json\"]')process.exit(98);console.log(readFileSync(process.env.FIXTURE_USAGE,'utf8'));");
	script(join(stage, "omp-engineer"), "if(JSON.stringify(args)!=='[\"memory\",\"--json\"]')process.exit(98);console.log(readFileSync(process.env.FIXTURE_MEMORY,'utf8'));");
	for (const name of ["omp", "glass", "board", "systemd-run", "systemctl", "git"]) script(join(bin, name), "console.error('forbidden live/legacy command');process.exit(99);");
	for (const name of ["omp-engineer", "omp-display", "omp-gui"]) writeFileSync(join(home, ".local/bin", name), "#!/bin/sh\nexit 99\n", { mode: 0o700 });
	symlinkSync("omp-engineer", join(home, ".local/bin/omp"));
	return {
		root, home, bin, stage, state, source, work, usage, agents, memory, commands, journal, pair,
		env: { ...process.env, HOME: home, PATH: bin, XDG_STATE_HOME: join(root, "xdg-state"),
			OMP_ROSTER_ENGINEER_LIMIT: "24", OMP_ROSTER_EXPERIMENTS_FILE: journal, OMP_ROSTER_PAIR_FILE: pair,
			FIXTURE_COMMANDS: commands, FIXTURE_WORK: work, FIXTURE_USAGE: usage, FIXTURE_AGENTS: agents, FIXTURE_MEMORY: memory },
	};
}
type Fixture = {
	root: string; home: string; bin: string; stage: string; state: string; source: string;
	work: string; usage: string; agents: string; memory: string; commands: string; journal: string; pair: string;
	env: Record<string, string | undefined>;
};

function run(f: Fixture, args: string[], env = {}) {
	const result = Bun.spawnSync({ cmd: [process.execPath, f.source, ...args], cwd: f.root, env: { ...f.env, ...env }, stdout: "pipe", stderr: "pipe" });
	return { code: result.exitCode, out: result.stdout.toString(), error: result.stderr.toString() };
}
function plan(f: Fixture, extra: string[] = []) {
	return run(f, ["launch", "--powder", ID, "--model", MODEL, "--thinking", "high", "--state-dir", f.state, "--json", ...extra]);
}
function calls(f: Fixture): { command: string; args: string[] }[] {
	return existsSync(f.commands) ? readFileSync(f.commands, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
}
function session(f: Fixture, model = entry) {
	const file = join(f.root, "exact-root.jsonl");
	writeFileSync(file, [
		{ type: "session", id: "sole-initiative-incarnation", cwd: f.root, timestamp: "2099-01-01T00:00:00.000Z" },
		{ type: "message", timestamp: "2099-01-01T00:01:00.000Z", message: { role: "assistant", provider: model.provider, model: model.model } },
	].map((record) => JSON.stringify(record)).join("\n") + "\n");
	return file;
}


test("explicit native plans require Open, independent prepared readiness, and no waiting; old state aliases never become permission", () => {
	const f = fixture(), ready = nativeWork();
	const refused = [
		{ ...ready, readiness: "needs_discussion" }, { ...ready, readiness: null }, { ...ready, readiness: undefined },
		{ ...ready, waiting: { to: "kaylee", question: "Not resolved" } },
		{ ...ready, owner: "exact-owner", waiting: { to: "kaylee", question: "Not resolved" } },
		{ ...ready, state: { kind: "done", evidence: [] }, readiness: null },
		{ ...ready, state: { kind: "done", source: "Preserved original" }, readiness: null },
		{ ...ready, state: { kind: "dropped", reason: "Stopped" }, readiness: null },
		{ ...ready, state: { kind: "dropped", source: "Preserved original" }, readiness: null },
		...["later", "ready", "claimed", "waiting", "settled", "historical_closed", "working"].map((kind) => ({ ...ready, state: { kind } })),
	];
	for (const input of refused) {
		writeFileSync(f.work, JSON.stringify(input));
		expect(plan(f).code).toBe(1);
	}
	expect(calls(f).filter((call) => call.command === "work-tracker")).toHaveLength(refused.length);
	expect(calls(f).every((call) => call.command === "pass-env" || (call.command === "work-tracker" && call.args[2] === "get"))).toBe(true);
	expect(readdirSync(f.state)).toEqual(["pair.json"]);
});

test("an owner alone, incomplete work, wrong identity, a Glass envelope, and another company cannot admit a native plan", () => {
	const f = fixture();
	const original = { ...nativeWork(), owner: "exact-owner" };
	const inputs = [
		{ ...original, readiness: "needs_discussion" }, { ...original, owner: undefined }, { ...original, why: null }, { ...original, work: null },
		{ ...original, work: { ...original.work, done_when: [] } }, { ...original, work: { ...original.work, victory: " " } },
		{ ...original, id: null }, { ...original, revision: 7 }, { ...original, scope: "r90group/harness" },
		{ data: { state: "ok", value: { ticket: { roster: [entry] } } } },
	];
	for (const input of inputs) {
		writeFileSync(f.work, JSON.stringify(input));
		expect(plan(f).code).toBe(1);
	}
	expect(readdirSync(f.state)).toEqual(["pair.json"]);
	expect(calls(f).filter((call) => call.command === "work-tracker")).toHaveLength(inputs.length);
	expect(calls(f).every((call) => ["pass-env", "work-tracker"].includes(call.command))).toBe(true);
});

test("native plans freeze opaque revision, exact owner, prepared definition, and policy without binding or custody loss", () => {
	const f = fixture();
	const original = { ...nativeWork(), owner: "Kaylee: exact work owner" };
	original.revision = "4294967295";
	writeFileSync(f.work, JSON.stringify(original));
	const legacy = join(f.state, `${ID}.aabbccdd.launch.json`), legacyBody = "Original launch custody bytes.\n";
	writeFileSync(legacy, legacyBody);
	const first = plan(f); expect(first.code).toBe(0);
	const output = JSON.parse(first.out), frozen = JSON.parse(readFileSync(output.record, "utf8"));
	expect(frozen.work).toEqual(original);
	expect(frozen.work_owner).toBe("Kaylee: exact work owner");
	expect(frozen.work.revision).toBe("4294967295");
	expect(frozen.readiness).toBe("ready"); expect(frozen.waiting).toBeNull();
	expect(frozen.source).toBe("powder"); expect(frozen.schema_version).toBe(3); expect(frozen.native_view).toBe("get/three-state");
	expect(frozen.policy.engineer).toEqual([entry]); expect(frozen.policy.fallback).toBe(false);
	expect(frozen.started).toBe(false); expect(frozen.session_binding).toBeNull(); expect(frozen.outcome).toBe("unknown");
	const overlay = JSON.parse(readFileSync(output.overlay, "utf8"));
	expect(overlay.retry.modelFallback).toBe(false);
	expect(Object.values(overlay.retry.fallbackChains).every((chain) => Array.isArray(chain) && chain.length === 0)).toBe(true);
	const bytes = readFileSync(output.record, "utf8");
	const second = JSON.parse(plan(f).out);
	expect(second.record).not.toBe(output.record); expect(readFileSync(output.record, "utf8")).toBe(bytes);
	expect(readFileSync(legacy, "utf8")).toBe(legacyBody);
	expect(readFileSync(f.journal, "utf8")).toBe("Accepted journal custody must not be interpreted or rewritten by a Powder plan.\n");
	expect(readFileSync(f.pair, "utf8")).toBe("Original pair marker custody.\n");
});

test("unclaimed prepared work keeps a null owner and explicit capacity never selects a different model", () => {
	const f = fixture();
	const ready = nativeWork(); ready.work.scope_in = []; ready.work.scope_out = [];
	writeFileSync(f.work, JSON.stringify(ready));
	const approved = JSON.parse(plan(f).out);
	expect(JSON.parse(readFileSync(approved.record, "utf8")).work_owner).toBeNull();
	writeFileSync(f.usage, JSON.stringify({ ok: true, rollup: [
		{ harness: "omp", provider: "openai-codex", model: "gpt-6.1-sol", verdict: "exhausted" },
		{ harness: "omp", provider: "anthropic", model: "sonnet", verdict: "usable" },
	], coverage: [], routes: [] }));
	const refused = plan(f); expect(refused.code).toBe(3);
	expect(JSON.parse(refused.out).launch).toBeNull();
	expect(readdirSync(f.state).filter((name) => name.endsWith(".launch.json"))).toHaveLength(1);
	expect(calls(f).some((call) => ["omp", "glass", "board", "systemd-run", "git"].includes(call.command))).toBe(false);
});

test("native model approval, effort floors, and no-cash rules remain explicit", () => {
	const f = fixture();
	for (const [model, effort] of [["openrouter/any-model", "high"], [MODEL, "low"], ["unapproved/no-model", "high"], ["openai-codex/gpt-6.1-sol:high", "high"]]) {
		const refused = run(f, ["launch", "--powder", ID, "--model", model!, "--thinking", effort!, "--state-dir", f.state]);
		expect([1, 2]).toContain(refused.code);
	}
	expect(calls(f)).toEqual([]);
	expect(run(f, ["launch", "--powder", ID, "--model", MODEL]).code).toBe(2);
	expect(plan(f, ["--item", ID]).code).toBe(2);
	expect(plan(f, ["--no-experiment", "Not a native option"]).code).toBe(2);
});

test("native plans preserve fleet and display containment guards without starting anything", () => {
	const f = fixture();
	writeFileSync(f.agents, JSON.stringify({ result: { agents: [{ agent: "omp", agent_status: "working", pane_id: "sole-initiative:p1", name: "display-only-not-authority" }] } }));
	const full = run(f, ["launch", "--powder", ID, "--model", MODEL, "--thinking", "high", "--state-dir", f.state], { OMP_ROSTER_ENGINEER_LIMIT: "1" });
	expect(full.code).toBe(5);
	writeFileSync(f.agents, JSON.stringify({ result: { agents: [] } }));
	rmSync(join(f.home, ".local/bin/omp-gui"));
	expect(plan(f).code).toBe(1);
	expect(readdirSync(f.state)).toEqual(["pair.json"]);
	expect(calls(f).every((call) => ["pass-env", "work-tracker", "herdr"].includes(call.command))).toBe(true);
});

test("native transport failure is a plain refusal and never retries through Glass", () => {
	const f = fixture();
	const refused = run(f, ["launch", "--powder", ID, "--model", MODEL, "--thinking", "high", "--state-dir", f.state], { FIXTURE_WORK_FAILURE: "1" });
	expect(refused.code).toBe(1);
	expect(calls(f)).toEqual([
		{ command: "pass-env", args: [...accessArgs, join(f.bin, "work-tracker"), "--url", "https://powder.mistystep.io", "get", ID] },
		{ command: "work-tracker", args: ["--url", "https://powder.mistystep.io", "get", ID] },
	]);
	expect(readdirSync(f.state)).toEqual(["pair.json"]);
});

test("a native compliance request without an accepted binding refuses before any read or association", () => {
	const f = fixture();
	const root = session(f);
	expect(run(f, ["check", "--powder", ID, "--session", root]).code).toBe(1);
	expect(calls(f)).toEqual([]);
	expect(readdirSync(f.state)).toEqual(["pair.json"]);
});

test("accepted historical launch records and their helper policy remain isolated from new native plans", () => {
	const f = fixture();
	expect(plan(f).code).toBe(0);
	const legacyPath = join(f.state, `${ID}.aabbccdd.launch.json`);
	const legacy = `${JSON.stringify({ item: ID, roster: [entry], launched_at: "2020-01-01T00:00:00.000Z" })}\n`;
	writeFileSync(legacyPath, legacy);
	const root = session(f), helpers = root.replace(/\.jsonl$/, ""); mkdirSync(helpers);
	writeFileSync(join(helpers, "reviewer.jsonl"), [
		{ type: "session", id: "sole-initiative-historical-helper", timestamp: "2099-01-01T00:00:00.000Z" },
		{ type: "session_init", modelRole: "reviewer" },
		{ type: "message", timestamp: "2099-01-01T00:01:00.000Z", message: { role: "assistant", provider: "openai-codex", model: "gpt-6-sol" } },
	].map((record) => JSON.stringify(record)).join("\n") + "\n");
	const ticket = join(f.root, "historical-ticket.json"); writeFileSync(ticket, JSON.stringify({ roster: [entry] }));
	const checked = run(f, ["check", "--item", ID, "--ticket-json", ticket, "--state-dir", f.state, "--session", root]);
	expect(checked.code).toBe(0);
	expect(readFileSync(legacyPath, "utf8")).toBe(legacy);
});
