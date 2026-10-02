import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { NativeAdapter, NativeRequest, ReviewReceipt, TaskSpec } from "./contract";
import { SummonStore } from "./core";

interface Fixture { root: string; workspace: string; stateDir: string; task: TaskSpec; store: SummonStore }
interface ProcessResult { exitCode: number; stdout: string; stderr: string }
const roots: string[] = [];
const workers: Bun.Subprocess<"pipe", "pipe", "pipe">[] = [];
const coreFile = join(import.meta.dir, "core.ts");
const cliFile = join(import.meta.dir, "cli.ts");

function fixture(overrides: Partial<TaskSpec> = {}): Fixture {
	const root = mkdtempSync(join(tmpdir(), "summon-core-"));
	roots.push(root);
	const workspace = join(root, "workspace");
	mkdirSync(workspace);
	const stateDir = join(root, "private-state");
	const task: TaskSpec = {
		id: "task-without-glass", kind: "implementation", brief: "Produce the commissioner deliverable.", workspace,
		route: { harness: "claude-code", provider: "anthropic", model: "claude-sonnet-4-6", effort: "medium" },
		checks: [], outputs: [], ...overrides,
	};
	return { root, workspace, stateDir, task, store: new SummonStore(stateDir) };
}

// Local test adapter exercises core's storage boundary, not native-provider correctness or model success.
function answerAdapter(action?: (request: NativeRequest) => void): NativeAdapter {
	return {
		id: "claude-code", capabilities: { resume: true, liveSteering: false, acknowledgement: "completion-only" },
		async preflight() {},
		async invoke(request) {
			action?.(request);
			return { sessionId: "fixture-native-session", completed: true, acknowledged: true, text: "The proposed deliverable is ready for commissioner checks.", model: null, usage: null };
		},
	};
}

function reviewReceipt(files: Fixture, checkId = "review"): ReviewReceipt {
	return { runId: files.task.id, checkId, deliveryDigest: files.store.inspect(files.task.id).deliveryDigest, verdict: "pass", reviewer: "commissioner@example.test", evidence: ["local independent review of specified deliverables"] };
}

function launch(files: Fixture, body: string, extraEnv: Record<string, string> = {}) {
	const child = Bun.spawn({
		cmd: [process.execPath, "--eval", `import { SummonStore, SummonError } from ${JSON.stringify(coreFile)};
import { writeFileSync } from 'node:fs';
const task = JSON.parse(process.env.SUMMON_TEST_TASK);
const store = new SummonStore(process.env.SUMMON_TEST_STATE);
try { ${body} } catch (error) { console.log(JSON.stringify({ error: { code: error instanceof SummonError ? error.code : 'WORKER_FAILURE', message: error.message } })); process.exitCode = 1; }`],
		env: { ...process.env, SUMMON_TEST_TASK: JSON.stringify(files.task), SUMMON_TEST_STATE: files.stateDir, ...extraEnv },
		stdin: "pipe", stdout: "pipe", stderr: "pipe",
	});
	workers.push(child);
	return child;
}
async function result(child: Bun.Subprocess<"pipe", "pipe", "pipe">): Promise<ProcessResult> {
	const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
	return { exitCode, stdout, stderr };
}
async function waitFile(path: string): Promise<void> {
	if (existsSync(path)) return;
	const { promise, resolve: ready, reject } = Promise.withResolvers<void>();
	const watcher = watch(dirname(path), () => { if (existsSync(path)) ready(); });
	watcher.on("error", reject);
	// Cross-process filesystem readiness cannot use a fake clock; this is only a failure watchdog.
	const signal = AbortSignal.timeout(5_000);
	const abort = () => reject(new Error(`worker did not reach ${path}`));
	signal.addEventListener("abort", abort, { once: true });
	if (existsSync(path)) ready();
	try { await promise; } finally { signal.removeEventListener("abort", abort); watcher.close(); }
}
function invoke(args: string[], stdin?: string): ProcessResult {
	const child = Bun.spawnSync({ cmd: [process.execPath, cliFile, ...args], stdin: stdin === undefined ? "ignore" : Buffer.from(stdin), stdout: "pipe", stderr: "pipe" });
	return { exitCode: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() };
}

