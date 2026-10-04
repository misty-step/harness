import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SummonStore } from "../summon/core";
import type { TaskSpec } from "../summon/contract";
import { admit, commissionDigest, type AdmissionRequest } from "./core";

// The runner forbids writes outside this repo. Use its ignored, run-scoped scratch.
const scratch = resolve(import.meta.dir, "../../../.lane/scratch");
mkdirSync(scratch, { recursive: true, mode: 0o700 });
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const fixture = join(import.meta.dir, "fixture.ts");
function fake(role: string, config: object = {}): string[] { return [process.execPath, fixture, role, JSON.stringify(config)]; }
function setup() {
	const root = mkdtempSync(join(scratch, "admission-")); roots.push(root);
	const state = join(root, "state"), workspace = join(root, "workspace");
	mkdirSync(state, { mode: 0o700 }); mkdirSync(workspace, { mode: 0o700 });
	const task: TaskSpec = {
		id: "task-1", kind: "implementation", brief: "Produce one fixture output", workspace,
		route: { harness: "claude-code", provider: "anthropic", model: "fixture-model", effort: "high" },
		checks: [{ id: "independent-review", type: "review", criterion: "Output satisfies brief" }], outputs: ["result.txt"],
	};
	const request: AdmissionRequest = {
		commission: { deliveryId: "commission-1", sessionId: "executive-session", sessionFile: "/fixture/executive.jsonl", kind: "commission", payload: JSON.stringify(task), runId: task.id, commissionRef: "fixture-commission", inputId: "start" },
		laneId: "engineer-a", engineer: { argv: fake("engineer"), vendor: "anthropic", accountId: "author-seat" },
		reviewer: { argv: fake("reviewer"), vendor: "google", accountId: "review-seat" },
		usageReader: { argv: fake("usage") },
		policy: { maxAgeMs: 60000, maxUsedPercent: 90, readerTimeoutMs: 2000, commandTimeoutMs: 2000 },
		occupancy: { laneId: "engineer-a", status: "idle", observedAt: Date.now(), evidence: ["fixture-occupancy"] },
	};
	const sign = () => { request.authorization = { authorized: true, digest: commissionDigest(request), expiresAt: Date.now() + 60000, evidence: ["fixture-owner-approval"] }; };
	sign();
	const events = () => { try { return readFileSync(join(workspace, "launches.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line)); } catch { return []; } };
	return { root, state, workspace, request, task, sign, events };
}
function guards(state: string): string[] { try { return readdirSync(join(state, "admission")).filter(name => name.endsWith(".guard")); } catch { return []; } }

test("one JSON commission reaches an engineer and independent review, using Summon's proof and Mage's envelope", async () => {
	const f = setup();
	const result = await admit(f.request, f.state);
	expect(result.status).toBe("pass"); expect(result.code).toBe("verified_delivery");
	expect(result.launches).toEqual({ engineer: 1, reviewer: 1 });
	expect(result.run?.state).toBe("verified_delivery"); expect(result.run?.deliveryState).toBe("answered");
	expect(result.review?.deliveryDigest).toBe(new SummonStore(f.state).inspect(f.task.id).deliveryDigest);
	expect(result.envelope).toMatchObject({ kind: "completion", sessionId: "executive-session", sessionFile: "/fixture/executive.jsonl", runId: f.task.id, commissionRef: "fixture-commission", inputId: "start" });
	expect(JSON.parse(result.envelope!.payload).status).toBe("pass");
	expect(result.envelope!.deliveryId).toHaveLength(64);
	expect(f.events().map(event => event.role)).toEqual(["usage", "engineer", "reviewer"]);
	expect(f.events()[1].input.request.task).toEqual(f.task);
	expect(f.events()[1].input.envelope).toEqual(f.request.commission);
	expect(new SummonStore(f.state).inspect(f.task.id).turns[0]!.result!.usage).toBeNull();
	expect(guards(f.state)).toHaveLength(0);
});

test("the existing Google author route can receive independent OpenAI review", async () => {
	const f = setup();
	f.task.route = { harness: "antigravity", provider: "google-antigravity", model: "fixture-google", effort: "high" };
	f.request.commission.payload = JSON.stringify(f.task);
	f.request.engineer.vendor = "google"; f.request.reviewer.vendor = "openai";
	f.request.reviewer.argv = fake("reviewer", { vendor: "openai", receipt: { reviewer: "openai:review-seat" } }); f.sign();
	expect((await admit(f.request, f.state)).status).toBe("pass");
});

const authCases: [string, (r: any) => void][] = [
	["missing", r => { delete r.authorization; }], ["denied", r => { r.authorization.authorized = false; }],
	["string boolean", r => { r.authorization.authorized = "true"; }], ["empty evidence", r => { r.authorization.evidence = []; }],
	["expired", r => { r.authorization.expiresAt = Date.now() - 1; }], ["unbound", r => { r.authorization.digest = "wrong"; }],
	["changed command", r => { r.engineer.argv = fake("engineer", { vendor: "openai" }); }],
	["changed task", r => { const task = JSON.parse(r.commission.payload); task.brief = "unapproved brief"; r.commission.payload = JSON.stringify(task); }],
];
for (const [name, mutate] of authCases) test(`authorization ${name} refuses with zero launches`, async () => {
	const f = setup(); mutate(f.request);
	expect(await admit(f.request, f.state)).toEqual({ status: "refused", code: "invalid_authorization", launches: { engineer: 0, reviewer: 0 } });
	expect(f.events()).toHaveLength(0); expect(readdirSync(f.state)).toHaveLength(0);
});

const occupancyCases: [string, (r: any) => void, string][] = [
	["missing", r => { delete r.occupancy; }, "unknown_occupancy"], ["unknown", r => { r.occupancy.status = "unknown"; }, "unknown_occupancy"],
	["occupied", r => { r.occupancy.status = "occupied"; }, "lane_occupied"], ["wrong lane", r => { r.occupancy.laneId = "other"; }, "unknown_occupancy"],
	["stale", r => { r.occupancy.observedAt = Date.now() - 60001; }, "unknown_occupancy"],
	["future", r => { r.occupancy.observedAt = Date.now() + 60000; }, "unknown_occupancy"],
	["empty evidence", r => { r.occupancy.evidence = []; }, "unknown_occupancy"],
];
for (const [name, mutate, code] of occupancyCases) test(`occupancy ${name} refuses with zero launches`, async () => {
	const f = setup(); mutate(f.request);
	const result = await admit(f.request, f.state);
	expect(result).toEqual({ status: "refused", code, launches: { engineer: 0, reviewer: 0 } }); expect(f.events()).toHaveLength(0);
});

const usageCases: [string, object, string][] = [
	["missing readings", { reply: {} }, "unknown_usage"], ["missing seat", { missing: true }, "unknown_usage"],
	["duplicate seat", { duplicate: true }, "unknown_usage"], ["wrong account", { reading: { accountId: "other" } }, "unknown_usage"],
	["wrong vendor", { reading: { vendor: "openai" } }, "unknown_usage"], ["stale", { reading: { observedAt: 1 } }, "unknown_usage"],
	["future", { reading: { observedAt: 9999999999999 } }, "unknown_usage"], ["empty evidence", { reading: { evidence: [] } }, "unknown_usage"],
	["missing percentage", { reading: { usedPercent: null } }, "unknown_usage"], ["negative", { reading: { usedPercent: -1 } }, "unknown_usage"],
	["over 100", { reading: { usedPercent: 101 } }, "unknown_usage"], ["missing capped", { reading: { capped: null } }, "unknown_usage"],
	["threshold", { reading: { usedPercent: 90 } }, "quota_exhausted"], ["capped", { reading: { capped: true } }, "quota_exhausted"],
	["reader exit", { exit: 7 }, "unknown_usage"], ["reader malformed", { malformed: true }, "unknown_usage"],
	["reader overflow", { overflow: true }, "unknown_usage"],
];
for (const [name, config, code] of usageCases) test(`usage ${name} refuses with zero launches`, async () => {
	const f = setup(); f.request.usageReader.argv = fake("usage", config); f.sign();
	expect(await admit(f.request, f.state)).toEqual({ status: "refused", code, launches: { engineer: 0, reviewer: 0 } });
	expect(f.events().map(event => event.role)).toEqual(["usage"]); expect(guards(f.state)).toHaveLength(0);
	expect(readdirSync(f.state)).toEqual(["admission"]);
});

test("an unavailable quota command refuses instead of passing", async () => {
	const f = setup(); f.request.usageReader.argv = [join(f.root, "missing-reader")]; f.sign();
	expect((await admit(f.request, f.state)).code).toBe("unknown_usage"); expect(f.events()).toHaveLength(0);
});

test("a hung quota reader is bounded, returns unknown_usage and admits no lane", async () => {
	const f = setup(); f.request.usageReader.argv = fake("usage", { hang: true }); f.request.policy.readerTimeoutMs = 150; f.sign();
	const start = Date.now(), result = await admit(f.request, f.state);
	expect(Date.now() - start).toBeLessThan(1500);
	expect(result).toEqual({ status: "refused", code: "unknown_usage", launches: { engineer: 0, reviewer: 0 } });
	expect(guards(f.state)).toHaveLength(0);
});

test("authorization is rechecked after a bounded reader wait", async () => {
	const f = setup(); f.request.usageReader.argv = fake("usage", { delay: 100 }); f.sign(); f.request.authorization!.expiresAt = Date.now() + 60;
	expect((await admit(f.request, f.state)).code).toBe("invalid_authorization"); expect(f.events().map(event => event.role)).toEqual(["usage"]);
});

test("missing reader command and invalid route or policy cannot launch", async () => {
	for (const [mutate, code] of [
		[(r: any) => { delete r.usageReader; }, "unknown_usage"],
		[(r: any) => { r.engineer.vendor = "openai"; }, "invalid_route"],
		[(r: any) => { r.policy.readerTimeoutMs = 0; }, "invalid_input"],
		[(r: any) => { r.policy.maxUsedPercent = 91; }, "invalid_input"],
	] as const) {
		const f = setup(); mutate(f.request);
		expect((await admit(f.request, f.state)).code).toBe(code); expect(f.events()).toHaveLength(0);
	}
});

test("same-vendor review is refused before any command", async () => {
	const f = setup(); f.request.reviewer.vendor = "anthropic"; f.sign();
	expect((await admit(f.request, f.state)).code).toBe("same_vendor_review"); expect(f.events()).toHaveLength(0);
});

test("cf1 and command-check tasks do not enter the local store", async () => {
	for (const cf of [true, false]) {
		const f = setup();
		if (cf) { f.task.id = "cf1:remote"; f.request.commission.runId = f.task.id; }
		else f.task.checks = [{ id: "check", type: "command", argv: ["true"] }];
		f.request.commission.payload = JSON.stringify(f.task); f.sign();
		expect((await admit(f.request, f.state)).status).toBe("refused"); expect(readdirSync(f.state)).toHaveLength(0);
	}
});

test("foreign state permissions refuse with zero launches", async () => {
	const f = setup(); chmodSync(f.state, 0o755);
	expect((await admit(f.request, f.state)).code).toBe("state_unavailable"); expect(f.events()).toHaveLength(0);
});

const engineerCases: [string, object][] = [
	["no acknowledgement", { result: { acknowledged: false } }], ["incomplete", { result: { completed: false } }],
	["null model", { result: { model: null } }], ["wrong model", { result: { model: "other" } }],
	["null session", { result: { sessionId: null } }], ["wrong vendor", { vendor: "google" }],
	["missing result", { reply: {} }], ["malformed", { malformed: true }], ["failed command", { exit: 7 }], ["hung command", { hang: true }],
];
for (const [name, config] of engineerCases) test(`engineer ${name} stays uncertain and is never replayed`, async () => {
	const f = setup(); f.request.engineer.argv = fake("engineer", config); f.request.policy.commandTimeoutMs = 150; f.sign();
	const result = await admit(f.request, f.state);
	expect(result.status).toBe("unknown"); expect(result.code).toBe("engineer_uncertain");
	expect(result.run?.deliveryState).toBe("uncertain"); expect(result.run?.state).toBe("interrupted");
	expect(result.launches).toEqual({ engineer: 1, reviewer: 0 }); expect(guards(f.state)).toHaveLength(1);
	const repeat = await admit(f.request, f.state);
	expect(repeat).toEqual({ status: "unknown", code: "reconciliation_required", launches: { engineer: 0, reviewer: 0 } });
	expect(f.events().filter(event => event.role === "engineer")).toHaveLength(1);
	f.task.id = "task-2"; f.request.commission.runId = f.task.id; f.request.commission.payload = JSON.stringify(f.task); f.sign();
	expect((await admit(f.request, f.state)).code).toBe("lane_occupied");
});

const reviewCases: [string, object, string, string][] = [
	["same vendor response", { vendor: "anthropic" }, "block", "invalid_review"],
	["wrong reviewer", { receipt: { reviewer: "anthropic:author-seat" } }, "block", "invalid_review"],
	["wrong run", { receipt: { runId: "other" } }, "block", "invalid_review"],
	["wrong check", { receipt: { checkId: "other" } }, "block", "invalid_review"],
	["wrong digest", { receipt: { deliveryDigest: "stale" } }, "block", "invalid_review"],
	["missing evidence", { receipt: { evidence: [] } }, "block", "invalid_review"],
	["known rejection", { receipt: { verdict: "block" } }, "block", "review_blocked"],
	["changed output", { mutate: true }, "block", "delivery_changed"],
	["explicit unknown", { unknown: true }, "unknown", "review_unknown"],
	["missing receipt", { reply: {} }, "unknown", "review_unknown"],
	["nonobject reply", { reply: [] }, "unknown", "review_unknown"],
	["unknown verdict", { receipt: { verdict: "unknown" } }, "unknown", "review_unknown"],
	["uncertain verdict", { receipt: { verdict: "uncertain" } }, "unknown", "review_unknown"],
	["malformed stdout", { malformed: true }, "unknown", "review_unknown"],
	["failed command", { exit: 7 }, "unknown", "review_unknown"], ["hung command", { hang: true }, "unknown", "review_unknown"],
];
for (const [name, config, status, code] of reviewCases) test(`review ${name} cannot manufacture a passing receipt`, async () => {
	const f = setup(); f.request.reviewer.argv = fake("reviewer", config); f.request.policy.commandTimeoutMs = 150; f.sign();
	const result = await admit(f.request, f.state);
	expect(result.status).toBe(status); expect(result.code).toBe(code); expect(result.launches).toEqual({ engineer: 1, reviewer: 1 });
	expect(result.run?.state).toBe("awaiting_review"); expect(new SummonStore(f.state).inspect(f.task.id).state).toBe("awaiting_review");
	expect(guards(f.state)).toHaveLength(status === "unknown" ? 1 : 0);
	const repeat = await admit(f.request, f.state); expect(repeat.status).toBe("unknown"); expect(repeat.launches).toEqual({ engineer: 0, reviewer: 0 });
	expect(f.events().filter(event => event.role === "reviewer")).toHaveLength(1);
});

test("missing declared outputs never launch a reviewer or produce success", async () => {
	const f = setup(); f.request.engineer.argv = fake("engineer", { noOutput: true }); f.sign();
	const result = await admit(f.request, f.state);
	expect(result.status).toBe("block"); expect(result.code).toBe("delivery_changed"); expect(result.launches).toEqual({ engineer: 1, reviewer: 0 });
});

test("two simultaneous JSON tasks for one lane produce exactly one engineer start", async () => {
	const f = setup(); f.request.usageReader.argv = fake("usage", { delay: 100 }); f.sign();
	const second = structuredClone(f.request), task = JSON.parse(second.commission.payload); task.id = "task-2";
	second.commission.runId = task.id; second.commission.deliveryId = "commission-2"; second.commission.payload = JSON.stringify(task);
	second.authorization!.digest = commissionDigest(second);
	const results = await Promise.all([admit(f.request, f.state), admit(second, f.state)]);
	expect(results.map(result => result.status).sort()).toEqual(["pass", "refused"]);
	expect(results.find(result => result.status === "refused")?.code).toBe("lane_occupied");
	expect(f.events().filter(event => event.role === "engineer")).toHaveLength(1);
});

test("a settled task is not repeated and its released lane admits another task", async () => {
	const f = setup(); expect((await admit(f.request, f.state)).status).toBe("pass");
	expect((await admit(f.request, f.state)).code).toBe("reconciliation_required");
	f.task.id = "task-2"; f.request.commission.runId = f.task.id; f.request.commission.deliveryId = "commission-2";
	f.request.commission.payload = JSON.stringify(f.task); f.sign();
	expect((await admit(f.request, f.state)).status).toBe("pass"); expect(f.events().filter(event => event.role === "engineer")).toHaveLength(2);
});

async function cli(args: string[], input: unknown) {
	const child = Bun.spawn([process.execPath, join(import.meta.dir, "cli.ts"), ...args], { stdin: Buffer.from(typeof input === "string" ? input : JSON.stringify(input)), stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	expect(stderr).toBe(""); expect(stdout.trim().split("\n")).toHaveLength(1);
	return { result: JSON.parse(stdout), exit };
}
test("CLI stdin JSON, digest-only mode, pass/refusal/unknown exit codes", async () => {
	const f = setup();
	expect(await cli(["--digest"], f.request)).toEqual({ result: { digest: commissionDigest(f.request) }, exit: 0 });
	expect(f.events()).toHaveLength(0); expect(readdirSync(f.state)).toHaveLength(0);
	expect((await cli(["--state-dir", f.state], f.request)).exit).toBe(0);
	expect((await cli(["--state-dir", f.state], f.request)).exit).toBe(3);
	const invalid = await cli(["--state-dir", f.state], "invalid JSON"); expect(invalid.exit).toBe(2); expect(invalid.result.code).toBe("invalid_input");
	expect((await cli([], f.request)).exit).toBe(2);
});


test("a quota reader that exits with an inherited stdout pipe still has a bounded wait", async () => {
	const f = setup(); f.request.usageReader.argv = fake("usage", { pipeHang: true });
	f.request.policy.readerTimeoutMs = 150; f.sign();
	const start = Date.now(); const result = await admit(f.request, f.state);
	expect(Date.now() - start).toBeLessThan(1500);
	expect(result).toEqual({ status: "refused", code: "unknown_usage", launches: { engineer: 0, reviewer: 0 } });
	expect(f.events().map(event => event.role)).toEqual(["usage"]);
});

test("cleanup failure preserves actual launches and an explicit unknown receipt", async () => {
	const f = setup(); const guardDir = join(f.state, "admission");
	f.request.reviewer.argv = fake("reviewer", { lockCleanup: guardDir }); f.sign();
	try {
		const result = await admit(f.request, f.state);
		expect(result.status).toBe("unknown"); expect(result.code).toBe("state_unavailable");
		expect(result.launches).toEqual({ engineer: 1, reviewer: 1 });
		expect(guards(f.state)).toHaveLength(1);
		const payload = JSON.parse(result.envelope!.payload);
		expect(payload.status).toBe("unknown"); expect(payload.launches).toEqual(result.launches);
		expect(payload.envelope).toBeUndefined();
	} finally { chmodSync(guardDir, 0o700); }
});

test("oversized review evidence cannot emit a passing envelope outside Mage's framing limit", async () => {
	const f = setup(); f.request.reviewer.argv = fake("reviewer", { largeEvidence: true }); f.sign();
	const result = await admit(f.request, f.state);
	expect(result.status).toBe("unknown"); expect(result.code).toBe("invalid_review");
	expect(Buffer.byteLength(result.envelope!.payload)).toBeLessThan(128 * 1024);
	expect(JSON.parse(result.envelope!.payload).status).toBe("unknown");
	expect(guards(f.state)).toHaveLength(1);
});

test("occupancy becomes stale while the reader waits and still produces zero launches", async () => {
	const f = setup(); f.request.usageReader.argv = fake("usage", { delay: 150 }); f.request.policy.maxAgeMs = 100; f.sign();
	expect((await admit(f.request, f.state)).code).toBe("unknown_occupancy"); expect(f.events().map(event => event.role)).toEqual(["usage"]);
});

test("an already queued Summon task is not silently taken over", async () => {
	const f = setup(); new SummonStore(f.state).start(f.task);
	expect(await admit(f.request, f.state)).toEqual({ status: "unknown", code: "reconciliation_required", launches: { engineer: 0, reviewer: 0 } });
	expect(f.events()).toHaveLength(0); expect(new SummonStore(f.state).status(f.task.id).turns[0]!.state).toBe("queued");
	expect(guards(f.state)).toHaveLength(0);
});

test("missing native usage is preserved as unknown while actual route evidence permits review", async () => {
	const f = setup(); f.request.engineer.argv = fake("engineer", { omitUsage: true }); f.sign();
	expect((await admit(f.request, f.state)).status).toBe("pass");
	expect(new SummonStore(f.state).inspect(f.task.id).turns[0]!.result!.usage).toBeNull();
});
