import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { experimentCommand, nextExperimentId, readLedger, withLedgerLock, writeLedger, type Entry, type Experiment, type Ledger, type Verdict } from "./omp-experiments.ts";

const SOL: Entry = { provider: "openai-codex", model: "gpt-6.1-sol", effort: "xhigh" };
const CANDIDATE: Entry = { ...SOL, effort: "high" };
const JUDGE: Entry = { provider: "anthropic", model: "claude-sonnet-5-5", effort: "high" };
const host: Parameters<typeof experimentCommand>[1] = {
	approvedModels: {
		"openai-codex/gpt-6.1-sol": { efforts: ["high", "xhigh", "max"], usage: { provider: "openai-codex" } },
		"anthropic/claude-sonnet-5-5": { efforts: ["medium", "high", "xhigh"], usage: { provider: "anthropic" } },
		"xai-oauth/grok-4.7": { efforts: ["high"], usage: { provider: "xai" } },
	},
	routeUsable: (_entry: Entry) => true,
};
const roots: string[] = [];
const environmentKeys = ["OMP_ROSTER_EXPERIMENTS_FILE", "PATH", "FAKE_EXPERIMENT_MODE", "FAKE_EXPERIMENT_REQUEST", "FAKE_EXPERIMENT_CALLS", "FAKE_EXPERIMENT_MUTATE"];
const environment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
afterEach(() => {
	for (const key of environmentKeys) {
		if (environment[key] === undefined) delete process.env[key];
		else process.env[key] = environment[key];
	}
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const history = "# Journal\n\n## E-007\nActual scoped default changed; preserve this lesson.\n\n### E-018 results\nPending, not a verdict.\nConfounds and every original byte stay intact.\n";
function fixture(): { root: string; path: string } {
	const root = mkdtempSync(join(tmpdir(), "omp-experiments-test-"));
	roots.push(root);
	const path = join(root, "experiments.md");
	writeFileSync(path, history, { mode: 0o644 });
	process.env.OMP_ROSTER_EXPERIMENTS_FILE = path;
	return { root, path };
}
function command(args: string[], routes = host): { status: number; stdout: string; stderr: string } {
	const out: string[] = [], err: string[] = [];
	const log = console.log, error = console.error;
	console.log = (...values) => { out.push(values.join(" ")); };
	console.error = (...values) => { err.push(values.join(" ")); };
	try { return { status: experimentCommand(args, routes), stdout: out.join("\n"), stderr: err.join("\n") }; }
	finally { console.log = log; console.error = error; }
}
function seeded(root: string): Experiment {
	const experiment: Experiment = {
		id: "E-019", item: "K-consumer", nature: "build", question: "Does candidate effort meet the checks as well as baseline?",
		default_key: "build:openai-codex/gpt-6.1-sol", variable: "effort", baseline: SOL, candidate: CANDIDATE,
		done: [{ check: "Daemon recovers after a crash", proof: "A restarted service answers 200" }, { check: "Recovery preserves state", proof: "Two recovery journals remain intact" }],
		brief_sha256: "b".repeat(64), base_commit: "a".repeat(40), status: "awaiting-verdict", started_at: "2026-10-02T10:00:00Z",
		lanes: [
			{ pane_id: "wTEST:p1", workspace_id: "worktree-one", session: join(root, "lane-one.jsonl"), cwd: join(root, "worktree-one"), entry: SOL },
			{ pane_id: "wTEST:p2", workspace_id: "worktree-two", session: join(root, "lane-two.jsonl"), cwd: join(root, "worktree-two"), entry: CANDIDATE },
		],
	};
	for (const lane of experiment.lanes) {
		mkdirSync(lane.cwd, { recursive: true });
		writeFileSync(lane.session, [
			{ type: "session", id: lane.workspace_id, cwd: lane.cwd },
			{ type: "model_change", model: `${lane.entry.provider}/${lane.entry.model}`, resolvedModelIsFallback: false },
			{ type: "thinking_level_change", thinkingLevel: lane.entry.effort },
			{ type: "message", message: { role: "assistant", provider: lane.entry.provider, model: lane.entry.model, stopReason: "stop", content: [{ type: "text", text: "Finished the deliverable." }] } },
		].map((row) => JSON.stringify(row)).join("\n") + "\n");
	}
	withLedgerLock(() => {
		const ledger = readLedger(); ledger.experiments.push(experiment); writeLedger(ledger);
	});
	return experiment;
}
function nativeFixture(root: string, mode = "complete"): { args: string[]; request: string; calls: string; a: string; b: string } {
	const a = join(root, "worktree-one", "deliverable.txt"), b = join(root, "worktree-two", "deliverable.txt");
	writeFileSync(a, `Lane A: openai-codex/gpt-6.1-sol xhigh, ${join(root, "worktree-one")}, wTEST:p1, E-019, K-consumer\nCheck one PARTIAL: implementation asserted, no recovery response shown.\nCheck two PARTIAL: preserving state was asserted, not demonstrated.\nAuthor: Alice Operator\n`);
	writeFileSync(b, `Lane B: GPT-6.1 Sol high, ${join(root, "worktree-two")}, wTEST:p2, E-019, K-consumer\nCheck one DELIVERED: restarted after crash and the service answered 200.\nCheck two DELIVERED: repeated twice; both recovery journals remain intact.\nAuthor: Bob Operator\nTrade-off: high risk; medium confidence; low operational overhead.\n`);
	const request = join(root, "judge-request.json"), calls = join(root, "judge-calls.txt");
	const binary = join(root, "omp");
	// A native-protocol boundary fixture, not a simulated claim of live model proof.
	writeFileSync(binary, `#!/usr/bin/env bun
import { appendFileSync, writeFileSync } from "node:fs";
const input = await Bun.stdin.text();
writeFileSync(process.env.FAKE_EXPERIMENT_REQUEST, input);
appendFileSync(process.env.FAKE_EXPERIMENT_CALLS, "called\\n");
const prompt = JSON.parse(input);
const mode = process.env.FAKE_EXPERIMENT_MODE;
if (mode === "native-failure" || mode === "protocol-failure") {
  console.error("Native transport refused the request.");
  console.error("No fallback was attempted.");
  console.log(JSON.stringify({type: "message_end", message: {role: "assistant", provider: "anthropic", model: "claude-sonnet-5-5", stopReason: "error",
    errorMessage: '429 {"error":{"type":"rate_limit_error","message":"Account rate limit exceeded"}} retry-after-ms=2261000'}}));
  process.exit(mode === "protocol-failure" ? 0 : 17);
}
const answer = {};
for (const label of ["X", "Y"]) answer[label] = prompt.done.map((check, index) => {
  const line = prompt.artifacts[label].find((line) => line.text.includes(index === 0 ? "Check one" : "Check two"));
  return {check: index + 1, score: mode === "tie" ? 2 : mode === "incomplete" ? 1 : line.text.includes("DELIVERED") ? 2 : 1,
    evidence: [{line: line.line, quote: mode === "bad-quote" ? "fabricated runtime proof" : line.text}], rationale: "The cited artifact provides the observed extent of the done-check proof."};
});
if (mode === "missing-check") answer.X.pop();
if (mode === "bad-score") answer.Y[0].score = 3;
if (mode === "extra-key") answer.winner = "X";
if (process.env.FAKE_EXPERIMENT_MUTATE) appendFileSync(process.env.FAKE_EXPERIMENT_MUTATE, "changed during judge\\n");
if (mode === "fallback") console.log(JSON.stringify({type: "retry_fallback_applied"}));
if (mode === "changed-model") console.log(JSON.stringify({type: "model_change", model: "openai-codex/gpt-6-luna"}));
if (mode === "changed-effort") console.log(JSON.stringify({type: "thinking_level_change", thinkingLevel: "medium"}));
if (mode === "malformed-event") { console.log("not native JSON"); process.exit(0); }
if (mode === "fenced-json") console.error("Native score response context.\\nNative completion emitted an invalid score payload.");
const message = {role: "assistant", provider: mode === "wrong-provider" || mode === "grok" ? "xai-oauth" : "anthropic",
  model: mode === "grok" ? "grok-4.7" : mode === "wrong-model" ? "claude-opus-5-5" : "claude-sonnet-5-5", stopReason: mode === "failed-stop" ? "error" : "stop",
  content: [{type: "text", text: mode === "fenced-json" ? "\\u0060\\u0060\\u0060json\\n" + JSON.stringify(answer) + "\\n\\u0060\\u0060\\u0060" : JSON.stringify(answer)}]};
console.log(JSON.stringify({type: "message_end", message: {role: "user", content: [{type: "text", text: "echo"}]}}));
console.log(JSON.stringify({type: "message_end", message}));
if (mode === "duplicate-answer") console.log(JSON.stringify({type: "message_end", message}));
console.log(JSON.stringify({type: "agent_end", isTerminal: mode !== "not-terminal"}));
`);
	chmodSync(binary, 0o700);
	process.env.PATH = `${root}:${environment.PATH ?? ""}`;
	process.env.FAKE_EXPERIMENT_MODE = mode;
	process.env.FAKE_EXPERIMENT_REQUEST = request;
	process.env.FAKE_EXPERIMENT_CALLS = calls;
	return { args: ["verdict", "--experiment", "E-019", "--artifact-a", a, "--artifact-b", b, "--judge", `${JUDGE.provider}/${JUDGE.model}`, "--thinking", JUDGE.effort, "--json"], request, calls, a, b };
}

function accepted(root: string, mode = "complete"): { experiment: Experiment; verdict: Verdict } {
	seeded(root);
	const judge = nativeFixture(root, mode);
	const result = command(judge.args);
	expect([result.status, result.stderr]).toEqual([0, ""]);
	const ledger = readLedger();
	return { experiment: ledger.experiments[0], verdict: ledger.experiments[0].verdict as Verdict };
}

test("one marked state block preserves historical prose and allocates after legacy and current E ids", () => {
	const { path } = fixture();
	const ledger = readLedger();
	expect([ledger.defaults, nextExperimentId(ledger)]).toEqual([{}, "E-019"]);
	withLedgerLock(() => {
		ledger.opt_outs.push({ item: "K-small", reason: "tiny: single mechanical edit", at: "2026-10-02T10:01:00Z" });
		writeLedger(ledger);
		ledger.opt_outs.push({ item: "K-live", reason: "live-data: interactive account flow", at: "2026-10-02T10:02:00Z" });
		writeLedger(ledger);
	});
	const markdown = readFileSync(path, "utf8");
	expect(markdown.startsWith(history)).toBe(true);
	expect(markdown.match(/<!-- omp-experiments:state:start -->/g)).toEqual(["<!-- omp-experiments:state:start -->"]);
	expect([statSync(path).mode & 0o777, readLedger().opt_outs.map((row) => row.item)]).toEqual([0o600, ["K-small", "K-live"]]);
});

test("partial starts and abandoned launches keep cleanup identities without pretending a session was bound", () => {
	const { root } = fixture();
	seeded(root);
	withLedgerLock(() => {
		const ledger = readLedger();
		const experiment = ledger.experiments[0];
		experiment.status = "starting"; experiment.lanes[0].session = "";
		writeLedger(ledger);
		experiment.status = "abandoned";
		writeLedger(ledger);
		experiment.status = "running";
		expect(() => writeLedger(ledger)).toThrow("lane session must be a nonempty string");
	});
	const abandoned = readLedger().experiments[0];
	expect([abandoned.status, abandoned.lanes[0].session, abandoned.lanes[0].pane_id, abandoned.lanes[0].workspace_id, abandoned.lanes[0].cwd]).toEqual(["abandoned", "", "wTEST:p1", "worktree-one", join(root, "worktree-one")]);
});

test("a real competing process cannot enter the locked launch transaction", () => {
	const { path } = fixture();
	const module = join(import.meta.dir, "omp-experiments.ts");
	withLedgerLock(() => {
		const contender = Bun.spawnSync({ cmd: [process.execPath, "--eval", `import {withLedgerLock} from ${JSON.stringify(module)}; withLedgerLock(() => {throw new Error('entered')});`], env: process.env, stdout: "pipe", stderr: "pipe" });
		expect(contender.exitCode).not.toBe(0);
		expect(contender.stderr.toString()).toContain("journal is busy");
		expect(contender.stderr.toString()).not.toContain("Error: entered");
	});
	withLedgerLock(() => { const ledger = readLedger(); ledger.opt_outs.push({ item: "K-next", reason: "explicit opt-out", at: "2026-10-02T11:00:00Z" }); writeLedger(ledger); });
	expect(readLedger().opt_outs[0].item).toBe("K-next");
});

test("a killed lock holder cannot strand later launches", async () => {
	fixture();
	const module = join(import.meta.dir, "omp-experiments.ts");
	const holder = Bun.spawn([process.execPath, "--eval", `import {withLedgerLock} from ${JSON.stringify(module)}; import {writeSync} from "node:fs"; withLedgerLock(() => {writeSync(1,"locked\\n"); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60000);});`], { env: process.env, stdout: "pipe", stderr: "pipe" });
	const reader = holder.stdout.getReader();
	const ready = await reader.read();
	expect(new TextDecoder().decode(ready.value)).toBe("locked\n");
	holder.kill("SIGKILL");
	await holder.exited;
	reader.releaseLock();
	withLedgerLock(() => {
		const ledger = readLedger();
		ledger.opt_outs.push({ item: "K-recovered", reason: "Recovered after interrupted dispatch", at: "2026-10-02T12:00:00Z" });
		writeLedger(ledger);
	});
	expect(readLedger().opt_outs[0].item).toBe("K-recovered");
});

test("stored user evidence can quote ledger markers without corrupting the journal", () => {
	fixture();
	const reason = "Inspect <!-- omp-experiments:state:start --> and <!-- omp-experiments:state:end --> as source evidence.";
	withLedgerLock(() => {
		const ledger = readLedger();
		ledger.opt_outs.push({ item: "K-markers", reason, at: "2026-10-02T12:00:00Z" });
		writeLedger(ledger);
	});
	expect(readLedger().opt_outs[0].reason).toBe(reason);
});

test("swapped artifacts and cross-lane symlinks cannot attribute another lane's work to the default", () => {
	const { root } = fixture();
	seeded(root);
	const native = nativeFixture(root);
	const swapped = [...native.args];
	swapped[swapped.indexOf("--artifact-a") + 1] = native.b;
	swapped[swapped.indexOf("--artifact-b") + 1] = native.a;
	expect(command(swapped).status).toBe(1);
	const link = join(root, "worktree-one", "copied-report.txt");
	symlinkSync(native.b, link);
	const escaped = [...native.args];
	escaped[escaped.indexOf("--artifact-a") + 1] = link;
	expect(command(escaped).status).toBe(1);
	expect(existsSync(native.calls)).toBe(false);
	expect(readLedger().defaults).toEqual({});
});

test("corrupt or duplicate state blocks fail before a callback can launch anything", () => {
	const { path } = fixture();
	for (const state of [
		"<!-- omp-experiments:state:start -->\n```json\n{bad\n```\n<!-- omp-experiments:state:end -->",
		"<!-- omp-experiments:state:start -->\n```json\n{}\n```\n<!-- omp-experiments:state:end -->",
		"<!-- omp-experiments:state:end -->",
		"<!-- omp-experiments:state:start -->\n<!-- omp-experiments:state:start -->\n<!-- omp-experiments:state:end -->",
	]) {
		writeFileSync(path, `${history}\n${state}`);
		let launched = false;
		expect(() => withLedgerLock(() => { launched = true; })).toThrow();
		expect(launched).toBe(false);
		expect(readFileSync(path, "utf8")).toBe(`${history}\n${state}`);
	}
});

test("unlocked and stale state writes are refused while new human prose survives a valid write", () => {
	const { path } = fixture();
	const ledger = readLedger();
	expect(() => writeLedger(ledger)).toThrow("requires withLedgerLock");
	withLedgerLock(() => {
		writeFileSync(path, `${history}\nHuman correction arrived meanwhile.\n`);
		ledger.opt_outs.push({ item: "K-first", reason: "explicit opt-out", at: "2026-10-02T12:00:00Z" });
		writeLedger(ledger);
		const stale = readLedger();
		const fresh = readLedger();
		fresh.opt_outs.push({ item: "K-newer", reason: "other writer", at: "2026-10-02T12:01:00Z" });
		writeLedger(fresh);
		expect(() => writeLedger(stale)).toThrow("state block changed since it was read");
	});
	expect(readFileSync(path, "utf8")).toContain(`${history}\nHuman correction arrived meanwhile.\n`);
	expect(readLedger().opt_outs.map((row) => row.item)).toEqual(["K-first", "K-newer"]);
});

test("a blind cross-family complete verdict changes the model-specific effort default with cited evidence", () => {
	const { root, path } = fixture();
	const experiment = seeded(root);
	const native = nativeFixture(root);
	expect(command(["defaults", "--json"]).stdout).toBe(JSON.stringify({ defaults: [] }, null, 2));
	const result = command(native.args);
	expect([result.status, result.stderr]).toEqual([0, ""]);
	const ledger = readLedger();
	const verdict = ledger.experiments[0].verdict as Verdict;
	expect([ledger.experiments[0].status, verdict.winner, verdict.default_changed, verdict.judge, verdict.scores]).toEqual(["verdict", "candidate", true, JUDGE, { baseline: 2, candidate: 4 }]);
	expect(verdict.checks.candidate.map((row) => row.evidence[0])).toEqual([
		{ line: 2, quote: "Check one DELIVERED: restarted after crash and the service answered 200." },
		{ line: 3, quote: "Check two DELIVERED: repeated twice; both recovery journals remain intact." },
	]);
	expect(JSON.parse(command(["defaults", "--nature", "build", "--model", "openai-codex/gpt-6.1-sol", "--json"]).stdout)).toEqual({ defaults: [{ key: experiment.default_key, entry: CANDIDATE, evidence: "E-019" }] });
	const request = readFileSync(native.request, "utf8");
	for (const identity of ["E-019", "K-consumer", "openai-codex", "gpt-6.1-sol", "GPT-6.1 Sol", "xhigh", root, "worktree-one", "worktree-two", "wTEST:p1", "wTEST:p2", "Alice Operator", "Bob Operator"]) expect(request).not.toContain(identity);
	expect(Object.keys(JSON.parse(request).artifacts).sort()).toEqual(["X", "Y"]);
	expect(request).toContain("high risk; medium confidence; low operational overhead");
	expect(readFileSync(path, "utf8").startsWith(history)).toBe(true);
	expect(nextExperimentId(ledger)).toBe("E-020");
});

test("the preregistered tie rule picks lower effort only when done checks are complete", () => {
	const { root } = fixture();
	const { verdict } = accepted(root, "tie");
	expect([verdict.scores, verdict.winner, verdict.default_changed, readLedger().defaults["build:openai-codex/gpt-6.1-sol"]]).toEqual([{ baseline: 4, candidate: 4 }, "candidate", true, { entry: CANDIDATE, evidence: "E-019" }]);
});

test("an incomplete verdict remains durable evidence but does not invent a routing default", () => {
	const { root } = fixture();
	const { experiment, verdict } = accepted(root, "incomplete");
	expect([experiment.status, verdict.scores, verdict.default_changed, readLedger().defaults]).toEqual(["verdict", { baseline: 2, candidate: 2 }, false, {}]);
	expect(JSON.parse(command(["defaults", "--json"]).stdout)).toEqual({ defaults: [] });
});

test("a default query withholds unusable routes and does not apply build evidence to research", () => {
	const { root } = fixture();
	accepted(root);
	expect(JSON.parse(command(["defaults", "--json"], { ...host, routeUsable: () => false }).stdout)).toEqual({ defaults: [] });
	expect(JSON.parse(command(["defaults", "--nature", "research", "--json"]).stdout)).toEqual({ defaults: [] });
});

test("an accepted verdict cannot be replaced by a second judge call", () => {
	const { root, path } = fixture();
	accepted(root);
	const before = readFileSync(path, "utf8");
	const native = nativeFixture(root);
	const result = command(native.args);
	expect([result.status, result.stderr]).toEqual([1, expect.stringContaining("already has a verdict")]);
	expect(readFileSync(native.calls, "utf8")).toBe("called\n");
	expect(readFileSync(path, "utf8")).toBe(before);
});

test("same-family, cash, unknown and unusable judges fail before any model call", () => {
	const { root, path } = fixture();
	seeded(root);
	const native = nativeFixture(root);
	const before = readFileSync(path, "utf8");
	for (const [selector, routes] of [
		["openai-codex/gpt-6.1-sol", host],
		["openrouter/anthropic/claude-sonnet-5-5", { ...host, approvedModels: { ...host.approvedModels, "openrouter/anthropic/claude-sonnet-5-5": { efforts: ["high"], usage: {} } } }],
		["anthropic/claude-retired", host],
		["anthropic/claude-sonnet-5-5", { ...host, routeUsable: () => false }],
	] as const) {
		const args = [...native.args]; args[args.indexOf("--judge") + 1] = selector;
		expect(command(args, routes).status).toBe(1);
	}
	expect(existsSync(native.calls)).toBe(false);
	expect(readFileSync(path, "utf8")).toBe(before);
});

test("lane model, effort and fallback confounds are rejected using actual session records", () => {
	const { root, path } = fixture();
	const experiment = seeded(root);
	const native = nativeFixture(root);
	const before = readFileSync(path, "utf8");
	const session = experiment.lanes[0].session;
	const original = readFileSync(session, "utf8");
	for (const changed of [
		original.replace('"model":"gpt-6.1-sol"', '"model":"gpt-6-luna"'),
		original.replace('"thinkingLevel":"xhigh"', '"thinkingLevel":"high"'),
		original.replace('"resolvedModelIsFallback":false', '"resolvedModelIsFallback":true'),
	]) {
		writeFileSync(session, changed);
		expect(command(native.args).status).toBe(1);
		expect(existsSync(native.calls)).toBe(false);
		expect(readFileSync(path, "utf8")).toBe(before);
	}
});

test("native judge failures report the command, complete stderr and protocol cause without committing evidence", () => {
	const { root, path } = fixture();
	seeded(root);
	const before = readFileSync(path, "utf8");
	for (const mode of ["native-failure", "protocol-failure"]) {
		const native = nativeFixture(root, mode);
		const result = command(native.args);
		expect(result.status).toBe(1);
		if (mode === "native-failure") expect(result.stderr).toContain("exit 17");
		expect(result.stderr).toContain("Command: 'omp' '--mode' 'json' '--print' '--no-session' '--model' 'anthropic/claude-sonnet-5-5' '--thinking' 'high'");
		expect(result.stderr).toContain("Native transport refused the request.\nNo fallback was attempted.");
		expect(result.stderr).toContain('429 {"error":{"type":"rate_limit_error","message":"Account rate limit exceeded"}} retry-after-ms=2261000');
		expect(readFileSync(path, "utf8")).toBe(before);
		expect(readLedger().defaults).toEqual({});
	}
	expect(command(nativeFixture(root).args).status).toBe(0);
	const recovered = readLedger();
	expect(recovered.experiments[0].status).toBe("verdict");
	expect(recovered.defaults["build:openai-codex/gpt-6.1-sol"]).toEqual({ entry: CANDIDATE, evidence: "E-019" });
});

test("malformed native output, fallback, nonterminal and duplicate responses never commit verdicts", () => {
	const { root, path } = fixture();
	seeded(root);
	const before = readFileSync(path, "utf8");
	for (const mode of ["fallback", "changed-model", "changed-effort", "wrong-provider", "wrong-model", "failed-stop", "malformed-event", "duplicate-answer", "not-terminal", "fenced-json"]) {
		const native = nativeFixture(root, mode);
		const result = command(native.args);
		expect(result.status, mode).toBe(1);
		if (mode === "fenced-json") expect(result.stderr).toContain("Native score response context.\nNative completion emitted an invalid score payload.");
		expect(readFileSync(path, "utf8"), mode).toBe(before);
	}
});

test("missing done checks, invalid scores and fabricated citations cannot become default evidence", () => {
	const { root, path } = fixture();
	seeded(root);
	const before = readFileSync(path, "utf8");
	for (const mode of ["missing-check", "bad-score", "extra-key", "bad-quote"]) {
		const native = nativeFixture(root, mode);
		expect(command(native.args).status, mode).toBe(1);
		expect(readFileSync(path, "utf8"), mode).toBe(before);
	}
});

test("an artifact modified during judging cannot be cited as immutable verdict evidence", () => {
	const { root, path } = fixture();
	seeded(root);
	const native = nativeFixture(root);
	process.env.FAKE_EXPERIMENT_MUTATE = native.a;
	const before = readFileSync(path, "utf8");
	const result = command(native.args);
	expect([result.status, result.stderr]).toEqual([1, expect.stringContaining("artifact changed during judging")]);
	expect(readFileSync(path, "utf8")).toBe(before);
});

test("legacy model comparisons need a judge independent of both families and cannot invent effort-default evidence", () => {
	const { root } = fixture();
	const original = seeded(root);
	withLedgerLock(() => {
		const ledger = readLedger();
		const legacy = ledger.experiments[0];
		legacy.legacy = true; legacy.variable = "model"; legacy.default_key = ""; legacy.brief_sha256 = ""; legacy.base_commit = "";
		legacy.candidate = JUDGE; legacy.lanes[1].entry = JUDGE;
		writeLedger(ledger);
	});
	const session = original.lanes[1].session;
	const rows = readFileSync(session, "utf8").trim().split("\n").map((line) => JSON.parse(line));
	rows[1].model = "anthropic/claude-sonnet-5-5";
	rows[3].message.provider = "anthropic"; rows[3].message.model = "claude-sonnet-5-5";
	writeFileSync(session, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
	const native = nativeFixture(root, "grok");
	expect(command(native.args).stderr).toContain("different model family than BOTH");
	expect(existsSync(native.calls)).toBe(false);
	native.args[native.args.indexOf("--judge") + 1] = "xai-oauth/grok-4.7";
	const result = command(native.args);
	expect([result.status, result.stderr]).toEqual([0, ""]);
	const ledger = readLedger();
	expect([ledger.defaults, (ledger.experiments[0].verdict as Verdict).default_changed]).toEqual([{}, false]);
});

test("default evidence cannot reference a missing or nonqualifying experiment", () => {
	fixture();
	const ledger: Ledger = readLedger();
	ledger.defaults["build:openai-codex/gpt-6.1-sol"] = { entry: CANDIDATE, evidence: "E-007" };
	withLedgerLock(() => { expect(() => writeLedger(ledger)).toThrow("no accepted verdict evidence"); });
	expect(readLedger().defaults).toEqual({});
});