const WAITING_NATIVE = `
const adapter = {
  id: 'claude-code', capabilities: { resume: true, liveSteering: false, acknowledgement: 'native-replay' },
  async preflight() {},
  async invoke(request, emit, signal) {
    if (process.env.SUMMON_TEST_ACK === 'yes') {
      emit({ type: 'session', sessionId: 'fixture-native-session' });
      emit({ type: 'acknowledged', requestId: request.requestId });
    }
    writeFileSync(process.env.SUMMON_TEST_ENTERED, String(process.pid));
    const { promise, resolve: canceled } = Promise.withResolvers();
    const cancel = () => canceled();
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    await promise;
    signal.removeEventListener('abort', cancel);
    writeFileSync(process.env.SUMMON_TEST_CLEANED, 'native fixture cleaned');
    throw new Error('fixture canceled after cleanup');
  }
};
console.log(JSON.stringify(await store.run(task.id, adapter)));`;

afterEach(async () => {
	for (const child of workers.splice(0)) {
		if (child.exitCode === null) child.kill(9);
		await child.exited;
	}
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("summon immutable local dispatch", () => {
	test("start canonicalizes the manifest, reopens idempotently, and refuses a conflicting payload", () => {
		const files = fixture();
		const started = files.store.start(files.task);
		const reopened = new SummonStore(files.stateDir);
		const reordered = { outputs: [], route: { effort: "medium", model: "claude-sonnet-4-6", provider: "anthropic", harness: "claude-code" }, checks: [], workspace: files.workspace, brief: files.task.brief, kind: "implementation", id: files.task.id };
		expect(reopened.start(reordered).manifestHash).toBe(started.manifestHash);
		expect(reopened.status(files.task.id)).toMatchObject({ generation: 1, state: "implementing", turns: [{ requestId: "start", state: "queued", acknowledged: false, result: null }] });
		expect(() => reopened.start({ ...files.task, brief: "Different commission." })).toThrow("different immutable manifest");
		expect(reopened.status(files.task.id).turns).toHaveLength(1);
		expect(readdirSync(files.stateDir).filter((path) => path.endsWith(".sqlite3"))).toHaveLength(1);
	});

	test("independent processes race identical and conflicting starts against the actual SQLite store", async () => {
		for (const conflict of [false, true]) {
			const files = fixture();
			const firstReady = join(files.root, "first-ready"), secondReady = join(files.root, "second-ready");
			const body = `writeFileSync(process.env.SUMMON_TEST_READY, 'ready'); await Bun.stdin.text(); console.log(JSON.stringify(store.start(task)));`;
			const first = launch(files, body, { SUMMON_TEST_READY: firstReady });
			const second = launch(files, body, { SUMMON_TEST_READY: secondReady, SUMMON_TEST_TASK: JSON.stringify(conflict ? { ...files.task, brief: "Competing immutable commission." } : files.task) });
			await Promise.all([waitFile(firstReady), waitFile(secondReady)]);
			first.stdin.end(); second.stdin.end();
			const outcomes = await Promise.all([result(first), result(second)]);
			if (conflict) {
				expect(outcomes.map((outcome) => outcome.exitCode).sort()).toEqual([0, 1]);
				const rejected = outcomes.find((outcome) => outcome.exitCode === 1)!;
				expect(JSON.parse(rejected.stdout)).toMatchObject({ error: { code: "START_CONFLICT" } });
			} else expect(outcomes.map((outcome) => outcome.exitCode)).toEqual([0, 0]);
			expect(new SummonStore(files.stateDir).status(files.task.id).turns).toHaveLength(1);
		}
	});

	test("same steering deduplicates across reopened and competing stores; different text conflicts", async () => {
		const files = fixture();
		files.store.start(files.task);
		const readyA = join(files.root, "a"), readyB = join(files.root, "b");
		const body = `writeFileSync(process.env.SUMMON_TEST_READY, 'ready'); await Bun.stdin.text(); console.log(JSON.stringify(store.say(task.id, 'steer-1', 'Add an independent reference.')));`;
		const a = launch(files, body, { SUMMON_TEST_READY: readyA });
		const b = launch(files, body, { SUMMON_TEST_READY: readyB });
		await Promise.all([waitFile(readyA), waitFile(readyB)]); a.stdin.end(); b.stdin.end();
		expect((await Promise.all([result(a), result(b)])).map((item) => item.exitCode)).toEqual([0, 0]);
		const reopened = new SummonStore(files.stateDir);
		expect(reopened.say(files.task.id, "steer-1", "Add an independent reference.")).toMatchObject({ generation: 2 });
		expect(() => reopened.say(files.task.id, "steer-1", "Conflicting correction.")).toThrow("different text");
		expect(reopened.status(files.task.id).turns.map((turn) => turn.requestId)).toEqual(["start", "steer-1"]);
		const competing = `writeFileSync(process.env.SUMMON_TEST_READY, 'ready'); await Bun.stdin.text(); console.log(JSON.stringify(store.say(task.id, 'steer-2', process.env.SUMMON_TEST_TEXT)));`;
		const c = launch(files, competing, { SUMMON_TEST_READY: join(files.root, "c"), SUMMON_TEST_TEXT: "First correction." });
		const d = launch(files, competing, { SUMMON_TEST_READY: join(files.root, "d"), SUMMON_TEST_TEXT: "Other correction." });
		await Promise.all([waitFile(join(files.root, "c")), waitFile(join(files.root, "d"))]); c.stdin.end(); d.stdin.end();
		const outcomes = await Promise.all([result(c), result(d)]);
		expect(outcomes.map((item) => item.exitCode).sort()).toEqual([0, 1]);
		expect(JSON.parse(outcomes.find((item) => item.exitCode === 1)!.stdout)).toMatchObject({ error: { code: "SAY_CONFLICT" } });
		expect(reopened.status(files.task.id)).toMatchObject({ generation: 3 });
		expect(reopened.status(files.task.id).turns).toHaveLength(3);
	});

	test("preflight refusal remains waiting_input and queued-safe, with no false ACK or submission", async () => {
		const files = fixture(); files.store.start(files.task);
		let submissions = 0;
		const adapter = answerAdapter(() => { submissions++; });
		adapter.preflight = async () => { throw new Error("native sign-in required"); };
		await expect(files.store.run(files.task.id, adapter)).rejects.toThrow("native sign-in required");
		expect(submissions).toBe(0);
		expect(new SummonStore(files.stateDir).status(files.task.id)).toMatchObject({ state: "waiting_input", owner: null, turns: [{ state: "queued", acknowledged: false }] });
		const delivered = await files.store.run(files.task.id, answerAdapter());
		expect(delivered).toMatchObject({ state: "awaiting_review", turns: [{ state: "answered" }] });
	});

	test("a competing process cannot dispatch; stop waits for owner cleanup instead of killing a PID", async () => {
		const files = fixture(); files.store.start(files.task);
		const entered = join(files.root, "entered"), cleaned = join(files.root, "cleaned");
		const child = launch(files, WAITING_NATIVE, { SUMMON_TEST_ENTERED: entered, SUMMON_TEST_CLEANED: cleaned, SUMMON_TEST_ACK: "yes" }); child.stdin.end();
		await waitFile(entered);
		expect(files.store.status(files.task.id)).toMatchObject({ owner: { pid: child.pid, alive: true }, turns: [{ state: "acknowledged", acknowledged: true, result: null }] });
		let calls = 0;
		await expect(new SummonStore(files.stateDir).run(files.task.id, answerAdapter(() => { calls++; }))).rejects.toMatchObject({ code: "BUSY" });
		expect(calls).toBe(0);
		const stopped = await new SummonStore(files.stateDir).stop(files.task.id);
		expect(stopped).toMatchObject({ state: "stopped", owner: null, turns: [{ state: "uncertain", acknowledged: true }] });
		expect(readFileSync(cleaned, "utf8")).toBe("native fixture cleaned");
		expect((await result(child)).exitCode).toBe(1);
	});

	test("crash classification persists uncertainty, never replays, and allows only explicit acknowledged-session reconciliation", async () => {
		const files = fixture(); files.store.start(files.task);
		const entered = join(files.root, "entered");
		const child = launch(files, WAITING_NATIVE, { SUMMON_TEST_ENTERED: entered, SUMMON_TEST_CLEANED: join(files.root, "unused"), SUMMON_TEST_ACK: "yes" }); child.stdin.end();
		await waitFile(entered); child.kill(9); await child.exited;
		const reopened = new SummonStore(files.stateDir);
		expect(reopened.status(files.task.id)).toMatchObject({ state: "interrupted", owner: { alive: false }, turns: [{ state: "uncertain" }] });
		let calls = 0;
		await expect(reopened.run(files.task.id, answerAdapter(() => { calls++; }))).rejects.toMatchObject({ code: "RECONCILIATION_REQUIRED" });
		expect(calls).toBe(0);
		expect(new SummonStore(files.stateDir).status(files.task.id)).toMatchObject({ owner: null, turns: [{ state: "uncertain" }] });
		const receipt = { runId: files.task.id, requestId: "start", sessionId: "fixture-native-session", completed: true, text: "Answer observed in the native transcript after dispatcher crash.", reviewer: "commissioner@example.test", evidence: ["native transcript: fixture-native-session/request start"] };
		expect(() => reopened.reconcile({ ...receipt, sessionId: "unrelated-session" })).toThrow("observed native session");
		reopened.say(files.task.id, "queued-after-crash", "Continue with the second requirement.");
		await expect(reopened.run(files.task.id, answerAdapter())).rejects.toMatchObject({ code: "RECONCILIATION_REQUIRED" });
		reopened.reconcile(receipt);
		const requests: NativeRequest[] = [];
		const resumed = await reopened.run(files.task.id, answerAdapter((request) => { requests.push(request); }));
		expect(requests).toHaveLength(1);
		expect(requests[0]).toMatchObject({ requestId: "queued-after-crash", sessionId: "fixture-native-session" });
		expect(resumed).toMatchObject({ state: "awaiting_review", owner: null });
		expect(resumed.turns.map((turn) => turn.state)).toEqual(["answered", "answered"]);
	});

	test("an acknowledged partial answer is uncertain; reconciliation preserves only actually reported native counters", async () => {
		const files = fixture(); files.store.start(files.task);
		const adapter = answerAdapter();
		adapter.invoke = async () => ({ sessionId: "fixture-native-session", completed: false, acknowledged: true, text: "Partial observed text.", model: "native-observed-model", usage: { input_tokens: 9, output_tokens: 4 } });
		await expect(files.store.run(files.task.id, adapter)).rejects.toMatchObject({ code: "UNCERTAIN" });
		expect(files.store.status(files.task.id)).toMatchObject({ state: "interrupted", turns: [{ state: "uncertain", acknowledged: true }] });
		const reconciled = files.store.reconcile({ runId: files.task.id, requestId: "start", sessionId: "fixture-native-session", completed: true, text: "Final text found in the acknowledged native transcript.", reviewer: "commissioner", evidence: ["native transcript fixture-native-session"] });
		expect(reconciled).toMatchObject({ state: "awaiting_review", turns: [{ state: "answered", result: { model: "native-observed-model", usage: { input_tokens: 9, output_tokens: 4 } } }] });
	});

	test("unacknowledged crash cannot be declared unsent, reconciled or silently replayed", async () => {
		const files = fixture(); files.store.start(files.task);
		const entered = join(files.root, "entered");
		const child = launch(files, WAITING_NATIVE, { SUMMON_TEST_ENTERED: entered, SUMMON_TEST_CLEANED: join(files.root, "unused"), SUMMON_TEST_ACK: "no" }); child.stdin.end();
		await waitFile(entered); child.kill(9); await child.exited;
		await expect(files.store.run(files.task.id, answerAdapter())).rejects.toMatchObject({ code: "RECONCILIATION_REQUIRED" });
		expect(() => files.store.reconcile({ runId: files.task.id, requestId: "start", sessionId: "invented", completed: true, text: "Invented answer", reviewer: "commissioner", evidence: ["assertion without native ACK"] })).toThrow("natively acknowledged");
		expect(files.store.status(files.task.id).turns[0]).toMatchObject({ state: "uncertain", acknowledged: false, result: null });
	});
});

describe("commissioner supplied completion policy", () => {
	test("implementation and research have distinct activity states; no checks never means verified delivery", async () => {
		for (const kind of ["implementation", "research"] as const) {
			const files = fixture({ kind });
			expect(files.store.start(files.task).state).toBe(kind === "implementation" ? "implementing" : "researching");
			await files.store.run(files.task.id, answerAdapter());
			const inspected = await files.store.check(files.task.id);
			expect(inspected).toMatchObject({ state: "awaiting_review", readyForReview: true, checks: [] });
			expect(new SummonStore(files.stateDir).status(files.task.id).state).toBe("awaiting_review");
		}
	});

	test("research delivers through an explicit review criterion, without Git or a default shell/test command", async () => {
		const files = fixture({ kind: "research", outputs: ["findings.md"], checks: [{ id: "review", type: "review", criterion: "Review the comparison and cited sources." }] });
		const marker = join(files.root, "unexpected-default-test");
		writeFileSync(join(files.workspace, "findings.md"), "A source comparison with independent references.\n");
		writeFileSync(join(files.workspace, "trap.test.ts"), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'unrequested default test');`);
		writeFileSync(join(files.workspace, "package.json"), JSON.stringify({ scripts: { test: `${process.execPath} trap.test.ts` } }));
		files.store.start(files.task); await files.store.run(files.task.id, answerAdapter());
		const checked = await files.store.check(files.task.id);
		expect(checked).toMatchObject({ state: "awaiting_review", head: null, checks: [{ id: "review", status: "pending" }] });
		expect(existsSync(marker)).toBe(false);
		expect(files.store.review(reviewReceipt(files)).state).toBe("verified_delivery");
	});

	test("a real failing command blocks delivery and the CLI exits nonzero with its persisted evidence", async () => {
		const files = fixture({ checks: [{ id: "contract", type: "command", argv: [process.execPath, "-e", "console.error('contract rejected'); process.exit(17);"] }] });
		files.store.start(files.task); await files.store.run(files.task.id, answerAdapter());
		const checked = invoke(["check", files.task.id, "--state-dir", files.stateDir]);
		expect(checked.exitCode).toBe(1);
		expect(JSON.parse(checked.stdout)).toMatchObject({ state: "awaiting_review", checks: [{ id: "contract", status: "block", evidence: { exitCode: 17, stderr: "contract rejected\n" } }] });
		expect(new SummonStore(files.stateDir).inspect(files.task.id)).toMatchObject({ state: "awaiting_review", checks: [{ status: "block" }] });
	});

	test("task-specific argv and an independent receipt together authorize delivery; argv is never shell-interpreted", async () => {
		const files = fixture({ outputs: ["deliverable.txt"], checks: [
			{ id: "artifact-contract", type: "command", argv: [process.execPath, "-e", "import { readFileSync } from 'node:fs'; if (readFileSync('deliverable.txt', 'utf8') !== 'accepted output\\n' || process.argv[1] !== 'literal; touch injected') process.exit(9); console.log('contract passed');", "literal; touch injected"] },
			{ id: "review", type: "review", criterion: "Independently inspect the deliverable against the commission." },
		] });
		writeFileSync(join(files.workspace, "deliverable.txt"), "accepted output\n");
		files.store.start(files.task); await files.store.run(files.task.id, answerAdapter());
		const receipt = reviewReceipt(files);
		expect(files.store.review(receipt).state).toBe("awaiting_review");
		const checked = await files.store.check(files.task.id);
		expect(checked.state).toBe("verified_delivery");
		expect(checked.checks.map((check) => check.status)).toEqual(["pass", "pass"]);
		expect(existsSync(join(files.workspace, "injected"))).toBe(false);
		expect(new SummonStore(files.stateDir).status(files.task.id).state).toBe("verified_delivery");
		expect(files.store.say(files.task.id, "start", files.task.brief).state).toBe("verified_delivery");
		expect(files.store.inspect(files.task.id).deliveryDigest).toBe(receipt.deliveryDigest);
	});

	test("changed outputs, new steering and later answers invalidate prior checks and reviews", async () => {
		const files = fixture({ outputs: ["answer.txt"], checks: [
			{ id: "command", type: "command", argv: [process.execPath, "-e", "import { readFileSync } from 'node:fs'; if (!readFileSync('answer.txt', 'utf8').startsWith('acceptable')) process.exit(1);"] },
			{ id: "review", type: "review", criterion: "Review the current answer." },
		] });
		writeFileSync(join(files.workspace, "answer.txt"), "acceptable original");
		files.store.start(files.task); await files.store.run(files.task.id, answerAdapter()); await files.store.check(files.task.id);
		const old = reviewReceipt(files); expect(files.store.review(old).state).toBe("verified_delivery");
		writeFileSync(join(files.workspace, "answer.txt"), "acceptable but changed");
		expect(files.store.status(files.task.id).state).toBe("awaiting_review");
		expect(files.store.start(files.task).state).toBe("awaiting_review");
		expect(files.store.say(files.task.id, "start", files.task.brief).state).toBe("awaiting_review");
		expect(() => files.store.review(old)).toThrow("does not match current manifest");
		expect(files.store.inspect(files.task.id).checks.map((check) => check.status)).toEqual(["pending", "pending"]);
		await files.store.check(files.task.id); const changed = reviewReceipt(files); expect(files.store.review(changed).state).toBe("verified_delivery");
		files.store.say(files.task.id, "steer", "Address the additional criterion.");
		expect(files.store.inspect(files.task.id)).toMatchObject({ state: "implementing", readyForReview: false, checks: [{ status: "pending" }, { status: "pending" }] });
		expect(() => files.store.review(changed)).toThrow("does not match current manifest");
		await files.store.run(files.task.id, answerAdapter());
		expect(() => files.store.review(changed)).toThrow("does not match current manifest");
		expect(files.store.status(files.task.id).state).toBe("awaiting_review");
	});

	test("steering during an owned command invalidates that command proof rather than approving a newer turn", async () => {
		const files = fixture();
		const entered = join(files.root, "entered-check"), released = join(files.root, "release-check");
		const childCode = `import { existsSync, watch, writeFileSync } from 'node:fs'; const watcher = watch(${JSON.stringify(files.root)}, () => { if (existsSync(${JSON.stringify(released)})) { watcher.close(); process.exit(0); } }); writeFileSync(${JSON.stringify(entered)}, 'ready'); if (existsSync(${JSON.stringify(released)})) { watcher.close(); process.exit(0); }`;
		files.task.checks = [{ id: "command", type: "command", argv: [process.execPath, "-e", childCode] }, { id: "review", type: "review", criterion: "Review the completed turn." }];
		files.store.start(files.task); await files.store.run(files.task.id, answerAdapter());
		const oldReview = reviewReceipt(files);
		const child = launch(files, "console.log(JSON.stringify(await store.check(task.id)));"); child.stdin.end();
		await waitFile(entered);
		files.store.say(files.task.id, "during-check", "A new requirement arrived.");
		writeFileSync(released, "release");
		const checked = await result(child);
		expect(checked.exitCode).toBe(1); expect(JSON.parse(checked.stdout)).toMatchObject({ error: { code: "CHECK_STALE" } });
		expect(files.store.inspect(files.task.id)).toMatchObject({ state: "implementing", owner: null, readyForReview: false, checks: [{ status: "pending" }, { status: "pending" }] });
		expect(() => files.store.review(oldReview)).toThrow("does not match current manifest");
	});

	test("Git HEAD freshness is additional evidence, not a mandatory repository identity", async () => {
		const files = fixture({ checks: [{ id: "review", type: "review", criterion: "Review this exact repository head." }] });
		for (const args of [["init", "-q"], ["-c", "user.name=Summon Test", "-c", "user.email=summon@example.test", "commit", "--allow-empty", "-qm", "initial"]]) {
			const result = spawnSync("git", ["-C", files.workspace, ...args], { encoding: "utf8" });
			if (result.status !== 0) throw new Error(result.stderr || "git fixture initialization failed");
		}
		files.store.start(files.task); await files.store.run(files.task.id, answerAdapter());
		const receipt = reviewReceipt(files); expect(files.store.review(receipt).state).toBe("verified_delivery");
		const commit = spawnSync("git", ["-C", files.workspace, "-c", "user.name=Summon Test", "-c", "user.email=summon@example.test", "commit", "--allow-empty", "-qm", "new head"], { encoding: "utf8" });
		if (commit.status !== 0) throw new Error(commit.stderr || "git fixture commit failed");
		expect(files.store.status(files.task.id).state).toBe("awaiting_review");
		expect(() => files.store.review(receipt)).toThrow("does not match current manifest");
	});

	test("review identity/evidence and criterion validate without inventing receipt authenticity", async () => {
		const files = fixture({ checks: [{ id: "review", type: "review", criterion: "Inspect the research conclusion." }] });
		files.store.start(files.task); await files.store.run(files.task.id, answerAdapter());
		const receipt = reviewReceipt(files);
		expect(() => files.store.review({ ...receipt, reviewer: " " })).toThrow("reviewer must be a nonempty string");
		expect(() => files.store.review({ ...receipt, reviewer: "person\nanother identity" })).toThrow("without control characters");
		expect(() => files.store.review({ ...receipt, evidence: [] })).toThrow("evidence must contain");
		expect(() => files.store.review({ ...receipt, checkId: "invented-check" })).toThrow("commissioner-supplied review criterion");
		expect(files.store.review({ ...receipt, verdict: "block" }).state).toBe("awaiting_review");
		expect(files.store.review(receipt).state).toBe("verified_delivery");
	});

	test("missing artifacts block completion and escaping paths/symlinks never count as workspace evidence", async () => {
		const files = fixture({ outputs: ["missing.txt"], checks: [{ id: "review", type: "review", criterion: "Inspect the output." }] });
		files.store.start(files.task); await files.store.run(files.task.id, answerAdapter());
		expect(files.store.inspect(files.task.id).readyForReview).toBe(false);
		await expect(files.store.check(files.task.id)).rejects.toMatchObject({ code: "CHECK_NOT_READY" });
		expect(() => files.store.review(reviewReceipt(files))).toThrow("completed turns and present outputs");
		for (const path of ["../outside.txt", join(files.root, "absolute.txt")]) expect(() => files.store.start({ ...files.task, id: path, outputs: [path] })).toThrow("without traversal");
		const missingReceipt = reviewReceipt(files);
		writeFileSync(join(files.root, "outside.txt"), "not a workspace deliverable");
		symlinkSync(join(files.root, "outside.txt"), join(files.workspace, "missing.txt"));
		expect(() => files.store.inspect(files.task.id)).toThrow("outside workspace");
		await expect(files.store.check(files.task.id)).rejects.toMatchObject({ code: "OUTPUT_ESCAPE" });
		expect(() => files.store.review(missingReceipt)).toThrow("outside workspace");
		symlinkSync(join(files.root, "not-yet-present"), join(files.workspace, "dangling.txt"));
		expect(() => files.store.start({ ...files.task, id: "dangling", outputs: ["dangling.txt"] })).toThrow("outside workspace");
	});

	test("stop cancels an owned command and waits for the subprocess group before clearing ownership", async () => {
		const files = fixture();
		const entered = join(files.root, "command-entered"), cleaned = join(files.root, "command-cleaned");
		// A real child lifetime/process-group signal is the contract; fake timers cannot control it.
		files.task.checks = [{ id: "slow", type: "command", argv: [process.execPath, "-e", `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(entered)}, String(process.pid)); process.on('SIGTERM', () => { writeFileSync(${JSON.stringify(cleaned)}, 'cleaned'); process.exit(0); }); setInterval(() => {}, 1000);`] }];
		files.store.start(files.task); await files.store.run(files.task.id, answerAdapter());
		const child = launch(files, "console.log(JSON.stringify(await store.check(task.id)));" ); child.stdin.end();
		await waitFile(entered);
		expect(files.store.status(files.task.id).owner).toMatchObject({ pid: child.pid, purpose: "check" });
		const stopped = await files.store.stop(files.task.id);
		expect(stopped).toMatchObject({ state: "stopped", owner: null });
		expect(readFileSync(cleaned, "utf8")).toBe("cleaned");
		const commandPid = Number(readFileSync(entered, "utf8"));
		expect(() => process.kill(commandPid, 0)).toThrow();
		expect((await result(child)).exitCode).toBe(1);
	});
});

describe("source-only JSON CLI", () => {
	test("read-only unknown status creates nothing, and local start/say/inspect/stop need no Glass or repository", () => {
		const files = fixture({ kind: "research" });
		const unknown = invoke(["status", files.task.id, "--state-dir", files.stateDir]);
		expect(unknown.exitCode).toBe(1); expect(JSON.parse(unknown.stderr)).toMatchObject({ error: { code: "NOT_FOUND" } });
		expect(existsSync(files.stateDir)).toBe(false);
		const noState = invoke(["start", "--task", "-"], JSON.stringify(files.task));
		expect(noState.exitCode).toBe(2); expect(JSON.parse(noState.stderr)).toMatchObject({ error: { code: "USAGE" } });
		const started = invoke(["start", "--state-dir", files.stateDir, "--task", "-"], JSON.stringify(files.task));
		expect(started.exitCode).toBe(0); expect(JSON.parse(started.stdout)).toMatchObject({ state: "researching", task: { id: files.task.id } });
		const dbFile = join(files.stateDir, readdirSync(files.stateDir).find((file) => file.endsWith(".sqlite3"))!);
		const before = statSync(dbFile).mtimeMs;
		const status = invoke(["status", files.task.id, "--state-dir", files.stateDir]);
		expect(status.exitCode).toBe(0); expect(statSync(dbFile).mtimeMs).toBe(before);
		expect(invoke(["say", files.task.id, "--state-dir", files.stateDir, "--request-id", "steer", "--text", "Cite another source."]).exitCode).toBe(0);
		const inspected = invoke(["inspect", files.task.id, "--state-dir", files.stateDir]);
		expect(inspected.exitCode).toBe(0); expect(JSON.parse(inspected.stdout)).toMatchObject({ readyForReview: false, head: null });
		expect(JSON.parse(inspected.stdout).deliveryDigest).toMatch(/^[0-9a-f]{64}$/);
		const stopped = invoke(["stop", files.task.id, "--state-dir", files.stateDir]);
		expect(stopped.exitCode).toBe(0); expect(JSON.parse(stopped.stdout)).toMatchObject({ state: "stopped", owner: null });
	});
});
